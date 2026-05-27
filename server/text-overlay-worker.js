/**
 * عملية فرعية: رسم نص على PNG — إن تعطل Skia/ICU لا يسقط خادم auth-server الرئيسي.
 * stdin: سطر JSON واحد { pngB64, overlayText, plan }
 * stdout: base64 لملف PNG الناتج
 */
const { renderTextOverlayPng } = require('./text-overlay-canvas');

function readStdin() {
    return new Promise((resolve, reject) => {
        const chunks = [];
        process.stdin.on('data', (c) => chunks.push(c));
        process.stdin.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
        process.stdin.on('error', reject);
    });
}

(async () => {
    const raw = await readStdin();
    const j = JSON.parse(raw);
    const png = Buffer.from(String(j.pngB64 || ''), 'base64');
    const out = await renderTextOverlayPng(png, j.overlayText, j.plan || {});
    process.stdout.write(out.toString('base64'));
})().catch((e) => {
    console.error('[text-overlay-worker]', e && e.stack ? e.stack : e);
    process.exit(1);
});
