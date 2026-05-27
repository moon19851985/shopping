/** استخراج آخر نص مستخدم من رسائل OpenAI الجاهزة */

function getLatestUserTextFromWireMessages(msgs) {
    if (!Array.isArray(msgs)) return '';
    for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        if (!m || m.role !== 'user') continue;
        const c = m.content;
        if (typeof c === 'string') return c.trim();
        if (Array.isArray(c)) {
            const textPart = c.find((p) => p && p.type === 'text' && typeof p.text === 'string');
            if (textPart) return String(textPart.text).trim();
        }
    }
    return '';
}

module.exports = { getLatestUserTextFromWireMessages };
