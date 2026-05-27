/**
 * تحويل رسائل العميل إلى تنسيق OpenAI (نص أو أجزاء نص+صور).
 * الصور تُرسَل فقط مع آخر رسالة مستخدم تحتوي صوراً.
 */
const {
    AI_CHAT_HISTORY_LIMIT,
    AI_CHAT_RECENT_BUDGET_CHARS,
    AI_CHAT_MAX_IMAGES_PER_MESSAGE,
    AI_CHAT_MAX_IMAGE_DATA_URL_CHARS
} = require('../models/config');
const { trimRawClientMessagesForBudget } = require('../memory/recent-trim');

function sanitizeAiChatImageDataUrl(s) {
    const str = String(s || '').trim();
    if (!str.startsWith('data:image/') || str.length < 32) return null;
    if (!/;[\s]*base64,/i.test(str)) return null;
    const semi = str.indexOf(';');
    if (semi < 10) return null;
    const mimePart = str.slice(5, semi).toLowerCase();
    const baseMime = mimePart.replace(/^image\//, '').split('+')[0];
    const allowed = new Set(['png', 'jpeg', 'jpg', 'webp', 'gif', 'pjpeg', 'x-png']);
    if (!allowed.has(baseMime)) return null;
    if (str.length > AI_CHAT_MAX_IMAGE_DATA_URL_CHARS) return null;
    return str;
}

function openAiMessagesNeedVision(msgs) {
    if (!Array.isArray(msgs)) return false;
    for (const msg of msgs) {
        if (!msg || msg.role !== 'user') continue;
        const c = msg.content;
        if (Array.isArray(c) && c.some((p) => p && p.type === 'image_url')) return true;
    }
    return false;
}

function rawClientMessagesHadImageArrays(rawMessages) {
    if (!Array.isArray(rawMessages)) return false;
    return rawMessages.some((m) => m && Array.isArray(m.images) && m.images.length > 0);
}

function buildOpenAiMessagesFromClient(rawMessages) {
    const budgeted = trimRawClientMessagesForBudget(
        rawMessages,
        AI_CHAT_RECENT_BUDGET_CHARS,
        AI_CHAT_HISTORY_LIMIT
    );
    const slice = Array.isArray(budgeted) ? budgeted : [];
    let lastImageUserIndex = -1;
    for (let i = slice.length - 1; i >= 0; i--) {
        const m = slice[i];
        if (!m || String(m.role || 'user') === 'assistant') continue;
        const imgs = Array.isArray(m.images) ? m.images : [];
        if (imgs.length) {
            lastImageUserIndex = i;
            break;
        }
    }
    const openAiMsgs = [];
    for (let i = 0; i < slice.length; i++) {
        const m = slice[i] || {};
        const role = String(m.role || 'user') === 'assistant' ? 'assistant' : 'user';
        if (role === 'assistant') {
            const c = String(m.content || '').slice(0, 12000);
            if (c.trim()) openAiMsgs.push({ role: 'assistant', content: c });
            continue;
        }
        const text = String(m.content || '').slice(0, 12000);
        const hadImagesInPayload = Array.isArray(m.images) && m.images.length > 0;
        const images = [];
        if (hadImagesInPayload && i === lastImageUserIndex) {
            for (const u of m.images) {
                const clean = sanitizeAiChatImageDataUrl(u);
                if (clean) images.push(clean);
                if (images.length >= AI_CHAT_MAX_IMAGES_PER_MESSAGE) break;
            }
            if (images.length === 0) {
                return {
                    error: 'invalid_images',
                    message:
                        'لم يُقبل أي صورة. استخدم JPG أو PNG أو WebP أو GIF (صيغة data URL صالحة). صور آيفون HEIC/HEIF غير مدعومة — صوّر أو صدّر كـ JPG من تطبيق الصور.'
                };
            }
        }
        let userText = text.trim();
        if (hadImagesInPayload && i !== lastImageUserIndex) {
            userText =
                (userText || 'رسالة مع صور') +
                ' [صور من رسالة سابقة — تُعاد معالجة آخر رسولة صور فقط لتوفير الحجم]';
        }
        if (!userText && images.length === 0) continue;
        if (images.length === 0) {
            openAiMsgs.push({ role: 'user', content: userText || '…' });
        } else {
            const displayText =
                userText ||
                'صف محتوى الصورة، ثم استخرج كل النص الظاهر فيها حرفياً قدر الإمكان (OCR) ضمن قسم «النص الظاهر في الصورة»، ثم أجب عن أي سؤال إن وُجد.';
            const parts = [];
            for (const url of images) {
                parts.push({ type: 'image_url', image_url: { url, detail: 'high' } });
            }
            parts.push({
                type: 'text',
                text: displayText.slice(0, 4000)
            });
            openAiMsgs.push({ role: 'user', content: parts });
        }
    }
    return { messages: openAiMsgs };
}

module.exports = {
    sanitizeAiChatImageDataUrl,
    openAiMessagesNeedVision,
    rawClientMessagesHadImageArrays,
    buildOpenAiMessagesFromClient
};
