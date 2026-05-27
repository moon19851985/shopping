const {
    normalizeEnvSecret,
    OPENAI_API_KEY,
    OPENAI_IMAGE_MODEL
} = require('./config');
const { buildOpenAiImageGenerationPrompt } = require('./image-prompt');

function isGptImageModel(model) {
    return /^gpt-image-/i.test(String(model || '').trim());
}

/** أحجام مدعومة لنماذج GPT Image (بدل 1792×1024 القديمة) */
function normalizeGptImageSize(raw) {
    const s = String(raw || '1024x1024')
        .trim()
        .toLowerCase();
    if (s === '1024x1792' || s === '1792x1024') {
        return '1024x1536';
    }
    if (/^(1024x1024|1024x1536|1536x1024|auto)$/.test(s)) {
        return s;
    }
    return '1024x1024';
}

/** جودة GPT Image: low | medium | high | auto */
function normalizeGptImageQuality(raw) {
    const s = String(raw || 'medium')
        .trim()
        .toLowerCase();
    if (s === 'hd' || s === 'high') {
        return 'high';
    }
    if (s === 'standard' || s === 'medium') {
        return 'medium';
    }
    if (s === 'low' || s === 'draft') {
        return 'low';
    }
    if (s === 'auto') {
        return 'auto';
    }
    return 'medium';
}

/** توليد صورة عبر OpenAI — مسار /api/ai/image وحلقة الأدوات */
async function openAiGenerateImageDataUrl(rawUserPrompt) {
    if (!OPENAI_API_KEY) {
        return { ok: false, message: 'OpenAI not configured' };
    }
    const raw = String(rawUserPrompt || '').trim();
    if (raw.length < 4) {
        return { ok: false, message: 'Prompt too short' };
    }
    if (raw.length > 4000) {
        return { ok: false, message: 'Prompt too long' };
    }
    const prompt = buildOpenAiImageGenerationPrompt(raw);
    if (prompt.length > 4000) {
        return { ok: false, message: 'Prompt too long after suffix' };
    }
    const model = String(OPENAI_IMAGE_MODEL || '').trim();
    const modelLc = model.toLowerCase();

    const body = {
        model,
        prompt,
        n: 1
    };

    if (modelLc === 'dall-e-3') {
        body.response_format = 'b64_json';
        body.size = normalizeEnvSecret(process.env.OPENAI_IMAGE_SIZE) || '1024x1024';
        if (!/^1024x1024|1024x1792|1792x1024$/.test(body.size)) {
            body.size = '1024x1024';
        }
        body.quality =
            String(process.env.OPENAI_IMAGE_QUALITY || 'standard').toLowerCase() === 'hd' ? 'hd' : 'standard';
    } else if (modelLc === 'dall-e-2') {
        body.response_format = 'b64_json';
        body.size = '1024x1024';
    } else if (isGptImageModel(model)) {
        body.size = normalizeGptImageSize(process.env.OPENAI_IMAGE_SIZE);
        body.quality = normalizeGptImageQuality(process.env.OPENAI_IMAGE_QUALITY);
        body.response_format = 'b64_json';
    } else {
        body.response_format = 'b64_json';
    }

    async function postBody(b) {
        const r = await fetch('https://api.openai.com/v1/images/generations', {
            method: 'POST',
            headers: {
                Authorization: 'Bearer ' + OPENAI_API_KEY,
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(b)
        });
        const data = await r.json().catch(() => ({}));
        return { r, data };
    }

    try {
        let { r, data } = await postBody(body);
        const errMsg = (m) =>
            String((m && m.error && m.error.message) || m.message || '').toLowerCase();
        if (
            !r.ok &&
            isGptImageModel(model) &&
            (errMsg(data).includes('response_format') || errMsg(data).includes('unknown parameter'))
        ) {
            const b2 = { ...body };
            delete b2.response_format;
            const second = await postBody(b2);
            r = second.r;
            data = second.data;
        }
        if (!r.ok) {
            const errObj = data && data.error;
            const detail = (errObj && errObj.message) || r.statusText || String(r.status);
            return { ok: false, message: String(detail).slice(0, 400), openaiCode: (errObj && errObj.code) || '' };
        }
        const d0 = data.data && data.data[0];
        let b64 = d0 && d0.b64_json;
        if (!b64 && d0 && d0.url) {
            try {
                const imgR = await fetch(String(d0.url));
                if (imgR.ok) {
                    const buf = Buffer.from(await imgR.arrayBuffer());
                    b64 = buf.toString('base64');
                }
            } catch (_) {}
        }
        if (!b64) {
            return { ok: false, message: 'No image data' };
        }
        const dataUrl = 'data:image/png;base64,' + String(b64);
        const revised = (d0 && d0.revised_prompt) || null;
        return { ok: true, imageDataUrl: dataUrl, revisedPrompt: revised };
    } catch (e) {
        return { ok: false, message: String((e && e.message) || e) };
    }
}

module.exports = { openAiGenerateImageDataUrl };
