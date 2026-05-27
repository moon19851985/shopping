/**
 * رسم نص على PNG عبر resvg — بدون data URI الضخمة (تفشل أحياناً مع صور الهاتف الكبيرة).
 */
const fs = require('fs');
const path = require('path');
const Jimp = require('jimp');
const { Resvg } = require('@resvg/resvg-js');

const NOTO_PATH = path.join(__dirname, 'fonts', 'NotoSansArabic-Regular.ttf');
/** ربط ثابت داخل SVG نمرّر له البايتات عبر resolveImage */
const EMBED_HREF = 'https://gosta.invalid/overlay-base.png';
const MAX_OVERLAY_EDGE = 2048;

function escapeXml(s) {
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function wrapLinesByChars(text, maxChars) {
    const paras = String(text).split(/\n/);
    const out = [];
    for (const para of paras) {
        const words = para.split(/\s+/).filter(Boolean);
        let line = '';
        for (const word of words) {
            const test = line ? `${line} ${word}` : word;
            if (test.length > maxChars && line) {
                out.push(line);
                line = word;
            } else {
                line = test;
            }
        }
        if (line) {
            out.push(line);
        }
    }
    if (!out.length) {
        out.push(String(text).slice(0, 200));
    }
    return out;
}

/**
 * @param {Buffer} pngBuffer
 * @param {string} overlayText
 * @param {{ textPosition?: string, textColor?: string }} plan
 * @returns {Promise<Buffer>}
 */
async function renderTextOverlayResvg(pngBuffer, overlayText, plan) {
    const text = String(overlayText || '').trim();
    if (!text) {
        return Buffer.isBuffer(pngBuffer) ? pngBuffer : Buffer.from(pngBuffer);
    }

    let img = await Jimp.read(pngBuffer);
    let w = img.getWidth();
    let h = img.getHeight();
    const maxE = Math.max(w, h);
    if (maxE > MAX_OVERLAY_EDGE) {
        const s = MAX_OVERLAY_EDGE / maxE;
        const nw = Math.max(1, Math.round(w * s));
        const nh = Math.max(1, Math.round(h * s));
        img = img.resize(nw, nh, Jimp.RESIZE_BILINEAR);
        w = nw;
        h = nh;
    }

    const workBuffer = await img.getBufferAsync(Jimp.MIME_PNG);
    const pos = (plan && plan.textPosition) || 'center';
    const tc = (plan && plan.textColor) || 'auto';

    let fill = '#1a1a1a';
    let stroke = '#ffffff';
    if (tc === 'dark') {
        fill = '#111111';
        stroke = '#ffffff';
    } else if (tc === 'light') {
        fill = '#ffffff';
        stroke = '#000000';
    } else {
        const sx = Math.max(0, Math.min(w - 1, Math.floor(w / 2)));
        const sy =
            pos === 'top'
                ? Math.min(h - 1, Math.floor(h * 0.12))
                : pos === 'bottom'
                  ? Math.max(0, Math.floor(h * 0.88))
                  : Math.floor(h / 2);
        const c = Jimp.intToRGBA(img.getPixelColor(sx, sy));
        const L = 0.299 * c.r + 0.587 * c.g + 0.114 * c.b;
        if (L > 165) {
            fill = '#111111';
            stroke = '#ffffff';
        } else {
            fill = '#ffffff';
            stroke = '#000000';
        }
    }

    let basePx = Math.max(16, Math.min(88, Math.round(Math.min(w, h) * 0.055)));
    const maxChars = Math.max(6, Math.floor((w * 0.88) / (basePx * 0.52)));
    const lines = wrapLinesByChars(text, maxChars);
    const lh = Math.round(basePx * 1.28);
    const cx = w / 2;
    const margin = Math.max(10, Math.round(Math.min(w, h) * 0.04));
    const strokeW = Math.max(2, Math.round(basePx / 10));
    const rtl = /[\u0600-\u06FF\u0750-\u077F\u08A0-\u08FF\uFB50-\uFDFF\uFE70-\uFEFF]/.test(text);
    const dir = rtl ? 'rtl' : 'ltr';

    let y0;
    if (pos === 'top') {
        y0 = margin + Math.round(basePx * 0.85);
    } else if (pos === 'bottom') {
        y0 = h - margin - (lines.length - 1) * lh - Math.round(basePx * 0.25);
    } else {
        y0 = h / 2 - ((lines.length - 1) * lh) / 2;
    }

    let textInner;
    if (lines.length === 1) {
        textInner = escapeXml(lines[0]);
    } else {
        textInner = lines
            .map((line, i) => {
                const dy = i === 0 ? 0 : lh;
                return `<tspan x="${cx}" dy="${dy}">${escapeXml(line)}</tspan>`;
            })
            .join('');
    }

    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" xml:lang="${rtl ? 'ar' : 'en'}">
  <image href="${EMBED_HREF}" xlink:href="${EMBED_HREF}" width="${w}" height="${h}" preserveAspectRatio="none"/>
  <text x="${cx}" y="${y0}" text-anchor="middle" font-family="Noto Sans Arabic, Arial, sans-serif" font-size="${basePx}" fill="${fill}" stroke="${stroke}" stroke-width="${strokeW}" paint-order="stroke fill" direction="${dir}">${textInner}</text>
</svg>`;

    const fontOpts = {
        loadSystemFonts: true,
        defaultFontFamily: 'Noto Sans Arabic',
        sansSerifFamily: 'Noto Sans Arabic'
    };
    if (fs.existsSync(NOTO_PATH)) {
        fontOpts.fontFiles = [NOTO_PATH];
    }

    const resvg = new Resvg(svg, {
        logLevel: 'error',
        font: fontOpts
    });
    const pending = resvg.imagesToResolve();
    for (const href of pending) {
        if (href === EMBED_HREF || String(href).includes('gosta.invalid')) {
            resvg.resolveImage(href, workBuffer);
        }
    }
    return resvg.render().asPng();
}

module.exports = { renderTextOverlayResvg, NOTO_PATH };
