
// بيانات الخطط
const plansData = {
    'INDEX3': {
        name: 'الخطة الأساسية',
        storage: '300 MB',
        price: '2 ريال'
    },
    'INDEX4': {
        name: 'الخطة المتقدمة',
        storage: '700 MB',
        price: '5 ريال'
    },
    'INDEX5': {
        name: 'الخطة المميزة السحابية',
        storage: '1000 MB',
        price: '10 ريال'
    }
};

let selectedPlan = null;
let selectedPaymentMethod = 'electronic';

/** إشعار موحّد — يفضّل notifyAppUser إن وُجد، وإلا showNotification أو alert */
function paymentNotify_INDEX2(message, variant) {
    var msg = String(message || '');
    var v = variant || 'info';
    if (typeof notifyAppUser_INDEX2 === 'function') {
        notifyAppUser_INDEX2(msg, v);
        return;
    }
    if (typeof showNotification === 'function') {
        showNotification(msg, v === 'error' ? 5000 : 3500, v);
        return;
    }
    alert(msg);
}

/** هل جسر Huawei متوفر داخل WebView (تطبيق Android) */
function detectHuaweiAppGallery_INDEX2() {
    try {
        if (typeof isAndroidHuaweiBillingAvailable_INDEX2 === 'function') {
            return isAndroidHuaweiBillingAvailable_INDEX2();
        }
        return !!(window.AndroidHuaweiBilling && typeof window.AndroidHuaweiBilling.startPurchase === 'function');
    } catch (e) {
        return false;
    }
}

function normalizePaymentPlanCode_INDEX2(raw) {
    return String(raw || 'INDEX3').trim().toUpperCase();
}

function getHuaweiSkuForPlan_INDEX2(planCode) {
    if (typeof planCodeToHuaweiSku_INDEX2 === 'function') {
        return planCodeToHuaweiSku_INDEX2(planCode);
    }
    var map = {
        INDEX3: 'index3_plan',
        INDEX4: 'index4_plan',
        INDEX5: 'index5_plan'
    };
    return map[normalizePaymentPlanCode_INDEX2(planCode)] || '';
}

document.addEventListener('DOMContentLoaded', function () {
    const urlParams = new URLSearchParams(window.location.search);
    selectedPlan = normalizePaymentPlanCode_INDEX2(urlParams.get('plan'));

    if (typeof isPlanPurchaseBlocked_INDEX2 === 'function' && isPlanPurchaseBlocked_INDEX2(selectedPlan)) {
        const msg =
            typeof getPlanPurchaseBlockedUserMessage_INDEX2 === 'function'
                ? getPlanPurchaseBlockedUserMessage_INDEX2(selectedPlan)
                : 'لا يمكن إتمام هذا الاشتراك حالياً.';
        paymentNotify_INDEX2((msg || 'لا يمكن إتمام الاشتراك.') + ' سيتم إعادتك للتطبيق.', 'error');
        window.location.href = 'index.html';
        return;
    }

    displayPlanSummary();
    setupHuaweiPaymentOption_INDEX2();
});

function setupHuaweiPaymentOption_INDEX2() {
    if (!detectHuaweiAppGallery_INDEX2()) {
        return;
    }

    var card = document.getElementById('huaweiPaymentCard');
    var btn = document.getElementById('btnHuaweiPay');

    if (card) {
        card.style.display = 'block';
        selectPaymentMethod('huawei');
    }

    if (!btn) {
        return;
    }

    btn.addEventListener('click', function () {
        const plan = normalizePaymentPlanCode_INDEX2(selectedPlan);
        if (!plan || !plansData[plan]) {
            paymentNotify_INDEX2('لم يتم تحديد الخطة', 'error');
            return;
        }

        if (typeof startHuaweiPurchase_INDEX2 === 'function') {
            startHuaweiPurchase_INDEX2(plan).then(function (started) {
                if (!started) {
                    paymentNotify_INDEX2(
                        'تعذر بدء الشراء عبر Huawei. استخدم تطبيق Android مع AppGallery.',
                        'error'
                    );
                }
            });
            return;
        }

        paymentNotify_INDEX2(
            'تعذر بدء الشراء عبر Huawei. استخدم تطبيق Android مع AppGallery.',
            'error'
        );
    });
}

function displayPlanSummary() {
    const plan = plansData[selectedPlan];

    if (!plan) {
        console.error('خطة غير موجودة');
        paymentNotify_INDEX2('الخطة غير معروفة', 'error');
        return;
    }

    document.getElementById('planName').textContent = plan.name;
    document.getElementById('planStorage').textContent = plan.storage;
    document.getElementById('planPrice').textContent = plan.price;
}

function selectPaymentMethod(method) {
    selectedPaymentMethod = method;

    document.querySelectorAll('.payment-method-card').forEach(function (card) {
        var isMatch = card.getAttribute('data-method') === method;
        card.classList.toggle('active', isMatch);
        if (card.style.display === 'none' && isMatch) {
            card.style.display = 'block';
        }
    });

    const radio = document.querySelector('input[name="paymentMethod"][value="' + method + '"]');
    if (radio) {
        radio.checked = true;
    }
}

function proceedElectronicPayment() {
    window.location.href = 'electronic-payment.html?plan=' + selectedPlan;
}

function proceedToCardPayment(cardType) {
    window.location.href = 'card-payment.html?plan=' + selectedPlan + '&card=' + cardType;
}

function goBackToSubscriptions() {
    window.history.back();
}

/** بعد نجاح Huawei من صفحة الدفع — العودة للتطبيق */
function paymentPageAfterHuaweiSuccess_INDEX2() {
    try {
        if (!/payment\.html/i.test(String(window.location.pathname || ''))) {
            return;
        }
        paymentNotify_INDEX2('تم تفعيل الاشتراك بنجاح', 'success');
        setTimeout(function () {
            window.location.href = 'index.html';
        }, 1400);
    } catch (e) {
        window.location.href = 'index.html';
    }
}

if (typeof window !== 'undefined') {
    window.paymentPageAfterHuaweiSuccess_INDEX2 = paymentPageAfterHuaweiSuccess_INDEX2;
}
