const {
    OPENAI_API_KEY,
    OPENAI_HTTP_TIMEOUT_MS,
    AI_CHAT_SUMMARY_MODEL
} = require('../models/config');

async function handleSummarizeHistory(req, res, { runAiWork, getClientIpForRateLimit, allowAiChatRate, adminMetrics }) {
    const bump = adminMetrics && typeof adminMetrics.bump === 'function' ? adminMetrics.bump : () => {};
    if (!OPENAI_API_KEY) {
        bump('ai_summarize_not_configured');
        return res.status(503).json({
            error: 'ai_not_configured',
            message: 'المساعد غير مُفعّل. أضف OPENAI_API_KEY في ملف .env.'
        });
    }
    const ip = getClientIpForRateLimit(req);
    if (!allowAiChatRate(ip)) {
        bump('ai_summarize_rate_limited');
        return res.status(429).json({ error: 'rate_limit', message: 'كثرة الطلبات. حاول بعد دقيقة.' });
    }
    const raw = req.body && req.body.messages;
    if (!Array.isArray(raw) || raw.length < 2) {
        bump('ai_summarize_bad_request');
        return res.status(400).json({ error: 'missing_messages' });
    }
    const prevSummary = String((req.body && req.body.previousSummary) || '').trim().slice(0, 2000);
    const lines = [];
    for (const row of raw.slice(-40)) {
        if (!row || typeof row !== 'object') continue;
        const role = String(row.role || 'user') === 'assistant' ? 'Assistant' : 'User';
        const c = String(row.content || '').trim().slice(0, 8000);
        if (!c) continue;
        lines.push(`${role}: ${c}`);
    }
    if (lines.length < 2) {
        bump('ai_summarize_bad_request');
        return res.status(400).json({ error: 'empty_messages' });
    }
    const bundle = lines.join('\n\n');
    const sys =
        'You compress multi-turn dialogue into a concise summary. Prefer Arabic if the dialogue is mostly Arabic; otherwise match the dialogue language. Max about 1200 characters. Use short bullets or paragraphs. Capture facts, decisions, names, and open questions. Do not invent.';
    const userContent =
        (prevSummary ? `Prior context summary (may be incomplete):\n${prevSummary}\n\n` : '') +
        `Messages to fold into an updated summary:\n${bundle}`;
    try {
        bump('ai_summarize_requests');
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
                    body: JSON.stringify({
                        model: AI_CHAT_SUMMARY_MODEL,
                        messages: [
                            { role: 'system', content: sys },
                            { role: 'user', content: userContent.slice(0, 100000) }
                        ],
                        max_tokens: 500,
                        temperature: 0.35
                    }),
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
            console.error('OpenAI summarize-history error:', r.status, errCode, detail);
            bump('ai_summarize_openai_error');
            return res.status(502).json({
                error: 'openai_error',
                message: 'تعذر تلخيص المحادثة.',
                openaiCode: errCode || null,
                openaiMessage: String(detail).slice(0, 500)
            });
        }
        let summary =
            (data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '';
        summary = String(summary).trim().slice(0, 2000);
        if (!summary) {
            bump('ai_summarize_openai_error');
            return res.status(502).json({ error: 'empty_summary', message: 'لم يُرجع النموذج ملخصاً.' });
        }
        bump('ai_summarize_success');
        return res.json({ ok: true, summary });
    } catch (e) {
        console.error('ai/summarize-history:', e);
        if (e && e.message === 'ai_queue_full') {
            bump('ai_summarize_queue_full');
            return res.status(503).json({
                error: 'server_busy',
                message: 'الخدمة مشغولة حالياً. حاول بعد ثوانٍ قليلة.'
            });
        }
        if (e && e.name === 'AbortError') {
            bump('ai_summarize_timeout');
            return res.status(504).json({
                error: 'upstream_timeout',
                message: 'انتهت مهلة التلخيص. حاول مجدداً.'
            });
        }
        bump('ai_summarize_other_error');
        return res.status(500).json({ error: 'proxy_failed', message: 'خطأ في تلخيص المحادثة.' });
    }
}

module.exports = { handleSummarizeHistory };
