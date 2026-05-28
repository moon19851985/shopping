/**
 * خادم تسجيل + إرسال كود التفعيل (SMTP) + واجهات المدير.
 * التشغيل: npm run auth-server
 * الإعداد: انسخ .env.example إلى .env وعدّل SMTP و ADMIN_API_KEY واختياري OPENAI_API_KEY للمساعد الذكي.
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const os = require('os');
const http = require('http');
const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
const PDFDocument = require('pdfkit');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { registerAiRoutes, logAiStartup } = require('./ai');
const { createConversationStore } = require('./ai/store/conversations');
const { registerConversationRoutes } = require('./ai/conversations-routes');
const adminMetrics = require('./admin-metrics');
const { readAppSettings, writeAppSettings, ensureAppSettingsFile } = require('./app-settings');
const cloudR2 = require('./cloud-r2');
const huaweiBilling = require('./huawei-billing');
const {
    HUAWEI_BILLING_ERROR,
    logHuaweiBillingEvent,
    getRecentBillingEventsForUser,
    huaweiBillingJsonError,
    mapVerifyFailureToCode,
    fetchWithHuaweiTimeout
} = huaweiBilling;
ensureAppSettingsFile();

const IS_PRODUCTION = String(process.env.NODE_ENV || '').trim().toLowerCase() === 'production';
const basePort = Number(process.env.AUTH_SERVER_PORT || process.env.PORT || 3000);
const DATA_PATH = path.join(__dirname, 'data', 'registrations.json');
const SUBSCRIPTION_LOGS_PATH = path.join(__dirname, 'data', 'subscription-logs.json');
const HUAWEI_USED_PURCHASES_PATH = path.join(__dirname, 'data', 'huawei-used-purchases.json');
const HUAWEI_PURCHASE_SESSIONS_PATH = path.join(__dirname, 'data', 'huawei-purchase-sessions.json');
const HUAWEI_PURCHASE_SESSION_TTL_MS = 15 * 60 * 1000;
const HUAWEI_USED_PURCHASES_MAX = 8000;
const CLOUD_FILES_PATH = path.join(__dirname, 'data', 'cloud-files.json');
const SUPPORT_TICKETS_PATH = path.join(__dirname, 'data', 'support-tickets.json');
const FREE_PREMIUM_TRIAL_DAYS = 10;
const HUAWEI_IAP_CLIENT_ID = normalizeEnvSecret(process.env.HUAWEI_IAP_CLIENT_ID || '');
const HUAWEI_IAP_CLIENT_SECRET = normalizeEnvSecret(process.env.HUAWEI_IAP_CLIENT_SECRET || '');
const HUAWEI_IAP_ORDER_URL = (
    process.env.HUAWEI_IAP_ORDER_URL || 'https://orders-dre.iap.hicloud.com/applications/purchases/tokens/verify'
).trim();
const HUAWEI_OAUTH_URL = (
    process.env.HUAWEI_OAUTH_URL || 'https://oauth-login.cloud.huawei.com/oauth2/v3/token'
).trim();
const SUPPORT_MAX_ATTACHMENTS = 5;
const SUPPORT_MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

function normalizeEnvSecret(value) {
    let s = String(value || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function parseAllowedOrigins(raw) {
    const list = String(raw || '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);
    return Array.from(new Set(list));
}

const ADMIN_KEY = normalizeEnvSecret(process.env.ADMIN_API_KEY || 'dev-admin-key-change-me');
const ALLOWED_ORIGINS = parseAllowedOrigins(process.env.ALLOWED_ORIGINS);
if (IS_PRODUCTION) {
    if (!ADMIN_KEY || ADMIN_KEY === 'dev-admin-key-change-me' || ADMIN_KEY.length < 24) {
        throw new Error('ADMIN_API_KEY must be strong (>=24 chars) in production');
    }
    if (ALLOWED_ORIGINS.length === 0) {
        throw new Error('ALLOWED_ORIGINS is required in production (comma-separated list)');
    }
}

const OPENAI_API_KEY = normalizeEnvSecret(process.env.OPENAI_API_KEY);
/** تعديل الصور عبر /v1/images/edits — حاليًا يدعم OpenAI نموذج dall-e-2 فقط لهذا المسار */
const OPENAI_IMAGE_EDIT_MODEL_RAW = normalizeEnvSecret(process.env.OPENAI_IMAGE_EDIT_MODEL) || 'dall-e-2';
const OPENAI_IMAGE_EDIT_MODEL = /^dall-e-2$/i.test(String(OPENAI_IMAGE_EDIT_MODEL_RAW))
    ? 'dall-e-2'
    : (console.warn(
          '[auth-server] OPENAI_IMAGE_EDIT_MODEL=',
          OPENAI_IMAGE_EDIT_MODEL_RAW,
          'غير مدعوم لمسار images/edits — استخدام dall-e-2'
      ),
      'dall-e-2');
const OPENAI_TRANSCRIBE_MODEL = normalizeEnvSecret(process.env.OPENAI_TRANSCRIBE_MODEL) || 'gpt-4o-mini-transcribe';
/** تحسين وصف التعديل عبر نموذج نصي قبل DALL·E 2 (أدق من إرسال العربي الخام) */
const OPENAI_IMAGE_EDIT_PROMPT_MODEL =
    normalizeEnvSecret(process.env.OPENAI_IMAGE_EDIT_PROMPT_MODEL) || 'gpt-4o-mini';
const OPENAI_IMAGE_EDIT_ENHANCE_RAW = String(process.env.OPENAI_IMAGE_EDIT_ENHANCE ?? '1')
    .trim()
    .toLowerCase();
const OPENAI_IMAGE_EDIT_ENHANCE = !(
    OPENAI_IMAGE_EDIT_ENHANCE_RAW === '0' ||
    OPENAI_IMAGE_EDIT_ENHANCE_RAW === 'false' ||
    OPENAI_IMAGE_EDIT_ENHANCE_RAW === 'off' ||
    OPENAI_IMAGE_EDIT_ENHANCE_RAW === 'no'
);
/** توليد/تعديل الصور أبطأ من الدردشة — مهلة أطول (قابلة للضبط) */
const OPENAI_IMAGE_EDIT_TIMEOUT_MS = Math.max(
    20000,
    Number(process.env.OPENAI_IMAGE_EDIT_TIMEOUT_MS || 120000) || 120000
);
/** رسم النص على الصورة محلياً (أدق من DALL·E للنص) — عطّل بـ 0 إن لزم */
const OPENAI_IMAGE_EDIT_TEXT_OVERLAY_RAW = String(process.env.OPENAI_IMAGE_EDIT_TEXT_OVERLAY ?? '1')
    .trim()
    .toLowerCase();
const OPENAI_IMAGE_EDIT_TEXT_OVERLAY = !(
    OPENAI_IMAGE_EDIT_TEXT_OVERLAY_RAW === '0' ||
    OPENAI_IMAGE_EDIT_TEXT_OVERLAY_RAW === 'false' ||
    OPENAI_IMAGE_EDIT_TEXT_OVERLAY_RAW === 'off' ||
    OPENAI_IMAGE_EDIT_TEXT_OVERLAY_RAW === 'no'
);

/** على Windows ARM64 يتعطل Skia داخل @napi-rs/canvas ويقع العملية — نفصل الرسم في worker */
const IMAGE_OVERLAY_CANVAS_IN_CHILD =
    String(process.env.IMAGE_OVERLAY_SPAWN || '').trim() === '1' ||
    (process.platform === 'win32' && process.arch === 'arm64');

const OPENAI_HTTP_TIMEOUT_MS = Math.max(
    5000,
    Number(process.env.OPENAI_HTTP_TIMEOUT_MS || 18000) || 18000
);
const AI_MAX_CONCURRENT = Math.max(1, Number(process.env.AI_MAX_CONCURRENT || 20) || 20);
const AI_MAX_QUEUE = Math.max(0, Number(process.env.AI_MAX_QUEUE || 200) || 200);
/** حد بسيط لكل عنوان IP (طلبات / دقيقة) — يُستخدم لمسارات المساعد المسجّلة في server/ai */
const aiChatRateByIp = new Map();
const AI_CHAT_RATE_WINDOW_MS = 60 * 1000;
const AI_CHAT_RATE_MAX = 0;
const aiImageRateByIp = new Map();
const AI_IMAGE_RATE_WINDOW_MS = 60 * 1000;
const AI_IMAGE_RATE_MAX = 0;
const aiWorkQueue = [];
let aiActiveWorkers = 0;

function pumpAiQueue() {
    while (aiActiveWorkers < AI_MAX_CONCURRENT && aiWorkQueue.length > 0) {
        const job = aiWorkQueue.shift();
        aiActiveWorkers += 1;
        Promise.resolve()
            .then(job.run)
            .then(job.resolve)
            .catch(job.reject)
            .finally(() => {
                aiActiveWorkers = Math.max(0, aiActiveWorkers - 1);
                setImmediate(pumpAiQueue);
            });
    }
}

function runAiWork(runFn) {
    return new Promise((resolve, reject) => {
        if (aiActiveWorkers < AI_MAX_CONCURRENT) {
            aiActiveWorkers += 1;
            Promise.resolve()
                .then(runFn)
                .then(resolve)
                .catch(reject)
                .finally(() => {
                    aiActiveWorkers = Math.max(0, aiActiveWorkers - 1);
                    setImmediate(pumpAiQueue);
                });
            return;
        }
        if (aiWorkQueue.length >= AI_MAX_QUEUE) {
            reject(new Error('ai_queue_full'));
            return;
        }
        aiWorkQueue.push({ run: runFn, resolve, reject });
    });
}

/**
 * OpenAI image edits تتطلب PNG بنمط RGBA أو LA أو L — ملفات PNG بثلاث قنوات (RGB) تُرفض.
 * نعيد ترميز كل المدخلات عبر jimp مع colorType 6 (RGBA).
 */
async function bufferToPngForOpenAiImageEdit(bytes) {
    const Jimp = require('jimp');
    const image = await Jimp.read(bytes);
    image.rgba(true);
    image.colorType(6);
    return image.getBufferAsync(Jimp.MIME_PNG);
}

/**
 * يحوّل طلب التعديل (أي لغة) إلى جملة إنجليزية مركّزة لـ DALL·E 2 — يقلّل اللبس ويحسّن النتيجة.
 */
async function enhanceImageEditPromptForOpenAI(userPrompt) {
    const trimmed = String(userPrompt || '').trim();
    if (!trimmed || !OPENAI_API_KEY || !OPENAI_IMAGE_EDIT_ENHANCE) {
        return trimmed;
    }
    const system =
        'You rewrite image-edit instructions for DALL·E 2 image editing. ' +
        'Output exactly ONE line in English only: concrete, visual, under 320 characters. ' +
        'If the user only wants the background changed, start with "Change only the background to" or "Replace the background with". ' +
        'If they want one object recolored or restyled, name that object clearly. ' +
        'Preserve all important constraints (colors, style, "do not change faces", etc.). ' +
        'No quotation marks, no preamble, no explanation.';
    try {
        const r = await runAiWork(async () => {
            const ac = new AbortController();
            const ms = Math.min(25000, Math.max(8000, OPENAI_HTTP_TIMEOUT_MS + 4000));
            const timer = setTimeout(() => ac.abort(), ms);
            try {
                return await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + OPENAI_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: OPENAI_IMAGE_EDIT_PROMPT_MODEL,
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: 'User instruction (any language):\n' + trimmed }
                        ],
                        max_tokens: 150,
                        temperature: 0.25
                    }),
                    signal: ac.signal
                });
            } finally {
                clearTimeout(timer);
            }
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            console.warn(
                '[auth-server] image-edit prompt enhance HTTP',
                r.status,
                (data && data.error && data.error.message) || ''
            );
            return trimmed;
        }
        let text = String(data?.choices?.[0]?.message?.content || '').trim();
        text = text.replace(/^["']|["']$/g, '').replace(/\s+/g, ' ');
        const oneLine = text.slice(0, 900);
        if (oneLine.length < 6) {
            return trimmed;
        }
        return oneLine;
    } catch (e) {
        console.warn('[auth-server] image-edit prompt enhance:', e && e.message);
        return trimmed;
    }
}

function defaultImageEditPlan() {
    return {
        kind: 'visual_edit',
        overlayText: null,
        textPosition: 'center',
        textColor: 'auto',
        dallePromptEn: '',
        visualPart: null
    };
}

/** يشير إلى أن المستخدم يريد نصاً ظاهراً على الصورة (للاستخراج الاحتياطي) */
function userPromptSuggestsTextOnImage(s) {
    return /اكتب|أكتب|إكتب|يكتب|تكتب|ليكتب|عليها\s+نص|نص\s+على|اضف\s*نص|أضف\s*نص|أضف\s*النص|ضع\s*نص|ضع\s*النص|ارسم\s*نص|النص\s*[:：]|نص\s*[:：]|العبارة|الكلمة\s*[:：]|كتابة|label|caption|write\s+on|add\s+text|put\s+text/i.test(
        String(s || '')
    );
}

/**
 * يستخرج النص المطلوب طباعته من صياغة المستخدم عندما يفوّت النموذج overlayText.
 */
function extractHeuristicOverlayText(userPrompt) {
    const raw = String(userPrompt || '').trim();
    if (!raw || !userPromptSuggestsTextOnImage(raw)) {
        return null;
    }
    let m = raw.match(/«([^»]{1,500})»/);
    if (m) {
        return m[1].trim().slice(0, 500);
    }
    m = raw.match(/"([^"]{1,500})"/);
    if (m) {
        return m[1].trim().slice(0, 500);
    }
    m = raw.match(/'([^']{1,500})'/);
    if (m) {
        return m[1].trim().slice(0, 500);
    }
    m = raw.match(/(?:النص|نص|العبارة|الكلمة)\s*[:：]\s*(.+?)(?:\s*$|[.!؟!])/i);
    if (m) {
        return m[1].trim().replace(/[.!؟،;:]+$/u, '').trim().slice(0, 500);
    }
    m = raw.match(/(?:اكتب|أكتب|إكتب|يكتب|تكتب)(?:\s+على\s+(?:الصورة|الصوره|الصورة\s+هذه))?\s+(.+?)(?:\s*$|[.!؟!]|،\s*غيّر|،\s*عدّل)/i);
    if (m) {
        let chunk = m[1].trim().replace(/[.!؟]+$/u, '').trim();
        if (chunk.length > 1) {
            return chunk.slice(0, 500);
        }
    }
    m = raw.match(/write\s+(?:on\s+(?:the\s+)?image\s+)?["']([^"']+)["']/i);
    if (m) {
        return m[1].trim().slice(0, 500);
    }
    m = raw.match(/(?:add|put)\s+text\s*[:：]\s*(.+)$/i);
    if (m) {
        return m[1].trim().replace(/[.!؟]+$/u, '').trim().slice(0, 500);
    }
    return null;
}

function mergeHeuristicOverlayIntoPlan(plan, heuristic) {
    const p = plan || defaultImageEditPlan();
    const h = heuristic != null ? String(heuristic).trim() : '';
    if (!h) {
        return p;
    }
    const hadVisualDalle = sanitizePromptForApi(p.dallePromptEn);
    if (!p.overlayText) {
        p.overlayText = h;
    } else if (p.overlayText.length < 2) {
        p.overlayText = h;
    }
    if (p.kind === 'visual_edit') {
        p.kind = hadVisualDalle ? 'both' : 'text_only';
        if (p.kind === 'text_only') {
            p.dallePromptEn = '';
        }
    }
    return p;
}

/** طلب واضح لتعديل بصري غير «إضافة نص» — عندها فقط نسمح لـ DALL·E بمسّ البكسل */
function userPromptSuggestsNonTextVisualEdit(s) {
    return /خلفية|الخلفية|خلفيه|لون\s*الخلف|غيّر\s*الخلف|بدّل\s*الخلف|شفاف|زاوية|اقتصاص|قصّ|تدوير|احذف|أحذف|ازل|ازيل|أزيل|إزيل|ازال|أزال|إزال|أزل|أضف\s*صورة|كبر|صغّر|وضوح|ضبابي|background|change\s+the\s+background|remove\s+the|\bremove\b|\bdelete\b|crop|rotate|blur|brightness/i.test(
        String(s || '')
    );
}

/**
 * DALL·E 2 يعيد توليد الصورة بالكامل ويدمر الخط العربي والخطوط الفنية.
 * إن كان المستخدم يريد كتابة/إضافة نص فقط → نلزم text_only ولا نمرّر dalle.
 */
function coerceCaptionOnlyPlan(plan, userPrompt) {
    const p = plan || defaultImageEditPlan();
    const up = String(userPrompt || '');
    if (!p.overlayText || !OPENAI_IMAGE_EDIT_TEXT_OVERLAY) {
        return p;
    }
    if (userPromptSuggestsNonTextVisualEdit(up)) {
        return p;
    }
    if (p.kind === 'both' || p.kind === 'visual_edit') {
        p.kind = 'text_only';
        p.dallePromptEn = '';
    }
    return p;
}

function normalizeImageEditPlan(o, userPrompt) {
    const base = defaultImageEditPlan();
    if (!o || typeof o !== 'object') {
        return base;
    }
    const kindRaw = String(o.kind || '').trim().toLowerCase();
    if (kindRaw === 'text_only' || kindRaw === 'visual_edit' || kindRaw === 'both') {
        base.kind = kindRaw;
    }
    let ot = o.overlayText != null ? String(o.overlayText).trim() : '';
    if (ot.length > 600) {
        ot = ot.slice(0, 600);
    }
    base.overlayText = ot || null;
    const tp = String(o.textPosition || '').toLowerCase();
    if (tp === 'top' || tp === 'bottom' || tp === 'center') {
        base.textPosition = tp;
    }
    const tc = String(o.textColor || '').toLowerCase();
    if (tc === 'auto' || tc === 'dark' || tc === 'light') {
        base.textColor = tc;
    }
    let dalle = o.dallePromptEn != null ? String(o.dallePromptEn).trim() : '';
    if (dalle.length > 900) {
        dalle = dalle.slice(0, 900);
    }
    base.dallePromptEn = dalle;
    base.visualPart = o.visualPart != null ? String(o.visualPart).trim().slice(0, 300) : null;
    if (base.kind === 'text_only' && !base.overlayText) {
        base.kind = 'visual_edit';
    }
    if (base.kind === 'both' && !base.overlayText) {
        base.kind = 'visual_edit';
    }
    if (base.kind === 'both' && !base.dallePromptEn) {
        base.kind = base.overlayText ? 'text_only' : 'visual_edit';
    }
    if (base.kind === 'text_only' && base.dallePromptEn) {
        base.dallePromptEn = '';
    }
    return base;
}

function parseJsonFromChatContent(raw) {
    let s = String(raw || '').trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) {
        s = fence[1].trim();
    }
    return JSON.parse(s);
}

/**
 * يخطّط تعديل الصورة: نص على الصورة مقابل تعديل بصري (DALL·E) — استجابة JSON من النموذج.
 */
async function planImageEditWithOpenAI(userPrompt) {
    const trimmed = String(userPrompt || '').trim();
    if (!trimmed || !OPENAI_API_KEY) {
        return defaultImageEditPlan();
    }
    const system =
        'You plan image edits. Reply with JSON only (no markdown) using this shape:\n' +
        '{"kind":"text_only"|"visual_edit"|"both","overlayText":string|null,"textPosition":"top"|"center"|"bottom",' +
        '"textColor":"auto"|"dark"|"light","dallePromptEn":string|null,"visualPart":string|null}\n' +
        'Rules:\n' +
        '- overlayText: EXACT characters the user wants drawn ON the image (any language). null if they do not ask for visible text.\n' +
        '- kind=text_only: ONLY adding/showing text or a short label on the picture; no background/object/color changes.\n' +
        '- kind=visual_edit: no on-image text; only style/background/object edits.\n' +
        '- kind=both: text on image AND other visual edits.\n' +
        '- dallePromptEn: ONE short English line for DALL·E 2 photo edit for NON-TEXT changes only. ' +
        'Must be null or empty when kind is text_only. Never put the overlay text inside dallePromptEn.\n' +
        '- CRITICAL: DALL·E 2 image edit RE-DRAWS the whole photo — it destroys Arabic calligraphy, logos, and fine art. ' +
        'If the user only wants words/caption/watermark ON TOP of the photo, kind MUST be text_only and dallePromptEn MUST be null.\n' +
        '- Use kind=both ONLY if the user clearly asks to change background, colors, remove objects, or similar non-text edits IN ADDITION to text.\n' +
        '- If the user gives text in quotes, use that exact string in overlayText.\n' +
        '- Arabic examples: «اكتب على الصورة مرحبا» → overlayText \"مرحبا\", kind text_only. ' +
        '\"غيّر الخلفية واكتب sale\" → kind both, overlayText \"sale\", dallePromptEn about background only.\n' +
        '- If unsure about overlayText, use null.';
    try {
        const r = await runAiWork(async () => {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), 22000);
            try {
                return await fetch('https://api.openai.com/v1/chat/completions', {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + OPENAI_API_KEY,
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify({
                        model: OPENAI_IMAGE_EDIT_PROMPT_MODEL,
                        response_format: { type: 'json_object' },
                        messages: [
                            { role: 'system', content: system },
                            { role: 'user', content: 'User request:\n' + trimmed }
                        ],
                        max_tokens: 450,
                        temperature: 0.05
                    }),
                    signal: ac.signal
                });
            } finally {
                clearTimeout(timer);
            }
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            console.warn(
                '[auth-server] planImageEdit HTTP',
                r.status,
                (data && data.error && data.error.message) || ''
            );
            return defaultImageEditPlan();
        }
        const content = data?.choices?.[0]?.message?.content || '{}';
        const parsed = parseJsonFromChatContent(content);
        return normalizeImageEditPlan(parsed, trimmed);
    } catch (e) {
        console.warn('[auth-server] planImageEdit:', e && e.message);
        return defaultImageEditPlan();
    }
}

/**
 * رسم النص: افتراضياً resvg (عربي، صور كبيرة، بدون ICU لـ Skia على Windows ARM).
 * للرجوع لـ @napi-rs/canvas: ضع IMAGE_OVERLAY_USE_CANVAS=1 في .env
 */
async function renderTextOverlayOnPngBuffer(pngBuffer, overlayText, plan) {
    const { renderTextOverlayResvg } = require('./text-overlay-resvg');
    const forceCanvas = String(process.env.IMAGE_OVERLAY_USE_CANVAS || '').trim() === '1';

    const tryCanvas = async () => {
        if (IMAGE_OVERLAY_CANVAS_IN_CHILD) {
            const workerPath = path.join(__dirname, 'text-overlay-worker.js');
            const payload = JSON.stringify({
                pngB64: Buffer.from(pngBuffer).toString('base64'),
                overlayText: String(overlayText || ''),
                plan: {
                    textPosition: plan && plan.textPosition,
                    textColor: plan && plan.textColor
                }
            });
            const r = spawnSync(process.execPath, [workerPath], {
                input: payload,
                maxBuffer: 50 * 1024 * 1024,
                encoding: 'utf-8',
                windowsHide: true,
                timeout: 90000
            });
            if (r.error) {
                throw r.error;
            }
            if (r.status !== 0) {
                const errTail = (r.stderr && String(r.stderr).trim().slice(0, 400)) || '';
                console.error('[auth-server] text-overlay-worker exit', r.status, errTail);
                throw new Error('text_overlay_worker_failed');
            }
            const b64 = String(r.stdout || '').trim();
            if (!b64) {
                throw new Error('text_overlay_worker_empty');
            }
            return Buffer.from(b64, 'base64');
        }
        const { renderTextOverlayPng } = require('./text-overlay-canvas');
        return renderTextOverlayPng(pngBuffer, overlayText, plan);
    };

    if (forceCanvas) {
        try {
            return await tryCanvas();
        } catch (e) {
            console.warn('[auth-server] canvas overlay failed, resvg fallback:', e && e.message);
            return renderTextOverlayResvg(pngBuffer, overlayText, plan);
        }
    }
    try {
        return await renderTextOverlayResvg(pngBuffer, overlayText, plan);
    } catch (e) {
        console.warn('[auth-server] resvg overlay failed, canvas fallback:', e && e.message);
        return tryCanvas();
    }
}

function sanitizePromptForApi(s) {
    const t = String(s || '').trim();
    return t.length >= 3 ? t : '';
}

function resolveDallePromptFromPlan(plan) {
    if (plan && plan.dallePromptEn && String(plan.dallePromptEn).trim().length >= 3) {
        return String(plan.dallePromptEn).trim();
    }
    return '';
}

function buildRevisedPromptLabel(plan, promptForApi, userPrompt, openaiRevised) {
    if (openaiRevised) {
        return openaiRevised;
    }
    const parts = [];
    if (plan && plan.overlayText) {
        parts.push(`النص على الصورة: ${plan.overlayText}`);
    }
    if (promptForApi && promptForApi !== userPrompt) {
        parts.push(`تعديل DALL·E: ${promptForApi}`);
    } else if (promptForApi) {
        parts.push(`تعديل DALL·E: ${promptForApi}`);
    }
    return parts.length ? parts.join(' — ') : null;
}

// ——— تخزين البيانات، البريد، التحقق الإداري، وتهيئة Express ———

function loadRegs() {
    try {
        if (!fs.existsSync(DATA_PATH)) {
            return [];
        }
        const data = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('[auth-server] loadRegs:', e.message || e);
        return [];
    }
}

function saveRegs(list) {
    fs.mkdirSync(path.dirname(DATA_PATH), { recursive: true });
    fs.writeFileSync(DATA_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function genCode() {
    return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

/** مفتاح ثابت للخزنة — لا يتغير عند تغيير كلمة السر (يُخزَّن على الخادم) */
function ensureVaultKeySeed(row) {
    if (!row) {
        return false;
    }
    const cur = String(row.vaultKeySeed || '').trim();
    if (cur.length >= 32) {
        return false;
    }
    row.vaultKeySeed = crypto.randomBytes(32).toString('hex');
    return true;
}

function accountClientPayload(row) {
    return {
        email: row.email,
        securityAnswer: row.securityAnswer || '',
        createdAt: row.createdAt || row.verifiedAt || new Date().toISOString(),
        emailVerified: true,
        vaultKeySeed: row.vaultKeySeed || null
    };
}

function loadSubscriptionLogs() {
    try {
        if (!fs.existsSync(SUBSCRIPTION_LOGS_PATH)) {
            return [];
        }
        const data = JSON.parse(fs.readFileSync(SUBSCRIPTION_LOGS_PATH, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('[auth-server] loadSubscriptionLogs:', e.message || e);
        return [];
    }
}

function saveSubscriptionLogs(list) {
    fs.mkdirSync(path.dirname(SUBSCRIPTION_LOGS_PATH), { recursive: true });
    fs.writeFileSync(SUBSCRIPTION_LOGS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function loadJsonObjectStore(filePath) {
    try {
        if (!fs.existsSync(filePath)) {
            return {};
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (e) {
        console.warn('[auth-server] loadJsonObjectStore:', filePath, e.message || e);
        return {};
    }
}

function saveJsonObjectStore(filePath, obj) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(obj, null, 2), 'utf8');
}

function huaweiPurchaseSessionKey(userEmail, huaweiAccountId) {
    const e = String(userEmail || '').trim().toLowerCase();
    const u = String(huaweiAccountId || '').trim();
    if (e && e.includes('@') && e !== 'unknown@gosta.local') {
        return 'email:' + e;
    }
    if (u) {
        return 'huawei:' + u;
    }
    return '';
}

function pruneHuaweiPurchaseSessions(sessions) {
    const now = Date.now();
    const out = {};
    for (const [k, v] of Object.entries(sessions || {})) {
        if (!v) continue;
        const started = Number(v.startedAt || 0);
        if (started > 0 && now - started < HUAWEI_PURCHASE_SESSION_TTL_MS) {
            out[k] = v;
        }
    }
    return out;
}

function loadHuaweiPurchaseSessions() {
    return pruneHuaweiPurchaseSessions(loadJsonObjectStore(HUAWEI_PURCHASE_SESSIONS_PATH));
}

function saveHuaweiPurchaseSessions(sessions) {
    saveJsonObjectStore(HUAWEI_PURCHASE_SESSIONS_PATH, pruneHuaweiPurchaseSessions(sessions));
}

function getActiveHuaweiPurchaseSession(userEmail, huaweiAccountId) {
    const key = huaweiPurchaseSessionKey(userEmail, huaweiAccountId);
    if (!key) return null;
    const sessions = loadHuaweiPurchaseSessions();
    return sessions[key] || null;
}

function beginHuaweiPurchaseSession(userEmail, huaweiAccountId, planCode) {
    const key = huaweiPurchaseSessionKey(userEmail, huaweiAccountId);
    if (!key) {
        return {
            ok: false,
            error: HUAWEI_BILLING_ERROR.MISSING_SESSION_IDENTITY,
            errorCode: HUAWEI_BILLING_ERROR.MISSING_SESSION_IDENTITY
        };
    }
    const sessions = loadHuaweiPurchaseSessions();
    const active = sessions[key];
    if (active && String(active.state || '') !== 'IDLE') {
        return {
            ok: false,
            error: HUAWEI_BILLING_ERROR.PURCHASE_SESSION_ACTIVE,
            errorCode: HUAWEI_BILLING_ERROR.PURCHASE_SESSION_ACTIVE,
            session: active
        };
    }
    sessions[key] = {
        userEmail: String(userEmail || '').trim(),
        huaweiAccountId: String(huaweiAccountId || '').trim(),
        planCode: String(planCode || '').toUpperCase(),
        state: 'PURCHASING',
        startedAt: Date.now()
    };
    saveHuaweiPurchaseSessions(sessions);
    return { ok: true, sessionKey: key };
}

function updateHuaweiPurchaseSessionState(userEmail, huaweiAccountId, state) {
    const key = huaweiPurchaseSessionKey(userEmail, huaweiAccountId);
    if (!key) return;
    const sessions = loadHuaweiPurchaseSessions();
    if (!sessions[key]) return;
    sessions[key].state = String(state || 'IDLE');
    sessions[key].updatedAt = Date.now();
    saveHuaweiPurchaseSessions(sessions);
}

function endHuaweiPurchaseSession(userEmail, huaweiAccountId, finalState) {
    const key = huaweiPurchaseSessionKey(userEmail, huaweiAccountId);
    if (!key) return;
    const sessions = loadHuaweiPurchaseSessions();
    delete sessions[key];
    saveHuaweiPurchaseSessions(sessions);
    if (finalState) {
        void finalState;
    }
}

function getPermanentHuaweiPurchaseRecord(purchaseToken) {
    const tok = String(purchaseToken || '').trim();
    if (!tok) return null;
    const used = loadJsonObjectStore(HUAWEI_USED_PURCHASES_PATH);
    return used[tok] || null;
}

function markHuaweiPurchasePermanentlyUsed(purchaseToken, meta) {
    const tok = String(purchaseToken || '').trim();
    if (!tok) return null;
    const used = loadJsonObjectStore(HUAWEI_USED_PURCHASES_PATH);
    if (used[tok]) {
        return used[tok];
    }
    used[tok] = Object.assign({}, meta || {}, { usedAt: new Date().toISOString(), status: 'USED' });
    const keys = Object.keys(used);
    if (keys.length > HUAWEI_USED_PURCHASES_MAX) {
        keys.sort((a, b) => String(used[a].usedAt || '').localeCompare(String(used[b].usedAt || '')));
        const removeCount = keys.length - HUAWEI_USED_PURCHASES_MAX;
        for (let i = 0; i < removeCount; i++) {
            delete used[keys[i]];
        }
    }
    saveJsonObjectStore(HUAWEI_USED_PURCHASES_PATH, used);
    return used[tok];
}

function loadSupportTickets() {
    try {
        if (!fs.existsSync(SUPPORT_TICKETS_PATH)) {
            return [];
        }
        const data = JSON.parse(fs.readFileSync(SUPPORT_TICKETS_PATH, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.error('[auth-server] loadSupportTickets:', e.message || e);
        return [];
    }
}

function saveSupportTickets(list) {
    fs.mkdirSync(path.dirname(SUPPORT_TICKETS_PATH), { recursive: true });
    fs.writeFileSync(SUPPORT_TICKETS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function loadCloudFilesStore() {
    try {
        if (!fs.existsSync(CLOUD_FILES_PATH)) {
            return {};
        }
        const data = JSON.parse(fs.readFileSync(CLOUD_FILES_PATH, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        console.error('[auth-server] loadCloudFilesStore:', e.message || e);
        return {};
    }
}

function saveCloudFilesStore(store) {
    fs.mkdirSync(path.dirname(CLOUD_FILES_PATH), { recursive: true });
    fs.writeFileSync(CLOUD_FILES_PATH, JSON.stringify(store, null, 2), 'utf8');
}

/** فهرس سحابي خفيف — بدون data أو معاينات واجهة */
function sanitizeCloudIndexRecord(record) {
    if (!record || record.id === null || record.id === undefined) {
        return record;
    }
    const out = Object.assign({}, record);
    delete out.data;
    delete out.__cardPreviewUrl_INDEX2;
    delete out.restoredAt;
    delete out.movedAt;
    return out;
}

/** طلب مزامنة — يُبقي data لرفع R2، ويزيل حقول الواجهة فقط */
function prepareCloudSyncIncomingRecord(record) {
    if (!record || record.id === null || record.id === undefined) {
        return record;
    }
    const out = Object.assign({}, record);
    delete out.__cardPreviewUrl_INDEX2;
    delete out.restoredAt;
    delete out.movedAt;
    return out;
}

function prepareCloudSyncIncomingFileList(list) {
    return (Array.isArray(list) ? list : []).map(prepareCloudSyncIncomingRecord);
}

function sanitizeCloudFileList(list) {
    return (Array.isArray(list) ? list : []).map(sanitizeCloudIndexRecord);
}

function countCloudRecordsWithData(list) {
    return (Array.isArray(list) ? list : []).filter(function (f) {
        return f && f.data && String(f.data).length > 0;
    }).length;
}

function sanitizeUserCloudPayload(payload) {
    if (!payload || typeof payload !== 'object') {
        return payload;
    }
    return Object.assign({}, payload, {
        files: sanitizeCloudFileList(payload.files),
        deletedFiles: sanitizeCloudFileList(payload.deletedFiles),
        backupFiles: sanitizeCloudFileList(payload.backupFiles)
    });
}

/** مجلدات يدوية للخطة المميزة — تُخزَّن مع حساب السحابة */
function sanitizeCloudFoldersList(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    const seen = new Set();
    for (const f of raw) {
        if (!f || f.id == null || f.id === '') {
            continue;
        }
        const id = String(f.id).trim().slice(0, 80);
        if (!id || seen.has(id)) {
            continue;
        }
        const name = String(f.name || '')
            .trim()
            .replace(/\s+/g, ' ')
            .slice(0, 48);
        if (!name) {
            continue;
        }
        seen.add(id);
        out.push({
            id,
            name,
            createdAt: f.createdAt ? String(f.createdAt) : null
        });
    }
    return out;
}

function sanitizeSupportAttachments(raw) {
    if (!Array.isArray(raw)) {
        return [];
    }
    const out = [];
    for (let i = 0; i < raw.length && out.length < SUPPORT_MAX_ATTACHMENTS; i++) {
        const a = raw[i];
        if (!a || typeof a !== 'object') {
            continue;
        }
        const dataUrl = String(a.dataUrl || a.data || '').trim();
        if (!dataUrl.startsWith('data:') || !/;[\s]*base64,/i.test(dataUrl)) {
            continue;
        }
        const comma = dataUrl.indexOf(',');
        const b64 = comma >= 0 ? dataUrl.slice(comma + 1) : '';
        const approxBytes = Math.floor((b64.length * 3) / 4);
        if (approxBytes > SUPPORT_MAX_ATTACHMENT_BYTES) {
            continue;
        }
        out.push({
            name: String(a.name || 'attachment').slice(0, 180),
            dataUrl: dataUrl.slice(0, Math.min(dataUrl.length, SUPPORT_MAX_ATTACHMENT_BYTES * 2))
        });
    }
    return out;
}

/** أحدث اشتراك INDEX5 فعّال في سجلات الخادم لبريد معيّن */
function findBestActiveIndex5SubscriptionForEmail(emailNorm) {
    const em = String(emailNorm || '').trim().toLowerCase();
    if (!em) {
        return null;
    }
    const logs = loadSubscriptionLogs();
    const now = Date.now();
    const candidates = logs.filter((l) => {
        const u = String(l.userEmail || l.email || '').trim().toLowerCase();
        if (u !== em) {
            return false;
        }
        if (String(l.type || '').toUpperCase() !== 'INDEX5') {
            return false;
        }
        if (String(l.status || '').toLowerCase() !== 'active') {
            return false;
        }
        const exp = l.expiryDate ? new Date(l.expiryDate).getTime() : NaN;
        if (!Number.isFinite(exp) || exp < now) {
            return false;
        }
        return true;
    });
    if (!candidates.length) {
        return null;
    }
    candidates.sort((a, b) => {
        const ta = new Date(a.expiryDate || 0).getTime();
        const tb = new Date(b.expiryDate || 0).getTime();
        return tb - ta;
    });
    return candidates[0];
}

/** أحدث اشتراك فعّال (INDEX3/4/5) في السجلات */
function findBestActiveSubscriptionForEmail(emailNorm) {
    const em = String(emailNorm || '').trim().toLowerCase();
    if (!em) {
        return null;
    }
    const logs = loadSubscriptionLogs();
    const now = Date.now();
    const candidates = logs.filter((l) => {
        const u = String(l.userEmail || l.email || '').trim().toLowerCase();
        if (u !== em) {
            return false;
        }
        if (String(l.status || '').toLowerCase() !== 'active') {
            return false;
        }
        const exp = l.expiryDate ? new Date(l.expiryDate).getTime() : NaN;
        if (!Number.isFinite(exp) || exp < now) {
            return false;
        }
        const t = String(l.type || '').toUpperCase();
        if (!t || (t !== 'INDEX3' && t !== 'INDEX4' && t !== 'INDEX5')) {
            return false;
        }
        return true;
    });
    if (!candidates.length) {
        return null;
    }
    candidates.sort((a, b) => {
        const ta = new Date(a.expiryDate || 0).getTime();
        const tb = new Date(b.expiryDate || 0).getTime();
        return tb - ta;
    });
    return candidates[0];
}

function findVerifiedRegistrationByEmail(emailNorm) {
    const em = String(emailNorm || '').trim().toLowerCase();
    if (!em) {
        return null;
    }
    return loadRegs().find((r) => String(r.email || '').trim().toLowerCase() === em && r.verified) || null;
}

function getFreePremiumTrialInfoForEmail(emailNorm) {
    const row = findVerifiedRegistrationByEmail(emailNorm);
    if (!row) {
        return null;
    }
    const startedAtMs = new Date(row.createdAt || row.verifiedAt || 0).getTime();
    if (!Number.isFinite(startedAtMs)) {
        return null;
    }
    const expiresAtMs = startedAtMs + FREE_PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000;
    if (Date.now() > expiresAtMs) {
        return null;
    }
    return {
        startedAt: new Date(startedAtMs).toISOString(),
        expiresAt: new Date(expiresAtMs).toISOString()
    };
}

function getCloudAccessForEmail(emailNorm) {
    const index5 = findBestActiveIndex5SubscriptionForEmail(emailNorm);
    if (index5) {
        return { ok: true, via: 'subscription', subscription: index5 };
    }
    const trial = getFreePremiumTrialInfoForEmail(emailNorm);
    if (trial) {
        return { ok: true, via: 'trial', trial };
    }
    return { ok: false };
}

function getCrossDeviceAccessForEmail(emailNorm) {
    const active = findBestActiveSubscriptionForEmail(emailNorm);
    if (active) {
        return { ok: true, via: 'subscription', subscription: active };
    }
    const trial = getFreePremiumTrialInfoForEmail(emailNorm);
    if (trial) {
        return { ok: true, via: 'trial', trial };
    }
    return { ok: false };
}

function requiresSameDeviceForPlan(planCode) {
    const t = String(planCode || '').toUpperCase();
    return t === 'INDEX3' || t === 'INDEX4';
}

function subscriptionClientPayloadFromLogEntry(log) {
    const l = log || {};
    return {
        type: String(l.type || '').toUpperCase() || 'INDEX5',
        planName: l.planName || '',
        storage: Number(l.storage) || 300,
        price: l.price != null ? String(l.price) : '',
        paymentMethod: l.paymentMethod || 'server',
        cardType: l.cardType || '',
        userEmail: String(l.userEmail || l.email || '').trim(),
        startDate: l.startDate || l.loggedAt || new Date().toISOString(),
        expiryDate: l.expiryDate || new Date().toISOString(),
        durationDays: l.durationDays || 180,
        status: 'active',
        isValid: true,
        paymentStatus: l.paymentStatus || 'completed',
        transactionId: l.transactionId || '',
        timestamp: l.timestamp || new Date().toISOString(),
        deviceBindingId: l.deviceBindingId || '',
        purchaseToken: l.purchaseToken,
        productId: l.productId
    };
}

function subscriptionClientPayloadFromTrial(emailNorm, trialInfo) {
    return {
        type: 'INDEX5',
        planName: 'الخطة التجريبية (كل المزايا)',
        storage: 1000,
        price: '0',
        paymentMethod: 'trial',
        cardType: '',
        userEmail: String(emailNorm || '').trim(),
        startDate: (trialInfo && trialInfo.startedAt) || new Date().toISOString(),
        expiryDate:
            (trialInfo && trialInfo.expiresAt) ||
            new Date(Date.now() + FREE_PREMIUM_TRIAL_DAYS * 24 * 60 * 60 * 1000).toISOString(),
        durationDays: FREE_PREMIUM_TRIAL_DAYS,
        status: 'active',
        isValid: true,
        paymentStatus: 'completed',
        transactionId: 'trial-free-premium',
        timestamp: new Date().toISOString()
    };
}

function inferPlanForSupportTicket(emailNorm) {
    const key = String(emailNorm || '').trim().toLowerCase();
    const sub = findBestActiveSubscriptionForEmail(key);
    if (sub) {
        const t = String(sub.type || '').toUpperCase();
        const names = {
            INDEX3: 'الخطة الأساسية',
            INDEX4: 'الخطة المتقدمة',
            INDEX5: 'الخطة المميزة السحابية'
        };
        return { planCode: t, planName: names[t] || t };
    }
    if (getFreePremiumTrialInfoForEmail(key)) {
        return { planCode: 'TRIAL', planName: 'فترة التجربة' };
    }
    return { planCode: 'FREE', planName: 'مجاني تجريبي' };
}

/**
 * لقطة للمساعد: تسجيل/خطة وفق بريد الجهاز فقط (بدون استعلام بريد عشوائي من النموذج).
 */
function buildAccountPlanSnapshotForAssistant(emailNorm) {
    const key = String(emailNorm || '').trim().toLowerCase();
    if (!key || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(key)) {
        return { ok: false, error: 'no_account_email' };
    }
    const row = loadRegs().find((r) => r.email.toLowerCase() === key);
    const activeSub = findBestActiveSubscriptionForEmail(key);
    const trial = getFreePremiumTrialInfoForEmail(key);
    const plan = inferPlanForSupportTicket(key);
    const verified = !!(row && row.verified);
    const freeTrialExpired = verified && !activeSub && !trial;
    let hint = 'No active paid subscription or server trial on this email.';
    if (activeSub) {
        hint = 'Active paid subscription on server records.';
    } else if (trial) {
        hint = 'Server-side signup trial still active for this email.';
    } else if (freeTrialExpired) {
        hint =
            'Signup trial ended on server; user is not on INDEX5 unless they have a separate paid subscription record.';
    }
    return {
        ok: true,
        registered: !!row,
        verified,
        planCode: plan.planCode,
        planName: plan.planName,
        hasActivePaidSubscription: !!activeSub,
        paidPlanCode: activeSub ? String(activeSub.type || '').toUpperCase() : null,
        freeTrialActive: !!trial,
        freeTrialExpired,
        hint
    };
}

/**
 * نواة إنشاء تذكرة دعم — يستدعيها POST /api/support/tickets وأداة المساعد.
 */
function createSupportTicketCore({
    email,
    subject,
    message,
    planCode: reqPlanCode,
    planName: reqPlanName,
    attachments: rawAttachments
}) {
    const em = String(email || '').trim();
    const subj = String(subject || '').trim();
    const msg = String(message || '').trim();
    if (!em || !subj || !msg) {
        return { ok: false, error: 'missing_fields' };
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        return { ok: false, error: 'invalid_email' };
    }
    const emailKey = em.toLowerCase();
    const tickets = loadSupportTickets();
    const inferredPlan = inferPlanForSupportTicket(emailKey);
    const rawPlanCode = String(reqPlanCode || '').trim().toUpperCase();
    const rawPlanName = String(reqPlanName || '').trim();
    const planCode = rawPlanCode || inferredPlan.planCode;
    const planName = rawPlanName || inferredPlan.planName;
    const activeTicket = tickets.find((t) => {
        const tEm = String(t?.email || '').trim().toLowerCase();
        const st = String(t?.status || 'open').toLowerCase();
        return tEm === emailKey && (st === 'open' || st === 'in_progress');
    });
    if (activeTicket) {
        return {
            ok: false,
            error: 'active_ticket_exists',
            ticketId: activeTicket.id,
            message: 'لديك تذكرة فعّالة حالياً. لا يمكن فتح تذكرة جديدة قبل إغلاق الحالية.'
        };
    }
    const attachments = sanitizeSupportAttachments(rawAttachments);
    const ticketId =
        'SUP-' +
        Date.now().toString(36).toUpperCase() +
        '-' +
        Math.random().toString(36).slice(2, 7).toUpperCase();
    const row = {
        id: ticketId,
        email: em,
        planCode,
        planName,
        subject: subj.slice(0, 180),
        message: msg.slice(0, 5000),
        status: 'open',
        reply: '',
        attachments,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    tickets.push(row);
    if (tickets.length > 5000) {
        tickets.splice(0, tickets.length - 5000);
    }
    saveSupportTickets(tickets);
    return { ok: true, ticketId, attachmentsSaved: attachments.length };
}

/** تحديث البريد في سجلات الدفع/الاشتراك بعد تغيير البريد (لتوافق لوحة التحكم) */
function patchSubscriptionLogsForEmailChange(oldEmail, newEmail) {
    const o = String(oldEmail || '').trim().toLowerCase();
    const n = String(newEmail || '').trim().toLowerCase();
    if (!o || !n || o === n) {
        return;
    }
    const logs = loadSubscriptionLogs();
    let changed = false;
    for (const l of logs) {
        const u = String(l.userEmail || l.email || '').trim().toLowerCase();
        if (u === o) {
            l.userEmail = n;
            if (l.email) {
                l.email = n;
            }
            changed = true;
        }
    }
    if (changed) {
        saveSubscriptionLogs(logs);
    }
}

let mailTransportCache = undefined;
let sendgridMailClient = undefined;

function getSendGridApiKey() {
    return normalizeEnvSecret(process.env.SENDGRID_API_KEY || '');
}

async function sendAuthEmailViaSendGrid(to, subject, text, mailOpts, from) {
    const apiKey = getSendGridApiKey();
    if (!apiKey) {
        return null;
    }
    if (!sendgridMailClient) {
        try {
            sendgridMailClient = require('@sendgrid/mail');
        } catch (e) {
            return { sent: false, error: 'sendgrid_module_missing' };
        }
        sendgridMailClient.setApiKey(apiKey);
    }
    const msg = {
        to: String(to).trim(),
        from: from,
        subject: String(subject || ''),
        text: String(text || '')
    };
    if (mailOpts && typeof mailOpts.html === 'string' && mailOpts.html.trim()) {
        msg.html = mailOpts.html.trim();
    }
    if (mailOpts && Array.isArray(mailOpts.attachments) && mailOpts.attachments.length) {
        msg.attachments = mailOpts.attachments.map((a) => ({
            filename: a.filename,
            type: a.contentType || 'application/octet-stream',
            disposition: a.contentDisposition || 'attachment',
            content: Buffer.isBuffer(a.content)
                ? a.content.toString('base64')
                : Buffer.from(a.content).toString('base64')
        }));
    }
    try {
        await sendgridMailClient.send(msg);
        return { sent: true };
    } catch (e) {
        const body = e && e.response && e.response.body;
        const errMsg =
            (body && (typeof body === 'string' ? body : JSON.stringify(body))) ||
            e.message ||
            'sendgrid_failed';
        return { sent: false, error: errMsg };
    }
}

function getMailTransport() {
    if (mailTransportCache === null) {
        return null;
    }
    if (mailTransportCache) {
        return mailTransportCache;
    }
    const host = normalizeEnvSecret(process.env.SMTP_HOST);
    if (!host) {
        mailTransportCache = null;
        return null;
    }
    mailTransportCache = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: String(process.env.SMTP_SECURE || '').toLowerCase() === 'true',
        auth:
            normalizeEnvSecret(process.env.SMTP_USER) || normalizeEnvSecret(process.env.SMTP_PASS)
                ? {
                      user: normalizeEnvSecret(process.env.SMTP_USER),
                      pass: normalizeEnvSecret(process.env.SMTP_PASS)
                  }
                : undefined
    });
    return mailTransportCache;
}

async function sendAuthEmail(to, subject, text, mailOpts) {
    const from =
        normalizeEnvSecret(process.env.MAIL_FROM) || normalizeEnvSecret(process.env.SMTP_USER) || 'noreply@localhost';
    const sgResult = await sendAuthEmailViaSendGrid(to, subject, text, mailOpts, from);
    if (sgResult !== null) {
        return sgResult;
    }
    const tx = getMailTransport();
    if (!tx) {
        return { sent: false, error: 'smtp_disabled' };
    }
    try {
        const payload = { from, to: String(to).trim(), subject, text: String(text || '') };
        if (mailOpts && typeof mailOpts.html === 'string' && mailOpts.html.trim()) {
            payload.html = mailOpts.html.trim();
        }
        if (mailOpts && Array.isArray(mailOpts.attachments) && mailOpts.attachments.length) {
            payload.attachments = mailOpts.attachments.map((a) => ({
                filename: a.filename,
                content: a.content,
                contentType: a.contentType || 'application/octet-stream',
                contentDisposition: a.contentDisposition || 'attachment'
            }));
        }
        await tx.sendMail(payload);
        return { sent: true };
    } catch (e) {
        return { sent: false, error: e.message || 'send_failed' };
    }
}

function sendActivationEmailInBackground(email, code) {
    const subject = 'رمز تفعيل حسابك — GOSTA';
    const text = `رمز التفعيل: ${code}\n\nإذا لم تطلب التسجيل يمكنك تجاهل هذه الرسالة.`;
    sendAuthEmail(email, subject, text)
        .then((r) => {
            if (!r.sent) {
                console.warn('[auth-server] activation email failed:', r.error);
            }
        })
        .catch((e) => console.warn('[auth-server] activation email:', e.message || e));
}

function sendEmailChangeCodeInBackground(newEmail, oldEmail, code) {
    const subject = 'تأكيد تغيير البريد — GOSTA';
    const text =
        `طلب تغيير البريد من ${oldEmail} إلى ${newEmail}.\n` +
        `رمز التأكيد: ${code}\n\nإذا لم تطلب التغيير تجاهل الرسالة.`;
    sendAuthEmail(newEmail, subject, text)
        .then((r) => {
            if (!r.sent) {
                console.warn('[auth-server] email-change mail failed:', r.error);
            }
        })
        .catch((e) => console.warn('[auth-server] email-change mail:', e.message || e));
}

function sendPasswordResetEmailInBackground(email, code) {
    const subject = 'إعادة تعيين كلمة السر — GOSTA';
    const text =
        `رمز إعادة تعيين كلمة السر: ${code}\n\n` +
        `صالح لمدة 15 دقيقة.\n` +
        `إذا لم تطلب ذلك تجاهل الرسالة.`;
    sendAuthEmail(email, subject, text)
        .then((r) => {
            if (!r.sent) {
                console.warn('[auth-server] password-reset email failed:', r.error);
            }
        })
        .catch((e) => console.warn('[auth-server] password-reset email:', e.message || e));
}

/** تسميات الخطة للفاتورة والبريد (عربي / إنجليزي) — بدل رموز INDEX3… */
const SUBSCRIPTION_PLAN_DISPLAY = {
    INDEX3: { ar: 'الخطة الأساسية', en: 'Basic plan' },
    INDEX4: { ar: 'الخطة المتقدمة', en: 'Advanced plan' },
    INDEX5: { ar: 'الخطة المميزة السحابية', en: 'Premium cloud plan' },
    INDEX2: { ar: 'الخطة المجانية التجريبية', en: 'Free trial plan' }
};

function resolveSubscriptionPlanLabels(entry) {
    const code = String(entry.type || entry.plan || '').trim().toUpperCase();
    const fromMap = SUBSCRIPTION_PLAN_DISPLAY[code];
    if (fromMap) {
        return { ar: fromMap.ar, en: fromMap.en, code };
    }
    const pn = String(entry.planName || '').trim();
    if (pn) {
        return { ar: pn, en: code || 'Subscription plan', code: code || '' };
    }
    return { ar: code || '—', en: code || '—', code: code || '' };
}

function paymentStatusBilingual(raw) {
    const s = String(raw || '').trim().toLowerCase();
    if (s === 'completed' || s === 'complete') {
        return { ar: 'مكتمل', en: 'Completed' };
    }
    if (s === 'active') {
        return { ar: 'نشط', en: 'Active' };
    }
    if (!s) {
        return { ar: '—', en: '—' };
    }
    return { ar: raw, en: raw };
}

/** سعر الفاتورة بالريال السعودي — صيغة SR (يستخرج الرقم من النص إن وُجد) */
function formatSubscriptionPriceSr(entry) {
    const raw = String(entry.price || '').trim();
    const numMatch = raw.replace(/,/g, '.').match(/(\d+(?:\.\d+)?)/);
    if (numMatch) {
        const n = Number(numMatch[1]);
        if (!Number.isNaN(n)) {
            return `${n} SR`;
        }
    }
    const code = String(entry.type || entry.plan || '').trim().toUpperCase();
    if (code === 'INDEX3') {
        return '2 SR';
    }
    if (code === 'INDEX4') {
        return '5 SR';
    }
    if (code === 'INDEX5') {
        return '10 SR';
    }
    if (raw) {
        return `${raw} SR`;
    }
    return '—';
}

/** تقصير رقم المعاملة للعرض في البريد وPDF — يعرض مرجعاً قصيراً فقط */
function formatShortTransactionId(transactionId) {
    const s = String(transactionId || '').trim();
    if (!s) {
        return '—';
    }
    const parts = s.split('-').filter(Boolean);
    const last = parts.length ? parts[parts.length - 1] : s;
    if (last.length >= 6 && last.length <= 14) {
        return last;
    }
    if (last.length > 14) {
        return last.slice(-12);
    }
    if (s.length <= 12) {
        return s;
    }
    return s.slice(-10);
}

/** اسم ملف PDF قصير ومستقر */
function subscriptionInvoicePdfFilename(entry) {
    const basis = String(entry.transactionId || entry.userEmail || entry.email || 'inv');
    const h = crypto.createHash('sha256').update(basis).digest('hex').slice(0, 12);
    return `GOSTA-invoice-${h}.pdf`;
}

/** فاتورة PDF بالإنجليزي فقط (بدون plan code، السعر بـ SR) */
function buildSubscriptionInvoicePdfBuffer(entry, planLabels) {
    return new Promise((resolve, reject) => {
        const doc = new PDFDocument({ size: 'A4', margin: 48 });
        const chunks = [];
        doc.on('data', (c) => chunks.push(c));
        doc.on('end', () => resolve(Buffer.concat(chunks)));
        doc.on('error', reject);

        const email = String(entry.userEmail || entry.email || '').trim();
        const txId = String(entry.transactionId || '').trim() || '—';
        const txShort = formatShortTransactionId(txId);
        const pay = paymentStatusBilingual(entry.paymentStatus);
        const priceSr = formatSubscriptionPriceSr(entry);
        const storage = entry.storage != null && entry.storage !== '' ? String(entry.storage) : '—';
        const start = String(entry.startDate || '').trim();
        const expiry = String(entry.expiryDate || '').trim();
        const method = String(entry.paymentMethod || '').trim();
        const methodEn =
            method === 'huawei_appgallery'
                ? 'Huawei AppGallery'
                : method === 'visa' || method === 'electronic'
                  ? 'Card / electronic'
                  : method || '—';

        doc.font('Helvetica-Bold').fontSize(14).fillColor('#111').text('GOSTA — Subscription invoice', {
            align: 'left'
        });
        doc.moveDown(0.6);
        doc.font('Helvetica').fontSize(10).fillColor('#222');
        doc.text(`Customer email: ${email}`);
        doc.text(`Plan: ${planLabels.en}`);
        doc.text(`Transaction ID: ${txShort}`);
        doc.text(`Payment status: ${pay.en}`);
        doc.text(`Price: ${priceSr}`);
        doc.text(`Storage MB: ${storage}`);
        doc.text(`Payment method: ${methodEn}`);
        doc.text(`Start date: ${start || '—'}`);
        doc.text(`End date: ${expiry || '—'}`);
        doc.moveDown();
        doc.fontSize(8).fillColor('#555').text('This document is generated automatically.');
        doc.text(`Issued: ${new Date().toISOString()}`);

        doc.end();
    });
}

async function sendPaymentInvoiceEmail(entry) {
    const email = String(entry.userEmail || entry.email || '').trim();
    if (!email) {
        return { sent: false, reason: 'no_email' };
    }
    const planLabels = resolveSubscriptionPlanLabels(entry);
    const pay = paymentStatusBilingual(entry.paymentStatus);
    const priceSr = formatSubscriptionPriceSr(entry);
    const subject = 'إيصال اشتراك — GOSTA / Subscription receipt';
    const txFull = String(entry.transactionId || '').trim();
    const txShort = formatShortTransactionId(txFull);
    const text =
        `تم تسجيل عملية اشتراك في النظام.\n` +
        `البريد: ${email}\n` +
        `الخطة: ${planLabels.ar}\n` +
        `المعاملة: ${txShort}\n` +
        `الحالة: ${pay.ar}\n` +
        `السعر: ${priceSr}\n\n` +
        `---\n\n` +
        `A subscription was recorded in the system.\n` +
        `Email: ${email}\n` +
        `Plan: ${planLabels.en}\n` +
        `Transaction: ${txShort}\n` +
        `Status: ${pay.en}\n` +
        `Price: ${priceSr}\n`;

    const esc = (s) =>
        String(s || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;');
    const html =
        `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;line-height:1.6">` +
        `<p><strong>إيصال اشتراك — GOSTA</strong></p>` +
        `<p>البريد: ${esc(email)}<br/>` +
        `الخطة: ${esc(planLabels.ar)}<br/>` +
        `المعاملة: ${esc(txShort)}<br/>` +
        `الحالة: ${esc(pay.ar)}<br/>` +
        `السعر: ${esc(priceSr)}</p>` +
        `<hr/><p dir="ltr" style="text-align:left;font-family:Arial,sans-serif">` +
        `<strong>Subscription receipt — GOSTA</strong><br/>` +
        `Email: ${esc(email)}<br/>` +
        `Plan: ${esc(planLabels.en)}<br/>` +
        `Transaction: ${esc(txShort)}<br/>` +
        `Status: ${esc(pay.en)}<br/>` +
        `Price: ${esc(priceSr)}</p>` +
        `</div>`;

    let attachments = [];
    try {
        const pdfBuf = await buildSubscriptionInvoicePdfBuffer(entry, planLabels);
        if (!pdfBuf || pdfBuf.length < 100) {
            throw new Error('pdf_too_small');
        }
        attachments = [
            {
                filename: subscriptionInvoicePdfFilename(entry),
                content: pdfBuf,
                contentType: 'application/pdf',
                contentDisposition: 'attachment'
            }
        ];
        console.log('[auth-server] subscription invoice PDF ready:', pdfBuf.length, 'bytes');
    } catch (e) {
        console.error('[auth-server] invoice PDF build failed:', e.message || e);
    }

    return sendAuthEmail(email, subject, text, {
        html,
        attachments: attachments.length ? attachments : undefined
    });
}

function getClientIpForRateLimit(req) {
    const xf = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    if (xf) {
        return xf;
    }
    return String((req.socket && req.socket.remoteAddress) || req.ip || 'unknown');
}

function allowAiChatRate(ip) {
    if (AI_CHAT_RATE_MAX <= 0) {
        return true;
    }
    const key = String(ip || 'unknown');
    const now = Date.now();
    let row = aiChatRateByIp.get(key);
    if (!row || now - row.start >= AI_CHAT_RATE_WINDOW_MS) {
        aiChatRateByIp.set(key, { start: now, count: 1 });
        return true;
    }
    if (row.count >= AI_CHAT_RATE_MAX) {
        return false;
    }
    row.count += 1;
    return true;
}

function allowAiImageRate(ip) {
    if (AI_IMAGE_RATE_MAX <= 0) {
        return true;
    }
    const key = String(ip || 'unknown');
    const now = Date.now();
    let row = aiImageRateByIp.get(key);
    if (!row || now - row.start >= AI_IMAGE_RATE_WINDOW_MS) {
        aiImageRateByIp.set(key, { start: now, count: 1 });
        return true;
    }
    if (row.count >= AI_IMAGE_RATE_MAX) {
        return false;
    }
    row.count += 1;
    return true;
}

function adminAuth(req, res, next) {
    const key = normalizeEnvSecret(req.get('x-admin-key') || req.query.key || '');
    if (!key || key !== ADMIN_KEY) {
        return res.status(401).json({ error: 'unauthorized' });
    }
    next();
}

const app = express();
app.use(
    cors({
        origin: function (origin, cb) {
            if (!origin) {
                return cb(null, true);
            }
            if (!IS_PRODUCTION) {
                return cb(null, true);
            }
            if (ALLOWED_ORIGINS.includes(origin)) {
                return cb(null, true);
            }
            return cb(new Error('CORS origin not allowed'));
        }
    })
);
app.use(express.json({ limit: process.env.PR_SAFE_JSON_LIMIT || '512mb' }));

if (String(process.env.AI_ROUTE_TIMING_LOG || '').trim() === '1') {
    app.use('/api/ai', (req, res, next) => {
        const t0 = Date.now();
        const pathOnly = (req.originalUrl || req.url || '').split('?')[0];
        res.on('finish', () => {
            try {
                console.log('[ai/timing]', req.method, pathOnly, Date.now() - t0, 'ms', res.statusCode);
            } catch (_) {}
        });
        next();
    });
}

const conversationStore = createConversationStore(path.join(__dirname, 'data', 'conversations.sqlite'));

/** تعطيل المساعد للتطبيق فقط — طلبات المدير (x-admin-key) تتجاوز القيد */
function appAssistantGateForUsers(req, res, next) {
    const adminKeyHdr = normalizeEnvSecret(req.get('x-admin-key') || '');
    if (adminKeyHdr && adminKeyHdr === ADMIN_KEY) {
        return next();
    }
    const settings = readAppSettings();
    if (!settings.assistantEnabledForApp) {
        return res.status(503).json({
            error: 'assistant_disabled',
            message: 'المساعد الذكي غير متاح حالياً في التطبيق. حاول لاحقاً.'
        });
    }
    next();
}

app.use('/api/ai', appAssistantGateForUsers);

registerAiRoutes(app, {
    runAiWork,
    getClientIpForRateLimit,
    allowAiChatRate,
    allowAiImageRate,
    buildAccountPlanSnapshotForAssistant,
    createSupportTicketCore,
    conversationStore,
    findVerifiedRegistrationByEmail,
    adminMetrics
});
registerConversationRoutes(app, {
    conversationStore,
    findVerifiedRegistrationByEmail,
    getClientIpForRateLimit,
    allowAiChatRate,
    adminMetrics
});
logAiStartup();

app.get('/api/ping', (req, res) => {
    /** يستخدمه pr-safe-auth-config لاختيار منفذ auth-server المحدّث عند وجود عدة عمليات Node */
    res.json({
        ok: true,
        t: Date.now(),
        serverMonitor: true,
        appSettings: true,
        passwordReset: true
    });
});

app.get('/api/app-settings', (req, res) => {
    try {
        const s = readAppSettings();
        res.json({
            ok: true,
            assistantEnabledForApp: !!s.assistantEnabledForApp,
            updatedAt: s.updatedAt || null
        });
    } catch (e) {
        console.error('[auth-server] app-settings read:', e);
        res.status(500).json({ ok: false, error: 'read_failed' });
    }
});

app.get('/api/admin/app-settings', adminAuth, (req, res) => {
    try {
        const s = readAppSettings();
        res.json({
            ok: true,
            assistantEnabledForApp: !!s.assistantEnabledForApp,
            updatedAt: s.updatedAt || null
        });
    } catch (e) {
        console.error('[auth-server] admin app-settings read:', e);
        res.status(500).json({ ok: false, error: 'read_failed' });
    }
});

app.put('/api/admin/app-settings', adminAuth, (req, res) => {
    try {
        const body = req.body && typeof req.body === 'object' ? req.body : {};
        if (typeof body.assistantEnabledForApp !== 'boolean') {
            return res.status(400).json({
                ok: false,
                error: 'invalid_body',
                message: 'أرسل assistantEnabledForApp كقيمة true أو false.'
            });
        }
        const saved = writeAppSettings({ assistantEnabledForApp: body.assistantEnabledForApp });
        res.json({
            ok: true,
            assistantEnabledForApp: !!saved.assistantEnabledForApp,
            updatedAt: saved.updatedAt
        });
    } catch (e) {
        console.error('[auth-server] admin app-settings write:', e);
        res.status(500).json({ ok: false, error: 'write_failed' });
    }
});

app.post('/api/ai/image-edit', async (req, res) => {
    if (!OPENAI_API_KEY) {
        adminMetrics.bump('ai_image_edit_not_configured');
        return res.status(503).json({
            error: 'ai_not_configured',
            message: 'المساعد غير مُفعّل. أضف OPENAI_API_KEY في .env.'
        });
    }
    const ip = getClientIpForRateLimit(req);
    if (!allowAiImageRate(ip)) {
        adminMetrics.bump('ai_image_edit_rate_limited');
        return res.status(429).json({ error: 'rate_limit', message: 'كثرة طلبات تعديل الصور. حاول بعد دقيقة.' });
    }
    const prompt = String((req.body && req.body.prompt) || '').trim();
    const imageDataUrl = String((req.body && req.body.imageDataUrl) || '').trim();
    if (prompt.length < 3) {
        adminMetrics.bump('ai_image_edit_bad_request');
        return res.status(400).json({ error: 'missing_prompt', message: 'اكتب وصف تعديل واضح للصورة.' });
    }
    if (!imageDataUrl.startsWith('data:image/') || !/;[\s]*base64,/i.test(imageDataUrl)) {
        adminMetrics.bump('ai_image_edit_bad_request');
        return res.status(400).json({ error: 'invalid_image', message: 'الصورة غير صالحة. أرسل JPG/PNG/WebP.' });
    }
    try {
        adminMetrics.bump('ai_image_edit_requests');
        const comma = imageDataUrl.indexOf(',');
        if (comma < 0) {
            adminMetrics.bump('ai_image_edit_bad_request');
            return res.status(400).json({ error: 'invalid_image', message: 'تنسيق الصورة غير صحيح.' });
        }
        const b64 = imageDataUrl.slice(comma + 1);
        const bytes = Buffer.from(b64, 'base64');
        if (!bytes.length || bytes.length > 10 * 1024 * 1024) {
            adminMetrics.bump('ai_image_edit_bad_request');
            return res.status(400).json({ error: 'image_too_large', message: 'حجم الصورة كبير أو غير صالح.' });
        }

        let pngBytes;
        try {
            pngBytes = await bufferToPngForOpenAiImageEdit(bytes);
        } catch (convErr) {
            console.error('image-edit png convert:', convErr);
            adminMetrics.bump('ai_image_edit_bad_request');
            return res.status(400).json({
                error: 'convert_failed',
                message: 'تعذر معالجة الصورة. جرّب JPG/PNG/WebP أو صورة أصغر.'
            });
        }

        const editSizeRaw = normalizeEnvSecret(process.env.OPENAI_IMAGE_EDIT_SIZE) || '1024x1024';
        const allowedEditSizes = new Set(['256x256', '512x512', '1024x1024']);
        const editSize = allowedEditSizes.has(editSizeRaw) ? editSizeRaw : '1024x1024';

        let plan = defaultImageEditPlan();
        if (OPENAI_IMAGE_EDIT_TEXT_OVERLAY) {
            plan = await planImageEditWithOpenAI(prompt);
            const heuristicOv = extractHeuristicOverlayText(prompt);
            plan = mergeHeuristicOverlayIntoPlan(plan, heuristicOv);
            plan = coerceCaptionOnlyPlan(plan, prompt);
            if (plan.kind !== 'visual_edit' || plan.overlayText) {
                console.log('[auth-server] image-edit plan:', plan.kind, plan.overlayText ? '(نص)' : '');
            }
            if (
                userPromptSuggestsTextOnImage(prompt) &&
                !userPromptSuggestsNonTextVisualEdit(prompt) &&
                !plan.overlayText
            ) {
                adminMetrics.bump('ai_image_edit_bad_request');
                return res.status(400).json({
                    error: 'missing_overlay_text',
                    message:
                        'لم نستطع استخراج النص المطلوب طباعته. اكتب بوضوح مثلاً: النص: كل عام وأنتم بخير أو ضع الجملة بين «علامتي تنصيص».'
                });
            }
        }

        const textOverlayRequested = !!(OPENAI_IMAGE_EDIT_TEXT_OVERLAY && plan && plan.overlayText);
        let textOverlayApplied = false;

        if (OPENAI_IMAGE_EDIT_TEXT_OVERLAY && plan.kind === 'text_only' && plan.overlayText) {
            try {
                const outBuf = await renderTextOverlayOnPngBuffer(pngBytes, plan.overlayText, plan);
                const outUrl = 'data:image/png;base64,' + outBuf.toString('base64');
                textOverlayApplied = true;
                adminMetrics.bump('ai_image_edit_success');
                return res.json({
                    ok: true,
                    imageDataUrl: outUrl,
                    revisedPrompt:
                        'النص على الصورة: ' +
                        plan.overlayText +
                        ' — رُسِم محلياً (أدق من إضافة النص عبر DALL·E).',
                    textOverlayRequested: true,
                    textOverlayApplied: true,
                    textOverlayWarning: null
                });
            } catch (ovErr) {
                console.error('image-edit text overlay:', ovErr);
                adminMetrics.bump('ai_image_edit_other_error');
                return res.status(502).json({
                    error: 'text_overlay_failed',
                    message:
                        'تعذر إضافة النص على الصورة دون إعادة رسمها. لن نستخدم DALL·E هنا لأنه يفسد الخطوط والخط العربي. جرّب صورة أصغر، أو صيغة «النص: …»، أو أعد تشغيل الخادم بعد التحديث.',
                    openaiMessage: String((ovErr && ovErr.message) || '').slice(0, 240),
                    textOverlayRequested: true,
                    textOverlayApplied: false,
                    textOverlayWarning: null
                });
            }
        }

        let promptForApi = resolveDallePromptFromPlan(plan);
        if (!sanitizePromptForApi(promptForApi)) {
            promptForApi = await enhanceImageEditPromptForOpenAI(prompt);
        }
        if (!sanitizePromptForApi(promptForApi)) {
            promptForApi = prompt;
        }
        if (promptForApi !== prompt) {
            console.log(
                '[auth-server] image-edit DALL·E prompt:',
                String(prompt).slice(0, 72),
                '->',
                String(promptForApi).slice(0, 120)
            );
        }

        const form = new FormData();
        form.append('model', OPENAI_IMAGE_EDIT_MODEL);
        form.append('prompt', promptForApi);
        form.append('size', editSize);
        form.append('response_format', 'b64_json');
        form.append('image', new Blob([pngBytes], { type: 'image/png' }), 'edit-input.png');

        const r = await runAiWork(async () => {
            const ac = new AbortController();
            const timer = setTimeout(() => ac.abort(), OPENAI_IMAGE_EDIT_TIMEOUT_MS);
            try {
                return await fetch('https://api.openai.com/v1/images/edits', {
                    method: 'POST',
                    headers: {
                        Authorization: 'Bearer ' + OPENAI_API_KEY
                    },
                    body: form,
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
            let messageAr = 'تعذر تعديل الصورة.';
            if (errCode === 'content_policy_violation' || /content policy|safety/i.test(String(detail))) {
                messageAr += ' الوصف قد يخالف سياسة المحتوى — جرّب صياغة أخرى.';
            } else if (errCode === 'insufficient_quota') {
                messageAr += ' تحقق من رصيد OpenAI.';
            } else if (errCode === 'model_not_found' || errCode === 'invalid_value') {
                messageAr +=
                    ' نموذج أو معامل غير مدعوم. للخادم: OPENAI_IMAGE_EDIT_MODEL=dall-e-2 وحجم 256/512/1024.';
            } else if (errCode === 'unsupported_file_mimetype') {
                messageAr += ' الصيغة غير مدعومة بعد التحويل — جرّب صورة أخرى.';
            }
            adminMetrics.bump('ai_image_edit_openai_error');
            return res.status(502).json({
                error: 'openai_image_edit_error',
                message: messageAr,
                openaiCode: errCode || null,
                openaiMessage: String(detail).slice(0, 500)
            });
        }
        let b64Out = data?.data?.[0]?.b64_json;
        if (!b64Out) {
            adminMetrics.bump('ai_image_edit_openai_error');
            return res.status(502).json({ error: 'no_image_data', message: 'لم يُرجع الخادم بيانات صورة معدلة.' });
        }
        if (OPENAI_IMAGE_EDIT_TEXT_OVERLAY && plan.overlayText && b64Out) {
            try {
                const editedBuf = Buffer.from(String(b64Out), 'base64');
                const rgbaBuf = await bufferToPngForOpenAiImageEdit(editedBuf);
                const overlaid = await renderTextOverlayOnPngBuffer(rgbaBuf, plan.overlayText, plan);
                b64Out = overlaid.toString('base64');
                textOverlayApplied = true;
            } catch (postOv) {
                console.warn('[auth-server] image-edit post-DALL·E overlay:', postOv && postOv.message);
            }
        }
        const outUrl = 'data:image/png;base64,' + String(b64Out);
        const openaiRevised = data.data[0] && data.data[0].revised_prompt;
        const warnNoText =
            textOverlayRequested && !textOverlayApplied
                ? 'لم يُرسم النص المطلوب على الصورة. قد تكون النتيجة من DALL·E فقط (غالباً بلا النص بدقة). جرّب صيغة «النص: …» أو جهاز/خادم x64 أو Linux.'
                : null;
        adminMetrics.bump('ai_image_edit_success');
        return res.json({
            ok: true,
            imageDataUrl: outUrl,
            revisedPrompt: buildRevisedPromptLabel(plan, promptForApi, prompt, openaiRevised),
            textOverlayRequested,
            textOverlayApplied: textOverlayRequested ? textOverlayApplied : false,
            textOverlayWarning: warnNoText
        });
    } catch (e) {
        console.error('ai/image-edit proxy:', e);
        if (e && e.message === 'ai_queue_full') {
            adminMetrics.bump('ai_image_edit_queue_full');
            return res.status(503).json({
                error: 'server_busy',
                message: 'الخدمة مشغولة حالياً. حاول بعد ثوانٍ قليلة.'
            });
        }
        if (e && (e.name === 'AbortError' || /aborted/i.test(String(e.message)))) {
            adminMetrics.bump('ai_image_edit_timeout');
            return res.status(504).json({
                error: 'image_edit_timeout',
                message: 'انتهت مهلة تعديل الصورة. جرّب صورة أصغر أو حاول مجدداً.'
            });
        }
        adminMetrics.bump('ai_image_edit_other_error');
        return res.status(500).json({ error: 'proxy_failed', message: 'خطأ في الاتصال بخدمة تعديل الصور.' });
    }
});

/**
 * تحويل صوت إلى نص (Speech-to-Text) عبر OpenAI.
 * الجسم: { audioDataUrl: "data:audio/..;base64,..." }
 */
app.post('/api/ai/transcribe', async (req, res) => {
    if (!OPENAI_API_KEY) {
        return res.status(503).json({
            error: 'ai_not_configured',
            message: 'المساعد غير مُفعّل. أضف OPENAI_API_KEY في .env.'
        });
    }
    try {
        const audioDataUrl = String(req.body?.audioDataUrl || '').trim();
        if (!audioDataUrl.startsWith('data:audio/') || !/;[\s]*base64,/i.test(audioDataUrl)) {
            return res.status(400).json({ error: 'invalid_audio', message: 'ملف الصوت غير صالح.' });
        }
        const comma = audioDataUrl.indexOf(',');
        if (comma < 0) {
            return res.status(400).json({ error: 'invalid_audio', message: 'تنسيق الصوت غير صحيح.' });
        }
        const header = audioDataUrl.slice(0, comma);
        const base64 = audioDataUrl.slice(comma + 1);
        const mimeMatch = header.match(/^data:([^;]+);base64$/i);
        const mime = mimeMatch ? String(mimeMatch[1]).toLowerCase() : 'audio/webm';
        const bytes = Buffer.from(base64, 'base64');
        if (!bytes.length || bytes.length > 12 * 1024 * 1024) {
            return res.status(400).json({ error: 'audio_too_large', message: 'ملف الصوت كبير أو فارغ.' });
        }

        const form = new FormData();
        form.append('model', OPENAI_TRANSCRIBE_MODEL);
        form.append('language', 'ar');
        form.append('response_format', 'json');
        form.append('file', new Blob([bytes], { type: mime }), 'voice-input.webm');

        const r = await fetch('https://api.openai.com/v1/audio/transcriptions', {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + OPENAI_API_KEY },
            body: form
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            const errObj = data && data.error;
            const detail = (errObj && errObj.message) || r.statusText || String(r.status);
            const errCode = (errObj && errObj.code) || '';
            return res.status(502).json({
                error: 'openai_transcribe_error',
                message: 'تعذر تحويل الصوت إلى نص.',
                openaiCode: errCode || null,
                openaiMessage: String(detail).slice(0, 500)
            });
        }
        const text = String(data?.text || '').trim();
        if (!text) {
            return res.status(200).json({ ok: true, text: '' });
        }
        return res.json({ ok: true, text });
    } catch (e) {
        console.error('ai/transcribe proxy:', e);
        return res.status(500).json({ error: 'proxy_failed', message: 'خطأ في تحويل الصوت إلى نص.' });
    }
});

app.post('/api/register', async (req, res) => {
    const { email, password, securityAnswer } = req.body || {};
    if (!email || !password || !securityAnswer) {
        return res.status(400).json({ error: 'missing_fields' });
    }

    const list = loadRegs();
    const lower = email.toLowerCase();
    const existing = list.find((r) => r.email.toLowerCase() === lower);
    const code = genCode();

    if (existing && existing.verified) {
        return res.status(409).json({ error: 'email_exists' });
    }

    if (existing && !existing.verified) {
        existing.code = code;
        existing.password = password;
        existing.securityAnswer = securityAnswer;
        existing.createdAt = new Date().toISOString();
        existing.lastEmailSent = true;
        existing.lastMailError = null;
        saveRegs(list);
        sendActivationEmailInBackground(email, code);
        return res.json({ ok: true, emailSent: true, mailPending: true });
    }

    const row = {
        email,
        password,
        securityAnswer,
        code,
        verified: false,
        createdAt: new Date().toISOString(),
        lastEmailSent: true,
        lastMailError: null,
        vaultKeySeed: crypto.randomBytes(32).toString('hex')
    };
    list.push(row);
    saveRegs(list);
    sendActivationEmailInBackground(email, code);
    return res.json({ ok: true, emailSent: true, mailPending: true });
});

app.post('/api/verify', (req, res) => {
    const { email, code } = req.body || {};
    if (!email || !code) {
        return res.status(400).json({ error: 'missing' });
    }

    const list = loadRegs();
    const row = list.find((r) => r.email.toLowerCase() === email.toLowerCase());
    if (!row || row.verified) {
        return res.status(400).json({ error: 'invalid' });
    }
    if (String(row.code) !== String(code).trim()) {
        return res.status(400).json({ error: 'wrong_code' });
    }

    row.verified = true;
    row.code = null;
    row.verifiedAt = new Date().toISOString();
    ensureVaultKeySeed(row);
    saveRegs(list);
    res.json({ ok: true, account: accountClientPayload(row) });
});

/**
 * تسجيل دخول من جهاز لا يحتوي حساباً محلياً: يتطلب بريداً مفعّلاً + كلمة سر صحيحة +
 * اشتراكاً فعّالاً بأي خطة (INDEX3/INDEX4/INDEX5) أو تجربة 10 أيام.
 */
app.post('/api/cross-device-login', (req, res) => {
    try {
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        if (!email || !password) {
            return res.status(400).json({ ok: false, error: 'missing_fields' });
        }
        const key = email.toLowerCase();
        const list = loadRegs();
        const row = list.find((r) => String(r.email || '').trim().toLowerCase() === key);
        if (!row || !row.verified) {
            return res.status(401).json({ ok: false, error: 'invalid_credentials' });
        }
        if (String(row.password || '') !== password) {
            return res.status(401).json({ ok: false, error: 'invalid_credentials' });
        }
        const access = getCrossDeviceAccessForEmail(key);
        if (!access.ok) {
            return res.status(403).json({
                ok: false,
                error: 'subscription_or_trial_required',
                message:
                    'تسجيل الدخول من جهاز جديد متاح باشتراك فعّال أو خلال فترة التجربة (10 أيام).'
            });
        }
        if (access.via === 'subscription') {
            const planType = String(access.subscription?.type || '').toUpperCase();
            if (requiresSameDeviceForPlan(planType)) {
                const requestedDevice = String(req.body?.deviceBindingId || '').trim();
                const boundDevice = String(access.subscription?.deviceBindingId || '').trim();
                if (!requestedDevice || !boundDevice || requestedDevice !== boundDevice) {
                    return res.status(403).json({
                        ok: false,
                        error: 'device_restricted_plan',
                        message:
                            'هذه الخطة مرتبطة بالجهاز الذي تم منه الاشتراك. للفتح من كل الأجهزة يلزم الخطة المميزة.'
                    });
                }
            }
        }
        const subscription =
            access.via === 'subscription'
                ? subscriptionClientPayloadFromLogEntry(access.subscription)
                : subscriptionClientPayloadFromTrial(key, access.trial);
        if (ensureVaultKeySeed(row)) {
            saveRegs(list);
        }
        return res.json({
            ok: true,
            account: accountClientPayload(row),
            subscription
        });
    } catch (e) {
        console.error('[auth-server] cross-device-login error:', e);
        return res.status(500).json({ ok: false, error: 'server_error' });
    }
});

/**
 * مزامنة حالة الاشتراك من الخادم لجهاز فيه حساب محلي قديم (بعد دفع من جهاز آخر).
 * لا يُرجع سجل التجربة كاشتراك مدفوع؛ INDEX3/INDEX4 تُرفض إن لم يطابق deviceBindingId.
 */
app.post('/api/subscription-sync', (req, res) => {
    try {
        const email = String(req.body?.email || '').trim();
        const password = String(req.body?.password || '');
        if (!email || !password) {
            return res.status(400).json({ ok: false, error: 'missing_fields' });
        }
        const key = email.toLowerCase();
        const list = loadRegs();
        const row = list.find((r) => String(r.email || '').trim().toLowerCase() === key);
        if (!row || !row.verified) {
            return res.status(401).json({ ok: false, error: 'invalid_credentials' });
        }
        if (String(row.password || '') !== password) {
            return res.status(401).json({ ok: false, error: 'invalid_credentials' });
        }

        const active = findBestActiveSubscriptionForEmail(key);
        if (!active) {
            const trial = getFreePremiumTrialInfoForEmail(key);
            return res.json({
                ok: true,
                subscription: null,
                accessMode: trial ? 'free_trial' : 'free'
            });
        }

        const planType = String(active.type || '').toUpperCase();
        if (requiresSameDeviceForPlan(planType)) {
            const requestedDevice = String(req.body?.deviceBindingId || '').trim();
            const boundDevice = String(active.deviceBindingId || '').trim();
            if (!requestedDevice || !boundDevice || requestedDevice !== boundDevice) {
                return res.json({
                    ok: true,
                    subscription: null,
                    accessMode: 'device_restricted',
                    serverPlan: planType,
                    message:
                        'اشتراك هذه الخطة مرتبط بجهاز الاشتراك ولا يُطبَّق على هذا الجهاز.'
                });
            }
        }

        return res.json({
            ok: true,
            subscription: subscriptionClientPayloadFromLogEntry(active),
            accessMode: 'paid'
        });
    } catch (e) {
        console.error('[auth-server] subscription-sync error:', e);
        return res.status(500).json({ ok: false, error: 'server_error' });
    }
});

/** حد أدنى بين طلبات إعادة الإرسال لنفس البريد (مللي ثانية) */
const RESEND_COOLDOWN_MS = 60 * 1000;
const lastResendAt = new Map();

/** تغيير البريد: صلاحية الكود وحد أدنى بين الطلبات */
const EMAIL_CHANGE_EXPIRY_MS = 15 * 60 * 1000;
const EMAIL_CHANGE_COOLDOWN_MS = 60 * 1000;
const lastEmailChangeRequestAt = new Map();

/** إعادة تعيين كلمة السر عبر البريد */
const PASSWORD_RESET_EXPIRY_MS = 15 * 60 * 1000;
const PASSWORD_RESET_COOLDOWN_MS = 60 * 1000;
const lastPasswordResetRequestAt = new Map();

app.post('/api/resend-code', async (req, res) => {
    const { email, password } = req.body || {};
    if (!email || !password) {
        return res.status(400).json({ error: 'missing_fields' });
    }
    const key = email.toLowerCase();
    const now = Date.now();
    const prev = lastResendAt.get(key) || 0;
    if (now - prev < RESEND_COOLDOWN_MS) {
        const waitSec = Math.ceil((RESEND_COOLDOWN_MS - (now - prev)) / 1000);
        return res.status(429).json({ error: 'rate_limit', retryAfterSec: waitSec });
    }

    const list = loadRegs();
    const row = list.find((r) => r.email.toLowerCase() === key);
    if (!row) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (row.verified) {
        return res.status(400).json({ error: 'already_verified' });
    }
    if (row.password !== password) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const code = genCode();
    row.code = code;
    row.lastResendAt = new Date().toISOString();

    row.lastEmailSent = true;
    row.lastMailError = null;
    saveRegs(list);
    lastResendAt.set(key, now);
    sendActivationEmailInBackground(email, code);
    return res.json({ ok: true, emailSent: true, mailPending: true });
});

app.post('/api/request-password-reset', async (req, res) => {
    const email = String(req.body?.email || '').trim();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        return res.status(400).json({ error: 'invalid_email' });
    }
    const key = email.toLowerCase();
    const now = Date.now();
    const prev = lastPasswordResetRequestAt.get(key) || 0;
    if (now - prev < PASSWORD_RESET_COOLDOWN_MS) {
        const waitSec = Math.ceil((PASSWORD_RESET_COOLDOWN_MS - (now - prev)) / 1000);
        return res.status(429).json({ error: 'rate_limit', retryAfterSec: waitSec });
    }

    const list = loadRegs();
    const row = list.find((r) => String(r.email || '').trim().toLowerCase() === key);
    if (!row || !row.verified) {
        return res.status(404).json({ error: 'not_found' });
    }

    const code = genCode();
    row.passwordResetPending = {
        code,
        expiresAt: new Date(now + PASSWORD_RESET_EXPIRY_MS).toISOString(),
        requestedAt: new Date(now).toISOString()
    };
    row.lastPasswordResetSent = true;
    row.lastPasswordResetMailError = null;
    saveRegs(list);
    lastPasswordResetRequestAt.set(key, now);
    sendPasswordResetEmailInBackground(email, code);
    return res.json({ ok: true, emailSent: true, mailPending: true });
});

app.post('/api/confirm-password-reset', (req, res) => {
    try {
        const email = String(req.body?.email || '').trim();
        const code = String(req.body?.code || '').trim();
        const newPassword = String(req.body?.password || '');
        const securityAnswer = String(req.body?.securityAnswer || '').trim();
        if (!email || !code || !newPassword || !securityAnswer) {
            return res.status(400).json({ error: 'missing_fields' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'password_too_short' });
        }
        const key = email.toLowerCase();
        const list = loadRegs();
        const row = list.find((r) => String(r.email || '').trim().toLowerCase() === key);
        if (!row || !row.verified) {
            return res.status(404).json({ error: 'not_found' });
        }
        const pending = row.passwordResetPending;
        if (!pending || !pending.code) {
            return res.status(400).json({ error: 'no_pending' });
        }
        if (String(pending.code) !== code) {
            return res.status(400).json({ error: 'wrong_code' });
        }
        const exp = new Date(pending.expiresAt).getTime();
        if (Number.isFinite(exp) && Date.now() > exp) {
            row.passwordResetPending = null;
            saveRegs(list);
            return res.status(400).json({ error: 'expired' });
        }

        row.password = newPassword;
        row.securityAnswer = securityAnswer;
        row.passwordResetPending = null;
        row.passwordResetAt = new Date().toISOString();
        if (ensureVaultKeySeed(row)) {
            saveRegs(list);
        } else {
            saveRegs(list);
        }

        const access = getCrossDeviceAccessForEmail(key);
        let subscription = null;
        if (access.ok) {
            subscription =
                access.via === 'subscription'
                    ? subscriptionClientPayloadFromLogEntry(access.subscription)
                    : subscriptionClientPayloadFromTrial(key, access.trial);
        }

        return res.json({
            ok: true,
            account: accountClientPayload(row),
            subscription
        });
    } catch (e) {
        console.error('[auth-server] confirm-password-reset error:', e);
        return res.status(500).json({ error: 'server_error' });
    }
});

app.post('/api/request-email-change', async (req, res) => {
    const { currentEmail, newEmail, password } = req.body || {};
    if (!currentEmail || !newEmail || !password) {
        return res.status(400).json({ error: 'missing_fields' });
    }
    const cur = String(currentEmail).trim();
    const neu = String(newEmail).trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(neu)) {
        return res.status(400).json({ error: 'invalid_new_email' });
    }
    const curKey = cur.toLowerCase();
    const neuKey = neu.toLowerCase();
    if (curKey === neuKey) {
        return res.status(400).json({ error: 'same_email' });
    }

    const now = Date.now();
    const prevEc = lastEmailChangeRequestAt.get(curKey) || 0;
    if (now - prevEc < EMAIL_CHANGE_COOLDOWN_MS) {
        const waitSec = Math.ceil((EMAIL_CHANGE_COOLDOWN_MS - (now - prevEc)) / 1000);
        return res.status(429).json({ error: 'rate_limit', retryAfterSec: waitSec });
    }

    const list = loadRegs();
    const row = list.find((r) => r.email.toLowerCase() === curKey);
    if (!row || !row.verified) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (row.password !== password) {
        return res.status(401).json({ error: 'unauthorized' });
    }

    const taken = list.find(
        (r) => r !== row && r.email.toLowerCase() === neuKey && r.verified
    );
    if (taken) {
        return res.status(409).json({ error: 'email_taken' });
    }

    const code = genCode();
    row.pendingEmailChange = {
        newEmail: neu,
        code,
        expiresAt: new Date(now + EMAIL_CHANGE_EXPIRY_MS).toISOString(),
        requestedAt: new Date(now).toISOString()
    };

    row.lastEmailChangeSent = true;
    row.lastEmailChangeMailError = null;
    saveRegs(list);
    lastEmailChangeRequestAt.set(curKey, now);
    sendEmailChangeCodeInBackground(neu, cur, code);
    return res.json({ ok: true, emailSent: true, mailPending: true });
});

app.post('/api/confirm-email-change', (req, res) => {
    const { currentEmail, newEmail, code } = req.body || {};
    if (!currentEmail || !newEmail || !code) {
        return res.status(400).json({ error: 'missing_fields' });
    }
    const cur = String(currentEmail).trim();
    const neu = String(newEmail).trim();
    const curKey = cur.toLowerCase();
    const neuKey = neu.toLowerCase();

    const list = loadRegs();
    const row = list.find((r) => r.email.toLowerCase() === curKey);
    if (!row || !row.verified) {
        return res.status(404).json({ error: 'not_found' });
    }
    const pe = row.pendingEmailChange;
    if (!pe || !pe.newEmail) {
        return res.status(400).json({ error: 'no_pending' });
    }
    if (pe.newEmail.toLowerCase() !== neuKey) {
        return res.status(400).json({ error: 'new_email_mismatch' });
    }
    if (String(pe.code) !== String(code).trim()) {
        return res.status(400).json({ error: 'wrong_code' });
    }
    const exp = new Date(pe.expiresAt).getTime();
    if (Number.isFinite(exp) && Date.now() > exp) {
        row.pendingEmailChange = null;
        saveRegs(list);
        return res.status(400).json({ error: 'expired' });
    }

    const taken = list.find(
        (r) => r !== row && r.email.toLowerCase() === neuKey && r.verified
    );
    if (taken) {
        return res.status(409).json({ error: 'email_taken' });
    }

    for (let i = list.length - 1; i >= 0; i--) {
        const r = list[i];
        if (r !== row && r.email.toLowerCase() === neuKey && !r.verified) {
            list.splice(i, 1);
        }
    }

    row.email = neu;
    row.pendingEmailChange = null;
    row.emailChangedAt = new Date().toISOString();
    saveRegs(list);
    try {
        patchSubscriptionLogsForEmailChange(cur, neu);
    } catch (e) {
        console.error('[auth-server] patchSubscriptionLogsForEmailChange:', e);
    }
    res.json({ ok: true });
});

app.get('/api/registration-status', (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'missing email' });
    }
    const row = loadRegs().find((r) => r.email.toLowerCase() === email.toLowerCase());
    if (!row) {
        return res.json({ registered: false });
    }
    res.json({ registered: true, verified: !!row.verified });
});

app.post('/api/support/tickets', (req, res) => {
    try {
        const result = createSupportTicketCore({
            email: req.body?.email,
            subject: req.body?.subject,
            message: req.body?.message,
            planCode: req.body?.planCode,
            planName: req.body?.planName,
            attachments: req.body?.attachments
        });
        if (!result.ok) {
            if (result.error === 'active_ticket_exists') {
                return res.status(409).json({
                    ok: false,
                    error: 'active_ticket_exists',
                    ticketId: result.ticketId,
                    message: result.message
                });
            }
            if (result.error === 'missing_fields') {
                return res.status(400).json({ ok: false, error: 'missing_fields' });
            }
            if (result.error === 'invalid_email') {
                return res.status(400).json({ ok: false, error: 'invalid_email' });
            }
            return res.status(400).json({ ok: false, error: result.error || 'bad_request' });
        }
        return res.json({
            ok: true,
            ticketId: result.ticketId,
            attachmentsSaved: result.attachmentsSaved
        });
    } catch (e) {
        console.error('[auth-server] support ticket create error:', e);
        return res.status(500).json({ ok: false, error: 'save_failed' });
    }
});

app.get('/api/admin/registrations', adminAuth, (req, res) => {
    const list = loadRegs().map((r) => ({
        email: r.email,
        verified: !!r.verified,
        createdAt: r.createdAt,
        verifiedAt: r.verifiedAt || null
    }));
    res.json(list);
});

app.get('/api/admin/registration-code', adminAuth, (req, res) => {
    const email = req.query.email;
    if (!email) {
        return res.status(400).json({ error: 'missing email' });
    }
    const row = loadRegs().find((r) => r.email.toLowerCase() === email.toLowerCase());
    if (!row || row.verified) {
        return res.status(404).json({ error: 'not_found' });
    }
    if (!row.code) {
        return res.status(404).json({ error: 'no_code' });
    }
    res.json({ code: row.code, email: row.email });
});

/** لقطة خفيفة للوحة الإدارة — قراءة فقط؛ لا تُحدَّث آلياً من التطبيق */
app.get('/api/admin/server-monitor', adminAuth, (req, res) => {
    try {
        adminMetrics.bump('admin_server_monitor_hits');
        function safeStat(p) {
            try {
                const st = fs.statSync(p);
                return { path: p, exists: true, bytes: st.size };
            } catch (_) {
                return { path: p, exists: false, bytes: 0 };
            }
        }
        const mem = process.memoryUsage();
        const la = os.loadavg();
        const total = os.totalmem();
        const free = os.freemem();
        let cpusLen = 0;
        try {
            const c = os.cpus();
            cpusLen = Array.isArray(c) ? c.length : 0;
        } catch (_) {
            cpusLen = 0;
        }
        const conversationsDbPath = path.join(__dirname, 'data', 'conversations.sqlite');
        res.json({
            ok: true,
            collectedAtUtc: new Date().toISOString(),
            metrics: adminMetrics.snapshot(),
            dataFiles: {
                registrations: safeStat(DATA_PATH),
                subscriptionLogs: safeStat(SUBSCRIPTION_LOGS_PATH),
                cloudFiles: safeStat(CLOUD_FILES_PATH),
                supportTickets: safeStat(SUPPORT_TICKETS_PATH),
                conversationsSqlite: safeStat(conversationsDbPath)
            },
            cloudStorage: {
                backend: cloudR2.getCloudStorageBackendLabel(),
                r2Configured: cloudR2.isR2Configured(),
                bucket: cloudR2.isR2Configured() ? String(process.env.S3_BUCKET || '').trim() : null
            },
            process: {
                uptimeSec: Math.floor(process.uptime()),
                pid: process.pid,
                nodeVersion: process.version
            },
            memory: {
                rssBytes: mem.rss,
                heapUsedBytes: mem.heapUsed,
                heapTotalBytes: mem.heapTotal,
                externalBytes: mem.external || 0
            },
            host: {
                platform: os.platform(),
                arch: os.arch(),
                hostname: os.hostname(),
                uptimeSec: Math.floor(os.uptime()),
                loadAvg1m: la[0],
                loadAvg5m: la[1],
                loadAvg15m: la[2],
                totalMemBytes: total,
                freeMemBytes: free,
                cpuCount: cpusLen
            },
            aiQueue: {
                activeWorkers: aiActiveWorkers,
                queuedJobs: aiWorkQueue.length,
                maxConcurrent: AI_MAX_CONCURRENT,
                maxQueue: AI_MAX_QUEUE
            }
        });
    } catch (e) {
        console.error('[auth-server] admin/server-monitor:', e);
        res.status(500).json({ ok: false, error: 'snapshot_failed' });
    }
});

app.get('/api/admin/support-tickets', adminAuth, (req, res) => {
    try {
        const list = loadSupportTickets();
        res.json(list);
    } catch (e) {
        console.error('[auth-server] admin/support-tickets error:', e);
        res.status(500).json({ error: 'read_failed' });
    }
});

app.patch('/api/admin/support-tickets/:id', adminAuth, (req, res) => {
    try {
        const ticketId = String(req.params?.id || '').trim();
        if (!ticketId) {
            return res.status(400).json({ ok: false, error: 'missing_id' });
        }
        const tickets = loadSupportTickets();
        const t = tickets.find((x) => String(x.id || '') === ticketId);
        if (!t) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        const nextStatus = String(req.body?.status || '').trim().toLowerCase();
        if (nextStatus && ['open', 'in_progress', 'resolved'].includes(nextStatus)) {
            t.status = nextStatus;
        }
        if (Object.prototype.hasOwnProperty.call(req.body || {}, 'reply')) {
            t.reply = String(req.body.reply || '').slice(0, 5000);
        }
        t.updatedAt = new Date().toISOString();
        saveSupportTickets(tickets);
        return res.json({ ok: true, ticket: t });
    } catch (e) {
        console.error('[auth-server] admin/support-tickets patch error:', e);
        return res.status(500).json({ ok: false, error: 'update_failed' });
    }
});

app.post('/api/admin/support-tickets/:id/send-reply', adminAuth, async (req, res) => {
    try {
        const ticketId = String(req.params?.id || '').trim();
        if (!ticketId) {
            return res.status(400).json({ ok: false, error: 'missing_id' });
        }
        const tickets = loadSupportTickets();
        const t = tickets.find((x) => String(x.id || '') === ticketId);
        if (!t) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        const replyText = String(req.body?.reply || t.reply || '').trim();
        if (!replyText) {
            return res.status(400).json({ ok: false, error: 'missing_reply' });
        }
        const requestedStatus = String(req.body?.status || '').trim().toLowerCase();
        const nextStatus = ['open', 'in_progress', 'resolved'].includes(requestedStatus)
            ? requestedStatus
            : String(t.status || 'open').toLowerCase();
        const subject = 'رد الدعم الفني — GOSTA (' + ticketId + ')';
        const text =
            'مرحباً،\n\n' +
            'تمت مراجعة تذكرتك (' +
            ticketId +
            ').\n\n' +
            'الرد:\n' +
            replyText +
            '\n\n' +
            'شكراً لك.\n';
        const sent = await sendAuthEmail(String(t.email || '').trim(), subject, text);
        if (!sent || !sent.sent) {
            return res.status(500).json({ ok: false, error: sent?.error || 'mail_send_failed' });
        }
        t.reply = replyText;
        t.status = nextStatus;
        t.updatedAt = new Date().toISOString();
        t.lastReplySentAt = new Date().toISOString();
        saveSupportTickets(tickets);
        return res.json({ ok: true, ticket: t });
    } catch (e) {
        console.error('[auth-server] support send-reply error:', e);
        return res.status(500).json({ ok: false, error: 'send_reply_failed' });
    }
});

/**
 * حفظ سجل اشتراك من صفحة الدفع (عام).
 * ملاحظة: هذا سجل عرض للوحة التحكم وليس تفويض دفع حقيقي.
 */
app.post('/api/subscription-log', (req, res) => {
    try {
        const raw = req.body || {};
        const email = String(raw.userEmail || raw.email || '').trim();
        const plan = String(raw.type || raw.plan || '').trim();
        const price = String(raw.price || '').trim();
        const paymentStatus = String(raw.paymentStatus || raw.status || 'completed').trim();
        const txid = String(raw.transactionId || '').trim();

        if (!email || !plan) {
            return res.status(400).json({ error: 'missing_fields' });
        }

        const logs = loadSubscriptionLogs();
        const logEntry = {
            ...raw,
            userEmail: email,
            type: plan,
            price: price,
            paymentStatus: paymentStatus,
            transactionId: txid || 'TXN-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10),
            loggedAt: new Date().toISOString(),
            source: 'api'
        };

        // منع التكرار السريع لنفس المعاملة
        const tx = logEntry.transactionId;
        const exists = logs.find((l) => String(l.transactionId || '') === String(tx));
        if (!exists) {
            logs.push(logEntry);
            if (logs.length > 2000) {
                logs.splice(0, logs.length - 2000);
            }
            saveSubscriptionLogs(logs);
        }

        /* إرسال الإيصال في كل طلب ناجح (حتى عند تكرار نفس المعاملة) حتى لا يُفقد المرفق أو يبقى المستخدم على نسخة بريد قديمة */
        sendPaymentInvoiceEmail(logEntry)
            .then((r) => {
                if (!r || !r.sent) {
                    console.warn('[auth-server] invoice email not sent:', r && (r.reason || r.error));
                }
            })
            .catch((err) => {
                console.error('[auth-server] invoice email error:', err && err.message ? err.message : err);
            });

        return res.json({ ok: true, transactionId: logEntry.transactionId });
    } catch (e) {
        console.error('[auth-server] subscription-log error:', e);
        return res.status(500).json({ error: 'save_failed' });
    }
});

/**
 * التحقق من شراء Huawei AppGallery IAP على السيرفر.
 * يتطلب: HUAWEI_IAP_CLIENT_ID و HUAWEI_IAP_CLIENT_SECRET من AppGallery Connect
 */
let cachedHuaweiAccessToken = { token: '', expiresAt: 0 };

async function getHuaweiIapAccessToken() {
    if (!HUAWEI_IAP_CLIENT_ID || !HUAWEI_IAP_CLIENT_SECRET) {
        throw new Error('missing_huawei_credentials');
    }
    if (cachedHuaweiAccessToken.token && Date.now() < cachedHuaweiAccessToken.expiresAt - 60000) {
        return cachedHuaweiAccessToken.token;
    }
    const body = new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: HUAWEI_IAP_CLIENT_ID,
        client_secret: HUAWEI_IAP_CLIENT_SECRET
    });
    const r = await fetchWithHuaweiTimeout(HUAWEI_OAUTH_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: body.toString()
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok || !data.access_token) {
        const err = new Error('iap_http_' + r.status);
        err.iapBody = data;
        throw err;
    }
    const expiresIn = Number(data.expires_in || 3600);
    cachedHuaweiAccessToken = {
        token: String(data.access_token),
        expiresAt: Date.now() + Math.max(60, expiresIn) * 1000
    };
    return cachedHuaweiAccessToken.token;
}

function resolvePlanFromHuaweiProductId(productId) {
    const pid = String(productId || '').trim();
    if (pid === 'index4_plan') return 'INDEX4';
    if (pid === 'index5_plan') return 'INDEX5';
    if (pid === 'index3_plan') return 'INDEX3';
    return null;
}

function buildSubscriptionFromHuaweiPlan(planCode, extras) {
    const o = extras || {};
    const planName =
        planCode === 'INDEX3' ? 'الخطة الأساسية'
        : planCode === 'INDEX4' ? 'الخطة المتقدمة'
        : 'الخطة المميزة السحابية';
    const storage =
        planCode === 'INDEX3' ? 300
        : planCode === 'INDEX4' ? 700
        : 1000;
    const price =
        planCode === 'INDEX3' ? '2 ريال'
        : planCode === 'INDEX4' ? '5 ريال'
        : '10 ريال';
    const expiryDate =
        o.expiryDate ||
        new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
    const purchaseToken = String(o.purchaseToken || '').trim();
    return {
        type: planCode,
        planName,
        storage,
        price,
        paymentMethod: 'huawei_appgallery',
        cardType: 'Huawei AppGallery',
        userEmail: o.userEmail || '',
        startDate: o.startDate || new Date().toISOString(),
        expiryDate,
        durationDays: 180,
        status: 'active',
        isValid: true,
        paymentStatus: 'completed',
        transactionId: 'HW-' + purchaseToken.slice(0, 18),
        purchaseToken,
        receiptId: purchaseToken,
        huaweiAccountId: o.huaweiAccountId || '',
        productId: o.productId || '',
        deviceBindingId:
            planCode === 'INDEX3' || planCode === 'INDEX4' ? o.deviceBindingId || '' : '',
        timestamp: new Date().toLocaleString('ar-EG'),
        loggedAt: new Date().toISOString(),
        source: 'huawei_iap_verify_api'
    };
}

async function verifyHuaweiPurchaseWithApi(purchaseToken, productId) {
    if (!HUAWEI_IAP_CLIENT_ID || !HUAWEI_IAP_CLIENT_SECRET) {
        throw new Error('missing_huawei_credentials');
    }
    const accessToken = await getHuaweiIapAccessToken();
    const url =
        HUAWEI_IAP_ORDER_URL +
        '?purchaseToken=' +
        encodeURIComponent(String(purchaseToken || '').trim()) +
        '&productId=' +
        encodeURIComponent(String(productId || '').trim());
    const r = await fetchWithHuaweiTimeout(url, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + accessToken,
            'Content-Type': 'application/json'
        }
    });
    const text = await r.text();
    let data = null;
    try {
        data = text ? JSON.parse(text) : null;
    } catch (eParse) {
        data = null;
    }
    if (!r.ok) {
        const err = new Error('iap_http_' + r.status);
        err.iapBody = data || text;
        throw err;
    }
    return data;
}

function parseHuaweiPurchaseTokenData(verifyResp) {
    if (!verifyResp || typeof verifyResp !== 'object') {
        return null;
    }
    const raw =
        verifyResp.purchaseTokenData ||
        verifyResp.purchaseTokenDataJson ||
        verifyResp.data ||
        null;
    if (!raw) {
        return verifyResp;
    }
    if (typeof raw === 'string') {
        try {
            return JSON.parse(raw);
        } catch (e) {
            return null;
        }
    }
    return raw;
}

function findVerifiedHuaweiPurchaseInLogs(purchaseToken) {
    const tok = String(purchaseToken || '').trim();
    if (!tok) return null;
    const permanent = getPermanentHuaweiPurchaseRecord(tok);
    if (permanent) {
        const logs = loadSubscriptionLogs();
        const fromLog = logs.find(
            (l) => String(l.purchaseToken || l.receiptId || '') === tok
        );
        if (fromLog) return fromLog;
        return {
            type: permanent.planCode || 'INDEX3',
            purchaseToken: tok,
            receiptId: tok,
            userEmail: permanent.userEmail || '',
            huaweiAccountId: permanent.huaweiAccountId || '',
            productId: permanent.productId || '',
            paymentMethod: 'huawei_appgallery',
            status: 'active',
            paymentStatus: 'completed',
            source: 'huawei_used_purchases_store'
        };
    }
    const logs = loadSubscriptionLogs();
    return (
        logs.find(
            (l) =>
                String(l.purchaseToken || l.receiptId || '') === tok &&
                (l.paymentMethod === 'huawei_appgallery' ||
                    String(l.source || '').includes('huawei'))
        ) || null
    );
}

function isRegisteredAppEmail(email) {
    const e = String(email || '').trim().toLowerCase();
    if (!e || !e.includes('@') || e === 'unknown@gosta.local') {
        return false;
    }
    const regs = loadRegs();
    return regs.some((r) => String(r.email || '').trim().toLowerCase() === e);
}

/** بدء جلسة شراء — يمنع شراء متزامن لنفس المستخدم على السيرفر */
app.post('/api/huawei-iap/purchase-session/begin', (req, res) => {
    try {
        const userEmail = String(req.body?.userEmail || req.body?.email || '').trim();
        const huaweiAccountId = String(req.body?.huaweiAccountId || req.body?.userId || '').trim();
        const planCode = String(req.body?.planCode || '').trim();
        const result = beginHuaweiPurchaseSession(userEmail, huaweiAccountId, planCode);
        if (!result.ok) {
            logHuaweiBillingEvent('SESSION_BEGIN_REJECTED', {
                email: userEmail,
                huaweiAccountId,
                planCode,
                errorCode: result.errorCode || result.error
            });
            const status = result.error === HUAWEI_BILLING_ERROR.PURCHASE_SESSION_ACTIVE ? 409 : 400;
            return res.status(status).json(result);
        }
        logHuaweiBillingEvent('SESSION_BEGIN', { email: userEmail, huaweiAccountId, planCode });
        return res.json(result);
    } catch (e) {
        console.error('[auth-server] huawei purchase-session begin:', e.message || e);
        logHuaweiBillingEvent('SESSION_BEGIN_FAILED', { detail: e.message || String(e) });
        return res.status(500).json(huaweiBillingJsonError(500, HUAWEI_BILLING_ERROR.SESSION_BEGIN_FAILED));
    }
});

/** إنهاء جلسة شراء (نجاح / فشل / إلغاء) */
app.post('/api/huawei-iap/purchase-session/end', (req, res) => {
    try {
        const userEmail = String(req.body?.userEmail || req.body?.email || '').trim();
        const huaweiAccountId = String(req.body?.huaweiAccountId || req.body?.userId || '').trim();
        const finalState = String(req.body?.finalState || 'IDLE').trim();
        endHuaweiPurchaseSession(userEmail, huaweiAccountId, finalState);
        logHuaweiBillingEvent('SESSION_END', { email: userEmail, huaweiAccountId, finalState });
        return res.json({ ok: true });
    } catch (e) {
        console.error('[auth-server] huawei purchase-session end:', e.message || e);
        logHuaweiBillingEvent('SESSION_END_FAILED', { detail: e.message || String(e) });
        return res.status(500).json(huaweiBillingJsonError(500, HUAWEI_BILLING_ERROR.SESSION_END_FAILED));
    }
});

/** استعادة حالة الشراء بعد إغلاق التطبيق أو انقطاع الشبكة */
app.post('/api/huawei-iap/recovery-status', (req, res) => {
    try {
        const userEmail = String(req.body?.userEmail || req.body?.email || '').trim();
        const huaweiAccountId = String(req.body?.huaweiAccountId || req.body?.userId || '').trim();
        const pendingPurchaseToken = String(
            req.body?.pendingPurchaseToken || req.body?.purchaseToken || req.body?.receiptId || ''
        ).trim();
        const clientPurchaseState = String(req.body?.clientPurchaseState || '').trim();

        const activeSession = getActiveHuaweiPurchaseSession(userEmail, huaweiAccountId);
        const permanent = pendingPurchaseToken
            ? getPermanentHuaweiPurchaseRecord(pendingPurchaseToken)
            : null;
        const recentEvents = getRecentBillingEventsForUser(userEmail, huaweiAccountId, 5);

        let action = 'NONE';
        let subscription = null;

        if (permanent && pendingPurchaseToken) {
            action = 'APPLY_SUBSCRIPTION';
            subscription = findVerifiedHuaweiPurchaseInLogs(pendingPurchaseToken);
            logHuaweiBillingEvent('RECOVERY_APPLY_USED_PURCHASE', {
                email: userEmail,
                huaweiAccountId,
                purchaseToken: pendingPurchaseToken
            });
        } else if (pendingPurchaseToken) {
            action = 'RETRY_VERIFY';
            logHuaweiBillingEvent('RECOVERY_RETRY_VERIFY', {
                email: userEmail,
                huaweiAccountId,
                purchaseToken: pendingPurchaseToken,
                clientPurchaseState
            });
        } else if (activeSession) {
            if (activeSession.state === 'VERIFYING' || activeSession.state === 'PURCHASING') {
                action = 'PURCHASE_IN_PROGRESS';
            }
        }

        return res.json({
            ok: true,
            action,
            activeSession: activeSession || null,
            subscription,
            recentEvents,
            clientPurchaseState
        });
    } catch (e) {
        console.error('[auth-server] huawei recovery-status:', e.message || e);
        logHuaweiBillingEvent('RECOVERY_FAILED', { detail: e.message || String(e) });
        return res.status(500).json(huaweiBillingJsonError(500, HUAWEI_BILLING_ERROR.NETWORK_ERROR));
    }
});

app.post('/api/huawei-iap/verify-purchase', async (req, res) => {
    try {
        const purchaseToken = String(
            req.body?.purchaseToken || req.body?.receiptId || ''
        ).trim();
        const huaweiAccountId = String(req.body?.huaweiAccountId || req.body?.userId || '').trim();
        const productIdHint = String(req.body?.productId || req.body?.sku || '').trim();
        const userEmail = String(req.body?.userEmail || req.body?.email || '').trim();
        const deviceBindingId = String(req.body?.deviceBindingId || '').trim();

        if (!purchaseToken || !productIdHint) {
            logHuaweiBillingEvent('VERIFY_REJECTED', {
                errorCode: HUAWEI_BILLING_ERROR.MISSING_PURCHASE_TOKEN,
                email: userEmail
            });
            return res
                .status(400)
                .json(huaweiBillingJsonError(400, HUAWEI_BILLING_ERROR.MISSING_PURCHASE_TOKEN));
        }
        if (!HUAWEI_IAP_CLIENT_ID || !HUAWEI_IAP_CLIENT_SECRET) {
            logHuaweiBillingEvent('VERIFY_REJECTED', {
                errorCode: HUAWEI_BILLING_ERROR.MISSING_HUAWEI_CREDENTIALS
            });
            return res
                .status(500)
                .json(huaweiBillingJsonError(500, HUAWEI_BILLING_ERROR.MISSING_HUAWEI_CREDENTIALS));
        }

        logHuaweiBillingEvent('VERIFY_START', {
            purchaseToken,
            email: userEmail,
            huaweiAccountId,
            productId: productIdHint
        });
        updateHuaweiPurchaseSessionState(userEmail, huaweiAccountId, 'VERIFYING');

        const priorPurchase = findVerifiedHuaweiPurchaseInLogs(purchaseToken);
        if (priorPurchase) {
            const priorEmail = String(priorPurchase.userEmail || '').trim().toLowerCase();
            const reqEmail = String(userEmail || '').trim().toLowerCase();
            if (priorEmail && reqEmail && priorEmail !== reqEmail) {
                logHuaweiBillingEvent('VERIFY_REJECTED', {
                    purchaseToken,
                    errorCode: HUAWEI_BILLING_ERROR.PURCHASE_REPLAY_CONFLICT,
                    email: userEmail
                });
                return res.status(409).json(
                    Object.assign(
                        huaweiBillingJsonError(409, HUAWEI_BILLING_ERROR.PURCHASE_REPLAY_CONFLICT),
                        { verified: false }
                    )
                );
            }
            endHuaweiPurchaseSession(userEmail, huaweiAccountId, 'ACTIVE');
            logHuaweiBillingEvent('VERIFY_IDEMPOTENT', {
                purchaseToken,
                email: userEmail,
                productId: priorPurchase.productId
            });
            return res.json({
                ok: true,
                verified: true,
                planCode: priorPurchase.type,
                productId: priorPurchase.productId,
                subscription: priorPurchase,
                idempotent: true,
                errorCode: HUAWEI_BILLING_ERROR.PURCHASE_ALREADY_USED
            });
        }

        if (IS_PRODUCTION && !isRegisteredAppEmail(userEmail)) {
            logHuaweiBillingEvent('VERIFY_REJECTED', {
                purchaseToken,
                errorCode: HUAWEI_BILLING_ERROR.EMAIL_NOT_REGISTERED,
                email: userEmail
            });
            return res.status(403).json(
                Object.assign(huaweiBillingJsonError(403, HUAWEI_BILLING_ERROR.EMAIL_NOT_REGISTERED), {
                    verified: false
                })
            );
        }

        let verifyResp;
        try {
            verifyResp = await verifyHuaweiPurchaseWithApi(purchaseToken, productIdHint);
        } catch (eIap) {
            const code = mapVerifyFailureToCode(eIap, eIap.iapBody);
            logHuaweiBillingEvent('VERIFY_FAILED', {
                purchaseToken,
                email: userEmail,
                errorCode: code,
                detail: eIap.message || String(eIap)
            });
            const httpStatus = code === HUAWEI_BILLING_ERROR.VERIFY_TIMEOUT ? 504 : 502;
            return res
                .status(httpStatus)
                .json(Object.assign(huaweiBillingJsonError(httpStatus, code), { verified: false }));
        }

        const responseCode = String(verifyResp?.responseCode || verifyResp?.returnCode || '').trim();
        if (responseCode && responseCode !== '0') {
            logHuaweiBillingEvent('VERIFY_FAILED', {
                purchaseToken,
                errorCode: HUAWEI_BILLING_ERROR.IAP_INVALID,
                responseCode
            });
            return res.status(502).json(
                Object.assign(huaweiBillingJsonError(502, HUAWEI_BILLING_ERROR.IAP_INVALID), {
                    verified: false,
                    responseCode
                })
            );
        }

        const tokenData = parseHuaweiPurchaseTokenData(verifyResp) || {};
        const productId = String(tokenData.productId || productIdHint || '').trim();
        const purchaseState = Number(tokenData.purchaseState);
        const planCode = resolvePlanFromHuaweiProductId(productId);

        if (productIdHint && productId && productIdHint !== productId) {
            logHuaweiBillingEvent('VERIFY_REJECTED', {
                purchaseToken,
                errorCode: HUAWEI_BILLING_ERROR.PRODUCT_ID_MISMATCH
            });
            return res.status(400).json(
                Object.assign(huaweiBillingJsonError(400, HUAWEI_BILLING_ERROR.PRODUCT_ID_MISMATCH), {
                    verified: false
                })
            );
        }

        const isPurchased = Number.isNaN(purchaseState) ? true : purchaseState === 0;
        if (!planCode || !isPurchased) {
            const failCode = !planCode
                ? HUAWEI_BILLING_ERROR.UNKNOWN_PRODUCT
                : HUAWEI_BILLING_ERROR.PURCHASE_CANCELED;
            logHuaweiBillingEvent('VERIFY_REJECTED', { purchaseToken, errorCode: failCode, productId });
            return res.json({
                ok: true,
                verified: false,
                errorCode: failCode,
                productId,
                purchaseState,
                reason: !planCode ? 'unknown_product' : 'not_purchased'
            });
        }

        let expiryDate = null;
        if (tokenData.expirationDate != null && !Number.isNaN(Number(tokenData.expirationDate))) {
            expiryDate = new Date(Number(tokenData.expirationDate)).toISOString();
        } else if (tokenData.purchaseTime != null && !Number.isNaN(Number(tokenData.purchaseTime))) {
            expiryDate = new Date(Number(tokenData.purchaseTime) + 180 * 24 * 60 * 60 * 1000).toISOString();
        }

        const subscription = buildSubscriptionFromHuaweiPlan(planCode, {
            userEmail,
            deviceBindingId,
            purchaseToken,
            huaweiAccountId,
            productId,
            expiryDate,
            startDate:
                tokenData.purchaseTime != null
                    ? new Date(Number(tokenData.purchaseTime)).toISOString()
                    : new Date().toISOString()
        });

        const logs = loadSubscriptionLogs();
        const exists = logs.find(
            (l) => String(l.purchaseToken || l.receiptId || '') === purchaseToken
        );
        if (!exists) {
            logs.push(subscription);
            if (logs.length > 2000) logs.splice(0, logs.length - 2000);
            saveSubscriptionLogs(logs);
        }
        sendPaymentInvoiceEmail(subscription).catch((e) => {
            console.warn('[auth-server] invoice email (huawei) failed:', e.message || e);
        });

        markHuaweiPurchasePermanentlyUsed(purchaseToken, {
            userEmail,
            huaweiAccountId,
            productId,
            planCode
        });
        updateHuaweiPurchaseSessionState(userEmail, huaweiAccountId, 'ACTIVE');
        endHuaweiPurchaseSession(userEmail, huaweiAccountId, 'ACTIVE');

        logHuaweiBillingEvent('VERIFY_SUCCESS', {
            purchaseToken,
            email: userEmail,
            huaweiAccountId,
            productId,
            planCode
        });

        return res.json({
            ok: true,
            verified: true,
            planCode,
            productId,
            subscription
        });
    } catch (e) {
        console.error('[auth-server] huawei-iap verify error:', e?.iapBody || e.message || e);
        const code = mapVerifyFailureToCode(e, e?.iapBody);
        logHuaweiBillingEvent('VERIFY_FAILED', {
            purchaseToken: String(req.body?.purchaseToken || req.body?.receiptId || ''),
            email: String(req.body?.userEmail || ''),
            errorCode: code,
            detail: e?.message || String(e)
        });
        try {
            const userEmail = String(req.body?.userEmail || req.body?.email || '').trim();
            const huaweiAccountId = String(req.body?.huaweiAccountId || req.body?.userId || '').trim();
            updateHuaweiPurchaseSessionState(userEmail, huaweiAccountId, 'FAILED');
            endHuaweiPurchaseSession(userEmail, huaweiAccountId, 'FAILED');
        } catch (eSess) {
            /* ignore */
        }
        return res.status(500).json(Object.assign(huaweiBillingJsonError(500, code), { verified: false }));
    }
});

/** قراءة جميع سجلات الاشتراكات (للإدارة فقط). */
app.get('/api/admin/subscription-logs', adminAuth, (req, res) => {
    try {
        const logs = loadSubscriptionLogs();
        res.json(logs);
    } catch (e) {
        console.error('[auth-server] admin/subscription-logs error:', e);
        res.status(500).json({ error: 'read_failed' });
    }
});

/** حذف جميع سجلات الاشتراكات من السيرفر (للإدارة فقط). */
app.delete('/api/admin/subscription-logs', adminAuth, (req, res) => {
    try {
        saveSubscriptionLogs([]);
        res.json({ ok: true, cleared: true });
    } catch (e) {
        console.error('[auth-server] admin/subscription-logs delete error:', e);
        res.status(500).json({ error: 'clear_failed' });
    }
});

/** حالة التخزين السحابي (JSON محلي أو R2). */
app.get('/api/cloud-storage/status', (req, res) => {
    try {
        return res.json({
            ok: true,
            backend: cloudR2.getCloudStorageBackendLabel(),
            r2Configured: cloudR2.isR2Configured(),
            bucket: cloudR2.isR2Configured() ? String(process.env.S3_BUCKET || '').trim() : null
        });
    } catch (e) {
        return res.status(500).json({ ok: false, error: 'status_failed' });
    }
});

/** مجلدات يدوية — جلب (INDEX5 / تجربة مميزة) */
app.get('/api/cloud-storage/folders', (req, res) => {
    try {
        const email = String(req.query?.email || '')
            .trim()
            .toLowerCase();
        if (!email) {
            return res.status(400).json({ ok: false, error: 'missing_email' });
        }
        if (!getCloudAccessForEmail(email).ok) {
            return res.status(403).json({
                ok: false,
                error: 'index5_required',
                message:
                    'المجلدات السحابية بين الأجهزة متاحة للخطة المميزة السحابية أو التجربة.'
            });
        }
        const store = loadCloudFilesStore();
        const payload = store[email] || { folders: [] };
        const folders = sanitizeCloudFoldersList(payload.folders);
        return res.json({ ok: true, email, folders, updatedAt: payload.updatedAt || null });
    } catch (e) {
        console.error('[auth-server] cloud folders get error:', e);
        return res.status(500).json({ ok: false, error: 'folders_load_failed' });
    }
});

/** مجلدات يدوية — حفظ قائمة كاملة دون المساس بملفات السحابة */
app.post('/api/cloud-storage/folders', (req, res) => {
    try {
        const email = String(req.body?.email || '')
            .trim()
            .toLowerCase();
        if (!email) {
            return res.status(400).json({ ok: false, error: 'missing_email' });
        }
        if (!getCloudAccessForEmail(email).ok) {
            return res.status(403).json({
                ok: false,
                error: 'index5_required',
                message:
                    'المجلدات السحابية بين الأجهزة متاحة للخطة المميزة السحابية أو التجربة.'
            });
        }
        const incoming = sanitizeCloudFoldersList(req.body?.folders);
        const store = loadCloudFilesStore();
        const previousPayload = store[email]
            ? JSON.parse(JSON.stringify(store[email]))
            : null;
        const base = previousPayload || {
            email,
            files: [],
            deletedFiles: [],
            backupFiles: [],
            folders: []
        };
        const userPayload = {
            email,
            files: Array.isArray(base.files) ? base.files : [],
            deletedFiles: Array.isArray(base.deletedFiles) ? base.deletedFiles : [],
            backupFiles: Array.isArray(base.backupFiles) ? base.backupFiles : [],
            folders: incoming,
            updatedAt: new Date().toISOString()
        };
        store[email] = userPayload;
        saveCloudFilesStore(store);
        return res.json({
            ok: true,
            email,
            folders: store[email].folders,
            syncedAt: store[email].updatedAt
        });
    } catch (e) {
        console.error('[auth-server] cloud folders save error:', e);
        return res.status(500).json({ ok: false, error: 'folders_sync_failed' });
    }
});

/**
 * مزامنة ملفات المستخدم للسحابة (نفس بيانات IndexedDB بعد التشفير).
 * مع R2: يرفع المحتوى إلى bucket ويحفظ الفهرسة فقط في cloud-files.json.
 */
app.post('/api/cloud-storage/sync', async (req, res) => {
    try {
        const email = String(req.body?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ ok: false, error: 'missing_email' });
        }
        if (!getCloudAccessForEmail(email).ok) {
            return res.status(403).json({
                ok: false,
                error: 'index5_required',
                message:
                    'التخزين والمزامنة السحابية متاحان لمزايا INDEX5 أو خلال فترة التجربة (10 أيام).'
            });
        }

        const files = prepareCloudSyncIncomingFileList(req.body?.files);
        const deletedFiles = prepareCloudSyncIncomingFileList(req.body?.deletedFiles);
        const backupFiles = prepareCloudSyncIncomingFileList(req.body?.backupFiles);
        const foldersRaw = req.body?.folders;

        const filesWithData = countCloudRecordsWithData(files);
        const deletedWithData = countCloudRecordsWithData(deletedFiles);
        const backupWithData = countCloudRecordsWithData(backupFiles);
        console.log(
            '[auth-server] cloud sync:',
            email,
            'files=' + files.length + '(' + filesWithData + ' with data)',
            'deleted=' + deletedFiles.length + '(' + deletedWithData + ' with data)',
            'backup=' + backupFiles.length + '(' + backupWithData + ' with data)',
            'backend=' + cloudR2.getCloudStorageBackendLabel()
        );
        if (
            cloudR2.isR2Configured() &&
            files.length > 0 &&
            filesWithData === 0 &&
            deletedWithData === 0 &&
            backupWithData === 0
        ) {
            console.warn(
                '[auth-server] cloud sync: لا يوجد محتوى (data) في الطلب — لن يُرفع شيء إلى R2. أعد المزامنة من الجهاز الذي يحتوي الملف محلياً.'
            );
        }

        const store = loadCloudFilesStore();
        const previousPayload = store[email]
            ? JSON.parse(JSON.stringify(store[email]))
            : null;

        let userPayload = {
            email,
            files,
            deletedFiles,
            backupFiles,
            folders: Array.isArray(foldersRaw)
                ? sanitizeCloudFoldersList(foldersRaw)
                : Array.isArray(previousPayload?.folders)
                  ? sanitizeCloudFoldersList(previousPayload.folders)
                  : [],
            updatedAt: new Date().toISOString()
        };
        const activeIds = new Set();
        (Array.isArray(userPayload.files) ? userPayload.files : []).forEach(function (f) {
            if (f && f.id !== null && f.id !== undefined) {
                activeIds.add(String(f.id));
            }
        });
        userPayload.deletedFiles = (Array.isArray(userPayload.deletedFiles) ? userPayload.deletedFiles : []).filter(
            function (f) {
                return f && f.id !== null && f.id !== undefined && !activeIds.has(String(f.id));
            }
        );
        userPayload.backupFiles = (Array.isArray(userPayload.backupFiles) ? userPayload.backupFiles : []).filter(
            function (f) {
                return f && f.id !== null && f.id !== undefined && !activeIds.has(String(f.id));
            }
        );
        if (cloudR2.isR2Configured()) {
            const snapshot = cloudR2.buildStoreSnapshotBeforeR2(email, userPayload, previousPayload);
            store[email] = snapshot;
            saveCloudFilesStore(store);
            userPayload = await cloudR2.persistUserPayloadToR2(email, userPayload, previousPayload);
        }

        store[email] = sanitizeUserCloudPayload(userPayload);
        saveCloudFilesStore(store);
        const saved = store[email];
        function mapCloudRecordMeta(list, category) {
            return (Array.isArray(list) ? list : []).map(function (f) {
                var sk = String(f.s3Key || '').trim() || null;
                return {
                    id: f.id,
                    s3Key: sk,
                    storageBackend: sk ? f.storageBackend || 'r2' : null
                };
            });
        }
        const cloudFilesMeta = mapCloudRecordMeta(saved.files, 'files');
        const cloudVaultMeta = {
            files: cloudFilesMeta,
            deletedFiles: mapCloudRecordMeta(saved.deletedFiles, 'deleted'),
            backupFiles: mapCloudRecordMeta(saved.backupFiles, 'backup')
        };
        return res.json({
            ok: true,
            syncedAt: saved.updatedAt,
            storageBackend: cloudR2.getCloudStorageBackendLabel(),
            cloudFiles: cloudFilesMeta,
            cloudVaultMeta: cloudVaultMeta
        });
    } catch (e) {
        console.error('[auth-server] cloud sync error:', e);
        return res.status(500).json({ ok: false, error: 'sync_failed' });
    }
});

/**
 * تحميل ملفات المستخدم من السحابة.
 * مع R2: يجلب المحتوى من bucket ويعيد data للتطبيق (متوافق مع الواجهة الحالية).
 */
app.get('/api/cloud-storage/files', async (req, res) => {
    try {
        const email = String(req.query?.email || '').trim().toLowerCase();
        if (!email) {
            return res.status(400).json({ ok: false, error: 'missing_email' });
        }
        if (!getCloudAccessForEmail(email).ok) {
            return res.status(403).json({
                ok: false,
                error: 'index5_required',
                message:
                    'استعادة الملفات من السحابة متاحة لمزايا INDEX5 أو خلال فترة التجربة (10 أيام).'
            });
        }
        const store = loadCloudFilesStore();
        let payload = store[email] || {
            email,
            files: [],
            deletedFiles: [],
            backupFiles: [],
            updatedAt: null
        };
        const hydrateFull =
            String(req.query?.hydrate || '1').trim() !== '0' &&
            String(req.query?.hydrate || '').toLowerCase() !== 'false';
        if (cloudR2.isR2Configured() && hydrateFull) {
            payload = Object.assign({}, payload, {
                files: await cloudR2.hydrateFileList(payload.files),
                deletedFiles: await cloudR2.hydrateFileList(payload.deletedFiles),
                backupFiles: await cloudR2.hydrateFileList(payload.backupFiles),
                storageBackend: 'r2'
            });
        } else if (cloudR2.isR2Configured()) {
            payload = Object.assign({}, payload, { storageBackend: 'r2' });
        }
        return res.json({ ok: true, ...payload, storageBackend: cloudR2.getCloudStorageBackendLabel() });
    } catch (e) {
        console.error('[auth-server] cloud load error:', e);
        return res.status(500).json({ ok: false, error: 'load_failed' });
    }
});

/**
 * جلب ملف واحد من السحابة (R2) للاستعادة — بدون تحميل كل الحساب.
 * category: files | deleted | backup
 */
function findCloudRecordByIdInPayload_INDEX2(payload, fileId) {
    if (!payload || fileId === null || fileId === undefined || fileId === '') {
        return null;
    }
    const idStr = String(fileId);
    const lists = [
        ['files', 'files'],
        ['deletedFiles', 'deleted'],
        ['backupFiles', 'backup']
    ];
    for (let i = 0; i < lists.length; i++) {
        const listKey = lists[i][0];
        const cat = lists[i][1];
        const list = Array.isArray(payload[listKey]) ? payload[listKey] : [];
        const rec = list.find(function (f) {
            return f && String(f.id) === idStr;
        });
        if (rec) {
            return { record: rec, category: cat };
        }
    }
    return null;
}

function inferCloudCategoryFromS3Key_INDEX2(s3Key) {
    const key = String(s3Key || '');
    if (/\/backup\//.test(key)) {
        return 'backup';
    }
    if (/\/deleted\//.test(key)) {
        return 'deleted';
    }
    if (/\/files\//.test(key)) {
        return 'files';
    }
    return null;
}

app.get('/api/cloud-storage/hydrate-record', async (req, res) => {
    try {
        const email = String(req.query?.email || '').trim().toLowerCase();
        const fileId = req.query?.id;
        const categoryHint = String(req.query?.category || '').trim().toLowerCase();
        if (!email || fileId === null || fileId === undefined || fileId === '') {
            return res.status(400).json({ ok: false, error: 'missing_params' });
        }
        if (!getCloudAccessForEmail(email).ok) {
            return res.status(403).json({ ok: false, error: 'index5_required' });
        }
        const store = loadCloudFilesStore();
        const payload = store[email];
        if (!payload) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        const found = findCloudRecordByIdInPayload_INDEX2(payload, fileId);
        if (!found) {
            return res.status(404).json({ ok: false, error: 'not_found' });
        }
        let record = found.record;
        let cat =
            categoryHint === 'backup' || categoryHint === 'files' || categoryHint === 'deleted'
                ? categoryHint
                : found.category;
        const fromKey = inferCloudCategoryFromS3Key_INDEX2(record.s3Key);
        if (fromKey) {
            cat = fromKey;
        }
        if (cloudR2.isR2Configured()) {
            record = cloudR2.ensureRecordS3KeyForCategory(email, record, cat);
            record = await cloudR2.hydrateFileRecordWithFallback(email, record, cat);
        }
        return res.json({
            ok: true,
            file: record,
            storageBackend: cloudR2.getCloudStorageBackendLabel()
        });
    } catch (e) {
        console.error('[auth-server] hydrate-record error:', e);
        return res.status(500).json({ ok: false, error: 'hydrate_failed' });
    }
});

function ensureWwwSynced() {
    const rootDir = path.join(__dirname, '..');
    const wwwDir = path.join(rootDir, 'www');
    const indexPath = path.join(wwwDir, 'index.html');
    if (fs.existsSync(indexPath)) {
        return;
    }
    const syncScript = path.join(rootDir, 'scripts', 'sync-www.js');
    if (!fs.existsSync(syncScript)) {
        console.warn('[auth-server] scripts/sync-www.js غير موجود — لا يمكن توليد www/');
        return;
    }
    console.log('[auth-server] www/ غير موجود — تشغيل sync-www تلقائياً...');
    const r = spawnSync(process.execPath, [syncScript], {
        cwd: rootDir,
        stdio: 'inherit',
        env: process.env
    });
    if (r.status !== 0) {
        console.warn('[auth-server] sync-www فشل، رمز الخروج:', r.status);
    } else if (fs.existsSync(indexPath)) {
        console.log('[auth-server] تم توليد www/ بنجاح');
    }
}

function mountGostaStaticFromWww() {
    ensureWwwSynced();
    const wwwDir = path.join(__dirname, '..', 'www');
    if (!fs.existsSync(wwwDir)) {
        console.warn('[auth-server] مجلد www غير موجود — شغّل: npm run sync:www');
        app.get('/', (req, res) => {
            res.type('html').send(
                '<!DOCTYPE html><html lang="ar" dir="rtl"><meta charset="utf-8">' +
                    '<body style="font-family:Tahoma;padding:24px"><h1>خادم التحقق يعمل</h1>' +
                    '<p>شغّل <code>npm run sync:www</code> ثم أعد تشغيل الخادم لفتح التطبيق من نفس المنفذ.</p></body></html>'
            );
        });
        return;
    }
    app.use(
        express.static(wwwDir, {
            index: false,
            extensions: ['html', 'css', 'js', 'json', 'webmanifest'],
            setHeaders(res, filePath) {
                if (String(filePath).endsWith('.html')) {
                    res.setHeader('Cache-Control', 'no-store');
                }
            }
        })
    );
    app.get('/', (req, res) => {
        res.sendFile(path.join(wwwDir, 'index.html'));
    });
    app.get(/^\/(?!api\/).+$/, (req, res, next) => {
        const seg = String(req.path || '').replace(/^\//, '').split('/')[0];
        if (!seg || seg.includes('.')) {
            return next();
        }
        const tryHtml = path.join(wwwDir, seg + '.html');
        if (fs.existsSync(tryHtml)) {
            return res.sendFile(tryHtml);
        }
        return next();
    });
}

mountGostaStaticFromWww();

function writeClientPortFiles(port) {
    const content =
        '/* يُحدَّث تلقائياً عند تشغيل npm run auth-server */\n' +
        'window.__PR_SAFE_AUTH_PORT__ = ' +
        port +
        ';\n';
    const rootDir = path.join(__dirname, '..');
    for (const p of [path.join(rootDir, 'pr-safe-auth-port.js'), path.join(rootDir, 'www', 'pr-safe-auth-port.js')]) {
        try {
            fs.writeFileSync(p, content, 'utf8');
        } catch (e) {
            console.warn('[auth-server] تعذر كتابة', p, e.message);
        }
    }
    console.log('[auth-server] تم تحديث pr-safe-auth-port.js (المنفذ ' + port + ')');
}

function tryListen(port) {
    if (port >= basePort + 30) {
        console.error('[auth-server] لم يُعثر على منفذ متاح');
        process.exit(1);
    }
    const srv = http.createServer(app);
    srv.once('error', (err) => {
        if (err.code === 'EADDRINUSE') {
            console.warn('[auth-server] المنفذ ' + port + ' مشغول — جاري تجربة ' + (port + 1) + '...');
            tryListen(port + 1);
        } else {
            console.error(err);
            process.exit(1);
        }
    });
    srv.listen(port, '0.0.0.0', () => {
        console.log('GOSTA auth server (هذا الجهاز): http://127.0.0.1:' + port + '/index.html');
        const nets = os.networkInterfaces();
        for (const name of Object.keys(nets)) {
            for (const net of nets[name] || []) {
                const fam = net.family;
                if ((fam === 'IPv4' || fam === 4) && !net.internal) {
                    const mobileBase = 'http://' + net.address + ':' + port;
                    console.log('  من الجوال (نفس الـ Wi‑Fi) — التطبيق: ' + mobileBase + '/index.html');
                    console.log('  من الجوال — لوحة التحكم: ' + mobileBase + '/admin-dashboard.html');
                }
            }
        }
        writeClientPortFiles(port);
        console.log('[auth-server] مراقبة الخادم (لوحة الإدارة): GET /api/admin/server-monitor — رأس x-admin-key');
        console.log('[auth-server] إعداد المساعد للتطبيق: GET/PUT /api/admin/app-settings — GET /api/app-settings');
        if (getSendGridApiKey()) {
            console.log('[auth-server] إرسال البريد: SendGrid API (HTTPS)');
        } else if (!process.env.SMTP_HOST) {
            console.warn('[auth-server] SMTP_HOST غير مضبوط — الإرسال التلقائي معطّل حتى تعديل .env');
        } else {
            console.log('[auth-server] إرسال البريد: SMTP — على Render Free قد يُحجب المنفذ 587');
        }
        cloudR2.logR2StartupStatus();
    });
}

tryListen(basePort);
