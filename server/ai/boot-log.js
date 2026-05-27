const {
    OPENAI_API_KEY,
    OPENAI_MODEL,
    OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_PROMPT_SUFFIX,
    AI_CHAT_STREAM,
    AI_CHAT_HISTORY_LIMIT,
    AI_CHAT_MAX_TOKENS,
    AI_CHAT_MAX_TOKENS_VISION,
    AI_CHAT_TEMPERATURE
} = require('./models/config');

function logAiStartup() {
    if (!OPENAI_API_KEY) return;
    const tail = OPENAI_API_KEY.length > 8 ? OPENAI_API_KEY.slice(-4) : '****';
    console.log(
        '[auth-server] مساعد OpenAI: مفعّل | محادثة:',
        OPENAI_MODEL,
        '| صور:',
        OPENAI_IMAGE_MODEL,
        '| نهاية المفتاح:',
        tail
    );
    if (OPENAI_IMAGE_PROMPT_SUFFIX) {
        console.log(
            '[auth-server] لاحقة إنشاء الصور (فوتو/واقعية): مفعّل، طول',
            OPENAI_IMAGE_PROMPT_SUFFIX.length,
            'محرف'
        );
    } else {
        console.log('[auth-server] لاحقة إنشاء الصور: معطّل');
    }
    console.log('[auth-server] محادثة SSE (بث تدريجي):', AI_CHAT_STREAM ? 'مفعّل' : 'معطّل');
    console.log(
        '[auth-server] محادثة: سجل حتى',
        AI_CHAT_HISTORY_LIMIT,
        'رسالة | max_tokens',
        AI_CHAT_MAX_TOKENS,
        '/',
        AI_CHAT_MAX_TOKENS_VISION,
        '| temperature',
        AI_CHAT_TEMPERATURE
    );
}

module.exports = { logAiStartup };
