/**
 * رسم نص على PNG عبر @napi-rs/canvas — يُستدعى من auth-server أو من text-overlay-worker.
 */
const path = require('path');
const fs = require('fs');

const NOTO_ARABIC_FONT_PATH = path.join(__dirname, 'fonts', 'NotoSansArabic-Regular.ttf');

let notoArabicFontRegistered = false;
function ensureNotoArabicFont() {
    if (notoArabicFontRegistered) {
        return fs.existsSync(NOTO_ARABIC_FONT_PATH);
    }
    try {
        if (!fs.existsSync(NOTO_ARABIC_FONT_PATH)) {
            return false;
        }
        const { GlobalFonts } = require('@napi-rs/canvas');
        GlobalFonts.registerFromPath(NOTO_ARABIC_FONT_PATH, 'Noto Arabic');
        notoArabicFontRegistered = true;
        return true;
    } catch (e) {
        console.warn('[text-overlay-canvas] Noto font:', e && e.message);
        return false;
    }
}

function wrapOverlayLines(ctx, text, maxWidth) {
    const paras = String(text).split(/\n/);
    const out = [];
    for (let p = 0; p < paras.length; p++) {
        const para = paras[p];
        const words = para.split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (ctx.measureText(test).width > maxWidth && line) {
                out.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) {
            out.push(line);
        } else if (para === '' && p < paras.length - 1) {
            out.push('');
        }
    }
    if (!out.length) {
        out.push(String(text).slice(0, 200));
    }
    return out;
}

async function renderTextOverlayPng(pngBuffer, overlayText, plan) {
    const { createCanvas, loadImage } = require('@napi-rs/canvas');
    const hasFont = ensureNotoArabicFont();
    const img = await loadImage(pngBuffer);
    const w = img.width;
    const h = img.height;
    const canvas = createCanvas(w, h);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    const text = String(overlayText || '').trim();
    if (!text) {
        return Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer);
    }
    const rtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
    ctx.direction = rtl ? 'rtl' : 'ltr';
    ctx.textAlign = 'center';
    const pos = (plan && plan.textPosition) || 'center';
    const maxW = w * 0.88;
    let basePx = Math.max(16, Math.min(88, Math.round(Math.min(w, h) * 0.055)));
    const fontFamily = hasFont ? '"Noto Arabic", sans-serif' : 'sans-serif';
    let lines;
    for (let attempt = 0; attempt < 12; attempt++) {
        ctx.font = `${basePx}px ${fontFamily}`;
        lines = wrapOverlayLines(ctx, text, maxW);
        const widest = Math.max(...lines.map((ln) => ctx.measureText(ln || ' ').width), 0);
        if (widest <= maxW || basePx <= 14) {
            break;
        }
        basePx -= 2;
    }
    const lineHeight = Math.round(basePx * 1.28);
    let fill = '#1a1a1a';
    let stroke = 'rgba(255,255,255,0.92)';
    const tc = (plan && plan.textColor) || 'auto';
    if (tc === 'dark') {
        fill = '#111111';
        stroke = 'rgba(255,255,255,0.92)';
    } else if (tc === 'light') {
        fill = '#ffffff';
        stroke = 'rgba(0,0,0,0.78)';
    } else {
        try {
            const sx = Math.max(0, Math.min(w - 1, Math.floor(w / 2)));
            const sy =
                pos === 'top'
                    ? Math.min(h - 1, Math.floor(h * 0.12))
                    : pos === 'bottom'
                      ? Math.max(0, Math.floor(h * 0.88))
                      : Math.floor(h / 2);
            const sample = ctx.getImageData(sx, sy, 1, 1).data;
            const L = 0.299 * sample[0] + 0.587 * sample[1] + 0.114 * sample[2];
            if (L > 165) {
                fill = '#111111';
                stroke = 'rgba(255,255,255,0.92)';
            } else {
                fill = '#ffffff';
                stroke = 'rgba(0,0,0,0.78)';
            }
        } catch {
            /* keep defaults */
        }
    }
    ctx.lineWidth = Math.max(2, Math.round(basePx / 10));
    ctx.lineJoin = 'round';
    ctx.miterLimit = 2;
    ctx.strokeStyle = stroke;
    ctx.fillStyle = fill;
    const margin = Math.max(10, Math.round(Math.min(w, h) * 0.04));
    let y0;
    if (pos === 'top') {
        ctx.textBaseline = 'top';
        y0 = margin;
    } else if (pos === 'bottom') {
        ctx.textBaseline = 'bottom';
        y0 = h - margin;
    } else {
        ctx.textBaseline = 'middle';
        y0 = h / 2 - ((lines.length - 1) * lineHeight) / 2;
    }
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        let y;
        if (pos === 'top') {
            y = y0 + i * lineHeight;
        } else if (pos === 'bottom') {
            y = y0 - (lines.length - 1 - i) * lineHeight;
        } else {
            y = y0 + i * lineHeight;
        }
        ctx.strokeText(line, w / 2, y);
        ctx.fillText(line, w / 2, y);
    }
    return canvas.toBuffer('image/png');
}

module.exports = { renderTextOverlayPng, NOTO_ARABIC_FONT_PATH };
