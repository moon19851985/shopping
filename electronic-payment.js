
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
let selectedPaymentType = null;
const DEVICE_BINDING_KEY_INDEX2 = 'deviceBindingId_INDEX2';

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
});

// عرض ملخص الخطة
function displayPlanSummary() {
    const plan = plansData[selectedPlan];
    
    if (!plan) {
        console.error('خطة غير موجودة');
        return;
    }
    
    document.getElementById('planName').textContent = plan.name;
    document.getElementById('planPrice').textContent = plan.price;
}

// اختيار نوع الدفع
function selectPaymentType(type) {
    selectedPaymentType = type;
    window.location.href = `card-payment.html?plan=${selectedPlan}&card=${type}`;
}

// إظهار قسم المعالجة
function showProcessing() {
    const processingSection = document.getElementById('processingSection');
    processingSection.style.display = 'block';
    
    // إخفاء الخيارات
    document.querySelector('.electronic-options').style.display = 'none';
    
    // التمرير إلى الأعلى
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

// معالجة الدفع
function processPayment(type) {
    const titles = {
        'visa': 'جاري معالجة بيانات بطاقة Visa...',
        'mada': 'جاري معالجة بيانات بطاقة Mada...'
    };
    
    const messages = {
        'visa': 'يرجى الانتظار بينما نتحقق من بيانات بطاقة Visa',
        'mada': 'يرجى الانتظار بينما نتحقق من بيانات بطاقة Mada'
    };
    
    document.getElementById('processingTitle').textContent = titles[type] || 'جاري معالجة الدفع...';
    document.getElementById('processingMessage').textContent = messages[type] || 'يرجى الانتظار';
    
    // محاكاة اكتمال المعالجة
    setTimeout(() => {
        // إظهار رسالة النجاح
        showSuccessMessage();
    }, 3000);
}

// إظهار رسالة النجاح
async function showSuccessMessage() {
    const processingSection = document.getElementById('processingSection');
    const successMessage = document.getElementById('successMessage');
    
    await saveSubscriptionToStorage();
    
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
            paymentMethod: selectedPaymentType || 'electronic',
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
    // العودة إلى قائمة الخيارات
    document.querySelector('.electronic-options').style.display = 'grid';
    document.getElementById('processingSection').style.display = 'none';
}

// العودة إلى صفحة الدفع
function goBackToPayment() {
    window.history.back();
}

// العودة إلى الرئيسية
function goBackHome() {
    window.location.href = 'index.html';
}
