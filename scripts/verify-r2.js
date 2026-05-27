/**
 * تحقق من اتصال Cloudflare R2 — شغّل: npm run verify:r2
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const cloudR2 = require('../server/cloud-r2');

async function main() {
    if (!cloudR2.isR2Configured()) {
        console.error(
            '[verify-r2] R2 غير مكتمل. املأ في .env:\n' +
                '  AWS_ACCESS_KEY_ID\n' +
                '  AWS_SECRET_ACCESS_KEY\n' +
                '  S3_BUCKET=aura\n' +
                '  S3_ENDPOINT=https://....r2.cloudflarestorage.com\n' +
                '\nمن: Cloudflare → R2 → Manage R2 API Tokens → Create API token (Object Read & Write)'
        );
        process.exit(1);
    }
    const email = 'verify@test.local';
    const testId = 'verify-' + Date.now();
    const payload = 'data:text/plain;base64,' + Buffer.from('gosta-r2-ok').toString('base64');
    const uploaded = await cloudR2.uploadFileRecord(
        email,
        { id: testId, name: 'verify.txt', type: 'text/plain', data: payload },
        'files'
    );
    if (!uploaded.s3Key) {
        console.error('[verify-r2] فشل الرفع — لا s3Key');
        process.exit(1);
    }
    const hydrated = await cloudR2.hydrateFileRecord(uploaded);
    if (!hydrated.data) {
        console.error('[verify-r2] فشل التحميل من R2 — لا data');
        process.exit(1);
    }
    const raw = String(hydrated.data);
    const b64 = raw.includes('base64,') ? raw.split('base64,')[1] : raw;
    const text = Buffer.from(b64, 'base64').toString('utf8');
    if (text !== 'gosta-r2-ok') {
        console.error('[verify-r2] فشل التحميل من R2 — محتوى غير متطابق');
        process.exit(1);
    }
    try {
        await cloudR2.deleteObjectKey(uploaded.s3Key);
    } catch (e) {
        console.warn('[verify-r2] تعذر حذف ملف الاختبار:', e.message || e);
    }
    console.log('[verify-r2] نجح — bucket=', process.env.S3_BUCKET, 'key=', uploaded.s3Key);
}

main().catch((e) => {
    console.error('[verify-r2]', e.message || e);
    process.exit(1);
});
