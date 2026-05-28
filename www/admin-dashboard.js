
// قاعدة بيانات أولية فارغة (تُعبأ من السيرفر أو localStorage حسب التوفر)
const ADMIN_DATA_SEED = {
    subscriptions: [],
    electronicPayments: [],
    users: []
};

function cloneAdminDataFromSeed() {
    return JSON.parse(JSON.stringify(ADMIN_DATA_SEED));
}

let adminData = cloneAdminDataFromSeed();

const SUBSCRIPTION_LOGS_KEY = 'subscriptionLogs_INDEX2';
const LAST_TOTAL_USERS_KEY = 'adminLastTotalUsersV1';
let serverSubscriptionLogsCache = [];
/** ملخص المساحة/الاشتراك من السيرفر (مفتاح = بريد بأحرف صغيرة) */
let serverUserUsageSummariesCache = {};
/** تسجيلات المستخدمين من السيرفر (نفس مصدر تبويب المستخدمين) — تُستخدم لدمج لوحة البيانات */
const SERVER_REGISTRATIONS_CACHE_KEY = 'adminServerRegistrationsCacheV1';
const SERVER_SUPPORT_TICKETS_CACHE_KEY = 'adminServerSupportTicketsCacheV1';
let serverRegistrationsCache = [];
try {
    const cachedRegsRaw = localStorage.getItem(SERVER_REGISTRATIONS_CACHE_KEY);
    const cachedRegs = cachedRegsRaw ? JSON.parse(cachedRegsRaw) : [];
    if (Array.isArray(cachedRegs)) {
        serverRegistrationsCache = cachedRegs;
    }
} catch (e) {
    console.warn('load registrations cache:', e);
}

let currentFilter = 'all';
let currentPaymentFilter = 'all';
let currentUserListFilter = 'all';
let currentSupportFilter = 'all';
let selectedData = null;
let serverSupportTicketsCache = [];
try {
    const cachedSupportRaw = localStorage.getItem(SERVER_SUPPORT_TICKETS_CACHE_KEY);
    const cachedSupport = cachedSupportRaw ? JSON.parse(cachedSupportRaw) : [];
    if (Array.isArray(cachedSupport)) {
        serverSupportTicketsCache = cachedSupport;
    }
} catch (e) {
    console.warn('load support tickets cache:', e);
}

async function waitForAuthDiscoveryAdmin() {
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY && typeof window.PR_SAFE_AUTH_DISCOVERY.then === 'function') {
            await window.PR_SAFE_AUTH_DISCOVERY;
        }
    } catch (e) {
        console.warn('waitForAuthDiscoveryAdmin:', e);
    }
}

function registrationIsVerified(reg) {
    if (!reg) return false;
    if (reg.verified === true) return true;
    if (reg.verifiedAt) return true;
    return false;
}

function subscriptionStatusLabel(sub) {
    if (!sub) return '—';
    if (sub.paymentType === 'registration') {
        if (sub.status === 'active' || sub.paymentStatus === 'verified') {
            return 'نشط (تسجيل مجاني تجريبي)';
        }
        return 'بانتظار التفعيل';
    }
    if (sub.status === 'active') return 'نشط';
    if (sub.status === 'pending') return 'بانتظار الدفع';
    return 'معطل';
}

function subscriptionStatusClass(sub) {
    if (!sub) return 'inactive';
    if (sub.paymentType === 'registration') {
        return sub.status === 'active' || sub.paymentStatus === 'verified' ? 'active' : 'pending';
    }
    return sub.status === 'active' ? 'active' : 'inactive';
}

function planForEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return '—';
    const sub = adminData.subscriptions.find((s) => String(s.email || '').trim().toLowerCase() === key);
    if (sub) return sub.plan;
    const u = adminData.users.find((x) => String(x.email || '').trim().toLowerCase() === key);
    return u ? u.plan : '—';
}

function lastLoginForEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return '—';
    const u = adminData.users.find((x) => String(x.email || '').trim().toLowerCase() === key);
    return u ? u.lastLogin : '—';
}

function parsePriceAmount(price) {
    if (price == null) return '0';
    const m = String(price).match(/[\d.]+/);
    return m ? m[0] : '0';
}

function escapeHtmlAttr(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function usageSummaryForEmail(email) {
    const key = String(email || '').trim().toLowerCase();
    if (!key) return null;
    const s = serverUserUsageSummariesCache[key];
    return s && typeof s === 'object' ? s : null;
}

function formatStorageUsageLabel(summary) {
    if (!summary) return '—';
    const used = Number(summary.usedMb);
    const quota = summary.quotaMb != null ? Number(summary.quotaMb) : NaN;
    const usedStr = Number.isFinite(used) ? used.toFixed(2) : '0.00';
    if (!Number.isFinite(quota)) {
        return usedStr + ' MB';
    }
    return usedStr + ' / ' + quota + ' MB';
}

function formatDaysRemainingHtml(summary) {
    if (!summary) {
        return escapeHtmlAttr('—');
    }
    if (summary.expired === true) {
        return '<span class="status-badge status-inactive">منتهي</span>';
    }
    const d = Number(summary.daysRemaining);
    if (!Number.isFinite(d)) {
        return escapeHtmlAttr('—');
    }
    if (d <= 0) {
        return '<span class="status-badge status-inactive">منتهي</span>';
    }
    let cls = 'status-active';
    if (d <= 7) cls = 'status-pending';
    if (d <= 3) cls = 'status-inactive';
    return '<span class="status-badge ' + cls + '">' + escapeHtmlAttr(String(d)) + ' يوم</span>';
}

function formatExpiryDateLabel(summary) {
    if (!summary || !summary.expiryDate) return '—';
    try {
        return new Date(summary.expiryDate).toLocaleString('ar-EG');
    } catch (e) {
        return '—';
    }
}

async function refreshServerUserUsageSummaries() {
    await waitForAuthDiscoveryAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        return false;
    }
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/user-usage-summaries`, {
            headers: { 'x-admin-key': AUTH.adminKey },
            cache: 'no-store'
        });
        if (!r.ok) {
            return false;
        }
        const data = await r.json().catch(function () {
            return {};
        });
        if (data && data.summaries && typeof data.summaries === 'object') {
            serverUserUsageSummariesCache = data.summaries;
            return true;
        }
    } catch (e) {
        console.warn('refreshServerUserUsageSummaries:', e);
    }
    return false;
}

function hydrateServerRegistrationsCacheFromStorage() {
    if (Array.isArray(serverRegistrationsCache) && serverRegistrationsCache.length > 0) {
        return serverRegistrationsCache.length;
    }
    try {
        const raw = localStorage.getItem(SERVER_REGISTRATIONS_CACHE_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        if (Array.isArray(parsed) && parsed.length > 0) {
            serverRegistrationsCache = parsed;
            return parsed.length;
        }
    } catch (e) {
        console.warn('hydrateServerRegistrationsCacheFromStorage:', e);
    }
    return 0;
}

/**
 * يدمج سجلات الاشتراك/الدفع من السيرفر مع قائمة التسجيلات.
 * تبويب «المستخدمين» كان يقرأ التسجيلات مباشرة؛ لوحة البيانات كانت تعتمد فقط على adminData.users
 * المُعبأة من سجلات الدفع فقط فتبقى 0 — لذلك نُوحّد المصدر هنا.
 */
/** يمسح سجلات اشتراك التطبيق المحلية من متصفح لوحة التحكم (لا تُعاد عند المزامنة). */
function clearAdminBrowserSubscriptionCaches() {
    try {
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const k = localStorage.key(i);
            if (!k) continue;
            if (
                k === SUBSCRIPTION_LOGS_KEY ||
                k.indexOf(SUBSCRIPTION_LOGS_KEY + '::') === 0 ||
                k === 'gostaPendingSubscriptionLogs_INDEX2' ||
                k === 'userSubscription_INDEX2' ||
                k.indexOf('userSubscription_INDEX2::') === 0
            ) {
                keysToRemove.push(k);
            }
        }
        keysToRemove.forEach(function (k) {
            localStorage.removeItem(k);
        });
    } catch (e) {
        console.warn('clearAdminBrowserSubscriptionCaches:', e);
    }
    serverSubscriptionLogsCache = [];
}

function refreshAdminDataFromLocalStorage() {
    hydrateServerRegistrationsCacheFromStorage();
    let logs = [];
    if (Array.isArray(serverSubscriptionLogsCache) && serverSubscriptionLogsCache.length > 0) {
        logs = serverSubscriptionLogsCache.slice();
    }

    const next = cloneAdminDataFromSeed();

    const paidLogs = logs.filter(function (l) {
        const email = l.userEmail || l.email;
        if (!email) return false;
        const ps = String(l.paymentStatus || '').toLowerCase();
        const st = String(l.status || '').toLowerCase();
        const paid = ps === 'completed' || st === 'active' || l.isValid === true;
        return paid;
    });

    const paymentsFromLogs = [];
    const seenTxn = new Set();
    for (let i = paidLogs.length - 1; i >= 0; i--) {
        const l = paidLogs[i];
        const id = String(l.transactionId || ('LOG-' + i + '-' + (l.loggedAt || '')));
        if (seenTxn.has(id)) continue;
        seenTxn.add(id);
        paymentsFromLogs.push({
            id: id,
            email: l.userEmail || l.email,
            cardType: l.cardType || l.paymentMethod || 'إلكتروني',
            amount: parsePriceAmount(l.price),
            date: l.timestamp || (l.loggedAt ? new Date(l.loggedAt).toLocaleString('ar-EG') : '—'),
            status: 'completed',
            planType: l.type || l.plan,
            planName: l.planName || '',
            expiryDate: l.expiryDate,
            transactionId: l.transactionId,
            autoActivated: true,
            _raw: l
        });
    }

    if (paymentsFromLogs.length > 0) {
        next.electronicPayments = paymentsFromLogs;
    }

    const byEmail = new Map();
    paidLogs.forEach(function (l) {
        const em = l.userEmail || l.email;
        if (!em) return;
        const t = new Date(l.loggedAt || l.startDate || 0).getTime();
        const prev = byEmail.get(em);
        const prevT = prev ? new Date(prev.loggedAt || prev.startDate || 0).getTime() : -1;
        if (!prev || t >= prevT) {
            byEmail.set(em, l);
        }
    });

    const liveSubs = [];
    let sid = 10000;
    byEmail.forEach(function (l, email) {
        liveSubs.push({
            id: l.transactionId || sid++,
            email: email,
            plan: l.type || 'INDEX3',
            date: l.loggedAt
                ? new Date(l.loggedAt).toLocaleDateString('ar-EG')
                : new Date(l.startDate || Date.now()).toLocaleDateString('ar-EG'),
            status: 'active',
            paymentType: 'electronic',
            paymentStatus: 'completed'
        });
    });

    if (Array.isArray(serverRegistrationsCache)) {
        serverRegistrationsCache.forEach(function (reg) {
            const em = String(reg.email || '').trim();
            if (!em) return;
            const key = em.toLowerCase();
            const exists = liveSubs.some(function (s) {
                return String(s.email || '').trim().toLowerCase() === key;
            });
            if (!exists) {
                const regOk = registrationIsVerified(reg);
                liveSubs.push({
                    id: 'reg-' + key,
                    email: em,
                    plan: 'free',
                    date: reg.createdAt
                        ? new Date(reg.createdAt).toLocaleDateString('ar-EG')
                        : '—',
                    status: regOk ? 'active' : 'pending',
                    paymentType: 'registration',
                    paymentStatus: regOk ? 'verified' : 'pending'
                });
            }
        });
    }

    if (liveSubs.length > 0) {
        next.subscriptions = liveSubs.slice();
    }

    const usersByEmail = new Map();
    if (Array.isArray(serverRegistrationsCache)) {
        serverRegistrationsCache.forEach(function (reg) {
            const em = String(reg.email || '').trim();
            if (!em) return;
            const key = em.toLowerCase();
            usersByEmail.set(key, {
                email: em,
                plan: '—',
                created: reg.createdAt ? new Date(reg.createdAt).toLocaleString('ar-EG') : '—',
                lastLogin: '—',
                status: reg.verified ? 'active' : 'pending'
            });
        });
    }

    liveSubs.forEach(function (ls) {
        const em = String(ls.email || '').trim();
        if (!em) return;
        const key = em.toLowerCase();
        const u = usersByEmail.get(key);
        if (u) {
            u.plan = ls.plan;
            u.status = 'active';
        } else {
            usersByEmail.set(key, {
                email: em,
                plan: ls.plan,
                created: ls.date,
                lastLogin: '—',
                status: 'active'
            });
        }
    });

    next.users = Array.from(usersByEmail.values());

    adminData = next;
}

async function refreshServerRegistrations() {
    await waitForAuthDiscoveryAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        return hydrateServerRegistrationsCacheFromStorage() > 0;
    }
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/registrations`, {
            headers: { 'x-admin-key': AUTH.adminKey },
            cache: 'no-store'
        });
        if (!r.ok) {
            return hydrateServerRegistrationsCacheFromStorage() > 0;
        }
        const rows = await r.json();
        if (Array.isArray(rows)) {
            serverRegistrationsCache = rows.map(function (r) {
                return {
                    email: r.email,
                    verified: registrationIsVerified(r),
                    createdAt: r.createdAt,
                    verifiedAt: r.verifiedAt || null
                };
            });
            try {
                localStorage.setItem(SERVER_REGISTRATIONS_CACHE_KEY, JSON.stringify(serverRegistrationsCache));
            } catch (e) {
                console.warn('save registrations cache:', e);
            }
            return serverRegistrationsCache.length;
        }
    } catch (e) {
        console.warn('refreshServerRegistrations:', e);
    }
    return hydrateServerRegistrationsCacheFromStorage() > 0;
}

function refreshAllAdminTabs() {
    refreshAdminDataFromLocalStorage();
    updateDashboard();
    loadSubscriptions();
    loadElectronicPayments();
    loadUsers();
    const supportTab = document.getElementById('supportTab');
    if (supportTab && supportTab.classList.contains('active')) {
        loadSupportTickets();
    }
}

async function refreshServerSubscriptionLogs() {
    await waitForAuthDiscoveryAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) return;
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/subscription-logs`, {
            headers: { 'x-admin-key': AUTH.adminKey }
        });
        if (!r.ok) return;
        const rows = await r.json();
        if (Array.isArray(rows)) {
            serverSubscriptionLogsCache = rows;
        }
    } catch (e) {
        console.warn('refreshServerSubscriptionLogs:', e);
    }
}

async function refreshServerSupportTickets() {
    await waitForAuthDiscoveryAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) return;
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/support-tickets`, {
            headers: { 'x-admin-key': AUTH.adminKey }
        });
        if (!r.ok) return;
        const rows = await r.json();
        if (Array.isArray(rows)) {
            serverSupportTicketsCache = rows;
            try {
                localStorage.setItem(SERVER_SUPPORT_TICKETS_CACHE_KEY, JSON.stringify(rows));
            } catch (e) {
                console.warn('save support tickets cache:', e);
            }
        }
    } catch (e) {
        console.warn('refreshServerSupportTickets:', e);
    }
}

/**
 * لقطات لوحة مراقبة الخادم — تنسيق للعرض.
 */
function formatMonitorBytes(bytes) {
    const n = Number(bytes);
    if (!Number.isFinite(n) || n < 0) {
        return '—';
    }
    if (n < 1024) {
        return n + ' B';
    }
    const units = ['KB', 'MB', 'GB', 'TB'];
    let v = n / 1024;
    let i = 0;
    while (v >= 1024 && i < units.length - 1) {
        v /= 1024;
        i += 1;
    }
    return (v >= 100 ? v.toFixed(0) : v.toFixed(1)) + ' ' + units[i];
}

function renderServerMonitorOverview(data) {
    const wrap = document.getElementById('serverMonitorOverview');
    if (!wrap) {
        return;
    }
    const mem = data.memory || {};
    const host = data.host || {};
    const q = data.aiQueue || {};
    const met = data.metrics || {};
    var ctr =
        met.counters && typeof met.counters === 'object' && met.counters ? met.counters : {};

    var counterLabelsAr = {
        ai_chat_requests: 'طلبات محادثة (مقبولة)',
        ai_chat_tool_json_ok: 'رد محادثة JSON (أدوات)',
        ai_chat_tool_stream_ok: 'بث محادثة (أدوات)',
        ai_chat_tool_loop_fallback: 'تراجع بعد فشل حلقة الأدوات',
        ai_chat_standard_json_ok: 'رد محادثة JSON (قياسي)',
        ai_chat_standard_stream_ok: 'بث محادثة (قياسي)',
        ai_chat_not_configured: 'محادثة — لم يُضبط OpenAI',
        ai_chat_rate_limited: 'محادثة — حد الطلبات',
        ai_chat_bad_request: 'محادثة — طلب غير صالح',
        ai_chat_openai_error: 'محادثة — خطأ OpenAI',
        ai_chat_queue_full: 'محادثة — طابور ممتلئ',
        ai_chat_timeout: 'محادثة — مهلة',
        ai_chat_other_error: 'محادثة — أخطاء أخرى',
        ai_summarize_requests: 'طلبات تلخيص',
        ai_summarize_success: 'تلخيص ناجح',
        ai_summarize_not_configured: 'تلخيص — لم يُضبط OpenAI',
        ai_summarize_rate_limited: 'تلخيص — حد الطلبات',
        ai_summarize_bad_request: 'تلخيص — طلب غير صالح',
        ai_summarize_openai_error: 'تلخيص — خطأ OpenAI',
        ai_summarize_queue_full: 'تلخيص — طابور',
        ai_summarize_timeout: 'تلخيص — مهلة',
        ai_summarize_other_error: 'تلخيص — أخطاء أخرى',
        ai_image_requests: 'طلبات إنشاء صورة',
        ai_image_success: 'صورة مُنشأة بنجاح',
        ai_image_not_configured: 'صورة — لم يُضبط OpenAI',
        ai_image_rate_limited: 'صورة — حد الطلبات',
        ai_image_bad_request: 'صورة — طلب غير صالح',
        ai_image_openai_error: 'صورة — خطأ OpenAI',
        ai_image_queue_full: 'صورة — طابور',
        ai_image_other_error: 'صورة — أخطاء أخرى',
        ai_image_edit_requests: 'طلبات تعديل صورة',
        ai_image_edit_success: 'تعديل صورة ناجح',
        ai_image_edit_not_configured: 'تعديل صورة — لم يُضبط OpenAI',
        ai_image_edit_rate_limited: 'تعديل صورة — حد الطلبات',
        ai_image_edit_bad_request: 'تعديل صورة — طلب غير صالح',
        ai_image_edit_openai_error: 'تعديل صورة — خطأ OpenAI',
        ai_image_edit_queue_full: 'تعديل صورة — طابور',
        ai_image_edit_timeout: 'تعديل صورة — مهلة',
        ai_image_edit_other_error: 'تعديل صورة — أخطاء أخرى',
        conversations_sync_ok: 'مزامنة محادثات ناجحة',
        conversations_sync_fail: 'مزامنة فاشلة',
        conversations_sync_rate_limited: 'مزامنة — حد الطلبات',
        conversations_sync_denied: 'مزامنة — حساب غير مصرّح',
        conversations_sync_bad_request: 'مزامنة — طلب غير صالح',
        conversations_sync_server_error: 'مزامنة — خطأ خادم',
        admin_server_monitor_hits: 'فتح لوحة مراقبة الخادم'
    };

    var mainStats = [];
    mainStats.push({
        title: 'مدة تشغيل العملية',
        val: Math.floor((data.process && data.process.uptimeSec) || 0) + ' ثانية'
    });
    mainStats.push({ title: 'Heap مستخدم', val: formatMonitorBytes(mem.heapUsedBytes) });
    mainStats.push({ title: 'RSS الذاكرة', val: formatMonitorBytes(mem.rssBytes) });
    mainStats.push({
        title: 'الذاكرة الحرة (النظام)',
        val: formatMonitorBytes(host.freeMemBytes) + ' / ' + formatMonitorBytes(host.totalMemBytes)
    });
    mainStats.push({
        title: 'الحِمل المتوسط ‎(1 د)‎',
        val:
            (typeof host.loadAvg1m === 'number' ? host.loadAvg1m.toFixed(2) : '—') +
            ' — معالجات: ' +
            String(host.cpuCount || 0)
    });

    var queueStats = [];
    queueStats.push({
        title: 'عامل نشط الآن',
        val: String(q.activeWorkers != null ? q.activeWorkers : '—') + ' / ' + String(q.maxConcurrent != null ? q.maxConcurrent : '—')
    });
    queueStats.push({
        title: 'في الانتظار',
        val:
            String(q.queuedJobs != null ? q.queuedJobs : '—') +
            ' (حد ' +
            String(q.maxQueue != null ? q.maxQueue : '—') +
            ')'
    });

    var nonzeroCounters = [];
    var ck = Object.keys(ctr).sort();
    for (var ci = 0; ci < ck.length; ci++) {
        var k = ck[ci];
        var v = ctr[k];
        if (typeof v !== 'number' || v <= 0) {
            continue;
        }
        var label = counterLabelsAr[k] || k;
        nonzeroCounters.push({ key: k, label: label, v: v });
    }

    var files = data.dataFiles || {};

    function basenamePath(p) {
        var s = String(p || '').replace(/\\/g, '/').split('/');
        return s[s.length - 1] || p || '—';
    }

    var fileLines = [];
    var fk = ['registrations', 'subscriptionLogs', 'cloudFiles', 'supportTickets', 'conversationsSqlite'];
    var titleLabels = {
        registrations: 'registrations.json',
        subscriptionLogs: 'subscription-logs.json',
        cloudFiles: 'cloud-files.json',
        supportTickets: 'support-tickets.json',
        conversationsSqlite: 'conversations.sqlite'
    };
    for (var fi = 0; fi < fk.length; fi++) {
        var key = fk[fi];
        var meta = files[key];
        if (!meta) {
            continue;
        }
        var tag = basenamePath(meta.path);
        var lbl = titleLabels[key] || tag;
        var state = meta.exists ? formatMonitorBytes(meta.bytes) : '(غير موجود)';
        fileLines.push({ title: lbl, val: state });
    }

    function sec(title, cards) {
        var h = '<h4 style="margin:14px 0 8px;font-size:14px;font-weight:600;">' + escapeHtmlAttr(title) + '</h4>';
        h += '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px">';
        for (var i = 0; i < cards.length; i++) {
            var c = cards[i];
            h +=
                '<div style="border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:12px;background:rgba(255,255,255,.03)">';
            h +=
                '<div style="font-size:11px;opacity:.75;margin-bottom:4px">' + escapeHtmlAttr(c.title) + '</div>';
            h += '<div style="font-size:15px;font-weight:600">' + escapeHtmlAttr(c.val) + '</div>';
            h += '</div>';
        }
        h += '</div>';
        return h;
    }

    var html = '';
    html +=
        '<p style="margin:4px 0 8px;font-size:12px;opacity:.8">عدادات AI منذ: ' + escapeHtmlAttr(met.startedAtUtc || '—');
    html += met.uptimeSec != null ? ' — منذ تشغيل العدّاد: ' + String(met.uptimeSec) + ' ث' : '';
    html += '</p>';
    html += sec('عملية الذاكرة والنظام', mainStats);
    html += sec('طابور المساعد (المزامنة على الخادم)', queueStats);
    if (fileLines.length) {
        html += sec('ملفّات البيانات على الخادم', fileLines);
    }
    if (nonzeroCounters.length) {
        var cards = [];
        for (var j = 0; j < nonzeroCounters.length; j++) {
            var x = nonzeroCounters[j];
            cards.push({ title: x.label + ' («' + x.key + '»)', val: String(x.v) });
        }
        html += sec('عدّادات طلبات المساعد (القيم أكبر من صفر)', cards);
    } else if (ctr && Object.keys(ctr).length) {
        html +=
            '<p style="margin-top:14px;font-size:13px;opacity:.82">جميع عدّادات المساعد صفر بعد آخر تشغيل — هذا طبيعي إن لم يُستخدم المساعد بعد.</p>';
    }
    wrap.innerHTML = html;
}

/**
 * لقطة خفيفة للخادم للوحة الإدارة فقط — لا تُستدعى آليّاً من مستخدمي التطبيق.
 */
async function loadServerMonitorSnapshot(btn) {
    await waitForAuthDiscoveryAdmin();
    const el = document.getElementById('serverMonitorBody');
    const ov = document.getElementById('serverMonitorOverview');
    if (!el) {
        return;
    }
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        if (ov) {
            ov.innerHTML = '';
        }
        el.textContent = '⚠️ تعذّر الاتصال: تأكد من apiBase و Admin key في الإعدادات.';
        return;
    }
    var oldText = '';
    if (btn && btn.textContent) {
        oldText = btn.textContent;
        btn.disabled = true;
        btn.textContent = '…جاري';
    }
    try {
        el.textContent = 'جاري الجلب…';
        const r = await fetch(`${AUTH.apiBase}/api/admin/server-monitor`, {
            headers: { 'x-admin-key': AUTH.adminKey }
        });
        const bodyText = await r.text();
        var data = null;
        try {
            data = bodyText ? JSON.parse(bodyText) : null;
        } catch (ignore) {
            data = null;
        }
        if (!r.ok) {
            var hintAr = '';
            if (r.status === 401) {
                hintAr =
                    '\n\n— تحقّق أن مفتاح المدير (x-admin-key) يطابق ADMIN_API_KEY في .env الخاص بالخادم.';
            } else if (r.status === 404) {
                hintAr =
                    '\n\n— غالباً **خادم قديم لم يُعاد تشغيله** أو **لم تُحدَّث** ملفّات الخادم. أوقف `npm run auth-server` وأعد تشغيله من مجلّد المشروع بعد التحديث. إذا كنت تشير إلى VPS بعيد، انسخ التحديث ثم أعد التشغيل هناك.';
                if (bodyText && /Cannot\s+GET\s+\/api\/admin\/server-monitor/i.test(bodyText)) {
                    hintAr +=
                        '\n\n— **غالباً المنفذ يستجيب نسخة قديمة من auth-server** بينما نسخة محدّثة تعمل على منفذ آخر (مثلاً 3001). بعد التحديث: أوقف كل عمليات `node` القديمة، أو نفّذ في PowerShell: `netstat -ano | findstr :3000` وأوقف الـ PID، ثم `npm run auth-server` من مجلّد المشروع. إن لزم: أعد تحميل لوحة الإدارة كاملة (F5) بعد تشغيل الخادم المحدّث.';
                }
            }
            var extra = '';
            if (data && typeof data === 'object' && data.error) {
                extra = String(data.error);
            } else if (bodyText && bodyText.trim()) {
                extra = bodyText.trim().slice(0, 400);
            }
            if (ov) {
                ov.innerHTML = '';
            }
            el.textContent =
                '❌ تعذّر اللقطة (HTTP ' + r.status + ')' + (extra ? ': ' + extra : '') + hintAr + '\n\nالطلب: ' + AUTH.apiBase + '/api/admin/server-monitor';
            return;
        }
        renderServerMonitorOverview(data);
        el.textContent = JSON.stringify(data, null, 2);
    } catch (e) {
        console.warn('loadServerMonitorSnapshot:', e);
        var ovCatch = document.getElementById('serverMonitorOverview');
        if (ovCatch) {
            ovCatch.innerHTML = '';
        }
        el.textContent = '❌ خطأ شبكة أو خادم: ' + String(e.message || e);
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = oldText || 'تحديث اللقطة';
        }
    }
}

async function exportServerSubscriptionLogs() {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        alert('⚠️ تعذر الاتصال بخادم الإدارة');
        return;
    }
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/subscription-logs`, {
            headers: { 'x-admin-key': AUTH.adminKey }
        });
        if (!r.ok) {
            alert('❌ فشل تصدير سجلات السيرفر');
            return;
        }
        const logs = await r.json();
        const blob = new Blob([JSON.stringify(logs, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'subscription-logs-' + new Date().toISOString().slice(0, 10) + '.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        alert('✅ تم تصدير سجل الاشتراكات من السيرفر');
    } catch (e) {
        console.error('exportServerSubscriptionLogs:', e);
        alert('❌ خطأ أثناء التصدير');
    }
}

async function clearServerSubscriptionLogs() {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        alert('⚠️ تعذر الاتصال بخادم الإدارة');
        return;
    }
    const ok = confirm('هل تريد تفريغ سجل الاشتراكات على السيرفر؟ لا يمكن التراجع عن هذه العملية.');
    if (!ok) return;
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/subscription-logs`, {
            method: 'DELETE',
            headers: { 'x-admin-key': AUTH.adminKey }
        });
        if (!r.ok) {
            alert('❌ فشل تفريغ سجل السيرفر');
            return;
        }
        serverSubscriptionLogsCache = [];
        clearAdminBrowserSubscriptionCaches();
        refreshAdminDataFromLocalStorage();
        updateDashboard();
        loadSubscriptions();
        loadElectronicPayments();
        alert(
            '✅ تم تفريغ سجل الاشتراكات على السيرفر.\n\n' +
                'إن ظهر الاشتراك مجدداً: امسح بيانات التطبيق على الجوال/المتصفح (أو نافذة خاصة) — التطبيق كان يعيد رفع الاشتراك المحلي تلقائياً.'
        );
    } catch (e) {
        console.error('clearServerSubscriptionLogs:', e);
        alert('❌ خطأ أثناء التفريغ');
    }
}

async function syncAdminDataNow(btn) {
    const oldText = btn && btn.textContent ? btn.textContent : '';
    if (btn) {
        btn.disabled = true;
        btn.textContent = '...جاري المزامنة';
    }
    try {
        await refreshServerRegistrations();
        await refreshServerSubscriptionLogs();
        await refreshServerUserUsageSummaries();
        await refreshServerSupportTickets();
        refreshAllAdminTabs();
        loadSupportTickets();
        alert('✅ تمت المزامنة الفورية بنجاح');
    } catch (e) {
        console.error('syncAdminDataNow:', e);
        alert('❌ تعذر تنفيذ المزامنة الفورية');
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.textContent = oldText || 'مزامنة فورية';
        }
    }
}

async function openManualActivationEmail(email) {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        alert('⚠️ راجع إعدادات PR_SAFE_AUTH في pr-safe-auth-config.js');
        return;
    }
    try {
        const r = await fetch(
            `${AUTH.apiBase}/api/admin/registration-code?email=${encodeURIComponent(email)}`,
            { headers: { 'x-admin-key': AUTH.adminKey } }
        );
        const data = await r.json().catch(() => ({}));
        if (!r.ok) {
            alert(data.error === 'not_found' ? 'لا يوجد طلب تفعيل لهذا البريد' : (data.error || 'تعذر جلب الكود'));
            return;
        }
        const subject = encodeURIComponent('كود تفعيل حسابك — GOSTA');
        const body = encodeURIComponent(
            `مرحباً،\n\nكود تفعيل بريدك في تطبيق GOSTA هو: ${data.code}\n\nإذا لم تطلب التسجيل يمكنك تجاهل الرسالة.\n`
        );
        window.location.href = `mailto:${encodeURIComponent(email)}?subject=${subject}&body=${body}`;
    } catch (e) {
        console.error(e);
        alert('❌ تعذر الاتصال بالخادم');
    }
}

// ========================================
// 🔒 دالة Hash آمنة للتحقق من البيانات
// ========================================
function hashStringBasic(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
}

// ========================================
// نظام تسجيل الأنشطة والأمان (Logging & Security)
// ========================================

// تعريفات مستويات التسجيل
const LOG_LEVELS = {
    INFO: 'INFO',
    WARNING: 'WARNING',
    ERROR: 'ERROR',
    SECURITY: 'SECURITY'
};

// تسجيل الأنشطة
function logActivity(action, details = '', level = LOG_LEVELS.INFO) {
    const timestamp = new Date().toISOString();
    const sessionData = JSON.parse(localStorage.getItem('adminSession') || '{}');
    const admin = sessionData.email || 'unknown';

    const logEntry = {
        timestamp,
        admin,
        action,
        details,
        level,
        userAgent: navigator.userAgent
    };

    // حفظ السجل في localStorage
    let logs = JSON.parse(localStorage.getItem('adminActivityLogs') || '[]');
    logs.push(logEntry);
    
    // الاحتفاظ بآخر 100 سجل فقط
    if (logs.length > 100) {
        logs = logs.slice(-100);
    }
    localStorage.setItem('adminActivityLogs', JSON.stringify(logs));

    // طباعة في console للتطوير
    console.log(`[${level}] ${timestamp} - ${admin}: ${action}`, details);
}

// إرسال تنبيه أمان
function securityAlert(message, severity = 'warning') {
    logActivity('SECURITY_ALERT', message, LOG_LEVELS.SECURITY);
}

// 🔒 تسجيل أحداث الأمان
function logSecurityEvent(eventType, details = '') {
    const securityLog = JSON.parse(localStorage.getItem('adminSecurityLog') || '[]');
    const sessionData = JSON.parse(localStorage.getItem('adminSession') || '{}');
    
    securityLog.push({
        timestamp: new Date().toISOString(),
        event: eventType,
        admin: sessionData.email || 'unknown',
        userAgent: navigator.userAgent,
        details: details
    });
    
    // احتفظ بآخر 100 حدث فقط
    if (securityLog.length > 100) {
        securityLog.shift();
    }
    
    localStorage.setItem('adminSecurityLog', JSON.stringify(securityLog));
}

let adminAppAssistantToggleBusy = false;
/** true إذا الخادم لا يدعم PUT /api/admin/app-settings (نسخة قديمة) — القراءة من /api/app-settings فقط */
let adminAppAssistantSettingsReadOnly = false;
const ADMIN_ASSISTANT_SETTING_CACHE_KEY = 'gostaAdminAssistantSettingCacheV1';

function readAssistantSettingFromLocalCache() {
    try {
        const raw = localStorage.getItem(ADMIN_ASSISTANT_SETTING_CACHE_KEY);
        if (!raw) return null;
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.assistantEnabledForApp === 'boolean') {
            return parsed;
        }
    } catch (e) {
        console.warn('readAssistantSettingFromLocalCache:', e);
    }
    return null;
}

function saveAssistantSettingToLocalCache(data) {
    try {
        localStorage.setItem(
            ADMIN_ASSISTANT_SETTING_CACHE_KEY,
            JSON.stringify({
                assistantEnabledForApp: !!data.assistantEnabledForApp,
                updatedAt: data.updatedAt || null
            })
        );
    } catch (e) {
        console.warn('saveAssistantSettingToLocalCache:', e);
    }
}

async function waitForAuthServerReadyAdmin() {
    await waitForAuthDiscoveryAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        return false;
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        try {
            const r = await fetch(AUTH.apiBase + '/api/ping', { cache: 'no-store' });
            if (r.ok) {
                const j = await r.json().catch(function () {
                    return null;
                });
                if (j && j.ok) {
                    return true;
                }
            }
        } catch (ePing) {
            console.warn('waitForAuthServerReadyAdmin ping:', ePing);
        }
        await new Promise(function (resolve) {
            setTimeout(resolve, 350);
        });
    }
    return false;
}

async function fetchAppAssistantSettingsPayload() {
    const serverUp = await waitForAuthServerReadyAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        const cached = readAssistantSettingFromLocalCache();
        if (cached) {
            return { ok: true, data: cached, readOnly: true, fromCache: true };
        }
        return { error: 'no_api', message: 'تعذّر الاتصال بالخادم' };
    }
    const adminHeaders = AUTH.adminKey ? { 'x-admin-key': AUTH.adminKey } : {};
    const urls = [
        AUTH.apiBase + '/api/admin/app-settings',
        AUTH.apiBase + '/api/app-settings'
    ];

    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            let r = await fetch(urls[0], {
                headers: adminHeaders,
                cache: 'no-store'
            });
            let readOnly = false;
            if (r.status === 404) {
                r = await fetch(urls[1], { cache: 'no-store' });
                readOnly = true;
            }
            if (r.status === 401) {
                return {
                    error: 'auth',
                    message: 'مفتاح المدير مرفوض — تأكد أن x-admin-key يطابق ADMIN_API_KEY في .env'
                };
            }
            if (!r.ok) {
                if (attempt < 2) {
                    await new Promise(function (resolve) {
                        setTimeout(resolve, 400);
                    });
                    continue;
                }
                return {
                    error: 'http',
                    status: r.status,
                    message: 'تعذّر تحميل الإعداد (HTTP ' + r.status + ')'
                };
            }
            const j = await r.json();
            saveAssistantSettingToLocalCache(j);
            return { ok: true, data: j, readOnly: readOnly };
        } catch (e) {
            if (attempt < 2) {
                await new Promise(function (resolve) {
                    setTimeout(resolve, 400);
                });
                continue;
            }
            const cached = readAssistantSettingFromLocalCache();
            if (cached) {
                return {
                    ok: true,
                    data: cached,
                    readOnly: true,
                    fromCache: true,
                    detail: e && e.message ? e.message : ''
                };
            }
            if (!serverUp) {
                return {
                    error: 'network',
                    message: 'الخادم غير متصل — شغّل npm run auth-server ثم حدّث الصفحة',
                    detail: e && e.message ? e.message : ''
                };
            }
            return {
                error: 'network',
                message: 'تعذّر الاتصال بالخادم لتحميل الإعداد',
                detail: e && e.message ? e.message : ''
            };
        }
    }

    const cached = readAssistantSettingFromLocalCache();
    if (cached) {
        return { ok: true, data: cached, readOnly: true, fromCache: true };
    }
    return { error: 'network', message: 'تعذّر تحميل الإعداد' };
}

function setAdminAppAssistantSettingsStatus(text, isError) {
    const el = document.getElementById('adminAppAssistantSettingsStatus');
    if (!el) return;
    el.textContent = text || '';
    el.style.color = isError ? '#c62828' : '#5f6f8c';
}

function syncAdminAppAssistantToggleUi(enabled) {
    const toggle = document.getElementById('adminAppAssistantEnabledToggle');
    const label = document.getElementById('adminAppAssistantEnabledLabel');
    if (toggle) toggle.checked = !!enabled;
    if (label) {
        label.textContent = enabled ? 'مفعّل للتطبيق' : 'معطّل للتطبيق';
    }
}

async function loadAdminAppAssistantSettings() {
    const result = await fetchAppAssistantSettingsPayload();
    const toggle = document.getElementById('adminAppAssistantEnabledToggle');
    if (!result.ok) {
        adminAppAssistantSettingsReadOnly = true;
        if (toggle) toggle.disabled = true;
        const msg =
            result.message +
            (result.detail ? ' (' + result.detail + ')' : '');
        setAdminAppAssistantSettingsStatus(msg, true);
        return;
    }
    adminAppAssistantSettingsReadOnly = !!result.readOnly;
    if (toggle) toggle.disabled = false;
    const j = result.data || {};
    syncAdminAppAssistantToggleUi(!!j.assistantEnabledForApp);
    let status = j.updatedAt ? 'آخر تحديث: ' + new Date(j.updatedAt).toLocaleString('ar-SA') : 'تم التحميل';
    if (result.readOnly) {
        status += ' — للحفظ أعد تشغيل auth-server من المشروع المحدّث';
    }
    if (result.fromCache) {
        status += ' (من الكاش المحلي';
        if (result.detail) {
            status += ' — ' + result.detail;
        }
        status += ')';
    }
    setAdminAppAssistantSettingsStatus(status, false);
}

async function saveAdminAppAssistantSettings(enabled) {
    if (adminAppAssistantSettingsReadOnly) {
        setAdminAppAssistantSettingsStatus(
            'لا يمكن الحفظ — أوقف auth-server القديم وشغّل npm run auth-server من مجلد المشروع المحدّث',
            true
        );
        return false;
    }
    await waitForAuthDiscoveryAdmin();
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        setAdminAppAssistantSettingsStatus('تعذّر الاتصال بالخادم', true);
        return false;
    }
    adminAppAssistantToggleBusy = true;
    setAdminAppAssistantSettingsStatus('جاري الحفظ…');
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/app-settings`, {
            method: 'PUT',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-key': AUTH.adminKey
            },
            body: JSON.stringify({ assistantEnabledForApp: !!enabled })
        });
        if (r.status === 404) {
            adminAppAssistantSettingsReadOnly = true;
            setAdminAppAssistantSettingsStatus(
                'مسار الحفظ غير موجود — أعد تشغيل auth-server (npm run auth-server)',
                true
            );
            return false;
        }
        const j = await r.json().catch(function () {
            return {};
        });
        if (!r.ok) {
            setAdminAppAssistantSettingsStatus(
                (j && j.message) || 'فشل الحفظ (HTTP ' + r.status + ')',
                true
            );
            return false;
        }
        syncAdminAppAssistantToggleUi(!!j.assistantEnabledForApp);
        saveAssistantSettingToLocalCache(j);
        setAdminAppAssistantSettingsStatus(
            'تم الحفظ — ' +
                (j.assistantEnabledForApp ? 'المساعد ظاهر في التطبيق' : 'المساعد مخفي في التطبيق')
        );
        logActivity(
            'APP_ASSISTANT_TOGGLE',
            j.assistantEnabledForApp ? 'تفعيل المساعد للتطبيق' : 'تعطيل المساعد للتطبيق'
        );
        return true;
    } catch (e) {
        console.warn('saveAdminAppAssistantSettings:', e);
        setAdminAppAssistantSettingsStatus('تعذّر الحفظ', true);
        return false;
    } finally {
        adminAppAssistantToggleBusy = false;
    }
}

function closeAdminAiDrawer() {
    const drawer = document.getElementById('adminAiDrawer');
    if (!drawer) return;
    drawer.classList.remove('admin-ai-drawer--open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.classList.remove('admin-ai-drawer-open');
}

function openAdminAiDrawer() {
    const drawer = document.getElementById('adminAiDrawer');
    const iframe = document.getElementById('adminAiChatIframe');
    if (!drawer) return;
    if (iframe && (!iframe.src || iframe.src === 'about:blank')) {
        iframe.src = 'admin-ai-chat.html';
    }
    drawer.classList.add('admin-ai-drawer--open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.classList.add('admin-ai-drawer-open');
}

function wireGostaAdminAiFab() {
    const fab = document.getElementById('gostaAdminAiFabBtn');
    if (!fab || fab.dataset.bound === '1') return;
    fab.dataset.bound = '1';
    fab.style.display = 'flex';
    fab.addEventListener('click', function () {
        const drawer = document.getElementById('adminAiDrawer');
        if (drawer && drawer.classList.contains('admin-ai-drawer--open')) {
            closeAdminAiDrawer();
        } else {
            openAdminAiDrawer();
        }
    });
}

function wireAdminAppAssistantToggle() {
    const toggle = document.getElementById('adminAppAssistantEnabledToggle');
    if (!toggle || toggle.dataset.bound === '1') return;
    toggle.dataset.bound = '1';
    toggle.addEventListener('change', async function () {
        if (adminAppAssistantToggleBusy) return;
        const want = !!toggle.checked;
        const ok = await saveAdminAppAssistantSettings(want);
        if (!ok) {
            syncAdminAppAssistantToggleUi(!want);
            toggle.checked = !want;
        }
    });
}

// تهيئة الصفحة
document.addEventListener('DOMContentLoaded', function() {
    // التحقق من وجود جلسة
    checkAdminSession();
    
    // تسجيل دخول المالك
    logActivity('ADMIN_LOGIN', 'دخول لوحة التحكم');

    wireGostaAdminAiFab();
    wireAdminAppAssistantToggle();
    const cachedAssistantBootstrap = readAssistantSettingFromLocalCache();
    if (cachedAssistantBootstrap) {
        syncAdminAppAssistantToggleUi(!!cachedAssistantBootstrap.assistantEnabledForApp);
    }

    // عرض فوري من الكاش المحلي قبل أي طلبات شبكة لتجنّب وميض 0 بعد تحديث الصفحة.
    updateDashboard();
    loadSubscriptions();
    loadElectronicPayments();
    loadUsers();

    (async function initAdminData() {
        await refreshServerRegistrations();
        await refreshServerSubscriptionLogs();
        await refreshServerUserUsageSummaries();
        await refreshServerSupportTickets();
        refreshAllAdminTabs();
        await loadAdminAppAssistantSettings();
    })();

    if (window.PR_SAFE_AUTH_DISCOVERY && typeof window.PR_SAFE_AUTH_DISCOVERY.then === 'function') {
        window.PR_SAFE_AUTH_DISCOVERY.then(function () {
            loadAdminAppAssistantSettings();
        });
    }

    window.addEventListener('storage', function (e) {
        if (
            !e.key ||
            (e.key.indexOf(SUBSCRIPTION_LOGS_KEY) !== 0 &&
                e.key.indexOf('userSubscription_INDEX2') !== 0)
        )
            return;
        refreshAdminDataFromLocalStorage();
        const payTab = document.getElementById('electronicPaymentsTab');
        const subTab = document.getElementById('subscriptionsTab');
        if (payTab && payTab.classList.contains('active')) {
            loadElectronicPayments();
        }
        if (subTab && subTab.classList.contains('active')) {
            loadSubscriptions();
        }
        if (document.getElementById('dashboardTab') && document.getElementById('dashboardTab').classList.contains('active')) {
            updateDashboard();
        }
    });
    
    // مراقبة التغييرات المريبة
    setupSecurityMonitoring();
});

// 🔒 التحقق الصارم من جلسة المالك
function checkAdminSession() {
    const adminSession = localStorage.getItem('adminSession');
    
    // 1️⃣ فحص وجود الجلسة
    if (!adminSession) {
        logSecurityEvent('unauthorized_dashboard_access_attempt', 'لا توجد جلسة');
        window.location.href = 'admin-login.html';
        return;
    }
    
    try {
        const sessionData = JSON.parse(adminSession);
        
        // 2️⃣ فحص البريد الإلكتروني (يجب أن يكون البريد المشروع فقط)
        const authorizedEmail = '0000000000000000000000001ad8ffb1'; // Hash البريد الصحيح
        const sessionEmailHash = hashStringBasic(sessionData.email);
        
        if (sessionEmailHash !== authorizedEmail) {
            logSecurityEvent('unauthorized_session_detected', `بريد غير مشروع: ${sessionData.email}`);
            localStorage.removeItem('adminSession');
            window.location.href = 'admin-login.html';
            return;
        }
        
        // 3️⃣ فحص زمن الجلسة
        const loginTime = new Date(sessionData.loginTime);
        const now = new Date();
        const sessionDuration = now - loginTime;
        
        // فحص مدة الجلسة (24 ساعة)
        const maxSessionDuration = 24 * 60 * 60 * 1000;
        if (sessionDuration > maxSessionDuration) {
            logSecurityEvent('session_timeout', 'انتهت مدة الجلسة');
            securityAlert('انتهت مدة الجلسة - تسجيل خروج تلقائي');
            logActivity('SESSION_EXPIRED', 'انتهت مدة جلسة المالك');
            localStorage.removeItem('adminSession');
            window.location.href = 'admin-login.html';
            return;
        }
        
        // إذا لم تكن هناك مشاكل، يمكن تحديث اسم المالك
        const adminNameElement = document.querySelector('.admin-name');
        if (adminNameElement) {
            adminNameElement.textContent = sessionData.email.split('@')[0];
        }
        
        logActivity('SESSION_VALIDATED', `جلسة صحيحة - المدة: ${Math.round(sessionDuration/1000)}s`);
    } catch (e) {
        // جلسة غير صحيحة
        securityAlert('محاولة وصول غير صحيحة - جلسة معطوبة');
        logActivity('INVALID_SESSION', `خطأ في الجلسة: ${e.message}`, LOG_LEVELS.ERROR);
        localStorage.removeItem('adminSession');
        window.location.href = 'admin-login.html';
    }
}

// إعداد مراقبة الأمان
function setupSecurityMonitoring() {
    // مراقبة تعديلات localStorage
    window.addEventListener('storage', function(e) {
        if (e.key === 'adminSession' && e.newValue === null) {
            securityAlert('تم حذف الجلسة من نافذة أخرى');
        }
    });
    
    // مراقبة الخروج من الصفحة
    window.addEventListener('beforeunload', function(e) {
        logActivity('PAGE_UNLOAD', 'محاولة مغادرة الصفحة');
    });
    
    // مراقبة الكلك الأيمن (منع النسخ)
    document.addEventListener('contextmenu', function(e) {
        // يمكن تفعيل هذا إذا أردنا منع النسخ
        // e.preventDefault();
        // securityAlert('محاولة نسخ بيانات حساسة');
    });
}

// تبديل التابز
function switchTab(tabName) {
    // إخفاء جميع التابز
    document.querySelectorAll('.tab-content').forEach(tab => {
        tab.classList.remove('active');
    });

    // تحويل اسم الـ tab إلى camelCase
    let tabId = tabName;
    if (tabName === 'electronic-payments') {
        tabId = 'electronicPayments';
    } else if (tabName === 'server-monitor') {
        tabId = 'serverMonitor';
    }

    // إظهار التاب المختار
    const tabElement = document.getElementById(tabId + 'Tab');
    if (tabElement) {
        tabElement.classList.add('active');
    } else {
        console.warn('❌ التاب لم يُعثر عليه:', tabId + 'Tab');
        return;
    }

    // تحديث اسم الصفحة
    const titles = {
        'dashboard': 'لوحة البيانات',
        'subscriptions': 'الاشتراكات',
        'electronic-payments': 'الدفع الإلكتروني',
        'users': 'المستخدمين',
        'support': 'الدعم الفني',
        'server-monitor': 'مراقبة الخادم'
    };

    document.getElementById('pageTitle').textContent = titles[tabName] || 'لوحة البيانات';

    const subEl = document.getElementById('pageSubtitle');
    if (subEl) {
        if (tabName === 'server-monitor') {
            subEl.textContent =
                'قراءة لحظية عند ضغطك «تحديث اللقطة» فقط — دون طلب دوري ولا تأثير على مستخدمي التطبيق.';
        } else {
            subEl.textContent = 'مرحباً بك في لوحة التحكم الإدارية';
        }
    }

    // تحديث القائمة الجانبية
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
    });
    if (event && event.currentTarget) {
        event.currentTarget.classList.add('active');
    }

    refreshAdminDataFromLocalStorage();

    if (tabName === 'dashboard') {
        updateDashboard();
    } else if (tabName === 'subscriptions') {
        loadSubscriptions();
    } else if (tabName === 'electronic-payments') {
        loadElectronicPayments();
    } else if (tabName === 'users') {
        loadUsers();
    } else if (tabName === 'support') {
        loadSupportTickets();
    } else if (tabName === 'server-monitor') {
        /* مراقبة الخادم: لا جلب تلقائي؛ المالك يضغط «تحديث اللقطة». */
    }
}

// تحديث لوحة البيانات
function updateDashboard() {
    refreshAdminDataFromLocalStorage();

    const regCount = Array.isArray(serverRegistrationsCache) ? serverRegistrationsCache.length : 0;
    const totalUsers = Math.max(adminData.users.length, regCount);
    const freeUsers = adminData.subscriptions.filter(function (s) {
        return String(s.plan || '').toLowerCase() === 'free';
    }).length;
    const paidUsers = adminData.subscriptions.filter(function (s) {
        const p = String(s.plan || '').toLowerCase();
        return p && p !== 'free';
    }).length;
    const totalRevenue = adminData.electronicPayments
        .filter(p => p.status === 'completed')
        .reduce((sum, p) => sum + parseFloat(p.amount), 0);

    try {
        if (totalUsers > 0) {
            localStorage.setItem(LAST_TOTAL_USERS_KEY, String(totalUsers));
        }
    } catch (e) {
        console.warn('total users cache:', e);
    }

    document.getElementById('totalUsers').textContent = totalUsers;
    document.getElementById('freeUsers').textContent = freeUsers;
    document.getElementById('paidUsers').textContent = paidUsers;
    document.getElementById('totalRevenue').textContent = totalRevenue + ' ريال';

    // تحديث النشاطات الأخيرة
    updateActivityList();
}

// تحديث قائمة النشاطات
function updateActivityList() {
    const activityList = document.getElementById('activityList');
    activityList.innerHTML = '';

    // إضافة نشاطات من البيانات
    const recentActivities = [
        ...adminData.subscriptions.slice(-3).map(s => ({
            icon: '📝',
            text: `اشتراك جديد من ${s.email}`,
            time: s.date
        })),
        ...adminData.electronicPayments.slice(-2).map(p => ({
            icon: '✅',
            text: `دفع إلكتروني من ${p.email} - ${p.amount} ريال`,
            time: p.date
        }))
    ];

    recentActivities.forEach(activity => {
        const activityEl = document.createElement('div');
        activityEl.className = 'activity-item';
        activityEl.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span class="activity-icon">${activity.icon}</span>
                <div class="activity-text">${activity.text}</div>
            </div>
            <span class="activity-time">${activity.time}</span>
        `;
        activityList.appendChild(activityEl);
    });
}

// تحميل الاشتراكات
async function loadSubscriptions() {
    const table = document.getElementById('subscriptionsTable');
    if (!table) return;
    table.innerHTML =
        '<tr><td colspan="7" style="text-align:center;padding:24px;">جاري التحميل…</td></tr>';

    await refreshServerUserUsageSummaries();

    table.innerHTML = '';

    let list = adminData.subscriptions.slice();
    if (currentFilter && currentFilter !== 'all') {
        const wanted = String(currentFilter).toUpperCase();
        list = list.filter((sub) => String(sub.plan || '').toUpperCase() === wanted);
    }

    if (list.length === 0) {
        table.innerHTML =
            '<tr><td colspan="7" style="text-align:center;padding:24px;">لا توجد اشتراكات في هذا الفلتر.</td></tr>';
        return;
    }

    list.forEach(sub => {
        const row = document.createElement('tr');
        const planNames = {
            'free': 'مجاني تجريبي',
            'INDEX3': 'الخطة الأساسية',
            'INDEX4': 'الخطة المتقدمة',
            'INDEX5': 'الخطة المميزة السحابية'
        };
        const usage = usageSummaryForEmail(sub.email);

        row.innerHTML = `
            <td>${escapeHtmlAttr(sub.email)}</td>
            <td>${escapeHtmlAttr(planNames[sub.plan] || sub.plan)}</td>
            <td>${escapeHtmlAttr(sub.date)}</td>
            <td>${escapeHtmlAttr(formatStorageUsageLabel(usage))}</td>
            <td>${formatDaysRemainingHtml(usage)}</td>
            <td><span class="status-badge status-${subscriptionStatusClass(sub)}">${escapeHtmlAttr(subscriptionStatusLabel(sub))}</span></td>
            <td>
                <div class="action-buttons">
                    <button class="btn-action btn-view" data-sub-id="${escapeHtmlAttr(String(sub.id))}">عرض</button>
                </div>
            </td>
        `;
        const viewBtn = row.querySelector('.btn-view');
        if (viewBtn) {
            viewBtn.addEventListener('click', function () {
                viewSubscriptionDetails(sub.id);
            });
        }
        table.appendChild(row);
    });
}

// تحميل الدفعات الإلكترونية
function loadElectronicPayments() {
    const table = document.getElementById('paymentsTable');
    if (!table) return;
    table.innerHTML = '';

    let list = adminData.electronicPayments.slice();
    if (currentPaymentFilter === 'pending') {
        list = list.filter((p) => p.status === 'pending');
    } else if (currentPaymentFilter === 'completed') {
        list = list.filter((p) => p.status === 'completed');
    } else if (currentPaymentFilter === 'rejected') {
        list = list.filter((p) => p.status === 'rejected');
    }

    if (list.length === 0) {
        table.innerHTML =
            '<tr><td colspan="7" style="text-align:center;padding:24px;">لا توجد دفعات في هذا الفلتر. بعد إتمام الدفع من التطبيق تظهر هنا تلقائياً.</td></tr>';
        return;
    }

    const statusText = {
        pending: 'قيد الانتظار',
        completed: 'مدفوع',
        rejected: 'مرفوض'
    };

    list.forEach((payment) => {
        const row = document.createElement('tr');
        const label = statusText[payment.status] || payment.status;
        const safeId = String(payment.id).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        row.innerHTML = `
            <td>${escapeHtmlAttr(payment.id)}</td>
            <td>${escapeHtmlAttr(payment.email)}</td>
            <td>${escapeHtmlAttr(payment.cardType)}</td>
            <td>${escapeHtmlAttr(payment.amount)} ريال</td>
            <td>${escapeHtmlAttr(payment.date)}</td>
            <td><span class="status-badge status-${payment.status}">${label}</span></td>
            <td>
                <div class="action-buttons">
                    <button type="button" class="btn-action btn-view" onclick="viewPaymentDetails('${safeId}')">عرض</button>
                </div>
            </td>
        `;
        table.appendChild(row);
    });
}

// تحميل المستخدمين (من خادم التحقق + بيانات تجريبية احتياطية)
async function loadUsers() {
    await waitForAuthDiscoveryAdmin();
    const table = document.getElementById('usersTable');
    if (!table) return;
    table.innerHTML =
        '<tr><td colspan="8" style="text-align:center;padding:24px;">جاري التحميل…</td></tr>';

    hydrateServerRegistrationsCacheFromStorage();

    const AUTH = window.PR_SAFE_AUTH || {};
    let rows = [];

    if (AUTH.apiBase && AUTH.adminKey) {
        try {
            const r = await fetch(`${AUTH.apiBase}/api/admin/registrations`, {
                headers: { 'x-admin-key': AUTH.adminKey }
            });
            if (r.ok) {
                const payload = await r.json();
                rows = Array.isArray(payload) ? payload : [];
                serverRegistrationsCache = rows.slice();
                try {
                    localStorage.setItem(SERVER_REGISTRATIONS_CACHE_KEY, JSON.stringify(rows));
                } catch (eSave) {
                    console.warn('loadUsers cache save:', eSave);
                }
                refreshAdminDataFromLocalStorage();
            }
            await refreshServerUserUsageSummaries();
        } catch (e) {
            console.warn('loadUsers:', e);
        }
    }

    if (!rows.length) {
        rows = Array.isArray(serverRegistrationsCache) ? serverRegistrationsCache.slice() : [];
    }
    if (!rows.length) {
        refreshAdminDataFromLocalStorage();
        rows = adminData.users.map(function (u) {
            return {
                email: u.email,
                verified: String(u.status || '').toLowerCase() !== 'pending',
                createdAt: u.created,
                legacy: true
            };
        });
    }

    if (!rows.length) {
        table.innerHTML =
            '<tr><td colspan="8" style="text-align:center;padding:24px;">لا تسجيلات بعد على خادم التحقق. شغّل <code>npm run auth-server</code> ثم سجّل مستخدماً من التطبيق، أو اضغط «مزامنة فورية».</td></tr>';
        return;
    }

    let list = rows.slice();
    if (currentUserListFilter === 'active') {
        list = list.filter((r) => r.verified);
    }
    if (currentUserListFilter === 'inactive') {
        list = list.filter((r) => !r.verified);
    }

    if (list.length === 0) {
        table.innerHTML =
            '<tr><td colspan="8" style="text-align:center;padding:24px;">لا مستخدمين ضمن الفلتر الحالي.</td></tr>';
        return;
    }

    table.innerHTML = '';
    const planNames = {
        free: 'مجاني تجريبي',
        INDEX3: 'الخطة الأساسية',
        INDEX4: 'الخطة المتقدمة',
        INDEX5: 'الخطة المميزة السحابية',
        '—': '—'
    };

    list.forEach(function (reg) {
        const email = String(reg.email || '').trim();
        if (!email) return;
        const plan = planForEmail(email);
        const lastLogin = lastLoginForEmail(email);
        const created = reg.createdAt
            ? reg.legacy
                ? reg.createdAt
                : new Date(reg.createdAt).toLocaleString('ar-EG')
            : '—';
        const statusBadge = reg.verified
            ? '<span class="status-badge status-active">نشط</span>'
            : '<span class="status-badge status-pending">بانتظار التفعيل</span>';
        const usage = usageSummaryForEmail(email);
        const showManual =
            !reg.verified && window.PR_SAFE_AUTH && window.PR_SAFE_AUTH.enableManualEmailFallback !== false;
        const manualBtn = showManual
            ? '<button type="button" class="btn-action btn-view btn-manual-email">📧 إرسال يدوي</button>'
            : '';

        const row = document.createElement('tr');
        row.innerHTML =
            '<td>' +
            escapeHtmlAttr(email) +
            '</td><td>' +
            escapeHtmlAttr(planNames[plan] || plan) +
            '</td><td>' +
            escapeHtmlAttr(formatStorageUsageLabel(usage)) +
            '</td><td>' +
            formatDaysRemainingHtml(usage) +
            '</td><td>' +
            escapeHtmlAttr(created) +
            '</td><td>' +
            escapeHtmlAttr(lastLogin) +
            '</td><td>' +
            statusBadge +
            '</td><td><div class="action-buttons">' +
            '<button type="button" class="btn-action btn-view">عرض</button> ' +
            manualBtn +
            '</div></td>';

        const viewBtn = row.querySelector('.btn-view:not(.btn-manual-email)');
        if (viewBtn) {
            viewBtn.addEventListener('click', function () {
                viewUserDetails(email);
            });
        }
        const manualEl = row.querySelector('.btn-manual-email');
        if (manualEl) {
            manualEl.addEventListener('click', function () {
                openManualActivationEmail(email);
            });
        }
        table.appendChild(row);
    });
}

function supportStatusLabel(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'resolved') return 'تم الحل';
    if (s === 'in_progress') return 'قيد المعالجة';
    return 'جديدة';
}

function supportStatusBadgeClass(status) {
    const s = String(status || '').toLowerCase();
    if (s === 'resolved') return 'status-active';
    if (s === 'in_progress') return 'status-pending';
    return 'status-rejected';
}

function supportReplyTemplateByStatus(status, ticket) {
    const id = String(ticket?.id || '').trim();
    const subject = String(ticket?.subject || '').trim();
    const prefix = id ? `رقم التذكرة: ${id}\n` : '';
    if (status === 'in_progress') {
        return (
            'مرحباً،\n\n' +
            prefix +
            (subject ? `تم استلام طلبك بخصوص: ${subject}\n` : '') +
            'تذكرتك الآن قيد المعالجة من فريق الدعم الفني.\n' +
            'سنوافيك بالتحديثات قريباً.\n\n' +
            'شكراً لتواصلك معنا.'
        );
    }
    if (status === 'resolved') {
        return (
            'مرحباً،\n\n' +
            prefix +
            (subject ? `بالنسبة لطلبك: ${subject}\n` : '') +
            'تم تنفيذ المعالجة وإغلاق التذكرة كـ "تم الحل".\n' +
            'إذا استمرت المشكلة يمكنك الرد على هذه الرسالة لإعادة فتح التذكرة.\n\n' +
            'شكراً لك.'
        );
    }
    if (status === 'open') {
        return (
            'مرحباً،\n\n' +
            prefix +
            'تم إعادة فتح التذكرة بناءً على طلبك.\n' +
            'سيقوم فريق الدعم بمتابعة الحالة مرة أخرى.\n\n' +
            'مع التحية.'
        );
    }
    return '';
}

function applySupportStatusTemplate(ticketId, status) {
    const t = (serverSupportTicketsCache || []).find((x) => String(x.id || '') === String(ticketId || ''));
    const input = document.getElementById('supportReplyInput');
    if (!t || !input) return;
    let template = supportReplyTemplateByStatus(status, t);
    template = String(template || '')
        .replace(/\r\n/g, '\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    // إزالة أي سطر مكرر متتالي لضمان نص نظيف.
    const lines = template.split('\n');
    const compact = [];
    for (let i = 0; i < lines.length; i++) {
        const current = lines[i];
        const prev = compact.length ? compact[compact.length - 1] : null;
        if (prev === current && current.trim() !== '') continue;
        compact.push(current);
    }
    template = compact.join('\n');
    if (template) {
        input.value = template;
    }
    input.dataset.nextStatus = String(status || 'open').toLowerCase();
}

function loadSupportTickets() {
    const table = document.getElementById('supportTicketsTable');
    if (!table) return;
    table.innerHTML = '';

    let list = Array.isArray(serverSupportTicketsCache) ? serverSupportTicketsCache.slice() : [];
    list.sort((a, b) => new Date(b.updatedAt || b.createdAt || 0).getTime() - new Date(a.updatedAt || a.createdAt || 0).getTime());
    if (currentSupportFilter !== 'all') {
        list = list.filter((t) => String(t.status || 'open').toLowerCase() === currentSupportFilter);
    }

    if (list.length === 0) {
        table.innerHTML = '<tr><td colspan="8" style="text-align:center;padding:24px;">لا توجد تذاكر دعم في هذا الفلتر.</td></tr>';
        return;
    }

    list.forEach((ticket) => {
        const id = escapeHtmlAttr(ticket.id || '—');
        const email = escapeHtmlAttr(ticket.email || '—');
        const plan = escapeHtmlAttr(ticket.planName || ticket.planCode || 'غير محدد');
        const subject = escapeHtmlAttr(ticket.subject || '—');
        const status = String(ticket.status || 'open').toLowerCase();
        const attCount = Array.isArray(ticket.attachments) ? ticket.attachments.length : 0;
        const createdAt = ticket.createdAt ? new Date(ticket.createdAt).toLocaleString('ar-EG') : '—';
        const safeId = String(ticket.id || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>${id}</td>
            <td>${email}</td>
            <td>${plan}</td>
            <td>${subject}</td>
            <td><span class="status-badge ${supportStatusBadgeClass(status)}">${supportStatusLabel(status)}</span></td>
            <td>${attCount}</td>
            <td>${escapeHtmlAttr(createdAt)}</td>
            <td>
                <div class="action-buttons">
                    <button type="button" class="btn-action btn-view" onclick="viewSupportTicket('${safeId}')">عرض</button>
                </div>
            </td>
        `;
        table.appendChild(row);
    });
}

async function updateSupportTicketStatus(ticketId, status) {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        alert('⚠️ تعذر الاتصال بخادم الإدارة');
        return;
    }
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/support-tickets/${encodeURIComponent(ticketId)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-key': AUTH.adminKey
            },
            body: JSON.stringify({ status })
        });
        if (!r.ok) {
            alert('❌ تعذر تحديث حالة التذكرة');
            return;
        }
        await refreshServerSupportTickets();
        loadSupportTickets();
        alert('✅ تم تحديث الحالة');
    } catch (e) {
        console.error('updateSupportTicketStatus:', e);
        alert('❌ خطأ أثناء تحديث الحالة');
    }
}

async function saveSupportTicketReply(ticketId) {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        alert('⚠️ تعذر الاتصال بخادم الإدارة');
        return;
    }
    const input = document.getElementById('supportReplyInput');
    const reply = String(input?.value || '').trim();
    if (!reply) {
        alert('⚠️ اكتب الرد أولاً');
        return;
    }
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/support-tickets/${encodeURIComponent(ticketId)}`, {
            method: 'PATCH',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-key': AUTH.adminKey
            },
            body: JSON.stringify({ reply, status: 'in_progress' })
        });
        if (!r.ok) {
            alert('❌ تعذر حفظ الرد');
            return;
        }
        await refreshServerSupportTickets();
        loadSupportTickets();
        alert('✅ تم حفظ الرد');
    } catch (e) {
        console.error('saveSupportTicketReply:', e);
        alert('❌ خطأ أثناء حفظ الرد');
    }
}

async function sendSupportReplyEmail(ticketId) {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase || !AUTH.adminKey) {
        alert('⚠️ تعذر الاتصال بخادم الإدارة');
        return;
    }
    const input = document.getElementById('supportReplyInput');
    const reply = String(input?.value || '').trim();
    const nextStatus = String(input?.dataset?.nextStatus || '').toLowerCase();
    if (!reply) {
        alert('⚠️ اكتب الرد أولاً');
        return;
    }
    try {
        const r = await fetch(`${AUTH.apiBase}/api/admin/support-tickets/${encodeURIComponent(ticketId)}/send-reply`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-admin-key': AUTH.adminKey
            },
            body: JSON.stringify({
                reply,
                status: ['open', 'in_progress', 'resolved'].includes(nextStatus) ? nextStatus : undefined
            })
        });
        const data = await r.json().catch(() => ({}));
        if (!r.ok || !data.ok) {
            alert('❌ تعذر إرسال الرد بالبريد: ' + (data.error || r.status));
            return;
        }
        await refreshServerSupportTickets();
        loadSupportTickets();
        closeModal();
        alert('✅ تم إرسال الرد للبريد مع الحفاظ على الحالة الحالية');
    } catch (e) {
        console.error('sendSupportReplyEmail:', e);
        alert('❌ خطأ أثناء إرسال الرد');
    }
}

function viewSupportTicket(ticketId) {
    const t = (serverSupportTicketsCache || []).find((x) => String(x.id || '') === String(ticketId || ''));
    if (!t) {
        alert('❌ لم يتم العثور على التذكرة');
        return;
    }
    const modal = document.getElementById('detailsModal');
    const attachments = Array.isArray(t.attachments) ? t.attachments : [];
    const attachmentsHtml = attachments.length
        ? attachments
              .map((a, idx) => {
                  const href = escapeHtmlAttr(a.dataUrl || '#');
                  const name = escapeHtmlAttr(a.name || ('attachment-' + (idx + 1)));
                  return `<li><a href="${href}" download="${name}" target="_blank" rel="noopener">${name}</a></li>`;
              })
              .join('')
        : '<li>لا يوجد مرفقات</li>';
    document.getElementById('modalTitle').textContent = 'تفاصيل تذكرة الدعم';
    document.getElementById('modalBody').innerHTML = `
        <p><strong>رقم التذكرة:</strong> ${escapeHtmlAttr(t.id || '—')}</p>
        <p><strong>البريد الإلكتروني:</strong> ${escapeHtmlAttr(t.email || '—')}</p>
        <p><strong>العنوان:</strong> ${escapeHtmlAttr(t.subject || '—')}</p>
        <p><strong>الحالة:</strong> ${supportStatusLabel(t.status)}</p>
        <p><strong>تاريخ الإنشاء:</strong> ${escapeHtmlAttr(t.createdAt ? new Date(t.createdAt).toLocaleString('ar-EG') : '—')}</p>
        <p><strong>التفاصيل:</strong><br>${escapeHtmlAttr(t.message || '—').replace(/\n/g, '<br>')}</p>
        <p><strong>الرد الفني:</strong></p>
        <textarea id="supportReplyInput" data-next-status="${escapeHtmlAttr(String(t.status || 'open').toLowerCase())}" rows="5" style="width:100%;margin-top:6px;">${escapeHtmlAttr(t.reply || '')}</textarea>
        <p><strong>المرفقات:</strong></p>
        <ul>${attachmentsHtml}</ul>
        <div class="action-buttons" style="margin-top:10px;">
            <button type="button" class="btn-action btn-view" onclick="applySupportStatusTemplate('${String(t.id || '').replace(/'/g, "\\'")}', 'in_progress'); updateSupportTicketStatus('${String(t.id || '').replace(/'/g, "\\'")}', 'in_progress')">قيد المعالجة</button>
            <button type="button" class="btn-action btn-view" onclick="applySupportStatusTemplate('${String(t.id || '').replace(/'/g, "\\'")}', 'resolved'); updateSupportTicketStatus('${String(t.id || '').replace(/'/g, "\\'")}', 'resolved')">تم الحل</button>
            <button type="button" class="btn-action btn-view" onclick="applySupportStatusTemplate('${String(t.id || '').replace(/'/g, "\\'")}', 'open'); updateSupportTicketStatus('${String(t.id || '').replace(/'/g, "\\'")}', 'open')">إعادة فتح</button>
            <button type="button" class="btn-action btn-view" onclick="saveSupportTicketReply('${String(t.id || '').replace(/'/g, "\\'")}')">حفظ الرد</button>
            <button type="button" class="btn-action btn-view" onclick="sendSupportReplyEmail('${String(t.id || '').replace(/'/g, "\\'")}')">إرسال الرد للبريد</button>
        </div>
    `;
    modal.style.display = 'flex';
}

// تفعيل الاشتراك
function activateSubscription(email) {
    selectedData = { email: email };
    document.getElementById('activateUserInfo').textContent = `البريد: ${email}`;
    document.getElementById('activateModal').style.display = 'flex';
    
    logActivity('SUBSCRIPTION_ACTIVATION_ATTEMPT', `محاولة تفعيل الاشتراك للبريد: ${email}`);
}

// تأكيد التفعيل
function confirmActivate() {
    if (selectedData) {
        const subscription = adminData.subscriptions.find(s => s.email === selectedData.email);
        if (subscription) {
            subscription.status = 'active';
            loadSubscriptions();
            
            // تسجيل النشاط
            logActivity('SUBSCRIPTION_ACTIVATED', `تفعيل الاشتراك للبريد: ${selectedData.email}`, LOG_LEVELS.INFO);
            
            alert(`✅ تم تفعيل الاشتراك للمستخدم: ${selectedData.email}`);
        }
    }
    closeModal();
}

// عرض تفاصيل الاشتراك
function viewSubscriptionDetails(id) {
    const sub = adminData.subscriptions.find(s => s.id == id);
    if (sub) {
        const usage = usageSummaryForEmail(sub.email);
        const modal = document.getElementById('detailsModal');
        document.getElementById('modalTitle').textContent = 'تفاصيل الاشتراك';
        const daysLine =
            usage && usage.expired === true
                ? 'منتهي'
                : usage && usage.daysRemaining != null
                  ? usage.daysRemaining + ' يوم'
                  : '—';
        document.getElementById('modalBody').innerHTML = `
            <p><strong>البريد الإلكتروني:</strong> ${escapeHtmlAttr(sub.email)}</p>
            <p><strong>الخطة:</strong> ${escapeHtmlAttr(sub.plan)}</p>
            <p><strong>تاريخ الاشتراك:</strong> ${escapeHtmlAttr(sub.date)}</p>
            <p><strong>المساحة المستخدمة:</strong> ${escapeHtmlAttr(formatStorageUsageLabel(usage))}</p>
            <p><strong>الأيام المتبقية:</strong> ${escapeHtmlAttr(daysLine)}</p>
            <p><strong>تاريخ الانتهاء:</strong> ${escapeHtmlAttr(formatExpiryDateLabel(usage))}</p>
            <p><strong>الحالة:</strong> ${escapeHtmlAttr(subscriptionStatusLabel(sub))}</p>
        `;
        modal.style.display = 'flex';
    }
}

// عرض تفاصيل الدفع
function viewPaymentDetails(id) {
    refreshAdminDataFromLocalStorage();
    const payment = adminData.electronicPayments.find((p) => String(p.id) === String(id));
    if (payment) {
        const modal = document.getElementById('detailsModal');
        document.getElementById('modalTitle').textContent = 'تفاصيل الدفع الإلكتروني';
        const statusLabel =
            payment.status === 'completed' ? 'مدفوع' : payment.status === 'rejected' ? 'مرفوض' : 'قيد الانتظار';
        const exp = payment.expiryDate
            ? new Date(payment.expiryDate).toLocaleString('ar-EG')
            : '—';
        const planLabel = escapeHtmlAttr(payment.planName || payment.planType || '—');
        document.getElementById('modalBody').innerHTML = `
            <p><strong>رقم المعاملة:</strong> ${escapeHtmlAttr(payment.id)}</p>
            <p><strong>البريد الإلكتروني:</strong> ${escapeHtmlAttr(payment.email)}</p>
            <p><strong>الخطة:</strong> ${planLabel}</p>
            <p><strong>نوع الدفع / البطاقة:</strong> ${escapeHtmlAttr(payment.cardType)}</p>
            <p><strong>المبلغ:</strong> ${escapeHtmlAttr(payment.amount)} ريال</p>
            <p><strong>التاريخ:</strong> ${escapeHtmlAttr(payment.date)}</p>
            <p><strong>الحالة:</strong> ${statusLabel}</p>
            <p><strong>انتهاء الاشتراك:</strong> ${escapeHtmlAttr(exp)}</p>
            <p style="margin-top:12px;padding:10px;background:#e8f5e9;border-radius:8px;font-size:0.95rem;">
                تم تفعيل الاشتراك في التطبيق <strong>تلقائياً</strong> بعد اكتمال الدفع — لا حاجة لتفعيل يدوي من اللوحة.
            </p>
        `;
        modal.style.display = 'flex';
    }
}

// عرض تفاصيل المستخدم
function viewUserDetails(email) {
    const modal = document.getElementById('detailsModal');
    const key = String(email || '').trim().toLowerCase();
    const user = adminData.users.find((u) => String(u.email || '').trim().toLowerCase() === key);
    document.getElementById('modalTitle').textContent = 'تفاصيل المستخدم';
    const usage = usageSummaryForEmail(email);
    const daysLine =
        usage && usage.expired === true
            ? 'منتهي'
            : usage && usage.daysRemaining != null
              ? usage.daysRemaining + ' يوم'
              : '—';
    if (user) {
        document.getElementById('modalBody').innerHTML = `
            <p><strong>البريد الإلكتروني:</strong> ${escapeHtmlAttr(user.email)}</p>
            <p><strong>الخطة الحالية:</strong> ${escapeHtmlAttr(user.plan)}</p>
            <p><strong>المساحة المستخدمة:</strong> ${escapeHtmlAttr(formatStorageUsageLabel(usage))}</p>
            <p><strong>الأيام المتبقية:</strong> ${escapeHtmlAttr(daysLine)}</p>
            <p><strong>تاريخ الانتهاء:</strong> ${escapeHtmlAttr(formatExpiryDateLabel(usage))}</p>
            <p><strong>تاريخ الإنشاء:</strong> ${escapeHtmlAttr(user.created)}</p>
            <p><strong>آخر دخول:</strong> ${escapeHtmlAttr(user.lastLogin)}</p>
            <p><strong>الحالة:</strong> ${user.status === 'active' ? 'نشط' : 'غير نشط'}</p>
        `;
    } else {
        document.getElementById('modalBody').innerHTML = `
            <p><strong>البريد الإلكتروني:</strong> ${escapeHtmlAttr(email)}</p>
            <p><strong>المساحة المستخدمة:</strong> ${escapeHtmlAttr(formatStorageUsageLabel(usage))}</p>
            <p><strong>الأيام المتبقية:</strong> ${escapeHtmlAttr(daysLine)}</p>
            <p><strong>تاريخ الانتهاء:</strong> ${escapeHtmlAttr(formatExpiryDateLabel(usage))}</p>
            <p>مسجّل على خادم التحقق. التفاصيل الإضافية تظهر في لوحة «تفعيل البريد» وملف <code>server/data/registrations.json</code>.</p>
        `;
    }
    modal.style.display = 'flex';
}

// إغلاق Modal
function closeModal() {
    document.getElementById('detailsModal').style.display = 'none';
    document.getElementById('activateModal').style.display = 'none';
}

// فلترة البيانات
function filterData() {
    const searchText = document.getElementById('searchInput').value.toLowerCase();
    // يمكن تطبيق الفلترة على جميع الجداول
}

// فلترة الاشتراكات
function filterSubscriptions(filter) {
    currentFilter = filter;
    const subTab = document.getElementById('subscriptionsTab');
    if (subTab) {
        subTab.querySelectorAll('.filter-buttons .filter-btn').forEach((btn) => btn.classList.remove('active'));
        if (typeof event !== 'undefined' && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }
    }
    loadSubscriptions();
}

// فلترة الدفعات
function filterPayments(filter) {
    currentPaymentFilter = filter;
    const tab = document.getElementById('electronicPaymentsTab');
    if (tab) {
        tab.querySelectorAll('.filter-buttons .filter-btn').forEach((btn) => btn.classList.remove('active'));
        if (typeof event !== 'undefined' && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }
    }
    loadElectronicPayments();
}

// فلترة المستخدمين
function filterUsers(filter) {
    currentUserListFilter = filter;
    const usersTab = document.getElementById('usersTab');
    if (usersTab) {
        usersTab.querySelectorAll('.filter-buttons .filter-btn').forEach((btn) => btn.classList.remove('active'));
        if (typeof event !== 'undefined' && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }
    }
    loadUsers();
}

function filterSupportTickets(filter) {
    currentSupportFilter = filter;
    const supportTab = document.getElementById('supportTab');
    if (supportTab) {
        supportTab.querySelectorAll('.filter-buttons .filter-btn').forEach((btn) => btn.classList.remove('active'));
        if (typeof event !== 'undefined' && event.currentTarget) {
            event.currentTarget.classList.add('active');
        }
    }
    loadSupportTickets();
}

// تسجيل الخروج
function logout() {
    if (confirm('هل تريد تسجيل الخروج من لوحة التحكم؟')) {
        const sessionData = JSON.parse(localStorage.getItem('adminSession') || '{}');
        
        // تسجيل الخروج
        logActivity('ADMIN_LOGOUT', `تسجيل خروج المالك: ${sessionData.email}`);
        
        // حذف الجلسة
        localStorage.removeItem('adminSession');
        
        // إعادة التوجيه إلى صفحة تسجيل الدخول
        window.location.href = 'admin-login.html';
    }
}

// تحديث البيانات بشكل دوري (كل 30 ثانية)
setInterval(function() {
    console.log('🔄 تحديث البيانات...');
    refreshServerRegistrations()
        .then(function () {
            return refreshServerSubscriptionLogs();
        })
        .then(function () {
            return refreshServerSupportTickets();
        })
        .finally(function () {
            refreshAllAdminTabs();
            loadSupportTickets();
        });
}, 30000);
