/**
 * مسارات /api/ai/chat و summarize-history و image.
 * يعتمد على دوال التزامن والحدود من auth-server عبر deps.
 */
const {
    normalizeEnvSecret,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    OPENAI_MODEL_COMPLEX,
    OPENAI_HTTP_TIMEOUT_MS,
    AI_CHAT_STREAM,
    AI_CHAT_STREAM_TIMEOUT_MS,
    OPENAI_CHAT_TOOLS,
    AI_CHAT_MAX_TOKENS,
    AI_CHAT_MAX_TOKENS_VISION,
    AI_CHAT_TEMPERATURE,
    AI_CHAT_FREQUENCY_PENALTY
} = require('./models/config');
const { AI_CHAT_TEXT_SYSTEM_PROMPT, AI_CHAT_VISION_SYSTEM_PROMPT } = require('./prompts/system');
const { sanitizeAssistantContext, buildAssistantMemorySystemBlock } = require('./memory/context');
const { isComplexPrompt } = require('./models/complexity');
const { getLatestUserTextFromWireMessages } = require('./models/chat-routing');
const { polishAiChatReplyShort } = require('./models/reply-polish');
const {
    buildOpenAiMessagesFromClient,
    openAiMessagesNeedVision,
    rawClientMessagesHadImageArrays
} = require('./vision/wire-messages');
const { sendSseTextChunksAndImages, pipeOpenAiChatStreamToClient } = require('./streaming/sse');
const { expandAssistantReplyOnePass } = require('./summarizer/expand');
const { handleSummarizeHistory } = require('./summarizer/history');
const { runAssistantChatToolLoop } = require('./tools/runner');
const { openAiGenerateImageDataUrl } = require('./models/image-generation');

function registerAiRoutes(app, deps) {
    const {
        runAiWork,
        getClientIpForRateLimit,
        allowAiChatRate,
        allowAiImageRate,
        buildAccountPlanSnapshotForAssistant,
        createSupportTicketCore,
        conversationStore,
        findVerifiedRegistrationByEmail,
        adminMetrics
    } = deps;
    const m = adminMetrics && typeof adminMetrics.bump === 'function' ? adminMetrics.bump : () => {};

    const toolDeps = {
        allowAiImageRate,
        buildAccountPlanSnapshotForAssistant,
        createSupportTicketCore
    };

    app.post('/api/ai/chat', async (req, res) => {
        if (!OPENAI_API_KEY) {
            m('ai_chat_not_configured');
            return res.status(503).json({
                error: 'ai_not_configured',
                message: 'المساعد الذكي غير مُفعّل. أضف OPENAI_API_KEY في ملف .env وأعد تشغيل الخادم.'
            });
        }
        const ip = getClientIpForRateLimit(req);
        if (!allowAiChatRate(ip)) {
            m('ai_chat_rate_limited');
            return res.status(429).json({ error: 'rate_limit', message: 'كثرة الطلبات. حاول بعد دقيقة.' });
        }
        const raw = req.body && req.body.messages;
        if (!Array.isArray(raw) || raw.length === 0) {
            m('ai_chat_bad_request');
            return res.status(400).json({ error: 'missing_messages' });
        }
        const built = buildOpenAiMessagesFromClient(raw);
        if (built.error) {
            m('ai_chat_bad_request');
            return res.status(400).json({ error: built.error, message: built.message });
        }
        const trimmed = built.messages;
        if (!trimmed.length) {
            m('ai_chat_bad_request');
            return res.status(400).json({ error: 'empty_messages' });
        }
        if (rawClientMessagesHadImageArrays(raw) && !openAiMessagesNeedVision(trimmed)) {
            console.error('[ai/chat] وصلت مصفوفات صور من العميل لكن لم يُبنَ محتوى رؤية — تحقق من sanitize أو التزامن.');
            m('ai_chat_bad_request');
            return res.status(500).json({
                error: 'vision_payload_mismatch',
                message:
                    'تعذر تمرير الصور للمساعد. جرّب صورة JPG/PNG أصغر، وأعد تشغيل auth-server بعد التحديث.'
            });
        }
        m('ai_chat_requests');
        const needsVision = openAiMessagesNeedVision(trimmed);
        const latestUserText = getLatestUserTextFromWireMessages(trimmed);
        const needsComplexModel = !needsVision && isComplexPrompt(latestUserText);
        let modelForRequest = needsComplexModel ? OPENAI_MODEL_COMPLEX : OPENAI_MODEL;
        if (needsVision) {
            const visionOverride = normalizeEnvSecret(process.env.OPENAI_VISION_MODEL);
            if (visionOverride) {
                modelForRequest = visionOverride;
            } else if (/gpt-3\.5/i.test(modelForRequest) || /instruct/i.test(modelForRequest)) {
                modelForRequest = 'gpt-4o-mini';
                console.warn('[ai/chat] النموذج الحالي لا يدعم الصور — استخدام gpt-4o-mini لهذا الطلب.');
            }
        }
        if (!needsVision && needsComplexModel) {
            console.log('[ai/chat] complex routing ->', modelForRequest);
        }
        let memCtx = sanitizeAssistantContext(req.body && req.body.assistantContext);
        const convId = String((req.body && req.body.conversationId) || '').trim();
        const accountForConv = String(
            (req.body && req.body.accountEmail) ||
                (memCtx && memCtx.account_email) ||
                ''
        )
            .trim()
            .toLowerCase();
        if (conversationStore && convId && accountForConv && typeof findVerifiedRegistrationByEmail === 'function') {
            const reg = findVerifiedRegistrationByEmail(accountForConv);
            if (reg) {
                const row = conversationStore.getById(convId, accountForConv);
                if (row) {
                    const base = memCtx ? { ...memCtx } : {};
                    const dbSum = (row.summary || '').trim();
                    const clientSum = (base.conversation_summary || '').trim();
                    if (dbSum && clientSum) {
                        base.conversation_summary = [dbSum, clientSum].join('\n\n---\n').slice(0, 2000);
                    } else if (dbSum) {
                        base.conversation_summary = dbSum.slice(0, 2000);
                    }
                    if (Array.isArray(row.pinnedFacts) && row.pinnedFacts.length) {
                        base.pinned_facts = row.pinnedFacts;
                    }
                    memCtx = sanitizeAssistantContext(base);
                }
            }
        }
        let systemBase = needsVision ? AI_CHAT_VISION_SYSTEM_PROMPT : AI_CHAT_TEXT_SYSTEM_PROMPT;
        const memoryBlock = buildAssistantMemorySystemBlock(memCtx);
        if (memoryBlock) {
            systemBase = `${systemBase}\n\n---\n${memoryBlock}`;
        }
        if (needsComplexModel && !needsVision) {
            systemBase +=
                '\n\n[This turn likely needs depth: reason step-by-step internally, then answer clearly with structure (headings/bullets if useful).]';
        }
        let maxOut = needsVision ? AI_CHAT_MAX_TOKENS_VISION : AI_CHAT_MAX_TOKENS;
        if (needsComplexModel && !needsVision) {
            maxOut = Math.min(2048, Math.ceil(maxOut * 1.12));
        }
        const clientAskedStream = !!(req.body && req.body.stream);
        const useStream = AI_CHAT_STREAM && clientAskedStream;
        if (needsVision) {
            let imagePartCount = 0;
            for (const msg of trimmed) {
                const c = msg.content;
                if (Array.isArray(c)) imagePartCount += c.filter((p) => p && p.type === 'image_url').length;
            }
            console.log('[ai/chat] طلب تحليل صور — النموذج:', modelForRequest, '— أجزاء صورة:', imagePartCount);
        }
        const useToolLoop = OPENAI_CHAT_TOOLS && OPENAI_API_KEY && !needsVision;
        if (useToolLoop) {
            const systemWithTools =
                systemBase +
                '\n\n[Tools: web_search (DuckDuckGo snippets), generate_image, get_server_time (UTC), get_account_plan_snapshot (needs assistantContext account_email), create_support_ticket (real ticket — only if user clearly asks; needs email from context or args). ' +
                'IMPORTANT: Do NOT call web_search for GOSTA in-app subscription plans, plan comparisons, or «what features does basic/advanced plan include» — those answers MUST come only from the OFFICIAL GOSTA APP FACTS block already in this system message; web_search often returns unrelated «GOSTA» hits and wrong features. Call tools only when useful; then answer in the user\'s language.]';
            try {
                const toolResult = await runAiWork(() =>
                    runAssistantChatToolLoop({
                        systemContent: systemWithTools,
                        trimmedMessages: trimmed,
                        model: modelForRequest,
                        maxTokens: maxOut,
                        temperature: AI_CHAT_TEMPERATURE,
                        frequencyPenalty: AI_CHAT_FREQUENCY_PENALTY,
                        clientIp: ip,
                        assistantCtx: memCtx,
                        deps: toolDeps
                    })
                );
                const replyTool = polishAiChatReplyShort(String(toolResult.reply || '').trim() || '…');
                const genImgs = toolResult.generatedImages || [];
                const execTickets = toolResult.executedSupportTickets || [];
                const payloadJson = { ok: true, reply: replyTool };
                if (genImgs.length) {
                    payloadJson.generatedImages = genImgs;
                }
                if (execTickets.length) {
                    payloadJson.executedSupportTickets = execTickets;
                }
                if (useStream) {
                    sendSseTextChunksAndImages(res, replyTool, genImgs, execTickets);
                    m('ai_chat_tool_stream_ok');
                    return;
                }
                m('ai_chat_tool_json_ok');
                return res.json(payloadJson);
            } catch (toolErr) {
                if (toolErr && toolErr.message === 'ai_queue_full') {
                    m('ai_chat_queue_full');
                    return res.status(503).json({
                        error: 'server_busy',
                        message: 'الخدمة مشغولة حالياً. حاول بعد ثوانٍ قليلة.'
                    });
                }
                m('ai_chat_tool_loop_fallback');
                console.warn('[ai/chat] tool loop failed, using standard chat:', toolErr && toolErr.message);
            }
        }
        const payload = {
            model: modelForRequest,
            messages: [
                {
                    role: 'system',
                    content: systemBase
                },
                ...trimmed
            ],
            max_tokens: maxOut,
            temperature: AI_CHAT_TEMPERATURE
        };
        if (AI_CHAT_FREQUENCY_PENALTY > 0) {
            payload.frequency_penalty = AI_CHAT_FREQUENCY_PENALTY;
        }
        try {
            if (useStream) {
                payload.stream = true;
                await runAiWork(async () => {
                    const ac = new AbortController();
                    const timer = setTimeout(() => ac.abort(), AI_CHAT_STREAM_TIMEOUT_MS);
                    try {
                        const r = await fetch('https://api.openai.com/v1/chat/completions', {
                            method: 'POST',
                            headers: {
                                Authorization: 'Bearer ' + OPENAI_API_KEY,
                                'Content-Type': 'application/json'
                            },
                            body: JSON.stringify(payload),
                            signal: ac.signal
                        });
                        if (!r.ok) {
                            const data = await r.json().catch(() => ({}));
                            const errObj = data && data.error;
                            const detail = (errObj && errObj.message) || r.statusText || String(r.status);
                            const errCode = (errObj && errObj.code) || '';
                            const oops = new Error('openai_stream_http');
                            oops.openaiStatus = r.status;
                            oops.openaiCode = errCode;
                            oops.openaiMessage = detail;
                            throw oops;
                        }
                        res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
                        res.setHeader('Cache-Control', 'no-cache, no-transform');
                        res.setHeader('Connection', 'keep-alive');
                        res.setHeader('X-Accel-Buffering', 'no');
                        if (typeof res.flushHeaders === 'function') {
                            res.flushHeaders();
                        }
                        await pipeOpenAiChatStreamToClient(r.body, res);
                        m('ai_chat_standard_stream_ok');
                    } finally {
                        clearTimeout(timer);
                    }
                });
                return;
            }

            const r = await runAiWork(async () => {
                const ac = new AbortController();
                const timer = setTimeout(() => ac.abort(), OPENAI_HTTP_TIMEOUT_MS);
                try {
                    return await fetch('https://api.openai.com/v1/chat/completions', {
                        method: 'POST',
                        headers: {
                            Authorization: 'Bearer ' + OPENAI_API_KEY,
                            'Content-Type': 'application/json'
                        },
                        body: JSON.stringify(payload),
                        signal: ac.signal
                    });
                } finally {
                    clearTimeout(timer);
                }
            });
            const data = await r.json().catch(() => ({}));
            if (!r.ok) {
                const errObj = data && data.error;
                const detail = (errObj && errObj.message) || r.statusText || String(r.status);
                const errCode = (errObj && errObj.code) || '';
                console.error('OpenAI API error:', r.status, errCode, detail);
                let messageAr = 'تعذر جلب رد المساعد.';
                if (errCode === 'insufficient_quota') {
                    messageAr += ' غالباً لا يوجد رصيد أو لم تُفعّل الفوترة في حساب OpenAI.';
                } else if (errCode === 'invalid_api_key' || r.status === 401) {
                    messageAr += ' المفتاح مرفوض أو ملغى — أنشئ مفتاحاً جديداً من لوحة OpenAI.';
                } else if (errCode === 'model_not_found') {
                    messageAr += ' النموذج غير متاح لحسابك — جرّب تغيير OPENAI_MODEL في .env.';
                }
                m('ai_chat_openai_error');
                return res.status(502).json({
                    error: 'openai_error',
                    message: messageAr,
                    openaiCode: errCode || null,
                    openaiMessage: String(detail).slice(0, 500)
                });
            }
            let reply = (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
            reply = await expandAssistantReplyOnePass(String(reply).trim());
            const replyOut = polishAiChatReplyShort(reply);
            m('ai_chat_standard_json_ok');
            return res.json({ ok: true, reply: replyOut || '…' });
        } catch (e) {
            console.error('ai/chat proxy:', e);
            if (e && e.message === 'openai_stream_http') {
                m('ai_chat_openai_error');
                const errCode = e.openaiCode || '';
                const detail = e.openaiMessage || '';
                let messageAr = 'تعذر جلب رد المساعد.';
                if (errCode === 'insufficient_quota') {
                    messageAr += ' غالباً لا يوجد رصيد أو لم تُفعّل الفوترة في حساب OpenAI.';
                } else if (errCode === 'invalid_api_key' || e.openaiStatus === 401) {
                    messageAr += ' المفتاح مرفوض أو ملغى — أنشئ مفتاحاً جديداً من لوحة OpenAI.';
                } else if (errCode === 'model_not_found') {
                    messageAr += ' النموذج غير متاح لحسابك — جرّب تغيير OPENAI_MODEL في .env.';
                }
                return res.status(502).json({
                    error: 'openai_error',
                    message: messageAr,
                    openaiCode: errCode || null,
                    openaiMessage: String(detail).slice(0, 500)
                });
            }
            if (e && e.message === 'ai_queue_full') {
                m('ai_chat_queue_full');
                return res.status(503).json({
                    error: 'server_busy',
                    message: 'الخدمة مشغولة حالياً. حاول بعد ثوانٍ قليلة.'
                });
            }
            if (e && e.name === 'AbortError') {
                m('ai_chat_timeout');
                return res.status(504).json({
                    error: 'upstream_timeout',
                    message: 'الخدمة مشغولة الآن. جرّب سؤالاً أقصر أو أعد المحاولة بعد ثوانٍ.'
                });
            }
            if (res.headersSent) {
                try {
                    res.end();
                } catch (_) {}
                return;
            }
            m('ai_chat_other_error');
            return res.status(500).json({ error: 'proxy_failed', message: 'خطأ في الاتصال بالمساعد.' });
        }
    });

    app.post('/api/ai/summarize-history', (req, res) =>
        handleSummarizeHistory(req, res, { runAiWork, getClientIpForRateLimit, allowAiChatRate, adminMetrics })
    );

    app.post('/api/ai/image', async (req, res) => {
        if (!OPENAI_API_KEY) {
            m('ai_image_not_configured');
            return res.status(503).json({
                error: 'ai_not_configured',
                message: 'المساعد غير مُفعّل. أضف OPENAI_API_KEY في ملف .env.'
            });
        }
        const ip = getClientIpForRateLimit(req);
        if (!allowAiImageRate(ip)) {
            m('ai_image_rate_limited');
            return res.status(429).json({ error: 'rate_limit', message: 'كثرة طلبات إنشاء الصور. حاول بعد دقيقة.' });
        }
        const rawPrompt = String((req.body && req.body.prompt) || '').trim();
        if (rawPrompt.length < 4) {
            m('ai_image_bad_request');
            return res.status(400).json({ error: 'missing_prompt', message: 'اكتب وصفاً أوضح للصورة (عدة كلمات على الأقل).' });
        }
        if (rawPrompt.length > 4000) {
            m('ai_image_bad_request');
            return res.status(400).json({ error: 'prompt_too_long', message: 'الوصف طويل جداً.' });
        }
        m('ai_image_requests');
        try {
            const result = await runAiWork(() => openAiGenerateImageDataUrl(rawPrompt));
            if (!result.ok) {
                const errCode = result.openaiCode || '';
                const detail = result.message || '';
                console.error('OpenAI images error:', errCode, detail);
                let messageAr = 'تعذر إنشاء الصورة.';
                if (errCode === 'content_policy_violation' || /content policy|safety/i.test(String(detail))) {
                    messageAr += ' الوصف قد يخالف سياسة المحتوى — جرّب صياغة أخرى.';
                } else if (errCode === 'insufficient_quota') {
                    messageAr += ' تحقق من الرصيد في OpenAI.';
                } else if (/model|dall-e|does not exist|invalid value/i.test(String(detail))) {
                    messageAr +=
                        ' النموذج غير مدعوم أو أُوقف — عيّن في .env: OPENAI_IMAGE_MODEL=gpt-image-1 (أو gpt-image-1-mini) وأعد تشغيل الخادم.';
                } else if (/too long|prompt_too_long/i.test(String(detail))) {
                    messageAr =
                        'الوصف أصبح أطول من المسموح بعد الضبط الافتراضي. اختصر النص أو عيّن OPENAI_IMAGE_PROMPT_SUFFIX=0 في .env.';
                    m('ai_image_bad_request');
                    return res.status(400).json({ error: 'prompt_too_long', message: messageAr });
                }
                m('ai_image_openai_error');
                return res.status(502).json({
                    error: 'openai_image_error',
                    message: messageAr,
                    openaiCode: errCode || null,
                    openaiMessage: String(detail).slice(0, 500)
                });
            }
            m('ai_image_success');
            return res.json({
                ok: true,
                imageDataUrl: result.imageDataUrl,
                revisedPrompt: result.revisedPrompt || null
            });
        } catch (e) {
            console.error('ai/image proxy:', e);
            if (e && e.message === 'ai_queue_full') {
                m('ai_image_queue_full');
                return res.status(503).json({
                    error: 'server_busy',
                    message: 'الخدمة مشغولة حالياً. حاول بعد ثوانٍ قليلة.'
                });
            }
            m('ai_image_other_error');
            return res.status(500).json({ error: 'proxy_failed', message: 'خطأ في الاتصال بخدمة الصور.' });
        }
    });
}

module.exports = { registerAiRoutes };
