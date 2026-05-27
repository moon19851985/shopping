/**
 * إعدادات طبقة المساعد (محادثة، أدوات، رؤية، تلخيص، توليد صور DALL·E للمسارات العامة).
 * يقرأ process.env — يفترض أن dotenv وُضِع في نقطة الدخول قبل التحميل.
 */
function normalizeEnvSecret(value) {
    let s = String(value || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

const OPENAI_API_KEY = normalizeEnvSecret(process.env.OPENAI_API_KEY);
/** افتراضي أسرع — للجودة الأعلى عيّن OPENAI_MODEL=gpt-4o في .env */
const OPENAI_MODEL = normalizeEnvSecret(process.env.OPENAI_MODEL) || 'gpt-4o-mini';
const OPENAI_MODEL_COMPLEX = normalizeEnvSecret(process.env.OPENAI_MODEL_COMPLEX) || 'gpt-4o-mini';
const OPENAI_IMAGE_MODEL = normalizeEnvSecret(process.env.OPENAI_IMAGE_MODEL) || 'gpt-image-1';

const OPENAI_IMAGE_PROMPT_SUFFIX_DEFAULT =
    'Ultra realistic photograph, natural soft lighting, shallow depth of field, lifelike textures, photorealistic cinematic look; strictly not cartoon, anime, illustration, drawing, or cute stylized art. Do not render any visible text, numbers, watermarks, borders, dimension labels, resolution specs, or camera settings as overlays or signage in the image.';
const OPENAI_IMAGE_PROMPT_SUFFIX_RAW = process.env.OPENAI_IMAGE_PROMPT_SUFFIX;
const OPENAI_IMAGE_PROMPT_SUFFIX_OFF = new Set(['0', 'false', 'off', 'no', '']);
let OPENAI_IMAGE_PROMPT_SUFFIX = '';
if (OPENAI_IMAGE_PROMPT_SUFFIX_RAW === undefined) {
    OPENAI_IMAGE_PROMPT_SUFFIX = OPENAI_IMAGE_PROMPT_SUFFIX_DEFAULT;
} else if (OPENAI_IMAGE_PROMPT_SUFFIX_OFF.has(String(OPENAI_IMAGE_PROMPT_SUFFIX_RAW).trim().toLowerCase())) {
    OPENAI_IMAGE_PROMPT_SUFFIX = '';
} else {
    OPENAI_IMAGE_PROMPT_SUFFIX = normalizeEnvSecret(OPENAI_IMAGE_PROMPT_SUFFIX_RAW);
}
const OPENAI_IMAGE_PROMPT_SUFFIX_MAX = 800;

const AI_CHAT_HISTORY_LIMIT = Math.min(
    40,
    Math.max(4, Number(process.env.AI_CHAT_HISTORY_LIMIT || 16) || 16)
);
/** ميزانية تقريبية لحجم «الرسائل الحديثة» بالحروف (≈ ربع التوكنات) قبل بناء طلب OpenAI */
const AI_CHAT_RECENT_BUDGET_CHARS = Math.min(
    120000,
    Math.max(8000, Number(process.env.AI_CHAT_RECENT_BUDGET_CHARS || 28000) || 28000)
);
const AI_CHAT_MAX_TOKENS = Math.min(
    4096,
    Math.max(256, Number(process.env.AI_CHAT_MAX_TOKENS || 700) || 700)
);
const AI_CHAT_MAX_TOKENS_VISION = Math.min(
    4096,
    Math.max(400, Number(process.env.AI_CHAT_MAX_TOKENS_VISION || 900) || 900)
);
const AI_CHAT_TEMPERATURE = Math.min(
    1,
    Math.max(0, Number(process.env.AI_CHAT_TEMPERATURE || 0.55) || 0.55)
);
const AI_CHAT_FREQUENCY_PENALTY = Math.min(
    0.5,
    Math.max(0, Number(process.env.AI_CHAT_FREQUENCY_PENALTY || 0.12) || 0.12)
);
const OPENAI_HTTP_TIMEOUT_MS = Math.max(
    5000,
    Number(process.env.OPENAI_HTTP_TIMEOUT_MS || 18000) || 18000
);
const AI_CHAT_STREAM_TIMEOUT_MS = Math.max(
    30000,
    Number(process.env.AI_CHAT_STREAM_TIMEOUT_MS || 120000) || 120000
);
const AI_CHAT_STREAM_RAW = String(process.env.AI_CHAT_STREAM ?? '1').trim().toLowerCase();
const AI_CHAT_STREAM = !(
    AI_CHAT_STREAM_RAW === '0' ||
    AI_CHAT_STREAM_RAW === 'false' ||
    AI_CHAT_STREAM_RAW === 'off' ||
    AI_CHAT_STREAM_RAW === 'no'
);
const OPENAI_CHAT_TOOLS_RAW = String(process.env.OPENAI_CHAT_TOOLS ?? '1').trim().toLowerCase();
const OPENAI_CHAT_TOOLS = !(
    OPENAI_CHAT_TOOLS_RAW === '0' ||
    OPENAI_CHAT_TOOLS_RAW === 'false' ||
    OPENAI_CHAT_TOOLS_RAW === 'off' ||
    OPENAI_CHAT_TOOLS_RAW === 'no'
);
/** معطّل افتراضياً — يتجنب طلب OpenAI ثانٍ بعد الرد القصير ويُسرّع المسار */
const AI_CHAT_EXPAND_RETRY_RAW = String(process.env.AI_CHAT_EXPAND_RETRY ?? '0').trim().toLowerCase();
const AI_CHAT_EXPAND_RETRY = !(
    AI_CHAT_EXPAND_RETRY_RAW === '0' ||
    AI_CHAT_EXPAND_RETRY_RAW === 'false' ||
    AI_CHAT_EXPAND_RETRY_RAW === 'off' ||
    AI_CHAT_EXPAND_RETRY_RAW === 'no'
);
const AI_CHAT_SUMMARY_MODEL = normalizeEnvSecret(process.env.AI_CHAT_SUMMARY_MODEL) || 'gpt-4o-mini';
const AI_CHAT_TOOL_MAX_ROUNDS = Math.min(8, Math.max(2, Number(process.env.AI_CHAT_TOOL_MAX_ROUNDS || 3) || 3));

const AI_ASSISTANT_SUPPORT_TOOL_WINDOW_MS = Math.max(
    60000,
    Number(process.env.AI_ASSISTANT_SUPPORT_TOOL_WINDOW_MS || 600000) || 600000
);
const AI_ASSISTANT_SUPPORT_TOOL_MAX = Math.max(
    1,
    Math.min(10, Number(process.env.AI_ASSISTANT_SUPPORT_TOOL_MAX || 2) || 2)
);

const AI_CHAT_MAX_IMAGES_PER_MESSAGE = 4;
const AI_CHAT_MAX_IMAGE_DATA_URL_CHARS = 6 * 1024 * 1024;

module.exports = {
    normalizeEnvSecret,
    OPENAI_API_KEY,
    OPENAI_MODEL,
    OPENAI_MODEL_COMPLEX,
    OPENAI_IMAGE_MODEL,
    OPENAI_IMAGE_PROMPT_SUFFIX,
    OPENAI_IMAGE_PROMPT_SUFFIX_MAX,
    OPENAI_HTTP_TIMEOUT_MS,
    AI_CHAT_STREAM_TIMEOUT_MS,
    AI_CHAT_STREAM,
    OPENAI_CHAT_TOOLS,
    AI_CHAT_EXPAND_RETRY,
    AI_CHAT_SUMMARY_MODEL,
    AI_CHAT_TOOL_MAX_ROUNDS,
    AI_ASSISTANT_SUPPORT_TOOL_WINDOW_MS,
    AI_ASSISTANT_SUPPORT_TOOL_MAX,
    AI_CHAT_HISTORY_LIMIT,
    AI_CHAT_RECENT_BUDGET_CHARS,
    AI_CHAT_MAX_TOKENS,
    AI_CHAT_MAX_TOKENS_VISION,
    AI_CHAT_TEMPERATURE,
    AI_CHAT_FREQUENCY_PENALTY,
    AI_CHAT_MAX_IMAGES_PER_MESSAGE,
    AI_CHAT_MAX_IMAGE_DATA_URL_CHARS
};
