/**
 * Cloudflare R2 (S3-compatible) — رفع/تحميل محتوى الملفات المشفّرة.
 * يُفعَّل عند ضبط S3_BUCKET + AWS_ACCESS_KEY_ID + AWS_SECRET_ACCESS_KEY + S3_ENDPOINT في .env
 */
const {
    S3Client,
    PutObjectCommand,
    GetObjectCommand,
    HeadObjectCommand,
    DeleteObjectCommand,
    CopyObjectCommand
} = require('@aws-sdk/client-s3');

function normalizeEnvSecret(value) {
    let s = String(value || '').trim();
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        s = s.slice(1, -1).trim();
    }
    return s;
}

function isR2Configured() {
    const backend = String(process.env.CLOUD_STORAGE_BACKEND || '').trim().toLowerCase();
    if (backend === 'json' || backend === 'local') {
        return false;
    }
    const bucket = normalizeEnvSecret(process.env.S3_BUCKET);
    const keyId = normalizeEnvSecret(process.env.AWS_ACCESS_KEY_ID);
    const secret = normalizeEnvSecret(process.env.AWS_SECRET_ACCESS_KEY);
    const endpoint = normalizeEnvSecret(process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT);
    return !!(bucket && keyId && secret && endpoint);
}

let cachedClient = null;

function getS3Client() {
    if (!isR2Configured()) {
        return null;
    }
    if (cachedClient) {
        return cachedClient;
    }
    cachedClient = new S3Client({
        region: normalizeEnvSecret(process.env.AWS_REGION) || 'auto',
        endpoint: normalizeEnvSecret(process.env.S3_ENDPOINT || process.env.AWS_ENDPOINT),
        credentials: {
            accessKeyId: normalizeEnvSecret(process.env.AWS_ACCESS_KEY_ID),
            secretAccessKey: normalizeEnvSecret(process.env.AWS_SECRET_ACCESS_KEY)
        },
        forcePathStyle: true
    });
    return cachedClient;
}

function getBucket() {
    return normalizeEnvSecret(process.env.S3_BUCKET);
}

function getKeyPrefix() {
    const raw = normalizeEnvSecret(process.env.S3_KEY_PREFIX) || 'users/';
    return raw.endsWith('/') ? raw : raw + '/';
}

function sanitizeEmailForKey(email) {
    return String(email || '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9@._-]+/g, '_');
}

function sanitizeFileIdForKey(fileId) {
    return String(fileId ?? '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]+/g, '_')
        .slice(0, 120);
}

/** @param {'files'|'deleted'|'backup'} category */
function buildObjectKey(email, fileId, category) {
    const cat = category === 'deleted' || category === 'backup' ? category : 'files';
    return getKeyPrefix() + sanitizeEmailForKey(email) + '/' + cat + '/' + sanitizeFileIdForKey(fileId) + '.enc';
}

function decodePayloadToBuffer(data) {
    const s = String(data || '');
    if (!s) {
        return Buffer.alloc(0);
    }
    const base64Marker = ';base64,';
    const idx = s.indexOf(base64Marker);
    if (idx >= 0) {
        return Buffer.from(s.slice(idx + base64Marker.length), 'base64');
    }
    if (/^[A-Za-z0-9+/=\s]+$/.test(s) && s.length > 64) {
        try {
            return Buffer.from(s.replace(/\s/g, ''), 'base64');
        } catch (_) {
            /* fall through */
        }
    }
    return Buffer.from(s, 'utf8');
}

function bufferToDataUrl(buf, mimeHint) {
    const mime = String(mimeHint || 'application/octet-stream').split(';')[0].trim() || 'application/octet-stream';
    return 'data:' + mime + ';base64,' + Buffer.from(buf).toString('base64');
}

async function objectKeyExists(key) {
    const k = String(key || '').trim();
    if (!k || !isR2Configured()) {
        return false;
    }
    const client = getS3Client();
    try {
        await client.send(
            new HeadObjectCommand({
                Bucket: getBucket(),
                Key: k
            })
        );
        return true;
    } catch (e) {
        const code = e && (e.name || e.Code);
        const status = e && e.$metadata && e.$metadata.httpStatusCode;
        if (code === 'NotFound' || code === 'NoSuchKey' || status === 404) {
            return false;
        }
        throw e;
    }
}

async function streamToBuffer(body) {
    if (!body) {
        return Buffer.alloc(0);
    }
    if (Buffer.isBuffer(body)) {
        return body;
    }
    if (typeof body.transformToByteArray === 'function') {
        const arr = await body.transformToByteArray();
        return Buffer.from(arr);
    }
    const chunks = [];
    for await (const chunk of body) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
}

function resolveObjectKeyForCategory(email, record, category) {
    return buildObjectKey(email, record.id, category);
}

async function copyObjectKey(sourceKey, destKey) {
    const src = String(sourceKey || '').trim();
    const dst = String(destKey || '').trim();
    if (!src || !dst || src === dst || !isR2Configured()) {
        return false;
    }
    const client = getS3Client();
    const bucket = getBucket();
    await client.send(
        new CopyObjectCommand({
            Bucket: bucket,
            Key: dst,
            CopySource: encodeURIComponent(bucket + '/' + src)
        })
    );
    return true;
}

/** نقل سجلّ بلا data من مسار files/ إلى deleted/ أو backup/ داخل R2 */
async function migrateRecordKeyToCategory(email, record, category) {
    const existingKey = String(record.s3Key || '').trim();
    const correctKey = resolveObjectKeyForCategory(email, record, category);
    const out = Object.assign({}, record);
    delete out.data;
    if (!existingKey) {
        out.s3Key = correctKey;
        out.storageBackend = 'r2';
        return out;
    }
    if (existingKey === correctKey) {
        out.s3Key = existingKey;
        out.storageBackend = 'r2';
        return out;
    }
    try {
        await copyObjectKey(existingKey, correctKey);
        await deleteObjectKey(existingKey);
        out.s3Key = correctKey;
        out.storageBackend = 'r2';
    } catch (e) {
        console.warn('[cloud-r2] migrate key failed:', existingKey, '→', correctKey, e.message || e);
        out.s3Key = existingKey;
    }
    return out;
}

/**
 * يرفع المحتوى إلى R2 ويعيد سجلّاً بدون data (فقط s3Key + metadata).
 */
async function uploadFileRecord(email, record, category) {
    if (!record || record.id === null || record.id === undefined) {
        return record;
    }
    const client = getS3Client();
    if (!client) {
        return record;
    }
    const data = record.data;
    const existingKey = String(record.s3Key || '').trim();
    if (!data && existingKey) {
        const onR2 = await objectKeyExists(existingKey);
        if (onR2) {
            const targetKey = buildObjectKey(email, record.id, category);
            if (existingKey !== targetKey) {
                return migrateRecordKeyToCategory(email, record, category);
            }
            const out = Object.assign({}, record);
            delete out.data;
            out.s3Key = existingKey;
            out.storageBackend = 'r2';
            return out;
        }
        const missing = Object.assign({}, record);
        delete missing.data;
        delete missing.s3Key;
        delete missing.storageBackend;
        return missing;
    }
    if (!data) {
        const bare = Object.assign({}, record);
        delete bare.s3Key;
        delete bare.storageBackend;
        return bare;
    }
    const key = resolveObjectKeyForCategory(email, record, category);
    const body = decodePayloadToBuffer(data);
    if (!body.length) {
        const emptyOut = Object.assign({}, record);
        delete emptyOut.data;
        delete emptyOut.s3Key;
        delete emptyOut.storageBackend;
        return emptyOut;
    }
    await client.send(
        new PutObjectCommand({
            Bucket: getBucket(),
            Key: key,
            Body: body,
            ContentType: 'application/octet-stream'
        })
    );
    console.log('[cloud-r2] uploaded:', key, '(' + body.length + ' bytes)');
    if (existingKey && existingKey !== key) {
        try {
            await deleteObjectKey(existingKey);
        } catch (delErr) {
            console.warn('[cloud-r2] delete old key after upload:', existingKey, delErr.message || delErr);
        }
    }
    const out = Object.assign({}, record);
    delete out.data;
    out.s3Key = key;
    out.storageBackend = 'r2';
    return out;
}

/**
 * يحمّل data من R2 إن وُجد s3Key ولا يوجد data.
 */
async function hydrateFileRecord(record) {
    if (!record) {
        return record;
    }
    if (record.data) {
        return record;
    }
    const key = String(record.s3Key || '').trim();
    if (!key || !isR2Configured()) {
        return record;
    }
    const client = getS3Client();
    try {
        const resp = await client.send(
            new GetObjectCommand({
                Bucket: getBucket(),
                Key: key
            })
        );
        const buf = await streamToBuffer(resp.Body);
        const mime = record.type || record.mime || 'application/octet-stream';
        const out = Object.assign({}, record);
        // ملفات قوستا المشفّرة تُخزَّن كـ base64 خام (NaCl) — وليس data URL للوسائط
        if (record.isEncrypted) {
            out.data = buf.toString('base64');
        } else {
            out.data = bufferToDataUrl(buf, mime);
        }
        return out;
    } catch (e) {
        console.error('[cloud-r2] hydrate failed:', key, e.message || e);
        return record;
    }
}

/**
 * يجرّب s3Key الحالي ثم مسارات files/ و deleted/ و backup/ حتى يُوجد الكائن على R2.
 */
async function hydrateFileRecordWithFallback(email, record, preferredCategory) {
    if (!record) {
        return record;
    }
    if (record.data) {
        return record;
    }
    if (!isR2Configured()) {
        return record;
    }
    const em = String(email || '').trim();
    const order = [];
    const pref =
        preferredCategory === 'backup' || preferredCategory === 'files' || preferredCategory === 'deleted'
            ? preferredCategory
            : null;
    if (pref) {
        order.push(pref);
    }
    ['files', 'deleted', 'backup'].forEach(function (c) {
        if (order.indexOf(c) < 0) {
            order.push(c);
        }
    });
    const existingKey = String(record.s3Key || '').trim();
    if (existingKey) {
        const direct = await hydrateFileRecord(record);
        if (direct && direct.data) {
            return direct;
        }
    }
    for (let i = 0; i < order.length; i++) {
        const cat = order[i];
        const key = buildObjectKey(em, record.id, cat);
        const tryRec = Object.assign({}, record, { s3Key: key, storageBackend: 'r2' });
        const hydrated = await hydrateFileRecord(tryRec);
        if (hydrated && hydrated.data) {
            return hydrated;
        }
    }
    return record;
}

async function hydrateFileList(list) {
    const arr = Array.isArray(list) ? list : [];
    const out = [];
    for (let i = 0; i < arr.length; i++) {
        out.push(await hydrateFileRecord(arr[i]));
    }
    return out;
}

/** يكمّل s3Key المتوقع لسجلّ R2 عند غيابه من الفهرس (استعادة / hydrate واحد). */
function ensureRecordS3KeyForCategory(email, record, category) {
    if (!record || record.id === null || record.id === undefined) {
        return record;
    }
    const out = Object.assign({}, record);
    const key = String(out.s3Key || '').trim();
    if (key) {
        if (!out.storageBackend) {
            out.storageBackend = 'r2';
        }
        return out;
    }
    if (!isR2Configured()) {
        return out;
    }
    out.s3Key = buildObjectKey(email, out.id, category);
    out.storageBackend = 'r2';
    return out;
}

function collectS3KeysFromPayload(payload) {
    const keys = new Set();
    if (!payload) {
        return keys;
    }
    ['files', 'deletedFiles', 'backupFiles'].forEach(function (cat) {
        const list = Array.isArray(payload[cat]) ? payload[cat] : [];
        list.forEach(function (f) {
            const k = String(f && f.s3Key ? f.s3Key : '').trim();
            if (k) {
                keys.add(k);
            }
        });
    });
    return keys;
}

/** يحذف من R2 أي مفتاح كان في الحالة السابقة ولم يعد مستخدماً (مثلاً files/ بعد النقل إلى deleted/). */
async function pruneOrphanR2Keys(previousPayload, newPayload) {
    if (!isR2Configured() || !previousPayload) {
        return;
    }
    const prevKeys = collectS3KeysFromPayload(previousPayload);
    const newKeys = collectS3KeysFromPayload(newPayload);
    for (const key of prevKeys) {
        if (newKeys.has(key)) {
            continue;
        }
        try {
            await deleteObjectKey(key);
            console.log('[cloud-r2] pruned orphan:', key);
        } catch (e) {
            console.warn('[cloud-r2] prune failed:', key, e.message || e);
        }
    }
}

function indexCloudRecordsById(list) {
    const m = new Map();
    (Array.isArray(list) ? list : []).forEach(function (r) {
        if (r && r.id !== null && r.id !== undefined) {
            m.set(String(r.id), r);
        }
    });
    return m;
}

/**
 * لقطة فهرس خفيفة لـ cloud-files.json قبل انتظار رفع/نقل R2 (يُحدَّث الملف بسرعة).
 */
function buildStoreSnapshotBeforeR2(email, payload, previousPayload) {
    const prev = previousPayload || {};
    const prevFiles = indexCloudRecordsById(prev.files);
    const prevDeleted = indexCloudRecordsById(prev.deletedFiles);
    const prevBackup = indexCloudRecordsById(prev.backupFiles);
    const em = String(email || '').trim();

    function snap(record, category, prevMap) {
        if (!record || record.id === null || record.id === undefined) {
            return record;
        }
        const out = Object.assign({}, record);
        const prevRec = prevMap.get(String(out.id)) || null;
        const key = String(out.s3Key || (prevRec && prevRec.s3Key) || '').trim();
        if (key) {
            delete out.data;
            out.s3Key = key;
            out.storageBackend = out.storageBackend || (prevRec && prevRec.storageBackend) || 'r2';
            return out;
        }
        if (out.data) {
            delete out.data;
        }
        delete out.storageBackend;
        return out;
    }

    return {
        email: payload.email,
        files: (Array.isArray(payload.files) ? payload.files : []).map(function (f) {
            return snap(f, 'files', prevFiles);
        }),
        deletedFiles: (Array.isArray(payload.deletedFiles) ? payload.deletedFiles : []).map(function (f) {
            return snap(f, 'deleted', prevDeleted);
        }),
        backupFiles: (Array.isArray(payload.backupFiles) ? payload.backupFiles : []).map(function (f) {
            return snap(f, 'backup', prevBackup);
        }),
        folders: Array.isArray(payload.folders)
            ? payload.folders
            : Array.isArray(prev.folders)
              ? prev.folders
              : [],
        updatedAt: payload.updatedAt || new Date().toISOString(),
        storageBackend: 'r2'
    };
}

async function persistUserPayloadToR2(email, payload, previousPayload) {
    const files = await Promise.all(
        (Array.isArray(payload.files) ? payload.files : []).map((f) => uploadFileRecord(email, f, 'files'))
    );
    const deletedFiles = await Promise.all(
        (Array.isArray(payload.deletedFiles) ? payload.deletedFiles : []).map((f) =>
            uploadFileRecord(email, f, 'deleted')
        )
    );
    const backupFiles = await Promise.all(
        (Array.isArray(payload.backupFiles) ? payload.backupFiles : []).map((f) =>
            uploadFileRecord(email, f, 'backup')
        )
    );
    const newPayload = {
        email: payload.email,
        files,
        deletedFiles,
        backupFiles,
        folders: Array.isArray(payload.folders)
            ? payload.folders
            : Array.isArray(previousPayload?.folders)
              ? previousPayload.folders
              : [],
        updatedAt: payload.updatedAt || new Date().toISOString(),
        storageBackend: 'r2'
    };
    await pruneOrphanR2Keys(previousPayload, newPayload);
    return newPayload;
}

function wantsR2Backend() {
    const backend = String(process.env.CLOUD_STORAGE_BACKEND || '').trim().toLowerCase();
    return backend === 'r2' || backend === 's3';
}

function getCloudStorageBackendLabel() {
    if (isR2Configured()) {
        return 'r2';
    }
    if (wantsR2Backend()) {
        return 'r2_pending';
    }
    return 'json';
}

async function deleteObjectKey(s3Key) {
    const key = String(s3Key || '').trim();
    if (!key || !isR2Configured()) {
        return false;
    }
    const client = getS3Client();
    await client.send(
        new DeleteObjectCommand({
            Bucket: getBucket(),
            Key: key
        })
    );
    return true;
}

function logR2StartupStatus() {
    if (isR2Configured()) {
        console.log(
            '[auth-server] التخزين السحابي: R2 — bucket=' + getBucket()
        );
        return;
    }
    if (wantsR2Backend()) {
        console.warn(
            '[auth-server] CLOUD_STORAGE_BACKEND=r2 لكن مفاتيح R2 ناقصة في .env — يُستخدم cloud-files.json مؤقتاً.\n' +
                '  أنشئ token: Cloudflare → R2 → Manage R2 API Tokens → ثم npm run verify:r2'
        );
        return;
    }
    console.log('[auth-server] التخزين السحابي: JSON محلي (cloud-files.json)');
}

module.exports = {
    isR2Configured,
    wantsR2Backend,
    getCloudStorageBackendLabel,
    buildStoreSnapshotBeforeR2,
    uploadFileRecord,
    persistUserPayloadToR2,
    hydrateFileList,
    hydrateFileRecord,
    hydrateFileRecordWithFallback,
    ensureRecordS3KeyForCategory,
    buildObjectKey,
    deleteObjectKey,
    pruneOrphanR2Keys,
    collectS3KeysFromPayload,
    logR2StartupStatus
};
