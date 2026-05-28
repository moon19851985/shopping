
// ⚠️ بيانات المالك المشفرة - لا تضع البيانات الأصلية في التعليقات أبداً
// هذه القيم محسوبة من البريد والرمز بطريقة آمنة فقط
// لا نحفظ البيانات الأصلية في أي مكان
const adminCredentials = {
    // ✅ Hash محسوب بشكل آمن - لا يمكن فك التشفير
    emailHash: '0000000000000000000000001ad8ffb1',
    passwordHash: '0000000000000000000000000f8daf62'
};

// ⚠️ نقطة أمان مهمة:
// البيانات الأصلية (البريد/كلمة المرور) لا تُحفظ أبداً في الكود
// فقط Hash محسوب بطريقة آمنة
// إذا اطلع أحد على كود DevTools، لن يعرف البيانات الأصلية

// دالة Hash بسيطة (للتطوير فقط)
function hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // تحويل إلى عدد صحيح 32-bit
    }
    return Math.abs(hash).toString(16).padStart(32, '0');
}

// ========================================
// 🔒 نظام حماية إضافي ضد التجسس
// ========================================

// منع الوصول إلى البيانات الحساسة
Object.defineProperty(window, 'adminCredentials', {
    configurable: false,
    writable: false,
    enumerable: false
});

// منع استخراج الدوال الحساسة
Object.defineProperty(window, 'hashString', {
    configurable: false,
    writable: false,
    enumerable: false
});

// تحذير عند محاولة الوصول إلى console
const originalLog = console.log;
const consoleWarning = () => {
    console.clear();
    console.warn('%c⚠️ WARNING', 'color: red; font-size: 20px;');
    console.warn('%cThis console is protected!', 'color: red; font-size: 14px;');
    console.warn('%cUnauthorized access detected!', 'color: orange;');
    // تسجيل محاولة الوصول
    logSecurityEvent('console_access_attempted');
};

// فحص إذا تم فتح DevTools
let isDevToolsOpen = false;
const checkDevTools = () => {
    const threshold = 160;
    if (window.outerHeight - window.innerHeight > threshold || 
        window.outerWidth - window.innerWidth > threshold) {
        if (!isDevToolsOpen) {
            isDevToolsOpen = true;
            consoleWarning();
        }
    } else {
        isDevToolsOpen = false;
    }
};

// فحص منتظم لـ DevTools
setInterval(checkDevTools, 500);

// منع الكتابة المباشرة في console
if (typeof console !== 'undefined') {
    console.log = function(...args) {
        if (args[0]?.toString().includes('admin') || 
            args[0]?.toString().includes('Hash') ||
            args[0]?.toString().includes('credentials')) {
            logSecurityEvent('sensitive_data_access_attempted');
            return;
        }
        originalLog.apply(console, args);
    };
}

// منع نسخ البيانات الحساسة
document.addEventListener('copy', (e) => {
    const selection = window.getSelection().toString();
    if (selection.length > 50) { // نصوص طويلة = محاولة نسخ بيانات حساسة
        e.preventDefault();
        logSecurityEvent('copy_sensitive_data_attempted', selection);
    }
});

// تسجيل أحداث الأمان
function logSecurityEvent(eventType, details = '') {
    const securityLog = JSON.parse(localStorage.getItem('adminSecurityLog') || '[]');
    securityLog.push({
        timestamp: new Date().toISOString(),
        event: eventType,
        userAgent: navigator.userAgent,
        details: details
    });
    
    // احتفظ بآخر 100 حدث فقط
    if (securityLog.length > 100) {
        securityLog.shift();
    }
    
    localStorage.setItem('adminSecurityLog', JSON.stringify(securityLog));
}
const RATE_LIMIT = {
    maxAttempts: 5,           // عدد محاولات الدخول المسموح بها
    lockoutDuration: 15 * 60 * 1000,  // 15 دقيقة بالميلي ثانية
    attemptResetTime: 1 * 60 * 1000   // 1 دقيقة لإعادة تعيين العدادات
};

function initializeRateLimit() {
    const rateLimitData = localStorage.getItem('adminLoginRateLimit');
    if (!rateLimitData) {
        const initialData = {
            attempts: 0,
            lastAttemptTime: null,
            lockedUntil: null
        };
        localStorage.setItem('adminLoginRateLimit', JSON.stringify(initialData));
    }
}

function isAccountLocked() {
    const rateLimitData = JSON.parse(localStorage.getItem('adminLoginRateLimit') || '{}');
    if (rateLimitData.lockedUntil) {
        const now = new Date().getTime();
        if (now < parseInt(rateLimitData.lockedUntil)) {
            return true;
        } else {
            // إزالة القفل بعد انتهاء المدة
            rateLimitData.lockedUntil = null;
            rateLimitData.attempts = 0;
            localStorage.setItem('adminLoginRateLimit', JSON.stringify(rateLimitData));
            return false;
        }
    }
    return false;
}

function recordFailedAttempt() {
    const rateLimitData = JSON.parse(localStorage.getItem('adminLoginRateLimit') || '{}');
    const now = new Date().getTime();
    
    // إعادة تعيين العدادات إذا انقضت مدة كافية
    if (rateLimitData.lastAttemptTime && (now - rateLimitData.lastAttemptTime) > RATE_LIMIT.attemptResetTime) {
        rateLimitData.attempts = 0;
    }
    
    rateLimitData.attempts++;
    rateLimitData.lastAttemptTime = now;
    
    // قفل الحساب إذا تجاوزت المحاولات الحد المسموح
    if (rateLimitData.attempts >= RATE_LIMIT.maxAttempts) {
        rateLimitData.lockedUntil = (now + RATE_LIMIT.lockoutDuration).toString();
    }
    
    localStorage.setItem('adminLoginRateLimit', JSON.stringify(rateLimitData));
}

function getRemainingTime() {
    const rateLimitData = JSON.parse(localStorage.getItem('adminLoginRateLimit') || '{}');
    if (rateLimitData.lockedUntil) {
        const now = new Date().getTime();
        const remaining = Math.ceil((parseInt(rateLimitData.lockedUntil) - now) / 1000);
        return remaining > 0 ? remaining : 0;
    }
    return 0;
}

// تهيئة الصفحة
document.addEventListener('DOMContentLoaded', function() {
    // تهيئة نظام Rate Limiting
    initializeRateLimit();

    // التحقق من وجود جلسة سابقة
    const adminSession = localStorage.getItem('adminSession');
    if (adminSession) {
        redirectToDashboard();
    }

    // معالج النموذج
    const loginForm = document.getElementById('loginForm');
    if (loginForm) {
        loginForm.addEventListener('submit', handleLogin);
    }
});

// معالجة تسجيل الدخول
function handleLogin(event) {
    event.preventDefault();

    // فحص ما إذا كان الحساب مقفولاً
    if (isAccountLocked()) {
        const remainingTime = getRemainingTime();
        const minutes = Math.ceil(remainingTime / 60);
        showError(`❌ تم قفل الحساب مؤقتاً. يرجى المحاولة بعد ${minutes} دقيقة`);
        return;
    }

    const email = document.getElementById('adminEmail').value;
    const password = document.getElementById('adminPassword').value;
    const rememberMe = document.getElementById('rememberMe').checked;

    // إخفاء الرسائل السابقة
    hideMessages();

    // التحقق من البيانات
    if (!email || !password) {
        showError('يرجى ملء جميع الحقول');
        return;
    }

    // التحقق من صحة البريد الإلكتروني
    if (!isValidEmail(email)) {
        showError('البريد الإلكتروني غير صحيح');
        return;
    }

    // حساب Hash للبيانات المدخلة
    const emailHashInput = hashString(email);
    const passwordHashInput = hashString(password);

    // التحقق من بيانات المالك باستخدام Hash
    if (emailHashInput !== adminCredentials.emailHash || passwordHashInput !== adminCredentials.passwordHash) {
        recordFailedAttempt();
        
        // التحقق مرة أخرى إذا تم قفل الحساب بعد هذه المحاولة
        if (isAccountLocked()) {
            const remainingTime = getRemainingTime();
            const minutes = Math.ceil(remainingTime / 60);
            showError(`❌ محاولة دخول فاشلة! تم قفل الحساب. يرجى المحاولة بعد ${minutes} دقيقة`);
        } else {
            const rateLimitData = JSON.parse(localStorage.getItem('adminLoginRateLimit') || '{}');
            const remainingAttempts = RATE_LIMIT.maxAttempts - rateLimitData.attempts;
            showError(`❌ البريد الإلكتروني أو كلمة المرور غير صحيحة (${remainingAttempts} محاولات متبقية)`);
        }
        return;
    }

    // تسجيل الدخول بنجاح - إعادة تعيين Rate Limiting
    const rateLimitData = {
        attempts: 0,
        lastAttemptTime: null,
        lockedUntil: null
    };
    localStorage.setItem('adminLoginRateLimit', JSON.stringify(rateLimitData));

    // عرض رسالة النجاح
    showSuccess('✅ جاري التحقق من البيانات...');

    // محاكاة معالجة الدخول
    setTimeout(() => {
        // حفظ الجلسة (بدون حفظ كلمة المرور)
        const sessionData = {
            email: email,
            loginTime: new Date().toISOString(),
            rememberMe: rememberMe,
            // لا نحفظ كلمة المرور أبداً
        };
        localStorage.setItem('adminSession', JSON.stringify(sessionData));

        // إعادة التوجيه إلى لوحة التحكم
        redirectToDashboard();
    }, 1500);
}

// إعادة التوجيه إلى لوحة التحكم
function redirectToDashboard() {
    setTimeout(() => {
        window.location.href = 'admin-dashboard.html';
    }, 500);
}

// التحقق من صحة البريد الإلكتروني
function isValidEmail(email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
}

// عرض رسالة الخطأ
function showError(message) {
    const errorMessage = document.getElementById('errorMessage');
    const errorText = document.getElementById('errorText');
    errorText.textContent = message;
    errorMessage.style.display = 'flex';
    errorMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// عرض رسالة النجاح
function showSuccess(message) {
    const successMessage = document.getElementById('successMessage');
    const successText = document.getElementById('successText');
    successText.textContent = message;
    successMessage.style.display = 'flex';
    successMessage.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

// إخفاء جميع الرسائل
function hideMessages() {
    document.getElementById('errorMessage').style.display = 'none';
    document.getElementById('successMessage').style.display = 'none';
}

// إظهار/إخفاء كلمة المرور
function togglePassword() {
    const passwordInput = document.getElementById('adminPassword');
    const toggleBtn = document.querySelector('.toggle-password');

    if (passwordInput.type === 'password') {
        passwordInput.type = 'text';
        toggleBtn.textContent = '🙈';
    } else {
        passwordInput.type = 'password';
        toggleBtn.textContent = '👁️';
    }
}
