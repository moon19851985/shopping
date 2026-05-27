/**
 * قصّ أحدث الرسائل حسب وزن تقريبي (حروف ≈ رموز) بدل الاعتماد على العدد فقط.
 */
const { AI_CHAT_HISTORY_LIMIT } = require('../models/config');

function approxMessageWeightChars(m) {
    if (!m || typeof m !== 'object') {
        return 4;
    }
    const role = String(m.role || 'user');
    const text = String(m.content || '');
    let w = Math.min(text.length, 12000) + 8;
    if (role !== 'assistant' && Array.isArray(m.images)) {
        for (const u of m.images) {
            const s = String(u || '');
            w += Math.min(s.length, 500000) > 200000 ? 200000 : Math.min(s.length, 500000);
        }
    }
    return w;
}

/**
 * يأخذ لاحقة من raw رسائل العميل بحيث يبقى تحت الميزانية وتحت حد أقصى للعدد.
 * @param {Array} rawMessages
 * @returns {Array}
 */
function trimRawClientMessagesForBudget(rawMessages, budgetChars, maxMessages) {
    const budget = Math.max(4000, Number(budgetChars) || 24000);
    const maxN = Math.max(4, Number(maxMessages) || AI_CHAT_HISTORY_LIMIT);
    if (!Array.isArray(rawMessages) || rawMessages.length === 0) {
        return [];
    }
    const capCount = Math.min(maxN, rawMessages.length);
    let start = rawMessages.length - capCount;
    let slice = rawMessages.slice(start);
    let weight = slice.reduce((a, m) => a + approxMessageWeightChars(m), 0);
    while (weight > budget && slice.length > 2) {
        slice = slice.slice(1);
        weight = slice.reduce((a, m) => a + approxMessageWeightChars(m), 0);
    }
    return slice;
}

module.exports = {
    trimRawClientMessagesForBudget,
    approxMessageWeightChars
};
