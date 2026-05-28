
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

const cardTypes = {
    'visa': 'بطاقة Visa',
    'mada': 'بطاقة Mada'
};

let selectedPlan = null;
let selectedCardType = null;
const DEVICE_BINDING_KEY_INDEX2 = 'deviceBindingId_INDEX2';

/** تفضيلات بطاقة اختيارية (محلي فقط — لا يُخزَّن الرقم الكامل ولا CVV). */
const SAVED_CARD_PREFS_KEY = 'gosta_savedCard_INDEX2';

/** بريد المستخدم للدفع: من الجلسة أو من الحساب المحفوظ (نفس أصل التخزين في المتصفح). */
function resolveUserEmailForPayment() {
    if (typeof gostaResolveUserEmailForPayment_INDEX2 === 'function') {
        return gostaResolveUserEmailForPayment_INDEX2();
    }
    let email = (localStorage.getItem('currentUserEmail_INDEX2') || '').trim();
    if (email) return email;
    try {
        const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (acc && acc.email) return String(acc.email).trim();
    } catch (ignore) {}
    return '';
}

function getOrCreateDeviceBindingIdForPayment_INDEX2() {
    try {
        const existing = String(localStorage.getItem(DEVICE_BINDING_KEY_INDEX2) || '').trim();
        if (existing) return existing;
        const generated =
            'dev-' +
            Date.now().toString(36) +
            '-' +
            Math.random().toString(36).slice(2, 10);
        localStorage.setItem(DEVICE_BINDING_KEY_INDEX2, generated);
        return generated;
    } catch (e) {
        return '';
    }
}

// تهيئة الصفحة
document.addEventListener('DOMContentLoaded', function() {
    const urlParams = new URLSearchParams(window.location.search);
    selectedPlan = urlParams.get('plan') || 'INDEX3';
    selectedCardType = urlParams.get('card') || 'visa';
    if (typeof isPlanPurchaseBlocked_INDEX2 === 'function' && isPlanPurchaseBlocked_INDEX2(selectedPlan)) {
        const msg =
            typeof getPlanPurchaseBlockedUserMessage_INDEX2 === 'function'
                ? getPlanPurchaseBlockedUserMessage_INDEX2(selectedPlan)
                : 'لا يمكن إتمام هذا الاشتراك حالياً.';
        alert((msg || 'لا يمكن إتمام الاشتراك.') + ' سيتم إعادتك للتطبيق.');
        window.location.href = 'index.html';
        return;
    }
    displayPlanSummary();
    loadSavedCardPreferences();
    setupEventListeners();
});

/**
 * استرجاع الاسم وتاريخ الانتهاء (وآخر 4 أرقام للعرض فقط) من التخزين المحلي.
 * لا يُعاد ملء رقم البطاقة الكامل ولا CVV لأسباب أمنية.
 */
function loadSavedCardPreferences() {
    try {
        const raw =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2(SAVED_CARD_PREFS_KEY)
                : localStorage.getItem(SAVED_CARD_PREFS_KEY);
        if (!raw) return;
        const d = JSON.parse(raw);
        const holderInput = document.getElementById('cardHolder');
        const expInput = document.getElementById('expiryDate');
        const saveChk = document.getElementById('saveCard');
        const hint = document.getElementById('savedCardHint');
        if (d.cardHolder && holderInput) {
            holderInput.value = String(d.cardHolder);
        }
        if (d.expiryDate && expInput) {
            expInput.value = String(d.expiryDate);
        }
        if (saveChk && (d.cardHolder || d.expiryDate)) {
            saveChk.checked = true;
        }
        const holderDisp = document.getElementById('cardHolderDisplay');
        if (holderDisp) {
            holderDisp.textContent = (holderInput && holderInput.value ? holderInput.value : '').toUpperCase() || 'YOUR NAME';
        }
        const expDisp = document.getElementById('cardExpiryDisplay');
        if (expDisp) {
            expDisp.textContent = (expInput && expInput.value) ? expInput.value : 'MM/YY';
        }
        const numDisp = document.getElementById('cardNumberDisplay');
        if (numDisp && d.last4 && String(d.last4).length >= 4) {
            const l4 = String(d.last4).slice(-4);
            numDisp.textContent = '•••• •••• •••• ' + l4;
        }
        const loadedSomething = !!(d.cardHolder || d.expiryDate || d.last4);
        if (hint && loadedSomething) {
            hint.style.display = 'block';
            hint.textContent =
                'تم استرجاع الاسم وتاريخ الانتهاء من حفظك السابق. أكمل رقم البطاقة كاملاً ورمز الأمان — لا نُخزِّن الرقم الكامل ولا CVV على الجهاز.';
        }
    } catch (e) {
        console.warn('loadSavedCardPreferences:', e);
    }
}

/**
 * عند نجاح الدفع: إن وُجدت الموافقة يُحفظ الاسم وتاريخ الانتهاء وآخر 4 أرقام فقط.
 * إن ألغى المستخدم الخانة يُزال الحفظ السابق.
 */
function persistSavedCardPreferencesIfOptedIn() {
    const saveChk = document.getElementById('saveCard');
    if (!saveChk) return;
    if (!saveChk.checked) {
        try {
            localStorage.removeItem(SAVED_CARD_PREFS_KEY);
        } catch (ignore) {}
        return;
    }
    const cardNumber = (document.getElementById('cardNumber') && document.getElementById('cardNumber').value || '').replace(/\s/g, '');
    const cardHolder = (document.getElementById('cardHolder') && document.getElementById('cardHolder').value || '').trim();
    const expiryDate = (document.getElementById('expiryDate') && document.getElementById('expiryDate').value || '').trim();
    if (!cardHolder || !/^\d{2}\/\d{2}$/.test(expiryDate) || cardNumber.length < 13) {
        return;
    }
    const payload = {
        cardHolder: cardHolder,
        expiryDate: expiryDate,
        last4: cardNumber.slice(-4),
        cardPaymentType: selectedCardType || 'visa',
        savedAt: new Date().toISOString()
    };
    try {
        if (typeof gostaLsSetScoped_INDEX2 === 'function') {
            gostaLsSetScoped_INDEX2(SAVED_CARD_PREFS_KEY, JSON.stringify(payload));
        } else {
            localStorage.setItem(SAVED_CARD_PREFS_KEY, JSON.stringify(payload));
        }
    } catch (e) {
        console.warn('persistSavedCardPreferencesIfOptedIn:', e);
    }
}

// عرض ملخص الخطة
function displayPlanSummary() {
    const plan = plansData[selectedPlan];
    
    if (!plan) {
        console.error('خطة غير موجودة');
        return;
    }
    
    document.getElementById('planName').textContent = plan.name;
    document.getElementById('planPrice').textContent = plan.price;
    document.getElementById('cardType').textContent = cardTypes[selectedCardType] || 'بطاقة';
}

// إعداد المستمعين للأحداث
function setupEventListeners() {
    const cardNumberInput = document.getElementById('cardNumber');
    const cardHolderInput = document.getElementById('cardHolder');
    const expiryDateInput = document.getElementById('expiryDate');
    const cvvInput = document.getElementById('cvv');

    // تحديث رقم البطاقة المعاينة
    if (cardNumberInput) {
        cardNumberInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\s/g, '');
            let formattedValue = value.match(/.{1,4}/g)?.join(' ') || value;
            e.target.value = formattedValue;
            
            // تحديث المعاينة
            const lastFour = value.slice(-4) || '••••';
            document.getElementById('cardNumberDisplay').textContent = 
                '•••• •••• •••• ' + lastFour;
        });
        // عند اختيار بطاقة محفوظة أو تغيير الرقم: إفراغ CVV (لا يُفترض بقاؤه مع بطاقة أخرى)
        cardNumberInput.addEventListener('change', function () {
            if (cvvInput) cvvInput.value = '';
        });
    }

    // تحديث اسم البطاقة المعاينة
    if (cardHolderInput) {
        cardHolderInput.addEventListener('input', function(e) {
            document.getElementById('cardHolderDisplay').textContent = 
                e.target.value.toUpperCase() || 'YOUR NAME';
        });
    }

    // تنسيق تاريخ الانتهاء
    if (expiryDateInput) {
        expiryDateInput.addEventListener('input', function(e) {
            let value = e.target.value.replace(/\D/g, '');
            if (value.length >= 2) {
                value = value.substring(0, 2) + '/' + value.substring(2, 4);
            }
            e.target.value = value;
            
            // تحديث المعاينة
            document.getElementById('cardExpiryDisplay').textContent = value || 'MM/YY';
        });
    }

    // تصفية CVV ليكون أرقام فقط
    if (cvvInput) {
        cvvInput.addEventListener('input', function(e) {
            e.target.value = e.target.value.replace(/\D/g, '');
        });
    }

    // معالج النموذج
    const form = document.getElementById('cardPaymentForm');
    if (form) {
        form.addEventListener('submit', function(e) {
            e.preventDefault();
            processCardPayment(e);
        });
    }
}

// معالجة الدفع بالبطاقة
function processCardPayment(e) {
    e.preventDefault();

    // التحقق من الموافقة على الشروط
    const agreePayment = document.getElementById('agreePayment');
    if (!agreePayment.checked) {
        showErrorMessage('يجب أن توافق على الشروط والأحكام');
        return;
    }

    // التحقق من صحة البيانات
    const cardNumber = document.getElementById('cardNumber').value.replace(/\s/g, '');
    const cardHolder = document.getElementById('cardHolder').value;
    const expiryDate = document.getElementById('expiryDate').value;
    const cvv = document.getElementById('cvv').value;

    if (cardNumber.length < 13 || cardNumber.length > 19) {
        showErrorMessage('رقم البطاقة غير صحيح');
        return;
    }

    if (cardHolder.trim().length < 3) {
        showErrorMessage('اسم البطاقة غير صحيح');
        return;
    }

    if (!/^\d{2}\/\d{2}$/.test(expiryDate)) {
        showErrorMessage('تاريخ الانتهاء غير صحيح (MM/YY)');
        return;
    }

    if (cvv.length < 3) {
        showErrorMessage('رمز CVV غير صحيح');
        return;
    }

    // إظهار قسم المعالجة
    showProcessing();

    // محاكاة معالجة الدفع
    setTimeout(() => {
        // إظهار رسالة النجاح
        showSuccessMessage();
    }, 3000);
}

// إظهار قسم المعالجة
function showProcessing() {
    const processingSection = document.getElementById('processingSection');
    processingSection.style.display = 'flex';
    
    // إخفاء النموذج
    document.querySelector('.card-form-section').style.display = 'none';
    document.querySelector('.security-info').style.display = 'none';
}

// إظهار رسالة النجاح
async function showSuccessMessage() {
    const processingSection = document.getElementById('processingSection');
    const successMessage = document.getElementById('successMessage');
    
    await saveSubscriptionToStorage();
    persistSavedCardPreferencesIfOptedIn();

    processingSection.style.display = 'none';
    successMessage.style.display = 'flex';
}

// ✅ حفظ الاشتراك في localStorage بعد الدفع الناجح
async function saveSubscriptionToStorage() {
    try {
        const currentUserEmail = resolveUserEmailForPayment();
        if (!currentUserEmail) {
            console.error('❌ لم يتم العثور على بريد المستخدم (سجّل الدخول من التطبيق ثم أعد الدفع)');
            return;
        }
        
        // إنشاء كائن الاشتراك
        const subscription = {
            type: selectedPlan,  // INDEX3 أو INDEX4
            planName: plansData[selectedPlan].name,
            storage: parseInt(plansData[selectedPlan].storage),
            price: plansData[selectedPlan].price,
            paymentMethod: selectedCardType,
            cardType: cardTypes[selectedCardType],
            userEmail: currentUserEmail,
            startDate: new Date().toISOString(),
            expiryDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString(), // ~6 أشهر (180 يوماً)
            durationDays: 180,
            status: 'active',
            isValid: true,
            paymentStatus: 'completed',
            transactionId: 'TXN-' + Date.now() + '-' + Math.random().toString(36).substr(2, 9),
            timestamp: new Date().toLocaleString('ar-EG'),
            deviceBindingId:
                selectedPlan === 'INDEX3' || selectedPlan === 'INDEX4'
                    ? getOrCreateDeviceBindingIdForPayment_INDEX2()
                    : ''
        };
        
        // حفظ الاشتراك
        if (typeof gostaLsSetScoped_INDEX2 === 'function') {
            gostaLsSetScoped_INDEX2('userSubscription_INDEX2', JSON.stringify(subscription));
        } else {
            localStorage.setItem('userSubscription_INDEX2', JSON.stringify(subscription));
        }
        try {
            sessionStorage.setItem('gosta_plan_activated', '1');
        } catch (ignore) {}

        // حفظ سجل الاشتراكات (للمالك)
        await saveSubscriptionLog(subscription);
        
        console.log('✅ تم حفظ الاشتراك بنجاح:');
        console.log('📊 نوع الخطة:', subscription.type);
        console.log('💾 السعة:', subscription.storage, 'MB');
        console.log('⏰ انتهاء الصلاحية:', subscription.expiryDate);
        console.log('🎟️ معرّف المعاملة:', subscription.transactionId);
        
    } catch (error) {
        console.error('❌ خطأ في حفظ الاشتراك:', error);
    }
}

// حفظ سجل الاشتراكات (للمالك - في admin-dashboard)
async function saveSubscriptionLog(subscription) {
    try {
        let subscriptionLogs = JSON.parse(
            (typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('subscriptionLogs_INDEX2')
                : localStorage.getItem('subscriptionLogs_INDEX2')) || '[]'
        ) || [];
        
        const logEntry = {
            ...subscription,
            loggedAt: new Date().toISOString()
        };
        
        subscriptionLogs.push(logEntry);
        
        // الاحتفاظ بآخر 100 سجل فقط
        if (subscriptionLogs.length > 100) {
            subscriptionLogs = subscriptionLogs.slice(-100);
        }
        
        if (typeof gostaLsSetScoped_INDEX2 === 'function') {
            gostaLsSetScoped_INDEX2('subscriptionLogs_INDEX2', JSON.stringify(subscriptionLogs));
        } else {
            localStorage.setItem('subscriptionLogs_INDEX2', JSON.stringify(subscriptionLogs));
        }
        console.log('📋 تم حفظ السجل في قائمة الاشتراكات');

        if (typeof gostaPushSubscriptionLogToServer_INDEX2 === 'function') {
            const pushResult = await gostaPushSubscriptionLogToServer_INDEX2(logEntry);
            if (!pushResult.ok) {
                console.warn(
                    '⚠️ لم يُحفظ الاشتراك على الخادم بعد — افتح التطبيق من http://IP:3000/index.html ثم أعد المحاولة أو سيتم المزامنة تلقائياً عند فتح التطبيق.'
                );
            }
        }
        
    } catch (error) {
        console.warn('⚠️ تحذير: فشل حفظ السجل:', error);
    }
}

// إظهار رسالة الخطأ
function showErrorMessage(errorText) {
    const errorMessage = document.getElementById('errorMessage');
    document.getElementById('errorText').textContent = errorText;
    errorMessage.style.display = 'flex';
}

// إخفاء رسالة الخطأ
function hideErrorMessage() {
    document.getElementById('errorMessage').style.display = 'none';
}

// العودة إلى صفحة الدفع الإلكترونية
function goBackToElectronic() {
    window.history.back();
}

// العودة إلى الرئيسية
function goBackHome() {
    window.location.href = 'index.html';
}
