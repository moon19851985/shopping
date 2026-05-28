// ==================== التحقق من الاشتراك ====================

/**
 * سجل اشتراك وهمي من الخادم أثناء التجربة المجانية (INDEX5 + trial) — ليس اشتراكاً مدفوعاً.
 */
function isTrialSubscriptionRecord_INDEX2(sub) {
    if (!sub || typeof sub !== 'object') return false;
    if (String(sub.paymentMethod || '').toLowerCase() === 'trial') return true;
    if (String(sub.transactionId || '') === 'trial-free-premium') return true;
    if (String(sub.planName || '').indexOf('تجريب') !== -1) return true;
    if (String(sub.price || '').trim() === '0' && String(sub.type || '').toUpperCase() === 'INDEX5') {
        return true;
    }
    return false;
}

/**
 * إزالة سجل التجربة من userSubscription_INDEX2 حتى لا يُعامل كخطة مميزة مدفوعة.
 */
function stripTrialSubscriptionFromStorage_INDEX2() {
    try {
        const raw =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('userSubscription_INDEX2')
                : localStorage.getItem('userSubscription_INDEX2');
        if (!raw) return false;
        const sub = JSON.parse(raw);
        if (!isTrialSubscriptionRecord_INDEX2(sub)) return false;
        if (typeof gostaLsRemoveScoped_INDEX2 === 'function') {
            gostaLsRemoveScoped_INDEX2('userSubscription_INDEX2');
        } else {
            localStorage.removeItem('userSubscription_INDEX2');
        }
        console.log('🧹 أُزيل سجل التجربة المجانية من التخزين المحلي (ليس اشتراكاً مدفوعاً)');
        return true;
    } catch (e) {
        console.warn('stripTrialSubscriptionFromStorage_INDEX2:', e);
        return false;
    }
}

/**
 * التحقق من صحة الاشتراك الحالي (محلي — لا يُعرّف باسم checkSubscriptionValidity حتى لا يُستبدل من script2.js).
 */
function checkSubscriptionValidity_INDEX2() {
    try {
        const subscription =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('userSubscription_INDEX2')
                : localStorage.getItem('userSubscription_INDEX2');

        if (!subscription) {
            console.log('🆓 المستخدم مجاني - لا يوجد اشتراك');
            return {
                status: 'free',
                isPaid: false,
                message: 'مجاني تجريبي'
            };
        }
        
        const sub = JSON.parse(subscription);

        if (isTrialSubscriptionRecord_INDEX2(sub)) {
            stripTrialSubscriptionFromStorage_INDEX2();
            console.log('🆓 تجربة مجانية — لا يُحسب اشتراكاً مدفوعاً');
            return {
                status: 'free',
                isPaid: false,
                message: 'مجاني تجريبي'
            };
        }
        
        // التحقق من صحة البيانات
        if (!sub.status || sub.status !== 'active') {
            console.log('❌ الاشتراك غير نشط');
            return {
                status: 'inactive',
                isPaid: false,
                message: 'اشتراك معطل'
            };
        }
        
        // التحقق من انتهاء الصلاحية
        const expiryDate = new Date(sub.expiryDate);
        const today = new Date();
        
        if (today > expiryDate) {
            console.log('⏰ انتهت صلاحية الاشتراك');
            // حذف الاشتراك المنتهي
            if (typeof gostaLsRemoveScoped_INDEX2 === 'function') {
                gostaLsRemoveScoped_INDEX2('userSubscription_INDEX2');
            } else {
                localStorage.removeItem('userSubscription_INDEX2');
            }
            return {
                status: 'expired',
                isPaid: false,
                message: 'انتهت الصلاحية'
            };
        }
        
        // الاشتراك فعال وصحيح
        console.log('✅ اشتراك فعال:', sub.type);
        return {
            status: 'active',
            isPaid: true,
            plan: sub.type,
            planName: sub.planName,
            storage: sub.storage,
            expiryDate: sub.expiryDate,
            daysRemaining: Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24)),
            message: sub.planName
        };
        
    } catch (error) {
        console.error('❌ خطأ في التحقق من الاشتراك:', error);
        return {
            status: 'error',
            isPaid: false,
            message: 'خطأ في التحقق'
        };
    }
}

/**
 * هل الاشتراك الحالي نشط وغير منتهٍ لنفس رمز الخطة (INDEX3 / INDEX4)؟
 */
function isSubscribedToPlan_INDEX2(planName) {
    if (!planName) return false;
    const info = checkSubscriptionValidity_INDEX2();
    if (!info || !info.isPaid || info.status !== 'active') return false;
    return String(info.plan || '').toUpperCase() === String(planName).toUpperCase();
}

/**
 * رمز الخطة النشطة المدفوعة (INDEX3 / INDEX4 / INDEX5) أو null إن لم يوجد.
 */
function getActiveSubscriptionPlan_INDEX2() {
    const info = checkSubscriptionValidity_INDEX2();
    if (!info || !info.isPaid || info.status !== 'active') return null;
    const t = String(info.plan || '').toUpperCase();
    return t === 'INDEX3' || t === 'INDEX4' || t === 'INDEX5' ? t : null;
}

var GOSTA_PLAN_NAMES_AR_INDEX2 = {
    INDEX3: 'الخطة الأساسية',
    INDEX4: 'الخطة المتقدمة',
    INDEX5: 'الخطة المميزة السحابية'
};

/**
 * حالة اشتراك المستخدم على هذا الجهاز — للمساعد الذكي (نص مضغوط).
 */
function buildUserSubscriptionSnapshotForAi_INDEX2() {
    try {
        if (typeof isActivePaidSubscription_INDEX2 === 'function' && isActivePaidSubscription_INDEX2()) {
            var code =
                typeof getActiveSubscriptionPlan_INDEX2 === 'function'
                    ? getActiveSubscriptionPlan_INDEX2()
                    : null;
            var info =
                typeof checkSubscriptionValidity_INDEX2 === 'function'
                    ? checkSubscriptionValidity_INDEX2()
                    : null;
            var name =
                (info && info.planName) ||
                GOSTA_PLAN_NAMES_AR_INDEX2[code] ||
                code ||
                'مدفوع';
            var days =
                info && info.daysRemaining != null && !isNaN(Number(info.daysRemaining))
                    ? String(info.daysRemaining)
                    : '';
            return (
                'اشتراك_المستخدم_الحالي:مدفوع_فعال|' +
                (code || '?') +
                '|' +
                name +
                (days ? '|متبقي_' + days + '_يوم' : '')
            );
        }
        if (typeof isFreePlanUsageLocked_INDEX2 === 'function' && isFreePlanUsageLocked_INDEX2()) {
            return 'اشتراك_المستخدم_الحالي:مجاني_تجريبي|تجربة_الاشتراك_العشرة_أيام_منتهية|يلزم_اشتراك_مدفوع';
        }
        if (typeof getFreePlanTrialDaysRemaining_INDEX2 === 'function') {
            var rem = getFreePlanTrialDaysRemaining_INDEX2();
            if (rem !== null && rem !== undefined) {
                return (
                    'اشتراك_المستخدم_الحالي:مجاني_تجريبي|تجربة_نشطة|متبقي_' + rem + '_يوم'
                );
            }
        }
        return 'اشتراك_المستخدم_الحالي:مجاني_تجريبي|لا_يوجد_اشتراك_مدفوع_فعال';
    } catch (e) {
        return 'اشتراك_المستخدم_الحالي:غير_معروف';
    }
}

/** كائن منظم يُرسل في assistantContext.user_subscription */
function getUserSubscriptionContextForAi_INDEX2() {
    try {
        if (typeof isActivePaidSubscription_INDEX2 === 'function' && isActivePaidSubscription_INDEX2()) {
            var codePaid =
                typeof getActiveSubscriptionPlan_INDEX2 === 'function'
                    ? getActiveSubscriptionPlan_INDEX2()
                    : null;
            var infoPaid =
                typeof checkSubscriptionValidity_INDEX2 === 'function'
                    ? checkSubscriptionValidity_INDEX2()
                    : null;
            return {
                status: 'paid_active',
                plan_code: codePaid || null,
                plan_name_ar:
                    (infoPaid && infoPaid.planName) ||
                    GOSTA_PLAN_NAMES_AR_INDEX2[codePaid] ||
                    null,
                trial_days_remaining: null
            };
        }
        if (typeof isFreePlanUsageLocked_INDEX2 === 'function' && isFreePlanUsageLocked_INDEX2()) {
            return {
                status: 'trial_expired',
                plan_code: null,
                plan_name_ar: 'مجاني تجريبي — انتهت التجربة',
                trial_days_remaining: 0
            };
        }
        if (typeof getFreePlanTrialDaysRemaining_INDEX2 === 'function') {
            var daysRem = getFreePlanTrialDaysRemaining_INDEX2();
            if (daysRem !== null && daysRem !== undefined) {
                return {
                    status: 'trial_active',
                    plan_code: null,
                    plan_name_ar: 'مجاني تجريبي — نشط',
                    trial_days_remaining: daysRem
                };
            }
        }
        return {
            status: 'free',
            plan_code: null,
            plan_name_ar: 'مجاني تجريبي',
            trial_days_remaining: null
        };
    } catch (e2) {
        return { status: 'free', plan_code: null, plan_name_ar: null, trial_days_remaining: null };
    }
}

/**
 * هل يُمنع بدء دفع هذه الخطة الآن؟
 * — يمنع الدفع لنفس الخطة.
 * — يمنع النزول لخطة أقل من الحالية.
 */
function isPlanPurchaseBlocked_INDEX2(planName) {
    const p = String(planName || '').toUpperCase();
    const cur = getActiveSubscriptionPlan_INDEX2();
    if (!cur) return false;
    const rank = { INDEX3: 1, INDEX4: 2, INDEX5: 3 };
    if (!rank[p] || !rank[cur]) return false;
    if (p === cur) return true;
    return rank[p] < rank[cur];
}

/**
 * رسالة للمستخدم عند منع الشراء (صفحات الدفع أو الإشعارات).
 */
function getPlanPurchaseBlockedUserMessage_INDEX2(planName) {
    if (typeof isPlanPurchaseBlocked_INDEX2 !== 'function' || !isPlanPurchaseBlocked_INDEX2(planName)) {
        return null;
    }
    const p = String(planName || '').toUpperCase();
    const cur = getActiveSubscriptionPlan_INDEX2();
    const names = { INDEX3: 'الخطة الأساسية', INDEX4: 'الخطة المتقدمة', INDEX5: 'الخطة المميزة السحابية' };
    if (p === 'INDEX3' && (cur === 'INDEX4' || cur === 'INDEX5')) {
        return 'أنت مشترك في خطة أعلى حتى انتهاء اشتراكك الحالي. لا يمكن التحويل لخطة أقل حالياً.';
    }
    if (p === 'INDEX3' && cur === 'INDEX3') {
        return 'أنت مشترك فعلاً في ' + names.INDEX3 + ' حتى انتهاء الفترة الحالية. لا يمكن دفع نفس الخطة مرتين.';
    }
    if (p === 'INDEX4' && cur === 'INDEX4') {
        return 'أنت مشترك فعلاً في ' + names.INDEX4 + ' حتى انتهاء الفترة الحالية. لا يمكن دفع نفس الخطة مرتين.';
    }
    if (p === 'INDEX4' && cur === 'INDEX5') {
        return 'أنت مشترك حالياً في ' + names.INDEX5 + '، ولا يمكن التحويل إلى خطة أقل قبل انتهاء المدة.';
    }
    if (p === 'INDEX5' && cur === 'INDEX5') {
        return 'أنت مشترك فعلاً في ' + names.INDEX5 + ' حتى انتهاء الفترة الحالية. لا يمكن دفع نفس الخطة مرتين.';
    }
    return 'لا يمكن إتمام هذا الاشتراك حالياً.';
}

/** مدة عمل الخطة المجانية بالأيام ثم يُقفل التطبيق حتى الترقية */
var FREE_PLAN_TRIAL_DAYS_INDEX2 = 10;
var FREE_PLAN_TRIAL_START_KEY_INDEX2 = 'freePlanTrialStart_INDEX2';

function parseTrialDateMs_INDEX2(raw) {
    try {
        if (!raw) return NaN;
        const s = String(raw).trim();
        let ms = new Date(s).getTime();
        if (Number.isFinite(ms)) return ms;
        const normalized = s
            .replace(/[\u200e\u200f]/g, '')
            .replace(/[٠-٩]/g, function (d) {
                return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));
            })
            .replace(/\s*ص\s*/g, ' AM ')
            .replace(/\s*م\s*/g, ' PM ');
        ms = new Date(normalized).getTime();
        return Number.isFinite(ms) ? ms : NaN;
    } catch (e) {
        return NaN;
    }
}

function ensureFreePlanTrialAnchor_INDEX2() {
    try {
        var existing =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('freePlanTrialStart_INDEX2')
                : localStorage.getItem(FREE_PLAN_TRIAL_START_KEY_INDEX2);
        if (existing) return;
        const accRaw = localStorage.getItem('userAccount_INDEX2');
        if (!accRaw) return;
        const acc = JSON.parse(accRaw);
        var startIso = null;
        if (acc && acc.createdAt) {
            var d = new Date(acc.createdAt);
            if (!isNaN(d.getTime())) startIso = d.toISOString();
        }
        if (!startIso) startIso = new Date().toISOString();
        if (typeof gostaLsSetScoped_INDEX2 === 'function') {
            gostaLsSetScoped_INDEX2('freePlanTrialStart_INDEX2', startIso);
        } else {
            localStorage.setItem(FREE_PLAN_TRIAL_START_KEY_INDEX2, startIso);
        }
    } catch (e) {
        console.warn('ensureFreePlanTrialAnchor_INDEX2:', e);
    }
}

function isActivePaidSubscription_INDEX2() {
    var info = checkSubscriptionValidity_INDEX2();
    return !!(info && info.isPaid && info.status === 'active');
}

/**
 * هل انتهت الأيام العشرة للمجاني ولا يوجد اشتراك مدفوع فعّال؟
 * إن true: لا تُفتح الحاسبة/الوسائط إلا بعد الترقية.
 */
function isFreePlanUsageLocked_INDEX2() {
    try {
        if (isActivePaidSubscription_INDEX2()) return false;
        ensureFreePlanTrialAnchor_INDEX2();
        var raw =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('freePlanTrialStart_INDEX2')
                : localStorage.getItem(FREE_PLAN_TRIAL_START_KEY_INDEX2);
        if (!raw) return false;
        var startMs = parseTrialDateMs_INDEX2(raw);
        if (isNaN(startMs)) return false;
        var endMs = startMs + FREE_PLAN_TRIAL_DAYS_INDEX2 * 24 * 60 * 60 * 1000;
        return Date.now() > endMs;
    } catch (e) {
        return false;
    }
}

/** عدد الأيام المتبقية من المجان (0 = آخر يوم أو انتهى اليوم)، أو null إن كان مدفوعاً */
function getFreePlanTrialDaysRemaining_INDEX2() {
    try {
        if (isActivePaidSubscription_INDEX2()) return null;
        ensureFreePlanTrialAnchor_INDEX2();
        var raw =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('freePlanTrialStart_INDEX2')
                : localStorage.getItem(FREE_PLAN_TRIAL_START_KEY_INDEX2);
        if (!raw) return null;
        var startMs = parseTrialDateMs_INDEX2(raw);
        if (isNaN(startMs)) return null;
        var endMs = startMs + FREE_PLAN_TRIAL_DAYS_INDEX2 * 24 * 60 * 60 * 1000;
        return Math.max(0, Math.ceil((endMs - Date.now()) / (24 * 60 * 60 * 1000)));
    } catch (e) {
        return null;
    }
}

/**
 * الحصول على معلومات الاشتراك الكاملة
 */
function getSubscriptionInfo() {
    try {
        const subscription =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('userSubscription_INDEX2')
                : localStorage.getItem('userSubscription_INDEX2');

        if (!subscription) {
            return null;
        }
        
        return JSON.parse(subscription);
    } catch (error) {
        console.error('❌ خطأ في الحصول على معلومات الاشتراك:', error);
        return null;
    }
}

/**
 * إشعار ذكي لقرب انتهاء الاشتراك (مرة واحدة يومياً لكل مستوى).
 */
function notifySubscriptionExpiryIfNeeded(subscription) {
    try {
        if (!subscription || !subscription.expiryDate) return;

        const expiryDate = new Date(subscription.expiryDate);
        const today = new Date();
        const daysRemaining = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));

        let level = null;
        let message = '';
        if (daysRemaining <= 0) {
            level = 'expired';
            message = '⚠️ انتهت صلاحية اشتراكك وتم تحويل حسابك تلقائياً إلى الخطة المجانية التجريبية (1000MB).';
        } else if (daysRemaining <= 3) {
            level = '3days';
            message = `⚠️ اشتراكك سينتهي خلال ${daysRemaining} يوم.`;
        } else if (daysRemaining <= 7) {
            level = '7days';
            message = `ℹ️ تنبيه: اشتراكك سينتهي خلال ${daysRemaining} أيام.`;
        }

        if (!level) return;

        const todayKey = new Date().toISOString().slice(0, 10);
        const em =
            typeof getCurrentUserEmailForStorage_INDEX2 === 'function'
                ? getCurrentUserEmailForStorage_INDEX2()
                : '';
        const emSafe = String(em || 'anon')
            .replace(/[^\w\-@.]/g, '_')
            .slice(0, 80);
        const notifyKey = `sub_notify_INDEX2_${emSafe}_${level}_${todayKey}`;
        if (localStorage.getItem(notifyKey) === '1') return;

        if (typeof showNotification === 'function') {
            showNotification(message);
        } else {
            console.warn(message);
        }

        localStorage.setItem(notifyKey, '1');
    } catch (error) {
        console.warn('⚠️ تعذر عرض إشعار انتهاء الاشتراك:', error);
    }
}

/**
 * عرض شريط الاشتراك في الواجهة
 */
function displaySubscriptionBar() {
    try {
        if (typeof ensureFreePlanTrialAnchor_INDEX2 === 'function') {
            ensureFreePlanTrialAnchor_INDEX2();
        }
        let subscription = getSubscriptionInfo();

        if (subscription && isTrialSubscriptionRecord_INDEX2(subscription)) {
            stripTrialSubscriptionFromStorage_INDEX2();
            subscription = null;
        }
        
        if (!subscription) {
            console.log('📊 عرض شريط الاشتراك المجاني');
            displayFreeSubscriptionBar();
            return;
        }
        
        // التحقق من الصلاحية
        const expiryDate = new Date(subscription.expiryDate);
        const today = new Date();
        
        if (today > expiryDate) {
            // الاشتراك انتهى
            if (typeof gostaLsRemoveScoped_INDEX2 === 'function') {
                gostaLsRemoveScoped_INDEX2('userSubscription_INDEX2');
            } else {
                localStorage.removeItem('userSubscription_INDEX2');
            }
            displayFreeSubscriptionBar();
            return;
        }
        
        // عرض شريط الاشتراك المدفوع
        displayPaidSubscriptionBar(subscription);
        
    } catch (error) {
        console.error('❌ خطأ في عرض شريط الاشتراك:', error);
    }
}

/**
 * عرض شريط الاشتراك المجاني (مع عدّاد 10 أيام أو حالة الإقفال بعد انتهائها).
 */
function displayFreeSubscriptionBar() {
    const statsBar = document.querySelector('.stats-bar');

    if (!statsBar) return;

    if (typeof ensureFreePlanTrialAnchor_INDEX2 === 'function') {
        ensureFreePlanTrialAnchor_INDEX2();
    }

    let subscriptionBar = document.getElementById('subscriptionBar');
    if (!subscriptionBar) {
        subscriptionBar = document.createElement('div');
        subscriptionBar.id = 'subscriptionBar';
        statsBar.parentElement.insertBefore(subscriptionBar, statsBar);
    }

    subscriptionBar.style.cssText =
        'color: white; padding: 12px 20px; text-align: center; border-radius: 8px; margin-bottom: 15px; font-size: 13px; font-weight: bold;';

    const locked =
        typeof isFreePlanUsageLocked_INDEX2 === 'function' && isFreePlanUsageLocked_INDEX2();
    if (locked) {
        subscriptionBar.style.background = 'linear-gradient(135deg, #b71c1c 0%, #880e4f 100%)';
        subscriptionBar.innerHTML =
            '⏰ انتهت فترة الخطة المجانية التجريبية (' +
            FREE_PLAN_TRIAL_DAYS_INDEX2 +
            ' أيام). رقِّ خطتك للمتابعة.' +
            '<span style="margin-inline-start: 10px;">' +
            '<a href="#" style="color: white; text-decoration: underline;" onclick="event.preventDefault(); if(typeof showSubscriptionsPage===\'function\')showSubscriptionsPage(); return false;">' +
            'اختر خطة مدفوعة ↑</a></span>';
        return;
    }

    const daysLeft =
        typeof getFreePlanTrialDaysRemaining_INDEX2 === 'function'
            ? getFreePlanTrialDaysRemaining_INDEX2()
            : null;
    subscriptionBar.style.background = 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)';
    const shownDays = daysLeft === null || daysLeft === undefined ? FREE_PLAN_TRIAL_DAYS_INDEX2 : daysLeft;
    const trialLine =
        '<br><span style="font-size:12px;font-weight:600;">متبقي ' +
        shownDays +
        ' أيام من المجاني التجريبي (ثم تُقفل العمليات وتبقى الترقية فقط)</span>';

    subscriptionBar.innerHTML =
        '🆓 النسخة المجانية التجريبية (1000MB)' +
        trialLine +
        '<span style="margin-inline-start: 10px;">' +
        '<a href="#" style="color: white; text-decoration: underline;" onclick="event.preventDefault(); if(typeof showSubscriptionsPage===\'function\')showSubscriptionsPage(); return false;">' +
        'ترقية الآن ↑</a></span>';
}

/**
 * عرض شريط الاشتراك المدفوع
 */
function displayPaidSubscriptionBar(subscription) {
    const statsBar = document.querySelector('.stats-bar');
    
    if (!statsBar) return;
    
    // حذف شريط القديم إن وجد
    const oldBar = document.getElementById('subscriptionBar');
    if (oldBar) {
        oldBar.remove();
    }
    
    // إضافة شريط الاشتراك المدفوع
    const subscriptionBar = document.createElement('div');
    subscriptionBar.id = 'subscriptionBar';
    
    // حساب الأيام المتبقية
    const expiryDate = new Date(subscription.expiryDate);
    const today = new Date();
    const daysRemaining = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
    
    // تحديد لون الشريط حسب الأيام المتبقية
    let barColor = 'linear-gradient(135deg, #4CAF50 0%, #45a049 100%)'; // أخضر - نشط
    if (daysRemaining <= 7) {
        barColor = 'linear-gradient(135deg, #ff9800 0%, #e68900 100%)'; // برتقالي - قريب الانتهاء
    }
    if (daysRemaining <= 3) {
        barColor = 'linear-gradient(135deg, #f44336 0%, #da190b 100%)'; // أحمر - جداً قريب
    }
    
    subscriptionBar.style.cssText = `
        background: ${barColor};
        color: white;
        padding: 12px 20px;
        text-align: center;
        border-radius: 8px;
        margin-bottom: 15px;
        font-size: 13px;
        font-weight: bold;
        display: flex;
        justify-content: space-between;
        align-items: center;
    `;
    
    subscriptionBar.innerHTML = `
        <span>💳 ${subscription.planName} • ${subscription.storage}MB</span>
        <span>⏰ ينتهي خلال ${daysRemaining} يوم</span>
    `;
    
    statsBar.parentElement.insertBefore(subscriptionBar, statsBar);
    
    console.log(`✅ تم عرض شريط الاشتراك المدفوع: ${subscription.planName}`);
}

/**
 * تهيئة نظام الاشتراكات عند تحميل الصفحة
 */
function initSubscriptionSystem() {
    try {
        if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
            stripTrialSubscriptionFromStorage_INDEX2();
        }
        // 1. التحقق من الاشتراك
        const subscription = checkSubscriptionValidity_INDEX2();
        console.log('✅ نتيجة التحقق:', subscription.status);
        notifySubscriptionExpiryIfNeeded(getSubscriptionInfo());
        
        // 2. عرض شريط الاشتراك
        displaySubscriptionBar();
        
        // 3. تحديث حدود التخزين (يستدعي داخلياً updateBackupTabVisibility في النهاية)
        updateStorageLimitsBySubscription();

        if (typeof syncGostaAiFabVisibility_INDEX2 === 'function') {
            syncGostaAiFabVisibility_INDEX2();
        }

        console.log('✅ تم تهيئة نظام الاشتراكات بنجاح');
        
    } catch (error) {
        console.error('❌ خطأ في تهيئة نظام الاشتراكات:', error);
    }
}

/**
 * تحديث حدود التخزين حسب الاشتراك
 */
function updateStorageLimitsBySubscription() {
    try {
        if (typeof isFreePlanUsageLocked_INDEX2 === 'function' && isFreePlanUsageLocked_INDEX2()) {
            window.MAX_UPLOAD_SIZE_INDEX2 = 0;
            console.log('📊 انتهت فترة المجانية — رفع الملفات معطل حتى الترقية');
            return;
        }

        let subscription = getSubscriptionInfo();

        if (subscription && isTrialSubscriptionRecord_INDEX2(subscription)) {
            stripTrialSubscriptionFromStorage_INDEX2();
            subscription = null;
        }
        
        if (!subscription) {
            // استخدام الحدود الافتراضية للمجاني
            window.MAX_UPLOAD_SIZE_INDEX2 = 1000 * 1024 * 1024; // 1000MB
            console.log('📊 حدود التخزين المجاني: 1000MB');
            return;
        }
        
        // التحقق من الصلاحية
        const expiryDate = new Date(subscription.expiryDate);
        if (new Date() > expiryDate) {
            if (typeof gostaLsRemoveScoped_INDEX2 === 'function') {
                gostaLsRemoveScoped_INDEX2('userSubscription_INDEX2');
            } else {
                localStorage.removeItem('userSubscription_INDEX2');
            }
            window.MAX_UPLOAD_SIZE_INDEX2 = 1000 * 1024 * 1024;
            console.log('📊 انتهت الصلاحية - استخدام حدود المجاني: 1000MB');
            return;
        }
        
        // تعيين حدود التخزين حسب الخطة
        if (subscription.type === 'INDEX3') {
            window.MAX_UPLOAD_SIZE_INDEX2 = 300 * 1024 * 1024; // 300MB
            console.log('✅ تم تحديث حدود التخزين: 300 MB (INDEX3)');
        } else if (subscription.type === 'INDEX4') {
            window.MAX_UPLOAD_SIZE_INDEX2 = 700 * 1024 * 1024; // 700MB
            console.log('✅ تم تحديث حدود التخزين: 700 MB (INDEX4)');
        } else if (subscription.type === 'INDEX5') {
            window.MAX_UPLOAD_SIZE_INDEX2 = 1000 * 1024 * 1024; // 1000MB
            console.log('✅ تم تحديث حدود التخزين: 1000 MB (INDEX5)');
        }
        
        console.log(`📊 الحد الأقصى الحالي: ${(window.MAX_UPLOAD_SIZE_INDEX2 / 1024 / 1024).toFixed(0)} MB`);
        
    } catch (error) {
        console.error('❌ خطأ في تحديث حدود التخزين:', error);
        window.MAX_UPLOAD_SIZE_INDEX2 = 1000 * 1024 * 1024;
    } finally {
        updateBackupTabVisibility();
    }
}

/**
 * ضبط حالة تبويب «النسخ الاحتياطية»:
 * - INDEX3: يبقى ظاهراً لكن «مقفل» ويعرض رسالة ترقية عند الضغط.
 * - INDEX4 أو غير مدفوع: يعمل بشكل طبيعي.
 */
function updateBackupTabVisibility() {
    const btn = document.getElementById('filterBtnBackup');
    if (!btn) return;

    let lockForBasic = false;
    try {
        const info = checkSubscriptionValidity_INDEX2();
        lockForBasic = info.status === 'active' && info.plan === 'INDEX3';
    } catch (e) {
        console.warn('⚠️ تعذر ضبط حالة تبويب النسخ الاحتياطية:', e);
    }

    btn.hidden = false;
    btn.style.display = '';
    btn.removeAttribute('aria-hidden');

    if (lockForBasic) {
        btn.classList.add('filter-btn-locked');
        btn.setAttribute('data-feature-locked', 'backup-index4');
        btn.title = 'ميزة النسخ الاحتياطية متاحة للخطة المتقدمة فقط';
    } else {
        btn.classList.remove('filter-btn-locked');
        btn.removeAttribute('data-feature-locked');
        btn.removeAttribute('title');
    }
}

// ==================== مزامنة سجل الاشتراك مع الخادم (لوحة التحكم + إيميل الإيصال) ====================

var GOSTA_PENDING_SUB_LOG_KEY_INDEX2 = 'gostaPendingSubscriptionLogs_INDEX2';

function gostaResolveUserEmailForPayment_INDEX2() {
    if (typeof getCurrentUserEmailForStorage_INDEX2 === 'function') {
        var scoped = getCurrentUserEmailForStorage_INDEX2();
        if (scoped) return scoped;
    }
    try {
        var email = (localStorage.getItem('currentUserEmail_INDEX2') || '').trim();
        if (email) return email;
        var acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (acc && acc.email) return String(acc.email).trim();
    } catch (ignore) {}
    return '';
}

function gostaResolvePaymentApiBase_INDEX2() {
    var AUTH = window.PR_SAFE_AUTH || {};
    if (AUTH.apiBase) return AUTH.apiBase;
    var port = window.__PR_SAFE_AUTH_PORT__ || 3000;
    var host = '127.0.0.1';
    try {
        var lh = window.location && window.location.hostname;
        if (lh && lh !== '') host = lh;
    } catch (e) {}
    return 'http://' + host + ':' + port;
}

function gostaQueuePendingSubscriptionLog_INDEX2(entry) {
    try {
        var list = JSON.parse(localStorage.getItem(GOSTA_PENDING_SUB_LOG_KEY_INDEX2) || '[]');
        if (!Array.isArray(list)) list = [];
        list.push(entry);
        localStorage.setItem(GOSTA_PENDING_SUB_LOG_KEY_INDEX2, JSON.stringify(list.slice(-30)));
    } catch (e) {
        console.warn('gostaQueuePendingSubscriptionLog:', e);
    }
}

async function gostaWaitPaymentApiReady_INDEX2() {
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY && typeof window.PR_SAFE_AUTH_DISCOVERY.then === 'function') {
            await Promise.race([
                window.PR_SAFE_AUTH_DISCOVERY,
                new Promise(function (resolve) {
                    setTimeout(resolve, 12000);
                })
            ]);
        }
    } catch (e) {
        console.warn('gostaWaitPaymentApiReady discovery:', e);
    }
    var base = gostaResolvePaymentApiBase_INDEX2();
    for (var attempt = 0; attempt < 5; attempt++) {
        try {
            var r = await fetch(base + '/api/ping', { cache: 'no-store' });
            if (r.ok) {
                var j = await r.json().catch(function () {
                    return null;
                });
                if (j && j.ok) {
                    if (window.PR_SAFE_AUTH) window.PR_SAFE_AUTH.apiBase = base;
                    return base;
                }
            }
        } catch (ePing) {
            console.warn('gostaWaitPaymentApiReady ping:', ePing);
        }
        await new Promise(function (r) {
            setTimeout(r, 400);
        });
    }
    return gostaResolvePaymentApiBase_INDEX2();
}

async function gostaPushSubscriptionLogToServer_INDEX2(subscription) {
    var entry = subscription || {};
    var email = String(entry.userEmail || entry.email || gostaResolveUserEmailForPayment_INDEX2() || '').trim();
    var plan = String(entry.type || entry.plan || '').trim();
    if (!email || !plan) {
        return { ok: false, reason: 'missing_email_or_plan' };
    }
    entry.userEmail = email;
    entry.type = plan;

    var apiBase = await gostaWaitPaymentApiReady_INDEX2();
    if (!apiBase) {
        gostaQueuePendingSubscriptionLog_INDEX2(entry);
        return { ok: false, reason: 'no_api' };
    }

    for (var attempt = 0; attempt < 4; attempt++) {
        try {
            var r = await fetch(apiBase + '/api/subscription-log', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                cache: 'no-store',
                body: JSON.stringify(entry)
            });
            if (r.ok) {
                return { ok: true, apiBase: apiBase };
            }
            console.warn(
                '[subscription-log] فشل الحفظ على الخادم:',
                r.status,
                await r.text().catch(function () {
                    return '';
                })
            );
        } catch (e) {
            console.warn('[subscription-log] خطأ شبكة:', e);
        }
        await new Promise(function (r) {
            setTimeout(r, 500);
        });
    }

    gostaQueuePendingSubscriptionLog_INDEX2(entry);
    return { ok: false, reason: 'network' };
}

async function gostaFlushPendingSubscriptionLogs_INDEX2() {
    var list = [];
    try {
        list = JSON.parse(localStorage.getItem(GOSTA_PENDING_SUB_LOG_KEY_INDEX2) || '[]');
        if (!Array.isArray(list)) list = [];
    } catch (e) {
        list = [];
    }
    if (!list.length) return { flushed: 0, remaining: 0 };

    var remaining = [];
    var flushed = 0;
    for (var i = 0; i < list.length; i++) {
        var r = await gostaPushSubscriptionLogToServer_INDEX2(list[i]);
        if (r.ok) flushed++;
        else remaining.push(list[i]);
    }
    try {
        localStorage.setItem(GOSTA_PENDING_SUB_LOG_KEY_INDEX2, JSON.stringify(remaining));
    } catch (e2) {}
    return { flushed: flushed, remaining: remaining.length };
}

/**
 * تطبيق اشتراك مدفوع من الخادم محلياً (لا يحفظ سجل التجربة كـ INDEX5 مدفوع).
 */
function applyServerSubscriptionLocally_INDEX2(subscription) {
    try {
        if (subscription && typeof isTrialSubscriptionRecord_INDEX2 === 'function') {
            if (isTrialSubscriptionRecord_INDEX2(subscription)) {
                if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
                    stripTrialSubscriptionFromStorage_INDEX2();
                }
                return { applied: false, reason: 'trial_not_stored_as_paid' };
            }
        }
        if (!subscription) {
            var hadPaid = false;
            try {
                var raw =
                    typeof gostaLsGetScoped_INDEX2 === 'function'
                        ? gostaLsGetScoped_INDEX2('userSubscription_INDEX2')
                        : localStorage.getItem('userSubscription_INDEX2');
                if (raw) {
                    var prev = JSON.parse(raw);
                    hadPaid =
                        prev &&
                        typeof isTrialSubscriptionRecord_INDEX2 === 'function' &&
                        !isTrialSubscriptionRecord_INDEX2(prev);
                }
            } catch (ePrev) {}
            if (typeof gostaLsRemoveScoped_INDEX2 === 'function') {
                gostaLsRemoveScoped_INDEX2('userSubscription_INDEX2');
            } else {
                localStorage.removeItem('userSubscription_INDEX2');
            }
            return { applied: false, reason: 'cleared_local_paid', hadPaid: hadPaid };
        }
        var payload = JSON.stringify(subscription);
        if (typeof gostaLsSetScoped_INDEX2 === 'function') {
            gostaLsSetScoped_INDEX2('userSubscription_INDEX2', payload);
        } else {
            localStorage.setItem('userSubscription_INDEX2', payload);
        }
        console.log('✅ مزامنة اشتراك من الخادم:', subscription.type);
        return { applied: true, plan: subscription.type };
    } catch (e) {
        console.warn('applyServerSubscriptionLocally_INDEX2:', e);
        return { applied: false, reason: 'error' };
    }
}

/**
 * جلب أحدث اشتراك من الخادم وتحديث التخزين المحلي (بعد دفع من جهاز آخر).
 */
async function syncSubscriptionFromServer_INDEX2(email, password) {
    var em = String(email || '').trim();
    var pw = String(password || '');
    if (!em || !pw) {
        return { ok: false, reason: 'missing_credentials' };
    }
    var apiBase = await gostaWaitPaymentApiReady_INDEX2();
    if (!apiBase) {
        return { ok: false, reason: 'no_api' };
    }
    var deviceBindingId = '';
    try {
        if (typeof getOrCreateDeviceBindingId_INDEX2 === 'function') {
            deviceBindingId = getOrCreateDeviceBindingId_INDEX2();
        }
    } catch (eDev) {}
    try {
        var res = await fetch(apiBase + '/api/subscription-sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            cache: 'no-store',
            body: JSON.stringify({
                email: em,
                password: pw,
                deviceBindingId: deviceBindingId
            })
        });
        var data = await res.json().catch(function () {
            return {};
        });
        if (!res.ok || !data.ok) {
            return { ok: false, reason: data.error || 'sync_failed', status: res.status };
        }
        if (data.subscription) {
            applyServerSubscriptionLocally_INDEX2(data.subscription);
        } else if (
            data.accessMode === 'free' ||
            data.accessMode === 'free_trial' ||
            data.accessMode === 'device_restricted'
        ) {
            applyServerSubscriptionLocally_INDEX2(null);
            if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
                stripTrialSubscriptionFromStorage_INDEX2();
            }
        }
        return {
            ok: true,
            accessMode: data.accessMode || (data.subscription ? 'paid' : 'free'),
            applied: !!data.subscription,
            deviceRestricted: data.accessMode === 'device_restricted'
        };
    } catch (eNet) {
        console.warn('syncSubscriptionFromServer_INDEX2:', eNet);
        return { ok: false, reason: 'network' };
    }
}

/** حالة آلة الشراء: IDLE | PURCHASING | VERIFYING | ACTIVE | FAILED */
var HUAWEI_PURCHASE_STATE_INDEX2 = 'IDLE';

function setHuaweiPurchaseState_INDEX2(state) {
    HUAWEI_PURCHASE_STATE_INDEX2 = String(state || 'IDLE');
    if (typeof window !== 'undefined') {
        window.HUAWEI_PURCHASE_STATE_INDEX2 = HUAWEI_PURCHASE_STATE_INDEX2;
    }
}

function getHuaweiPurchaseContextEmail_INDEX2() {
    try {
        var email = String(localStorage.getItem('currentUserEmail_INDEX2') || '').trim();
        if (!email) {
            var acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            if (acc && acc.email) {
                email = String(acc.email).trim();
            }
        }
        return email || 'unknown@gosta.local';
    } catch (e) {
        return 'unknown@gosta.local';
    }
}

function beginHuaweiPurchaseSessionOnServer_INDEX2(planCode, huaweiAccountId) {
    if (!window.PR_SAFE_AUTH || !window.PR_SAFE_AUTH.apiBase) {
        return Promise.resolve({ ok: true, skipped: true });
    }
    return fetch(window.PR_SAFE_AUTH.apiBase + '/api/huawei-iap/purchase-session/begin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userEmail: getHuaweiPurchaseContextEmail_INDEX2(),
            huaweiAccountId: String(huaweiAccountId || ''),
            planCode: String(planCode || '').toUpperCase()
        })
    })
        .then(function (r) {
            return r.json().catch(function () {
                return { ok: false };
            });
        })
        .catch(function () {
            return { ok: true, skipped: true };
        });
}

function endHuaweiPurchaseSessionOnServer_INDEX2(finalState, huaweiAccountId) {
    if (!window.PR_SAFE_AUTH || !window.PR_SAFE_AUTH.apiBase) {
        return Promise.resolve();
    }
    return fetch(window.PR_SAFE_AUTH.apiBase + '/api/huawei-iap/purchase-session/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userEmail: getHuaweiPurchaseContextEmail_INDEX2(),
            huaweiAccountId: String(huaweiAccountId || ''),
            finalState: String(finalState || 'IDLE')
        })
    }).catch(function () {});
}

/** قفل شراء واحد — يمنع مسارين متزامنين (subscriptions + payment) */
var HUAWEI_PURCHASE_LOCK_TIMEOUT_MS_INDEX2 = 120000;
var huaweiPurchaseLockTimer_INDEX2 = null;
var huaweiVerifyingReceiptIds_INDEX2 = {};
var huaweiPurchaseContextUserId_INDEX2 = '';

function isHuaweiPurchaseLocked_INDEX2() {
    return !!window.IS_PURCHASING_INDEX2;
}

function acquireHuaweiPurchaseLock_INDEX2() {
    if (window.IS_PURCHASING_INDEX2) {
        return false;
    }
    window.IS_PURCHASING_INDEX2 = true;
    if (huaweiPurchaseLockTimer_INDEX2) {
        clearTimeout(huaweiPurchaseLockTimer_INDEX2);
    }
    huaweiPurchaseLockTimer_INDEX2 = setTimeout(function () {
        releaseHuaweiPurchaseLock_INDEX2();
    }, HUAWEI_PURCHASE_LOCK_TIMEOUT_MS_INDEX2);
    return true;
}

function releaseHuaweiPurchaseLock_INDEX2() {
    window.IS_PURCHASING_INDEX2 = false;
    if (huaweiPurchaseLockTimer_INDEX2) {
        clearTimeout(huaweiPurchaseLockTimer_INDEX2);
        huaweiPurchaseLockTimer_INDEX2 = null;
    }
    if (HUAWEI_PURCHASE_STATE_INDEX2 === 'PURCHASING') {
        setHuaweiPurchaseState_INDEX2('IDLE');
    }
}

function isHuaweiReceiptVerifyInFlight_INDEX2(receiptId) {
    return !!huaweiVerifyingReceiptIds_INDEX2[String(receiptId || '')];
}

function markHuaweiReceiptVerifyInFlight_INDEX2(receiptId, inFlight) {
    var id = String(receiptId || '');
    if (!id) {
        return;
    }
    if (inFlight) {
        huaweiVerifyingReceiptIds_INDEX2[id] = true;
    } else {
        delete huaweiVerifyingReceiptIds_INDEX2[id];
    }
}

/** خريطة الخطط → SKU في Huawei Developer Console */
var HUAWEI_PLAN_SKU_MAP_INDEX2 = {
    INDEX3: 'index3_plan',
    INDEX4: 'index4_plan',
    INDEX5: 'index5_plan'
};

function planCodeToHuaweiSku_INDEX2(planCode) {
    var plan = String(planCode || '').toUpperCase();
    return HUAWEI_PLAN_SKU_MAP_INDEX2[plan] || '';
}

function huaweiSkuToPlanCode_INDEX2(sku) {
    var s = String(sku || '').trim();
    var keys = Object.keys(HUAWEI_PLAN_SKU_MAP_INDEX2);
    for (var i = 0; i < keys.length; i++) {
        if (HUAWEI_PLAN_SKU_MAP_INDEX2[keys[i]] === s) {
            return keys[i];
        }
    }
    return '';
}

/** هل الدفع عبر Huawei AppGallery IAP متاح (تطبيق Android + جسر MainActivity) */
function isAndroidHuaweiBillingAvailable_INDEX2() {
    try {
        if (!window.AndroidHuaweiBilling || typeof window.AndroidHuaweiBilling.startPurchase !== 'function') {
            return false;
        }
        if (typeof window.Capacitor !== 'undefined' && typeof window.Capacitor.getPlatform === 'function') {
            return window.Capacitor.getPlatform() === 'android';
        }
        return true;
    } catch (e) {
        return false;
    }
}

/**
 * طبقة شراء واحدة — Android Huawei IAP (Promise).
 * @returns {Promise<boolean>}
 */
function startHuaweiPurchase_INDEX2(planCode) {
    var plan = String(planCode || '').toUpperCase();
    var sku = planCodeToHuaweiSku_INDEX2(plan);
    if (!sku) {
        if (typeof notifyAppUser_INDEX2 === 'function') {
            notifyAppUser_INDEX2('الخطة غير معروفة', 'error');
        }
        return Promise.resolve(false);
    }
    if (!isAndroidHuaweiBillingAvailable_INDEX2()) {
        return Promise.resolve(false);
    }
    if (!acquireHuaweiPurchaseLock_INDEX2()) {
        if (typeof notifyAppUser_INDEX2 === 'function') {
            notifyAppUser_INDEX2('عملية شراء قيد التنفيذ بالفعل…', 'info');
        } else if (typeof showNotification === 'function') {
            showNotification('عملية شراء قيد التنفيذ بالفعل…', 3000, 'info');
        }
        return Promise.resolve(false);
    }

    setHuaweiPurchaseState_INDEX2('PURCHASING');

    return beginHuaweiPurchaseSessionOnServer_INDEX2(plan, huaweiPurchaseContextUserId_INDEX2)
        .then(function (sessionResp) {
            if (sessionResp && sessionResp.ok === false && sessionResp.error === 'purchase_session_active') {
                releaseHuaweiPurchaseLock_INDEX2();
                setHuaweiPurchaseState_INDEX2('FAILED');
                if (typeof notifyAppUser_INDEX2 === 'function') {
                    notifyAppUser_INDEX2('لديك عملية شراء نشطة. انتظر قليلاً ثم أعد المحاولة.', 'error');
                }
                return false;
            }
            try {
                window.AndroidHuaweiBilling.startPurchase(sku);
                if (typeof notifyAppUser_INDEX2 === 'function') {
                    notifyAppUser_INDEX2('جاري فتح Huawei AppGallery للدفع…', 'info');
                } else if (typeof showNotification === 'function') {
                    showNotification('جاري فتح Huawei AppGallery للدفع…', 3200, 'info');
                }
                return true;
            } catch (eAmz) {
                console.error('Huawei Purchase Error:', eAmz);
                releaseHuaweiPurchaseLock_INDEX2();
                setHuaweiPurchaseState_INDEX2('FAILED');
                endHuaweiPurchaseSessionOnServer_INDEX2('FAILED', huaweiPurchaseContextUserId_INDEX2);
                if (typeof notifyAppUser_INDEX2 === 'function') {
                    notifyAppUser_INDEX2('فشل بدء عملية الشراء', 'error');
                }
                return false;
            }
        })
        .catch(function (eNet) {
            console.warn('beginHuaweiPurchaseSessionOnServer_INDEX2:', eNet);
            try {
                window.AndroidHuaweiBilling.startPurchase(sku);
                return true;
            } catch (e2) {
                releaseHuaweiPurchaseLock_INDEX2();
                setHuaweiPurchaseState_INDEX2('FAILED');
                return false;
            }
        });
}

var HUAWEI_PENDING_VERIFY_KEY_INDEX2 = 'HUAWEI_PENDING_VERIFY_INDEX2';
var huaweiRecoveryInFlight_INDEX2 = false;

var HUAWEI_BILLING_USER_MSG_INDEX2 = {
    PURCHASE_SESSION_ACTIVE: 'لديك عملية شراء نشطة. انتظر قليلاً ثم أعد المحاولة.',
    PURCHASE_ALREADY_USED: 'تم استخدام هذا الشراء مسبقاً — الاشتراك مفعّل.',
    PURCHASE_REPLAY_CONFLICT: 'هذا الشراء مرتبط بحساب آخر.',
    VERIFY_TIMEOUT: 'انتهت مهلة التحقق من AppGallery. سنعيد المحاولة عند فتح التطبيق.',
    VERIFY_FAILED: 'تعذر التحقق من الشراء. حاول مرة أخرى أو تواصل مع الدعم.',
    IAP_INVALID: 'رد غير صالح من Huawei. أعد المحاولة لاحقاً.',
    IAP_HTTP_ERROR: 'تعذر الاتصال بخدمة تحقق Huawei.',
    NETWORK_ERROR: 'تعذر الاتصال بالخادم. تحقق من الإنترنت.',
    EMAIL_NOT_REGISTERED: 'يلزم تسجيل الدخول ببريد مسجّل قبل تفعيل الاشتراك.'
};

function huaweiBillingUserMessage_INDEX2(errorCode, fallback) {
    var code = String(errorCode || '').trim();
    if (code && HUAWEI_BILLING_USER_MSG_INDEX2[code]) {
        return HUAWEI_BILLING_USER_MSG_INDEX2[code];
    }
    return fallback || 'تعذر إتمام عملية الشراء';
}

function saveHuaweiPendingVerify_INDEX2(payload) {
    try {
        localStorage.setItem(
            HUAWEI_PENDING_VERIFY_KEY_INDEX2,
            JSON.stringify(
                Object.assign({}, payload || {}, {
                    savedAt: new Date().toISOString()
                })
            )
        );
    } catch (e) {}
}

function loadHuaweiPendingVerify_INDEX2() {
    try {
        var raw = localStorage.getItem(HUAWEI_PENDING_VERIFY_KEY_INDEX2);
        if (!raw) return null;
        var o = JSON.parse(raw);
        if (!o || !(o.purchaseToken || o.receiptId)) return null;
        var age = Date.now() - new Date(o.savedAt || 0).getTime();
        if (age > 7 * 24 * 60 * 60 * 1000) {
            clearHuaweiPendingVerify_INDEX2();
            return null;
        }
        return o;
    } catch (e2) {
        return null;
    }
}

function clearHuaweiPendingVerify_INDEX2() {
    try {
        localStorage.removeItem(HUAWEI_PENDING_VERIFY_KEY_INDEX2);
    } catch (e) {}
}

function fetchHuaweiRecoveryStatus_INDEX2(pending) {
    if (!window.PR_SAFE_AUTH || !window.PR_SAFE_AUTH.apiBase) {
        return Promise.resolve({ ok: false, errorCode: 'NETWORK_ERROR' });
    }
    var p = pending || loadHuaweiPendingVerify_INDEX2() || {};
    return fetch(window.PR_SAFE_AUTH.apiBase + '/api/huawei-iap/recovery-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            userEmail: getHuaweiPurchaseContextEmail_INDEX2(),
            huaweiAccountId: String(p.huaweiAccountId || p.huaweiUserId || huaweiPurchaseContextUserId_INDEX2 || ''),
            pendingPurchaseToken: String(p.purchaseToken || p.receiptId || ''),
            clientPurchaseState: HUAWEI_PURCHASE_STATE_INDEX2
        })
    })
        .then(function (r) {
            return r.json().catch(function () {
                return { ok: false, errorCode: 'NETWORK_ERROR' };
            });
        })
        .catch(function () {
            return { ok: false, errorCode: 'NETWORK_ERROR' };
        });
}

/**
 * استعادة بعد إغلاق التطبيق أو انقطاع الشبكة أثناء VERIFYING.
 */
function recoverHuaweiBillingOnAppResume_INDEX2() {
    if (huaweiRecoveryInFlight_INDEX2) {
        return Promise.resolve(false);
    }
    var pending = loadHuaweiPendingVerify_INDEX2();
    var needsRecovery =
        !!pending ||
        HUAWEI_PURCHASE_STATE_INDEX2 === 'VERIFYING' ||
        HUAWEI_PURCHASE_STATE_INDEX2 === 'PURCHASING';
    if (!needsRecovery) {
        return Promise.resolve(false);
    }
    if (!window.PR_SAFE_AUTH || !window.PR_SAFE_AUTH.apiBase) {
        return Promise.resolve(false);
    }

    huaweiRecoveryInFlight_INDEX2 = true;
    return fetchHuaweiRecoveryStatus_INDEX2(pending)
        .then(function (status) {
            if (!status || !status.ok) {
                return false;
            }
            if (status.action === 'APPLY_SUBSCRIPTION' && status.subscription) {
                if (typeof applyHuaweiSubscriptionFromVerify_INDEX2 === 'function') {
                    applyHuaweiSubscriptionFromVerify_INDEX2(status.subscription);
                }
                clearHuaweiPendingVerify_INDEX2();
                setHuaweiPurchaseState_INDEX2('ACTIVE');
                releaseHuaweiPurchaseLock_INDEX2();
                if (typeof notifyAppUser_INDEX2 === 'function') {
                    notifyAppUser_INDEX2('تم استعادة اشتراكك بعد انقطاع الاتصال', 'success');
                }
                return true;
            }
            if (status.action === 'RETRY_VERIFY' && pending && (pending.purchaseToken || pending.receiptId)) {
                setHuaweiPurchaseState_INDEX2('VERIFYING');
                return onHuaweiPurchaseSuccess_INDEX2(pending);
            }
            if (status.action === 'PURCHASE_IN_PROGRESS') {
                if (typeof notifyAppUser_INDEX2 === 'function') {
                    notifyAppUser_INDEX2('عملية شراء قيد المعالجة على الخادم…', 'info');
                }
                return false;
            }
            return false;
        })
        .finally(function () {
            huaweiRecoveryInFlight_INDEX2 = false;
        });
}

function wireHuaweiBillingRecoveryListener_INDEX2() {
    if (window.__huaweiRecoveryWired_INDEX2) {
        return;
    }
    window.__huaweiRecoveryWired_INDEX2 = true;
    document.addEventListener('visibilitychange', function () {
        if (document.visibilityState === 'visible') {
            recoverHuaweiBillingOnAppResume_INDEX2();
        }
    });
    try {
        if (
            window.Capacitor &&
            window.Capacitor.Plugins &&
            window.Capacitor.Plugins.App &&
            typeof window.Capacitor.Plugins.App.addListener === 'function'
        ) {
            window.Capacitor.Plugins.App.addListener('appStateChange', function (state) {
                if (state && state.isActive) {
                    recoverHuaweiBillingOnAppResume_INDEX2();
                }
            });
        }
    } catch (eCap) {}
}

/**
 * يُستدعى من أندرويد بعد نجاح الشراء — تحقق السيرفر ثم تفعيل الاشتراك.
 * @param {{ planCode?: string, sku?: string, purchaseToken: string, huaweiAccountId?: string }} purchaseData
 */
function onHuaweiPurchaseSuccess_INDEX2(purchaseData) {
    var data = purchaseData || {};
    var purchaseToken = String(data.purchaseToken || data.receiptId || '').trim();
    var huaweiAccountId = String(data.huaweiAccountId || data.huaweiUserId || '').trim();
    var sku = String(data.sku || data.productId || '').trim();
    var planCode =
        String(data.planCode || '').toUpperCase() || huaweiSkuToPlanCode_INDEX2(sku);

    if (!purchaseToken || !sku) {
        console.warn('onHuaweiPurchaseSuccess_INDEX2: missing purchaseToken or productId');
        releaseHuaweiPurchaseLock_INDEX2();
        return Promise.resolve(false);
    }

    if (isHuaweiReceiptVerifyInFlight_INDEX2(purchaseToken)) {
        console.warn('onHuaweiPurchaseSuccess_INDEX2: duplicate verify skipped', purchaseToken);
        return Promise.resolve(false);
    }
    markHuaweiReceiptVerifyInFlight_INDEX2(purchaseToken, true);
    huaweiPurchaseContextUserId_INDEX2 = huaweiAccountId;
    setHuaweiPurchaseState_INDEX2('VERIFYING');
    saveHuaweiPendingVerify_INDEX2({
        purchaseToken: purchaseToken,
        receiptId: purchaseToken,
        huaweiAccountId: huaweiAccountId,
        sku: sku,
        planCode: planCode
    });

    var email = '';
    try {
        email = String(localStorage.getItem('currentUserEmail_INDEX2') || '').trim();
        if (!email) {
            var acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            if (acc && acc.email) {
                email = String(acc.email).trim();
                if (email) {
                    localStorage.setItem('currentUserEmail_INDEX2', email);
                }
            }
        }
    } catch (eEmail) {}
    if (!email) {
        email = 'unknown@gosta.local';
    }

    var deviceBindingId = '';
    try {
        if (typeof getOrCreateDeviceBindingId_INDEX2 === 'function') {
            deviceBindingId = getOrCreateDeviceBindingId_INDEX2();
        } else {
            deviceBindingId = String(localStorage.getItem('deviceBindingId_INDEX2') || '').trim();
        }
    } catch (eDev) {}

    if (!window.PR_SAFE_AUTH || !window.PR_SAFE_AUTH.apiBase) {
        if (typeof notifyAppUser_INDEX2 === 'function') {
            notifyAppUser_INDEX2('تعذر الاتصال بخادم التحقق', 'error');
        }
        markHuaweiReceiptVerifyInFlight_INDEX2(purchaseToken, false);
        releaseHuaweiPurchaseLock_INDEX2();
        return Promise.resolve(false);
    }

    return fetch(window.PR_SAFE_AUTH.apiBase + '/api/huawei-iap/verify-purchase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            purchaseToken: purchaseToken,
            huaweiAccountId: huaweiAccountId,
            productId: sku,
            userEmail: email,
            deviceBindingId: deviceBindingId
        })
    })
        .then(function (r) {
            return r.json().catch(function () {
                return {};
            });
        })
        .then(function (resp) {
            if (!resp || !resp.verified || !resp.subscription) {
                var err = new Error((resp && resp.errorCode) || (resp && resp.error) || 'verify_failed');
                err.errorCode = (resp && resp.errorCode) || 'VERIFY_FAILED';
                throw err;
            }
            clearHuaweiPendingVerify_INDEX2();
            if (typeof applyHuaweiSubscriptionFromVerify_INDEX2 === 'function') {
                applyHuaweiSubscriptionFromVerify_INDEX2(resp.subscription);
            } else if (typeof applyServerSubscriptionLocally_INDEX2 === 'function') {
                applyServerSubscriptionLocally_INDEX2(resp.subscription);
            } else {
                localStorage.setItem('userSubscription_INDEX2', JSON.stringify(resp.subscription));
            }
            if (typeof gostaHuaweiConfirmPurchase_INDEX2 === 'function') {
                gostaHuaweiConfirmPurchase_INDEX2(purchaseToken, true);
            }
            var planName =
                planCode === 'INDEX3'
                    ? 'الخطة الأساسية'
                    : planCode === 'INDEX4'
                      ? 'الخطة المتقدمة'
                      : 'الخطة المميزة السحابية';
            if (typeof notifyAppUser_INDEX2 === 'function') {
                notifyAppUser_INDEX2('✅ تم تفعيل ' + planName + ' عبر Huawei AppGallery', 'success');
            } else if (typeof showNotification === 'function') {
                showNotification('✅ تم تفعيل ' + planName + ' عبر Huawei AppGallery');
            }
            setHuaweiPurchaseState_INDEX2('ACTIVE');
            if (typeof paymentPageAfterHuaweiSuccess_INDEX2 === 'function') {
                paymentPageAfterHuaweiSuccess_INDEX2();
            }
            if (email && email.indexOf('@') > 0 && typeof syncSubscriptionFromServer_INDEX2 === 'function') {
                try {
                    var accRaw = localStorage.getItem('userAccount_INDEX2');
                    var acc = accRaw ? JSON.parse(accRaw) : null;
                    var pass = acc && acc.password ? String(acc.password) : '';
                    if (pass) {
                        syncSubscriptionFromServer_INDEX2(email, pass).catch(function () {});
                    }
                } catch (eSync) {}
            }
            return true;
        })
        .catch(function (err) {
            console.warn('onHuaweiPurchaseSuccess_INDEX2:', err);
            setHuaweiPurchaseState_INDEX2('VERIFYING');
            if (typeof gostaHuaweiConfirmPurchase_INDEX2 === 'function') {
                gostaHuaweiConfirmPurchase_INDEX2(purchaseToken, false);
            }
            var msg = huaweiBillingUserMessage_INDEX2(
                err && err.errorCode,
                'تم الدفع. سنعيد محاولة التحقق عند عودة الاتصال.'
            );
            if (typeof notifyAppUser_INDEX2 === 'function') {
                notifyAppUser_INDEX2(msg, 'error');
            } else if (typeof showNotification === 'function') {
                showNotification(msg);
            }
            return false;
        })
        .finally(function () {
            markHuaweiReceiptVerifyInFlight_INDEX2(purchaseToken, false);
            releaseHuaweiPurchaseLock_INDEX2();
            endHuaweiPurchaseSessionOnServer_INDEX2(
                HUAWEI_PURCHASE_STATE_INDEX2 === 'ACTIVE' ? 'ACTIVE' : 'IDLE',
                huaweiPurchaseContextUserId_INDEX2
            );
        });
}

if (typeof window !== 'undefined') {
    window.onHuaweiPurchaseSuccess = onHuaweiPurchaseSuccess_INDEX2;
    wireHuaweiBillingRecoveryListener_INDEX2();
}

/** إبلاغ التطبيق الأصلي بتأكيد الشراء بعد تحقق السيرفر */
function gostaHuaweiConfirmPurchase_INDEX2(purchaseToken, confirmed) {
    try {
        if (
            typeof window.AndroidHuaweiBilling !== 'undefined' &&
            typeof window.AndroidHuaweiBilling.confirmPurchase === 'function'
        ) {
            window.AndroidHuaweiBilling.confirmPurchase(String(purchaseToken || ''), !!confirmed);
        }
    } catch (eFul) {
        console.warn('gostaHuaweiConfirmPurchase_INDEX2:', eFul);
    }
}
if (typeof window !== 'undefined') {
    window.__gostaHuaweiConfirmPurchase = gostaHuaweiConfirmPurchase_INDEX2;
}

/**
 * بعد تحقق Huawei AppGallery من الخادم — تطبيق الاشتراك مع قواعد INDEX3/4 (ربط الجهاز).
 */
function applyHuaweiSubscriptionFromVerify_INDEX2(subscription) {
    if (!subscription) {
        return { applied: false, reason: 'empty' };
    }
    if (typeof isTrialSubscriptionRecord_INDEX2 === 'function') {
        if (isTrialSubscriptionRecord_INDEX2(subscription)) {
            if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
                stripTrialSubscriptionFromStorage_INDEX2();
            }
            return { applied: false, reason: 'trial_not_stored_as_paid' };
        }
    }
    var plan = String(subscription.type || '').toUpperCase();
    if (plan === 'INDEX3' || plan === 'INDEX4') {
        try {
            var bind =
                typeof getOrCreateDeviceBindingId_INDEX2 === 'function'
                    ? getOrCreateDeviceBindingId_INDEX2()
                    : String(localStorage.getItem('deviceBindingId_INDEX2') || '').trim();
            if (bind) {
                subscription.deviceBindingId = bind;
            }
        } catch (eBind) {}
    }
    var applyResult = applyServerSubscriptionLocally_INDEX2(subscription);
    try {
        var logs = JSON.parse(localStorage.getItem('subscriptionLogs_INDEX2') || '[]');
        if (!Array.isArray(logs)) {
            logs = [];
        }
        logs.push(
            Object.assign({}, subscription, {
                loggedAt: new Date().toISOString(),
                source: 'huawei_appgallery_client'
            })
        );
        if (logs.length > 100) {
            logs = logs.slice(-100);
        }
        localStorage.setItem('subscriptionLogs_INDEX2', JSON.stringify(logs));
    } catch (eLog) {}
    if (typeof gostaPushSubscriptionLogToServer_INDEX2 === 'function') {
        gostaPushSubscriptionLogToServer_INDEX2(subscription).catch(function () {});
    }
    if (typeof refreshSubscriptionUiAfterServerSync_INDEX2 === 'function') {
        refreshSubscriptionUiAfterServerSync_INDEX2();
    }
    return applyResult;
}

/** إعادة بناء واجهة الاشتراك بعد المزامنة */
function refreshSubscriptionUiAfterServerSync_INDEX2() {
    try {
        if (typeof initSubscriptionSystem === 'function') {
            initSubscriptionSystem();
        }
        if (typeof refreshSubscriptionPlanButtonsState === 'function') {
            refreshSubscriptionPlanButtonsState();
        }
        if (typeof refreshCloudFeaturesUi_INDEX2 === 'function') {
            refreshCloudFeaturesUi_INDEX2();
        }
        if (typeof updateBasicPlanUpgradeBanner_INDEX2 === 'function') {
            updateBasicPlanUpgradeBanner_INDEX2();
        }
        if (typeof displaySubscriptionBar === 'function') {
            displaySubscriptionBar();
        }
    } catch (eUi) {
        console.warn('refreshSubscriptionUiAfterServerSync_INDEX2:', eUi);
    }
}

/** يُرسل الاشتراك المحلي النشط للخادم إن وُجد (بعد دفع لم يُزامَن سابقاً). */
async function gostaSyncActiveSubscriptionToServer_INDEX2() {
    try {
        var info = typeof getSubscriptionInfo === 'function' ? getSubscriptionInfo() : null;
        if (!info || !info.type) return { ok: false, reason: 'no_local_subscription' };
        var ps = String(info.paymentStatus || '').toLowerCase();
        var st = String(info.status || '').toLowerCase();
        if (ps !== 'completed' && st !== 'active' && info.isValid !== true) {
            return { ok: false, reason: 'not_paid' };
        }
        return await gostaPushSubscriptionLogToServer_INDEX2(info);
    } catch (e) {
        console.warn('gostaSyncActiveSubscriptionToServer:', e);
        return { ok: false, reason: 'error' };
    }
}
