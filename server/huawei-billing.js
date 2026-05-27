/**
 * Huawei AppGallery IAP — سجل أحداث، رموز أخطاء موحدة، واستعادة الحالة.
 */
const fs = require('fs');
const path = require('path');

const HUAWEI_BILLING_EVENTS_PATH = path.join(__dirname, 'data', 'huawei-billing-events.json');
const HUAWEI_BILLING_EVENTS_MAX = 6000;

/** رموز أخطاء موحدة للعميل والسجلات */
const HUAWEI_BILLING_ERROR = {
    PURCHASE_SESSION_ACTIVE: 'PURCHASE_SESSION_ACTIVE',
    PURCHASE_ALREADY_USED: 'PURCHASE_ALREADY_USED',
    PURCHASE_REPLAY_CONFLICT: 'PURCHASE_REPLAY_CONFLICT',
    MISSING_PURCHASE_TOKEN: 'MISSING_PURCHASE_TOKEN',
    MISSING_SESSION_IDENTITY: 'MISSING_SESSION_IDENTITY',
    VERIFY_TIMEOUT: 'VERIFY_TIMEOUT',
    VERIFY_FAILED: 'VERIFY_FAILED',
    IAP_INVALID: 'IAP_INVALID',
    IAP_HTTP_ERROR: 'IAP_HTTP_ERROR',
    NETWORK_ERROR: 'NETWORK_ERROR',
    EMAIL_NOT_REGISTERED: 'EMAIL_NOT_REGISTERED',
    PRODUCT_ID_MISMATCH: 'PRODUCT_ID_MISMATCH',
    MISSING_HUAWEI_CREDENTIALS: 'MISSING_HUAWEI_CREDENTIALS',
    SESSION_BEGIN_FAILED: 'SESSION_BEGIN_FAILED',
    SESSION_END_FAILED: 'SESSION_END_FAILED',
    UNKNOWN_PRODUCT: 'UNKNOWN_PRODUCT',
    PURCHASE_CANCELED: 'PURCHASE_CANCELED',
    PURCHASE_NOT_CONFIRMED: 'PURCHASE_NOT_CONFIRMED'
};

function loadBillingEvents() {
    try {
        if (!fs.existsSync(HUAWEI_BILLING_EVENTS_PATH)) {
            return [];
        }
        const data = JSON.parse(fs.readFileSync(HUAWEI_BILLING_EVENTS_PATH, 'utf8'));
        return Array.isArray(data) ? data : [];
    } catch (e) {
        console.warn('[huawei-billing] loadBillingEvents:', e.message || e);
        return [];
    }
}

function saveBillingEvents(list) {
    fs.mkdirSync(path.dirname(HUAWEI_BILLING_EVENTS_PATH), { recursive: true });
    fs.writeFileSync(HUAWEI_BILLING_EVENTS_PATH, JSON.stringify(list, null, 2), 'utf8');
}

/**
 * @param {string} event
 * @param {object} meta
 */
function logHuaweiBillingEvent(event, meta) {
    try {
        const entry = Object.assign(
            {
                time: new Date().toISOString(),
                event: String(event || 'UNKNOWN')
            },
            meta || {}
        );
        const list = loadBillingEvents();
        list.push(entry);
        if (list.length > HUAWEI_BILLING_EVENTS_MAX) {
            list.splice(0, list.length - HUAWEI_BILLING_EVENTS_MAX);
        }
        saveBillingEvents(list);
        if (process.env.HUAWEI_BILLING_LOG_CONSOLE === '1') {
            console.info('[huawei-billing]', entry.event, entry.purchaseToken || entry.email || '');
        }
    } catch (e) {
        console.warn('[huawei-billing] logHuaweiBillingEvent:', e.message || e);
    }
}

function getRecentBillingEventsForUser(email, huaweiAccountId, limit) {
    const e = String(email || '').trim().toLowerCase();
    const u = String(huaweiAccountId || '').trim();
    const max = Math.min(Number(limit) || 5, 20);
    const list = loadBillingEvents();
    const filtered = list.filter((row) => {
        const rowEmail = String(row.email || row.userEmail || '').trim().toLowerCase();
        const rowUser = String(row.huaweiAccountId || '').trim();
        if (e && e !== 'unknown@gosta.local' && rowEmail === e) return true;
        if (u && rowUser === u) return true;
        return false;
    });
    return filtered.slice(-max);
}

function huaweiBillingJsonError(status, code, extra) {
    return Object.assign({ ok: false, error: code, errorCode: code }, extra || {});
}

function mapVerifyFailureToCode(err, iapBody) {
    const msg = String(err?.message || err || '');
    if (msg.includes('missing_huawei_credentials')) {
        return HUAWEI_BILLING_ERROR.MISSING_HUAWEI_CREDENTIALS;
    }
    if (msg.startsWith('iap_http_')) {
        return HUAWEI_BILLING_ERROR.IAP_HTTP_ERROR;
    }
    if (msg === 'AbortError' || msg.includes('abort')) {
        return HUAWEI_BILLING_ERROR.VERIFY_TIMEOUT;
    }
    if (iapBody && typeof iapBody === 'object') {
        return HUAWEI_BILLING_ERROR.IAP_INVALID;
    }
    return HUAWEI_BILLING_ERROR.VERIFY_FAILED;
}

const HUAWEI_IAP_TIMEOUT_MS = Number(process.env.HUAWEI_IAP_TIMEOUT_MS || 28000);

async function fetchWithHuaweiTimeout(url, options) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => {
        try {
            ctrl.abort();
        } catch (e) {}
    }, HUAWEI_IAP_TIMEOUT_MS);
    try {
        const r = await fetch(url, Object.assign({}, options || {}, { signal: ctrl.signal }));
        clearTimeout(timer);
        return r;
    } catch (e) {
        clearTimeout(timer);
        throw e;
    }
}

module.exports = {
    HUAWEI_BILLING_ERROR,
    HUAWEI_BILLING_EVENTS_PATH,
    logHuaweiBillingEvent,
    getRecentBillingEventsForUser,
    huaweiBillingJsonError,
    mapVerifyFailureToCode,
    fetchWithHuaweiTimeout,
    HUAWEI_IAP_TIMEOUT_MS
};
