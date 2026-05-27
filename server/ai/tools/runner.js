const {
    OPENAI_API_KEY,
    AI_CHAT_TOOL_MAX_ROUNDS
} = require('../models/config');
const { ASSISTANT_FUNCTION_TOOLS } = require('./definitions');
const { webSearchDuckDuckGoLite } = require('./web-search');
const { expandAssistantReplyOnePass } = require('../summarizer/expand');
const { polishAiChatReplyShort } = require('../models/reply-polish');
const { openAiGenerateImageDataUrl } = require('../models/image-generation');
const { allowAssistantSupportTicketTool } = require('./support-rate-limit');

/**
 * @param {object} deps من auth-server: allowAiImageRate, buildAccountPlanSnapshotForAssistant, createSupportTicketCore
 */
async function runAssistantChatToolLoop({
    systemContent,
    trimmedMessages,
    model,
    maxTokens,
    temperature,
    frequencyPenalty,
    clientIp,
    assistantCtx,
    deps
}) {
    const { allowAiImageRate, buildAccountPlanSnapshotForAssistant, createSupportTicketCore } = deps;
    const generatedImages = [];
    const executedSupportTickets = [];
    const messages = [{ role: 'system', content: systemContent }, ...trimmedMessages];
    for (let round = 0; round < AI_CHAT_TOOL_MAX_ROUNDS; round++) {
        const payload = {
            model,
            messages,
            tools: ASSISTANT_FUNCTION_TOOLS,
            tool_choice: 'auto',
            max_tokens: maxTokens,
            temperature
        };
        if (frequencyPenalty > 0) {
            payload.frequency_penalty = frequencyPenalty;
        }
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + OPENAI_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(payload)
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            const err = (data.error && data.error.message) || r.statusText || 'openai_error';
            throw new Error(String(err));
        }
        const msg = data.choices && data.choices[0] && data.choices[0].message;
        if (!msg) {
            throw new Error('empty_choice');
        }
        if (!msg.tool_calls || !msg.tool_calls.length) {
            let text = String(msg.content || '').trim();
            text = await expandAssistantReplyOnePass(text);
            text = polishAiChatReplyShort(text);
            return { reply: text || '…', generatedImages, executedSupportTickets };
        }
        messages.push(msg);
        for (const tc of msg.tool_calls) {
            let outStr = '';
            try {
                const fn = tc.function && tc.function.name;
                const args = JSON.parse((tc.function && tc.function.arguments) || '{}');
                if (fn === 'web_search') {
                    outStr = await webSearchDuckDuckGoLite(args.query);
                } else if (fn === 'get_server_time') {
                    outStr = JSON.stringify({ utc: new Date().toISOString() });
                } else if (fn === 'generate_image') {
                    if (clientIp && !allowAiImageRate(clientIp)) {
                        outStr = JSON.stringify({
                            ok: false,
                            error: 'image_rate_limit',
                            message: 'Too many image requests. Try again in a minute.'
                        });
                    } else {
                        const img = await openAiGenerateImageDataUrl(String(args.prompt || ''));
                        if (img.ok) {
                            generatedImages.push({
                                imageDataUrl: img.imageDataUrl,
                                revisedPrompt: img.revisedPrompt || null
                            });
                            outStr = JSON.stringify({
                                ok: true,
                                note: 'Image generated. Summarize for the user; the app will display the image inline.',
                                revised_prompt: img.revisedPrompt || null
                            });
                        } else {
                            outStr = JSON.stringify({
                                ok: false,
                                error: img.message || 'image_generation_failed'
                            });
                        }
                    }
                } else if (fn === 'get_account_plan_snapshot') {
                    const snap = buildAccountPlanSnapshotForAssistant(assistantCtx && assistantCtx.account_email);
                    outStr = JSON.stringify(snap);
                } else if (fn === 'create_support_ticket') {
                    if (!allowAssistantSupportTicketTool(clientIp)) {
                        outStr = JSON.stringify({
                            ok: false,
                            error: 'rate_limit',
                            message: 'Too many support tickets from this session. Try again later or use the support form in the app.'
                        });
                    } else {
                        const fromCtx = assistantCtx && assistantCtx.account_email;
                        const emailUse = String(args.email || fromCtx || '')
                            .trim()
                            .toLowerCase();
                        if (!emailUse || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailUse)) {
                            outStr = JSON.stringify({
                                ok: false,
                                error: 'missing_email',
                                message: 'No valid email — user must sign in or provide an email in the support form.'
                            });
                        } else {
                            const ticketRes = createSupportTicketCore({
                                email: emailUse,
                                subject: args.subject,
                                message: args.message,
                                attachments: []
                            });
                            if (ticketRes.ok) {
                                executedSupportTickets.push({ ticketId: ticketRes.ticketId });
                            }
                            outStr = JSON.stringify(ticketRes);
                        }
                    }
                } else {
                    outStr = JSON.stringify({ error: 'unknown_tool', name: fn });
                }
            } catch (ex) {
                outStr = JSON.stringify({ error: String((ex && ex.message) || ex) });
            }
            messages.push({
                role: 'tool',
                tool_call_id: tc.id,
                content: String(outStr).slice(0, 12000)
            });
        }
    }
    return {
        reply: polishAiChatReplyShort('تعذر إكمال الطلب بعد عدة جولات أدوات. جرّب صياغة أبسط.'),
        generatedImages,
        executedSupportTickets
    };
}

module.exports = { runAssistantChatToolLoop };
