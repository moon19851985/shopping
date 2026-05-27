const {
    OPENAI_API_KEY,
    AI_CHAT_EXPAND_RETRY,
    AI_CHAT_SUMMARY_MODEL
} = require('../models/config');

async function expandAssistantReplyOnePass(shortReply) {
    const s = String(shortReply || '').trim();
    if (!s || s.length >= 120 || !AI_CHAT_EXPAND_RETRY || !OPENAI_API_KEY) {
        return s;
    }
    try {
        const r = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + OPENAI_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                model: AI_CHAT_SUMMARY_MODEL,
                messages: [
                    {
                        role: 'system',
                        content:
                            'Expand the draft into a clearer helpful answer in the SAME language as the draft. Stay on topic. Use short bullets if useful. Max length moderate.'
                    },
                    { role: 'user', content: 'Draft:\n' + s.slice(0, 2500) }
                ],
                max_tokens: 450,
                temperature: 0.4
            })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            return s;
        }
        const out = String(data?.choices?.[0]?.message?.content || '').trim();
        return out || s;
    } catch (_) {
        return s;
    }
}

module.exports = { expandAssistantReplyOnePass };
