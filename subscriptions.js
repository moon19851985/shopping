// ==================== وظائف صفحة الاشتراكات ====================

/** إشعار داخل التطبيق (toast) — بديل alert/إشعار المتصفح */
function notifyAppUser_INDEX2(message, variant, durationMs) {
    const text = String(message || '').trim();
    if (!text) return;
    if (typeof showNotification === 'function') {
        showNotification(text, typeof durationMs === 'number' && durationMs > 0 ? durationMs : 3600, variant || 'info');
        return;
    }
    alert(text);
}

/**
 * عرض صفحة الاشتراكات
 */
function showSubscriptionsPage() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
    try {
        const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        const pendRaw = localStorage.getItem('pendingEmailVerify_INDEX2');
        const pend = pendRaw ? JSON.parse(pendRaw) : null;
        if (!acc && pend && pend.email) {
            notifyAppUser_INDEX2('أكمل تفعيل البريد أولاً — الحساب غير مكتمل التسجيل', 'info');
            if (typeof showPage === 'function') showPage('loginPage');
            if (typeof showEmailVerificationUI === 'function') {
                showEmailVerificationUI(pend.email, { reopened: true });
            }
            return;
        }
        if (acc && typeof isEmailVerified === 'function' && !isEmailVerified(acc)) {
            notifyAppUser_INDEX2('يجب تفعيل البريد أولاً', 'info');
            if (typeof showPage === 'function') showPage('loginPage');
            if (typeof showEmailVerificationUI === 'function') {
                showEmailVerificationUI(acc.email, { reopened: true });
            }
            return;
        }
    } catch (ignore) {}
    if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
        stripTrialSubscriptionFromStorage_INDEX2();
    }
    showPage('subscriptionsPage');
    if (typeof refreshSubscriptionPlanButtonsState === 'function') {
        refreshSubscriptionPlanButtonsState();
    }
}

/**
 * تعطيل زر «اشترك الآن» عند منع الشراء (نفس الخطة، أو أساسية مع اشتراك متقدم فعال).
 */
function refreshSubscriptionPlanButtonsState() {
    ['INDEX3', 'INDEX4', 'INDEX5'].forEach(function (plan) {
        const btn = document.querySelector('[data-subscribe-plan="' + plan + '"]');
        if (!btn) return;
        const blocked =
            typeof isPlanPurchaseBlocked_INDEX2 === 'function' && isPlanPurchaseBlocked_INDEX2(plan);
        if (blocked) {
            btn.disabled = true;
            btn.setAttribute('aria-disabled', 'true');
            btn.classList.add('btn-subscribe-disabled');
            const cur =
                typeof getActiveSubscriptionPlan_INDEX2 === 'function'
                    ? getActiveSubscriptionPlan_INDEX2()
                    : null;
            if (plan === 'INDEX3' && cur === 'INDEX4') {
                btn.textContent = 'غير متاح مع الخطة المتقدمة';
            } else if (
                typeof isSubscribedToPlan_INDEX2 === 'function' &&
                isSubscribedToPlan_INDEX2(plan)
            ) {
                btn.textContent = 'أنت مشترك في هذه الخطة';
            } else {
                btn.textContent = 'غير متاح حالياً';
            }
        } else {
            btn.disabled = false;
            btn.removeAttribute('aria-disabled');
            btn.classList.remove('btn-subscribe-disabled');
            btn.textContent = 'اشترك الآن';
        }
    });
}

/**
 * إخفاء صفحة الاشتراكات
 */
function hideSubscriptionsPage() {
    showPage('calculatorPage');
}

/**
 * معالجة الاشتراك (حوار تأكيد وإشعارات من واجهة التطبيق — ليس نافذة المتصفح)
 */
async function subscribeNow(planName, price) {
    if (typeof isPlanPurchaseBlocked_INDEX2 === 'function' && isPlanPurchaseBlocked_INDEX2(planName)) {
        const msg =
            typeof getPlanPurchaseBlockedUserMessage_INDEX2 === 'function'
                ? getPlanPurchaseBlockedUserMessage_INDEX2(planName)
                : 'لا يمكن إتمام هذا الاشتراك حالياً.';
        notifyAppUser_INDEX2(msg || 'لا يمكن إتمام هذا الاشتراك حالياً.', 'info');
        return;
    }
    const normalizedPlan = String(planName || '').toUpperCase();
    if (normalizedPlan === 'INDEX3' || normalizedPlan === 'INDEX4') {
        const planLabel = normalizedPlan === 'INDEX3' ? 'الخطة الأساسية' : 'الخطة المتقدمة';
        const confirmMessage =
            'اشتراك ' +
            planLabel +
            ' سيكون مرتبطاً بهذا الجهاز فقط.\n' +
            'لن يعمل تسجيل الدخول من أجهزة أخرى بهذه الخطة.\n\n' +
            'هل توافق على المتابعة وتفعيل الاشتراك لهذا الجهاز؟';
        let ok = false;
        if (typeof showVaultConfirmDialog_INDEX2 === 'function') {
            ok = await showVaultConfirmDialog_INDEX2({
                title: 'تنبيه مهم',
                message: confirmMessage,
                confirmLabel: 'متابعة',
                cancelLabel: 'إلغاء'
            });
        } else {
            ok = window.confirm('تنبيه مهم:\n\n' + confirmMessage);
        }
        if (!ok) {
            notifyAppUser_INDEX2('تم إلغاء المتابعة. لم يتم بدء الاشتراك.', 'info');
            return;
        }
    }
    console.log(`📋 تم اختيار الخطة: ${planName} - السعر: ${price} ريال`);

  // تطبيق Android المنشور: Huawei AppGallery IAP (الويب يبقى على payment.html)
    if (
        typeof isAndroidHuaweiBillingAvailable_INDEX2 === 'function' &&
        isAndroidHuaweiBillingAvailable_INDEX2() &&
        typeof startHuaweiPurchase_INDEX2 === 'function'
    ) {
        startHuaweiPurchase_INDEX2(normalizedPlan).then(function (started) {
            if (started) {
                return;
            }
            window.location.href = 'payment.html?plan=' + planName;
        });
        return;
    }

    window.location.href = `payment.html?plan=${planName}`;
}

/**
 * تفعيل الخطة المجانية (إلغاء الاشتراك المدفوع الحالي).
 */
function activateFreePlan() {
    try {
        // إذا كان هناك اشتراك مدفوع فعال، لا تسمح بالرجوع للمجاني حتى انتهاء المدة
        const activePaidKeys = ['userSubscription_INDEX2', 'userSubscription_INDEX3', 'userSubscription_INDEX4'];
        for (const key of activePaidKeys) {
            const raw =
                key === 'userSubscription_INDEX2' && typeof gostaLsGetScoped_INDEX2 === 'function'
                    ? gostaLsGetScoped_INDEX2('userSubscription_INDEX2')
                    : localStorage.getItem(key);
            if (!raw) continue;

            try {
                const sub = JSON.parse(raw);
                const expiryDate = new Date(sub?.expiryDate || 0);
                const isActive = sub?.status === 'active' && new Date() <= expiryDate;

                if (isActive) {
                    const expiryText = expiryDate.toLocaleDateString('ar-EG');
                    notifyAppUser_INDEX2(
                        `لا يمكن تفعيل المجاني التجريبي الآن. اشتراكك المدفوع نشط حتى ${expiryText}.`,
                        'error'
                    );
                    return;
                }
            } catch (parseError) {
                console.warn(`⚠️ اشتراك غير صالح في ${key}:`, parseError);
            }
        }

        // إزالة الاشتراكات المدفوعة من جميع المفاتيح المستخدمة في النسخ المختلفة
        if (typeof gostaLsRemoveScoped_INDEX2 === 'function') {
            gostaLsRemoveScoped_INDEX2('userSubscription_INDEX2');
        } else {
            localStorage.removeItem('userSubscription_INDEX2');
        }
        localStorage.removeItem('userSubscription_INDEX3');
        localStorage.removeItem('userSubscription_INDEX4');
        localStorage.removeItem('currentSubscription_INDEX3');
        localStorage.removeItem('currentSubscription_INDEX4');
        localStorage.removeItem('currentSubscription_INDEX2');

        // فرض حدود الخطة المجانية مباشرة
        window.MAX_UPLOAD_SIZE_INDEX2 = 1000 * 1024 * 1024;

        // إعادة تهيئة الاشتراك/الحدود فوراً
        if (typeof initSubscriptionSystem === 'function') {
            initSubscriptionSystem();
        } else if (typeof updateStorageLimitsBySubscription === 'function') {
            updateStorageLimitsBySubscription();
        }

        notifyAppUser_INDEX2('تم تفعيل الخطة المجانية التجريبية بنجاح (1000MB).', 'success');

        hideSubscriptionsPage();

        // تحديث العرض والإحصائيات بدون إعادة تحميل الصفحة
        if (typeof updateStats === 'function' && typeof files !== 'undefined' && Array.isArray(files)) {
            updateStats(files);
        }
        if (typeof displayFiles === 'function') {
            displayFiles();
        }

        // ضمان تطبيق الحالة الجديدة حتى لو كانت هناك حالة قديمة مخزنة في الواجهة
        setTimeout(() => {
            window.location.reload();
        }, 150);
    } catch (error) {
        console.error('❌ خطأ في تفعيل الخطة المجانية:', error);
        notifyAppUser_INDEX2('تعذر تفعيل الخطة المجانية التجريبية حالياً', 'error');
    }
}
