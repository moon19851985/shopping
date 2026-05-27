/**
 * يحذف من R2 أي كائن غير مذكور في cloud-files.json (نسخ قديمة في files/ بعد النقل لـ deleted/).
 * شغّل مرة بعد التحديث: npm run r2:prune-orphans
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command } = require('@aws-sdk/client-s3');
const cloudR2 = require('../server/cloud-r2');

function sanitizeEmailForKey(email) {
    return String(email || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9@._-]+/g, '_');
}

function getPrefixForEmail(email) {
    const raw = String(process.env.S3_KEY_PREFIX || 'users/').trim();
    const base = raw.endsWith('/') ? raw : raw + '/';
    return base + sanitizeEmailForKey(email) + '/';
}

async function listKeysUnderPrefix(s3, bucket, prefix) {
    const keys = [];
    let token;
    do {
        const resp = await s3.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: token
            })
        );
        (resp.Contents || []).forEach(function (o) {
            if (o && o.Key) {
                keys.push(o.Key);
            }
        });
        token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    return keys;
}

async function main() {
    if (!cloudR2.isR2Configured()) {
        console.error('[r2:prune-orphans] R2 غير مضبوط في .env');
        process.exit(1);
    }
    const storePath = path.join(__dirname, '..', 'server', 'data', 'cloud-files.json');
    if (!fs.existsSync(storePath)) {
        console.error('[r2:prune-orphans] لا يوجد cloud-files.json');
        process.exit(1);
    }
    const store = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    const bucket = String(process.env.S3_BUCKET || '').trim();
    const endpoint = String(process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT || '').trim();
    const s3 = new S3Client({
        region: process.env.AWS_REGION || 'auto',
        endpoint,
        credentials: {
            accessKeyId: String(process.env.AWS_ACCESS_KEY_ID || '').trim(),
            secretAccessKey: String(process.env.AWS_SECRET_ACCESS_KEY || '').trim()
        },
        forcePathStyle: true
    });

    let totalPruned = 0;
    for (const email of Object.keys(store)) {
        const payload = store[email];
        const allowed = cloudR2.collectS3KeysFromPayload(payload);
        const prefix = getPrefixForEmail(email);
        const keys = await listKeysUnderPrefix(s3, bucket, prefix);
        for (const key of keys) {
            if (allowed.has(key)) {
                continue;
            }
            await cloudR2.deleteObjectKey(key);
            console.log('[r2:prune-orphans] حذف:', key);
            totalPruned++;
        }
    }
    console.log('[r2:prune-orphans] انتهى — حُذف', totalPruned, 'كائن(اً) يتيم(اً)');
}

main().catch(function (e) {
    console.error(e);
    process.exit(1);
});
