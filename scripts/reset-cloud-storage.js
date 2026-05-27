/**
 * تصفير التخزين السحابي (cloud-files.json + كائنات R2 للمستخدمين المسجّلين).
 * تشغيل: npm run reset:cloud
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const fs = require('fs');
const path = require('path');
const { S3Client, ListObjectsV2Command, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const cloudR2 = require('../server/cloud-r2');

const CLOUD_FILES_PATH = path.join(__dirname, '..', 'server', 'data', 'cloud-files.json');

function loadStore() {
    if (!fs.existsSync(CLOUD_FILES_PATH)) {
        return {};
    }
    try {
        const data = JSON.parse(fs.readFileSync(CLOUD_FILES_PATH, 'utf8'));
        return data && typeof data === 'object' ? data : {};
    } catch (e) {
        console.error('[reset-cloud] تعذر قراءة cloud-files.json:', e.message || e);
        process.exit(1);
    }
}

function collectKeysFromStore(store) {
    const keys = new Set();
    Object.keys(store).forEach(function (email) {
        const payload = store[email];
        if (!payload || typeof payload !== 'object') {
            return;
        }
        cloudR2.collectS3KeysFromPayload(payload).forEach(function (k) {
            keys.add(k);
        });
    });
    return keys;
}

function getListClient() {
    if (!cloudR2.isR2Configured()) {
        return null;
    }
    const normalizeEnvSecret = function (value) {
        let s = String(value || '').trim();
        if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
            s = s.slice(1, -1).trim();
        }
        return s;
    };
    return new S3Client({
        region: normalizeEnvSecret(process.env.AWS_REGION) || 'auto',
        endpoint: normalizeEnvSecret(process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT),
        credentials: {
            accessKeyId: normalizeEnvSecret(process.env.AWS_ACCESS_KEY_ID),
            secretAccessKey: normalizeEnvSecret(process.env.AWS_SECRET_ACCESS_KEY)
        },
        forcePathStyle: true
    });
}

function getBucket() {
    let s = String(process.env.S3_BUCKET || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function getKeyPrefix() {
    const raw = String(process.env.S3_KEY_PREFIX || 'users/').trim();
    const p = raw.endsWith('/') ? raw : raw + '/';
    return p;
}

function sanitizeEmailForKey(email) {
    return String(email || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9@._-]+/g, '_');
}

async function listAllKeysUnderPrefix(client, prefix) {
    const bucket = getBucket();
    const out = [];
    let token;
    do {
        const res = await client.send(
            new ListObjectsV2Command({
                Bucket: bucket,
                Prefix: prefix,
                ContinuationToken: token
            })
        );
        (res.Contents || []).forEach(function (obj) {
            if (obj && obj.Key) {
                out.push(obj.Key);
            }
        });
        token = res.IsTruncated ? res.NextContinuationToken : undefined;
    } while (token);
    return out;
}

async function deleteKeys(keys) {
    const arr = Array.from(keys);
    let ok = 0;
    let fail = 0;
    for (let i = 0; i < arr.length; i++) {
        try {
            await cloudR2.deleteObjectKey(arr[i]);
            ok++;
            if (ok % 10 === 0) {
                console.log('[reset-cloud] حذف R2:', ok, '/', arr.length);
            }
        } catch (e) {
            fail++;
            console.warn('[reset-cloud] فشل حذف:', arr[i], e.message || e);
        }
    }
    return { ok, fail, total: arr.length };
}

async function main() {
    const store = loadStore();
    const emails = Object.keys(store);
    console.log('[reset-cloud] مستخدمون في الفهرس:', emails.length, emails.join(', ') || '(فارغ)');

    const keysFromIndex = collectKeysFromStore(store);
    const allKeys = new Set(keysFromIndex);

    if (cloudR2.isR2Configured()) {
        const client = getListClient();
        const prefixRoot = getKeyPrefix();
        for (let e = 0; e < emails.length; e++) {
            const userPrefix = prefixRoot + sanitizeEmailForKey(emails[e]) + '/';
            const listed = await listAllKeysUnderPrefix(client, userPrefix);
            listed.forEach(function (k) {
                allKeys.add(k);
            });
            console.log('[reset-cloud] R2 prefix', userPrefix, '→', listed.length, 'كائن');
        }
        const del = await deleteKeys(allKeys);
        console.log('[reset-cloud] R2: حُذف', del.ok, 'فشل', del.fail, 'من', del.total);
    } else if (allKeys.size > 0) {
        console.warn('[reset-cloud] R2 غير مضبوط — تُحذف الفهرسة فقط (', allKeys.size, 'مفتاح في JSON)');
    } else {
        console.log('[reset-cloud] R2 غير مضبوط — تصفير JSON فقط');
    }

    if (fs.existsSync(CLOUD_FILES_PATH)) {
        const bak = CLOUD_FILES_PATH + '.bak-' + Date.now();
        fs.copyFileSync(CLOUD_FILES_PATH, bak);
        console.log('[reset-cloud] نسخة احتياطية:', path.basename(bak));
    }

    fs.mkdirSync(path.dirname(CLOUD_FILES_PATH), { recursive: true });
    fs.writeFileSync(CLOUD_FILES_PATH, '{}\n', 'utf8');
    console.log('[reset-cloud] تم تصفير cloud-files.json');
}

main().catch(function (e) {
    console.error('[reset-cloud]', e.message || e);
    process.exit(1);
});
