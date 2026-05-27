const {
    OPENAI_IMAGE_PROMPT_SUFFIX,
    OPENAI_IMAGE_PROMPT_SUFFIX_MAX
} = require('./config');

/** لاحقة اختيارية ضمن حد 4000 محرف لـ DALL·E */
function buildOpenAiImageGenerationPrompt(userPrompt) {
    const base = String(userPrompt || '').trim();
    let suf = String(OPENAI_IMAGE_PROMPT_SUFFIX || '').trim();
    if (!base || !suf) {
        return base;
    }
    if (suf.length > OPENAI_IMAGE_PROMPT_SUFFIX_MAX) {
        suf = suf.slice(0, OPENAI_IMAGE_PROMPT_SUFFIX_MAX);
    }
    const sep = '\n\n';
    const max = 4000;
    let combined = base + sep + suf;
    if (combined.length > max) {
        const room = max - base.length - sep.length;
        if (room < 24) {
            return base;
        }
        combined = base + sep + suf.slice(0, room);
    }
    return combined;
}

module.exports = { buildOpenAiImageGenerationPrompt };
