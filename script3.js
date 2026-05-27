// متغيرات عامة - INDEX3 (مستقل تماماً عن INDEX)
let currentUser = null;
let userPassword = '';
let displayValue = '0';
let files = [];
let deletedFiles = []; // سلة المحذوفات
let backupFiles = []; // النسخ الاحتياطية (الملفات المحذوفة نهائياً)
let currentMediaIndex = -1;
let currentFilter = 'all'; // متغير لتتبع الفلترة الحالية
let db = null; // قاعدة بيانات IndexedDB

// ===== حدود التخزين الخاصة بـ INDEX3 =====
const MAX_UPLOAD_SIZE_INDEX3 = 300 * 1024 * 1024; // 300MB حد أقصى للتحميل
const MAX_RESTORE_FILES = 50; // 50 ملف كحد أقصى للاستعادة
const MAX_RESTORE_SIZE = 300 * 1024 * 1024; // 300MB حد أقصى للاستعادة

let hasStoragePermission = localStorage.getItem('pr_safe_permission_INDEX3') === 'true'; // متغير لتتبع حالة الإذن (مستقل)

// ==================== إدارة قاعدة البيانات IndexedDB ====================

function initDatabase() {
    return new Promise((resolve, reject) => {
        // إغلاق أي اتصال قديم
        if (db) {
            db.close();
            db = null;
        }
        
        const request = indexedDB.open('mediaAppDB_INDEX3', 3); // قاعدة بيانات منفصلة لـ INDEX3
        
        request.onerror = function() {
            console.error('❌ خطأ في فتح قاعدة البيانات');
            reject(request.error);
        };
        
        request.onsuccess = function(event) {
            db = event.target.result;
            console.log('✅ تم فتح قاعدة البيانات بنجاح (INDEX3 - الإصدار: 3)');
            resolve(db);
        };
        
        request.onupgradeneeded = function(event) {
            const database = event.target.result;
            console.log('🔄 جاري ترقية قاعدة البيانات...');
            
            // إنشاء جدول الملفات إذا لم يكن موجوداً
            if (!database.objectStoreNames.contains('mediaFiles')) {
                database.createObjectStore('mediaFiles', { keyPath: 'id' });
                console.log('✅ تم إنشاء جدول الملفات');
            }
            
            // إنشاء جدول الملفات المحذوفة
            if (!database.objectStoreNames.contains('deletedFiles')) {
                database.createObjectStore('deletedFiles', { keyPath: 'id' });
                console.log('✅ تم إنشاء جدول الملفات المحذوفة');
            }
            
            // ✅ إنشاء جدول النسخ الاحتياطية (بيانات كاملة)
            if (!database.objectStoreNames.contains('backupData')) {
                database.createObjectStore('backupData', { keyPath: 'id' });
                console.log('✅ تم إنشاء جدول النسخ الاحتياطية');
            }
        };
    });
}

// حفظ ملف في IndexedDB
function saveFileToIndexedDB(fileObject) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['mediaFiles'], 'readwrite');
        const objectStore = transaction.objectStore('mediaFiles');
        const request = objectStore.put(fileObject);
        
        request.onerror = function() {
            console.error('❌ خطأ في حفظ الملف:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = function() {
            console.log('✅ تم حفظ الملف في IndexedDB:', fileObject.name);
            resolve();
        };
    });
}

// حفظ ملف محذوف في IndexedDB
function saveDeletedFileToIndexedDB(fileObject) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['deletedFiles'], 'readwrite');
        const objectStore = transaction.objectStore('deletedFiles');
        const request = objectStore.put(fileObject);
        
        request.onerror = function() {
            console.error('❌ خطأ في حفظ الملف المحذوف:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = function() {
            console.log('✅ تم حفظ الملف المحذوف في IndexedDB:', fileObject.name);
            resolve();
        };
    });
}

// تحميل جميع الملفات من IndexedDB
function loadFilesFromIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['mediaFiles'], 'readonly');
        const objectStore = transaction.objectStore('mediaFiles');
        const request = objectStore.getAll();
        
        request.onerror = function() {
            console.error('❌ خطأ في تحميل الملفات:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = function(event) {
            const loadedFiles = event.target.result || [];
            console.log(`✅ تم تحميل ${loadedFiles.length} ملف من IndexedDB`);
            resolve(loadedFiles);
        };
    });
}

// استرجاع ملف معين من IndexedDB بواسطة ID
function getFileFromIndexedDB(fileId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['mediaFiles'], 'readonly');
        const objectStore = transaction.objectStore('mediaFiles');
        const request = objectStore.get(fileId);
        
        request.onerror = function() {
            console.error('❌ خطأ في استرجاع الملف:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = function(event) {
            const file = event.target.result;
            if (file) {
                console.log(`✅ تم استرجاع الملف من IndexedDB:`, file.name);
                resolve(file);
            } else {
                console.warn(`⚠️ الملف غير موجود في IndexedDB (ID: ${fileId})`);
                resolve(null);
            }
        };
    });
}

// حذف ملف من IndexedDB
function deleteFileFromIndexedDB(fileId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['mediaFiles'], 'readwrite');
        const objectStore = transaction.objectStore('mediaFiles');
        const request = objectStore.delete(fileId);
        
        request.onerror = function() {
            console.error('❌ خطأ في حذف الملف:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = function() {
            console.log('✅ تم حذف الملف من IndexedDB');
            resolve();
        };
    });
}

// حذف ملف من mediaFiles مباشرة (بدون async/await)
function deleteFileFromMediaFiles(fileId) {
    if (!db) {
        console.warn('⚠️ قاعدة البيانات غير مهيأة');
        return;
    }
    
    try {
        const transaction = db.transaction(['mediaFiles'], 'readwrite');
        const objectStore = transaction.objectStore('mediaFiles');
        objectStore.delete(fileId);
        
        transaction.onerror = function() {
            console.error('❌ خطأ في حذف الملف من mediaFiles:', transaction.error);
        };
        
        transaction.oncomplete = function() {
            console.log('✅ تم حذف الملف من mediaFiles فوراً');
        };
    } catch (error) {
        console.error('❌ خطأ في محاولة حذف الملف:', error);
    }
}

// نقل ملف إلى سلة المحذوفات
function moveFileToTrash(fileObject) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        // أضيف معلومات الحذف
        const deletedFile = {
            ...fileObject,
            deletedAt: new Date().toLocaleString('ar-EG')
        };
        
        const transaction = db.transaction(['deletedFiles', 'mediaFiles'], 'readwrite');
        
        // أضيف إلى جدول deletedFiles
        const deletedStore = transaction.objectStore('deletedFiles');
        const putRequest = deletedStore.put(deletedFile);
        
        // احذف من جدول mediaFiles
        const mediaStore = transaction.objectStore('mediaFiles');
        const deleteRequest = mediaStore.delete(fileObject.id);
        
        transaction.onerror = function() {
            console.error('❌ خطأ في نقل الملف إلى سلة المحذوفات:', transaction.error);
            reject(transaction.error);
        };
        
        transaction.oncomplete = function() {
            console.log('✅ تم نقل الملف إلى سلة المحذوفات ومسحه من mediaFiles');
            resolve();
        };
    });
}

// تحميل الملفات المحذوفة من IndexedDB
function loadDeletedFilesFromIndexedDB() {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['deletedFiles'], 'readonly');
        const objectStore = transaction.objectStore('deletedFiles');
        const request = objectStore.getAll();
        
        request.onerror = function() {
            console.error('❌ خطأ في تحميل الملفات المحذوفة:', request.error);
            reject(request.error);
        };
        
        request.onsuccess = function(event) {
            const loadedFiles = event.target.result || [];
            console.log(`✅ تم تحميل ${loadedFiles.length} ملف من سلة المحذوفات`);
            resolve(loadedFiles);
        };
    });
}

// استعادة ملف من سلة المحذوفات
function restoreFileFromTrash(fileId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        // أولاً: احصل على الملف من deletedFiles
        const transaction = db.transaction(['deletedFiles', 'mediaFiles'], 'readwrite');
        const deletedStore = transaction.objectStore('deletedFiles');
        const getRequest = deletedStore.get(fileId);
        
        getRequest.onsuccess = function() {
            const file = getRequest.result;
            if (file) {
                // أزيل معلومات الحذف
                const restoredFile = { ...file };
                delete restoredFile.deletedAt;
                
                // أضيف إلى mediaFiles
                const mediaStore = transaction.objectStore('mediaFiles');
                mediaStore.put(restoredFile);
                
                // احذف من deletedFiles
                deletedStore.delete(fileId);
            }
        };
        
        transaction.onerror = function() {
            console.error('❌ خطأ في استعادة الملف:', transaction.error);
            reject(transaction.error);
        };
        
        transaction.oncomplete = function() {
            console.log('✅ تم استعادة الملف من سلة المحذوفات إلى mediaFiles');
            resolve();
        };
    });
}

// حذف نهائي من سلة المحذوفات
function permanentlyDeleteFile(fileId) {
    return new Promise((resolve, reject) => {
        if (!db) {
            reject(new Error('قاعدة البيانات غير مهيأة'));
            return;
        }
        
        const transaction = db.transaction(['deletedFiles'], 'readwrite');
        const objectStore = transaction.objectStore('deletedFiles');
        const request = objectStore.delete(fileId);
        
        request.onerror = function() {
            console.error('❌ خطأ في الحذف النهائي:', request.error);
            reject(request.error);
        };
        
        transaction.oncomplete = function() {
            console.log('✅ تم حذف الملف نهائياً من deletedFiles');
            resolve();
        };
    });
}

// ==================== وظائف التسجيل والدخول ====================

function toggleLoginMode() {
    const registerForm = document.getElementById('registerForm').parentElement;
    const loginMode = document.getElementById('loginMode');
    
    if (loginMode.style.display === 'none') {
        loginMode.style.display = 'block';
        registerForm.style.display = 'none';
    } else {
        loginMode.style.display = 'none';
        registerForm.style.display = 'block';
    }
}

// التسجيل
document.getElementById('registerForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const email = document.getElementById('email').value;
    const password = document.getElementById('password').value;
    const confirmPassword = document.getElementById('confirmPassword').value;
    
    if (password !== confirmPassword) {
        alert('⚠️ كلمات السر غير متطابقة!');
        return;
    }
    
    if (!isValidEmail(email)) {
        alert('⚠️ البريد الإلكتروني غير صحيح!');
        return;
    }
    
    // حفظ الحساب في localStorage
    const account = {
        email: email,
        password: password,
        createdAt: new Date().toLocaleString('ar-EG')
    };      localStorage.setItem('userAccount_INDEX3', JSON.stringify(account));
    localStorage.setItem('currentUserEmail_INDEX3', email);
    currentUser = email;
    userPassword = password;
      alert('✅ تم إنشاء الحساب بنجاح!\nالبريد: ' + email);
      // تأخير قليل ثم الانتقال إلى الصفحة الرئيسية
    setTimeout(() => {
        window.location.href = 'index3.html';
    }, 500);
    
    // مسح النموذج
    this.reset();
});

// تسجيل الدخول
document.getElementById('loginForm').addEventListener('submit', function(e) {
    e.preventDefault();
    
    const email = document.getElementById('loginEmail').value;
    const password = document.getElementById('loginPassword').value;
      const account = JSON.parse(localStorage.getItem('userAccount_INDEX3'));
    
    if (!account) {
        alert('⚠️ لم يتم العثور على أي حساب. الرجاء إنشاء حساب جديد أولاً!');
        toggleLoginMode();
        return;
    }
      if (account.email === email && account.password === password) {
        currentUser = email;
        userPassword = password;
        localStorage.setItem('currentUserEmail_INDEX3', email);
        alert('✅ مرحباً ' + email);
        
        // التحقق من الاشتراك الحالي
        const currentSub = localStorage.getItem('userSubscription_INDEX3');
        if (currentSub) {
            // لديه اشتراك بالفعل - الانتقال للتطبيق
            showPage('calculatorPage');        } else {
            // لا يوجد اشتراك - الانتقال للصفحة الرئيسية
            setTimeout(() => {
                window.location.href = 'index3.html';
            }, 500);
        }
        this.reset();
    } else {
        alert('⚠️ البريد الإلكتروني أو كلمة السر غير صحيحة!');
    }
});

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// تغيير كلمة السر
function changePassword() {    const newPassword = prompt('أدخل كلمة السر الجديدة:');
    if (newPassword && newPassword.length >= 6) {
        const account = JSON.parse(localStorage.getItem('userAccount_INDEX3'));
        account.password = newPassword;
        localStorage.setItem('userAccount_INDEX3', JSON.stringify(account));
        userPassword = newPassword;
        alert('✅ تم تغيير كلمة السر بنجاح!');
    } else if (newPassword) {
        alert('⚠️ كلمة السر يجب أن تكون 6 أحرف على الأقل!');
    }
}

// تسجيل الخروج
function logout() {    if (confirm('هل أنت متأكد من رغبتك في تسجيل الخروج؟')) {
        // ✅ إلغاء فلترة النسخ الاحتياطية عند الخروج
        sessionStorage.removeItem('backupFilterDateFrom_INDEX3');
        sessionStorage.removeItem('backupFilterDateTo_INDEX3');
        
        // إعادة تعيين الفلترة الحالية
        currentFilter = 'all';
        
        // مسح البيانات
        currentUser = null;
        userPassword = '';
        
        showPage('loginPage');
        document.getElementById('loginForm').reset();
        document.getElementById('registerForm').reset();
        document.getElementById('loginMode').style.display = 'none';
        document.getElementById('registerForm').parentElement.style.display = 'block';
    }
}

// مسح سجل النقل
function clearTransferHistory() {
    if (confirm('هل تريد مسح سجل النقل؟\nهذا قد يساعد في تحرير مساحة التخزين.')) {
        localStorage.removeItem('transferred_files_INDEX3');
        showNotification('✅ تم مسح سجل النقل بنجاح');
        console.log('🗑️ تم مسح سجل النقل');
    }
}

// ==================== وظائف الحاسبة ====================

function appendNumber(num) {
    if (displayValue === '0' && num !== '.') {
        displayValue = num;
    } else if (num === '.' && displayValue.includes('.')) {
        return;
    } else {
        displayValue += num;
    }
    updateDisplay();
}

function appendOperator(op) {
    if (displayValue && !displayValue.endsWith('+') && !displayValue.endsWith('-') && 
        !displayValue.endsWith('*') && !displayValue.endsWith('/')) {
        displayValue += op;
        updateDisplay();
    }
}

function calculate() {
    // التحقق من كلمة المرور السرية
    // إذا أدخل المستخدم كلمة المرور في الحاسبة والضغط على =، ينتقل للملفات
    if (displayValue === userPassword) {
        showNotification('✅ تم التحقق! جاري فتح الملفات المخفية...');
        setTimeout(() => {
            showPage('mediaPage');
            loadFiles();
            clearDisplay();
        }, 500);
        return;
    }
    
    // وإلا قم بالحساب العادي
    try {
        displayValue = eval(displayValue).toString();
    } catch (e) {
        displayValue = 'خطأ';
    }
    updateDisplay();
}

function clearDisplay() {
    displayValue = '0';
    updateDisplay();
}

function backspace() {
    if (displayValue.length > 1) {
        displayValue = displayValue.slice(0, -1);
    } else {
        displayValue = '0';
    }
    updateDisplay();
}

function updateDisplay() {
    document.getElementById('display').value = displayValue;
}

// ==================== وظائف التحكم في المحمل ====================

function showLoadingIndicator(text = 'جاري التحميل...') {
    const loader = document.getElementById('loadingIndicator');
    const loadingText = document.getElementById('loadingText');
    const progressBar = document.getElementById('progressBar');
    
    if (loader) {
        loadingText.textContent = text;
        progressBar.style.width = '0%';
        loader.style.display = 'block';
        loader.classList.add('show');
    }
}

function hideLoadingIndicator() {
    const loader = document.getElementById('loadingIndicator');
    if (loader) {
        loader.classList.remove('show');
        setTimeout(() => {
            loader.style.display = 'none';
        }, 300);
    }
}

function updateLoadingProgress(percent) {
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.animation = 'none';
        progressBar.style.width = Math.min(percent, 95) + '%';
    }
}

function completeLoading() {
    const progressBar = document.getElementById('progressBar');
    if (progressBar) {
        progressBar.style.animation = 'none';
        progressBar.style.width = '100%';
    }
    setTimeout(async () => {
        hideLoadingIndicator();
        // ✅ تحديث قائمة الملفات بعد انتهاء التحميل
        try {
            // إعادة تحميل الملفات من IndexedDB
            const loadedFiles = await loadFilesFromIndexedDB();
            files = loadedFiles || [];
            console.log(`✅ تم تحديث الملفات: ${files.length} ملف`);
            
            // عرض الملفات على الفور
            displayFiles();
            console.log('✅ تم تحديث واجهة المستخدم بنجاح');
        } catch (error) {
            console.error('❌ خطأ في تحديث الملفات:', error);
            displayFiles();
        }
    }, 500);
}

// ==================== وظائف الملفات ====================

function toggleMediaPage() {
    const loginPage = document.getElementById('loginPage');
    const calculatorPage = document.getElementById('calculatorPage');
    const mediaPage = document.getElementById('mediaPage');
    
    if (mediaPage.style.display === 'none' || !mediaPage.classList.contains('active')) {
        showPage('mediaPage');
        loadFilesOnStart();
    } else {
        showPage('calculatorPage');
    }
}

function showPage(pageName) {
    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    document.getElementById(pageName).classList.add('active');
}

// معالجة رفع الملفات - يتم إضافتها عند تحميل الصفحة
function initFileUpload() {
    const fileInput = document.getElementById('fileInput');
    if (!fileInput) return;
    
    const uploadBox = document.querySelector('.upload-box');
    
    // إضافة حدث الضغط على upload box
    if (uploadBox) {
        uploadBox.addEventListener('click', function(e) {
            if (e.target === uploadBox || uploadBox.contains(e.target)) {
                // التحقق من الإذن أولاً
                if (!checkPermissionBeforeUpload()) {
                    return;
                }
            }
        });
    }
    
    fileInput.addEventListener('change', function(e) {
        // التحقق من الإذن
        if (!checkPermissionBeforeUpload()) {
            fileInput.value = '';
            return;
        }
        
        const newFiles = Array.from(e.target.files);
        let totalFiles = newFiles.length;
        let loadedCount = 0;
        
        if (newFiles.length === 0) {
            showNotification('⚠️ لم تختر أي ملفات');
            return;
        }
        
        // إظهار المحمل
        showLoadingIndicator(`جاري تحميل الملفات (0/${totalFiles})...`);
          newFiles.forEach((file, fileIndex) => {
            // قائمة الملفات المدعومة
            const supportedTypes = [
                'image/jpeg', 'image/jpg', 'image/png', 'image/gif', 'image/webp', 'image/bmp',
                'video/mp4', 'video/webm', 'video/ogg', 'video/quicktime', 'video/x-msvideo',
                'video/mpeg', 'video/3gpp', 'video/x-matroska'
            ];
            
            const isSupported = file.type.startsWith('image/') || file.type.startsWith('video/') || 
                               supportedTypes.includes(file.type);
              if (isSupported) {                // التحقق من حجم الملف الفردي (حد أقصى 300 MB للـ INDEX3)
                if (file.size > MAX_UPLOAD_SIZE_INDEX3) {
                    showNotification('⚠️ الملف كبير جداً: ' + file.name + ' (الحد الأقصى 300 MB)');
                    loadedCount++;
                    updateLoadingProgress((loadedCount / totalFiles) * 100);
                    
                    // إذا انتهينا من جميع الملفات
                    if (loadedCount === totalFiles) {
                        completeLoading();
                    }
                    return;
                }
                  // ✅ التحقق من الإجمالي الكلي للملفات المحملة
                let currentTotal = 0;
                files.forEach(f => {
                    const sizeStr = f.size.replace(' MB', '');
                    currentTotal += parseFloat(sizeStr);
                });
                
                const newFileSize = file.size / 1024 / 1024;
                const maxStorageLimit = 300; // الحد الأقصى 300 MB
                if (currentTotal + newFileSize > maxStorageLimit) {
                    showNotification(`⚠️ تجاوز حد التخزين الأقصى!\n\nالحد الأقصى: ${maxStorageLimit} MB\nالمستخدم: ${currentTotal.toFixed(2)} MB\nحجم الملف: ${newFileSize.toFixed(2)} MB\n\nلا يمكن تحميل: ${file.name}`);
                    loadedCount++;
                    updateLoadingProgress((loadedCount / totalFiles) * 100);
                    
                    if (loadedCount === totalFiles) {
                        completeLoading();
                    }
                    return;
                }
                  const reader = new FileReader();                reader.onload = async function(event) {
                    try {
                        let fileData = event.target.result;
                        
                        // احفظ الملف كاملاً بدون قطع
                        const fileObject = {
                            id: Date.now() + Math.random(),
                            name: file.name,
                            type: file.type,
                            data: fileData,
                            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                            uploadedAt: new Date().toLocaleString('ar-EG'),
                            isLocked: true,
                            isCompressed: false
                        };
                        
                        try {
                            // ✅ حفظ الملف مباشرة في IndexedDB بدون تأخير
                            await saveFileToIndexedDB(fileObject);
                            files.push(fileObject);
                            console.log('✅ تم حفظ الملف في IndexedDB:', fileObject.name);
                        } catch (storageError) {
                            console.error('❌ خطأ في حفظ الملف:', storageError);
                            showNotification('❌ خطأ في حفظ الملف: ' + file.name);
                        }
                        loadedCount++;
                        
                        const fileType = file.type.startsWith('image/') ? '🖼️' : '🎥';
                        showNotification(`${fileType} تم تحميل ${file.name}`);
                        
                        // عرض رسالة التخزين الآمن
                        showSecurityAlert(file.name, fileObject.size, file.type);
                        
                        // تحديث نسبة التقدم
                        updateLoadingProgress((loadedCount / totalFiles) * 100);
                        document.getElementById('loadingText').textContent = `جاري التحميل (${loadedCount}/${totalFiles})...`;
                        
                        // إذا انتهينا من جميع الملفات
                        if (loadedCount === totalFiles) {
                            completeLoading();
                        }
                    } catch (error) {
                        showNotification('❌ خطأ في حفظ: ' + file.name);
                        console.error('Error saving file:', error);
                        files.pop();
                        loadedCount++;
                        
                        if (loadedCount === totalFiles) {
                            completeLoading();
                        }
                    }
                };
                
                reader.onerror = function(error) {
                    showNotification('❌ خطأ في قراءة: ' + file.name);
                    loadedCount++;
                    
                    if (loadedCount === totalFiles) {
                        completeLoading();
                    }
                };
                
                reader.readAsDataURL(file);
            } else {
                showNotification('⚠️ نوع ملف غير مدعوم: ' + file.name);
                loadedCount++;
                
                if (loadedCount === totalFiles) {
                    completeLoading();
                }
            }
        });
        
    this.value = '';
    });
    
    // دعم السحب والإفلات
    if (uploadBox) {
        uploadBox.addEventListener('dragover', function(e) {
            e.preventDefault();
            uploadBox.style.backgroundColor = '#e0e0ff';
            uploadBox.style.borderColor = '#764ba2';
        });
        
        uploadBox.addEventListener('dragleave', function(e) {
            uploadBox.style.backgroundColor = '#f8f9ff';
            uploadBox.style.borderColor = '#667eea';
        });
        
        uploadBox.addEventListener('drop', function(e) {
            e.preventDefault();
            uploadBox.style.backgroundColor = '#f8f9ff';
            uploadBox.style.borderColor = '#667eea';
            
            const droppedFiles = e.dataTransfer.files;
            fileInput.files = droppedFiles;
            
            const event = new Event('change', { bubbles: true });
            fileInput.dispatchEvent(event);
        });
    }
}

// دالة مساعدة: تحويل حجم الملف إلى MB بأمان
function getSizeInMB(fileSize) {
    if (!fileSize) return 0;
    
    let sizeStr = fileSize.toString().trim();
    
    // إذا كانت الصيغة "X.XX MB"
    if (sizeStr.includes(' MB')) {
        sizeStr = sizeStr.replace(' MB', '').trim();
    }
    // إذا كانت بايت
    else if (sizeStr.match(/^\d+$/)) {
        return parseFloat((sizeStr / 1024 / 1024).toFixed(2));
    }
    
    return parseFloat(sizeStr) || 0;
}

// حساب إجمالي حجم الملفات
function calculateTotalSize() {
    let total = 0;
    files.forEach(file => {
        total += getSizeInMB(file.size);
    });
    return total.toFixed(2) + ' MB';
}

// الحصول على معلومات الذاكرة المتاحة
function getStorageInfo() {
    try {
        const maxStorage = 300; // MB (300MB limit for INDEX3)
        // Calculate actual used storage by summing file sizes
        const usedSize = files.reduce((total, file) => {
            return total + getSizeInMB(file.size);
        }, 0);
        const available = Math.max(0, maxStorage - usedSize);
          return {
            used: usedSize.toFixed(2) + ' MB',
            available: available.toFixed(2) + ' MB',
            max: maxStorage + ' MB',
            percentUsed: Math.min(100, (usedSize / maxStorage * 100).toFixed(0))
        };
    } catch (e) {
        return { used: 'غير معروف', available: 'غير معروف', max: '300 MB' };
    }
}

// حفظ الملفات في IndexedDB (بدون قطع البيانات)
async function saveFiles() {
    try {
        if (!db) {
            console.warn('⚠️ قاعدة البيانات غير مهيأة');
            return;
        }
        
        console.log('💾 جاري حفظ الملفات...');
        
        // إنشاء مصفوفة من الـ Promises للملفات النشطة في IndexedDB
        const saveActivePromises = files.map(file => 
            saveFileToIndexedDB(file).catch(error => {
                console.error('❌ خطأ في حفظ الملف:', file.name, error);
            })
        );
        
        // انتظر انتهاء جميع العمليات
        await Promise.all(saveActivePromises);
        
        // احفظ الملفات المحذوفة في localStorage (metadata فقط)
        saveDeletedFilesToLocalStorage();
        
        // احفظ الملفات المحذوفة في IndexedDB (مع البيانات الكاملة)
        await saveDeletedFilesToIndexedDB();
        
        console.log('✅ تم حفظ ' + files.length + ' ملف(ات) و ' + deletedFiles.length + ' ملف محذوف بنجاح');
    } catch (error) {
        console.error('❌ خطأ في الحفظ:', error);
    }
}

// حفظ بديل في localStorage (للحالات القديمة)
function saveFilesLegacy() {
    try {
        // احفظ البيانات الأساسية فقط بدون data URLs
        const fileMetadata = files.map(f => ({
            id: f.id,
            name: f.name,
            type: f.type,
            size: f.size,
            uploadedAt: f.uploadedAt,
            isLocked: f.isLocked,
            isCompressed: f.isCompressed,
            storedInIndexedDB: true
        }));
        
        const deletedMetadata = deletedFiles.map(f => ({
            id: f.id,
            name: f.name,
            type: f.type,
            size: f.size,
            uploadedAt: f.uploadedAt,
            deletedAt: f.deletedAt,
            storedInIndexedDB: true
        }));
        
        localStorage.setItem('mediaFilesMetadata_INDEX3', JSON.stringify(fileMetadata));
        localStorage.setItem('deletedFilesMetadata_INDEX3', JSON.stringify(deletedMetadata));
        console.log('✅ تم حفظ معلومات الملفات في localStorage (INDEX3)');
    } catch (error) {
        console.error('❌ خطأ في الحفظ البديل:', error);
    }
}

// حذف أقدم ملف لتحرير المساحة
function deleteOldestFile() {
    if (files.length <= 1) return false;
    
    // ترتيب الملفات حسب تاريخ الرفع
    files.sort((a, b) => new Date(a.uploadedAt) - new Date(b.uploadedAt));
    
    const deletedFile = files.shift();
    showNotification('🗑️ تم حذف الملف الأقدم: ' + deletedFile.name);
    return true;
}

// ضغط الفيديوهات الكبيرة
function compressLargeVideos() {
    const largeVideos = files.filter(f => 
        f.type.startsWith('video/') && parseFloat(f.size) > 50
    );
    
    console.log('جاري ضغط ' + largeVideos.length + ' فيديو(هات)');
    
    largeVideos.forEach(video => {
        try {
            // تقليل جودة البيانات (إزالة بعض البايتات)
            if (video.data && video.data.length > 10 * 1024 * 1024) {
                // حفظ فقط أول 90% من الفيديو (معاينة جيدة)
                const truncatedData = video.data.substring(0, video.data.length * 0.9);
                video.data = truncatedData;
                video.isCompressed = true;
                console.log('✅ تم ضغط: ' + video.name);
            }
        } catch (e) {
            console.error('خطأ في ضغط:', video.name, e);
        }
    });
}

// حفظ الملفات المحذوفة في localStorage (metadata فقط - البيانات الكاملة تُحفظ في IndexedDB)
function saveDeletedFilesToLocalStorage() {
    try {
        const deletedMetadata = deletedFiles.map(f => ({
            id: f.id,
            name: f.name,
            type: f.type,
            size: f.size,
            deletedAt: f.deletedAt,        uploadedAt: f.uploadedAt,
            isLocked: f.isLocked
        }));
        
        localStorage.setItem('deletedFilesMetadata_INDEX3', JSON.stringify(deletedMetadata));
        console.log('✅ تم حفظ الملفات المحذوفة في localStorage (INDEX3)');
    } catch (error) {
        console.error('❌ خطأ في حفظ الملفات المحذوفة:', error);
    }
}

// حفظ الملفات المحذوفة في IndexedDB (مع البيانات الكاملة)
async function saveDeletedFilesToIndexedDB() {
    return new Promise((resolve, reject) => {
        try {
            if (!db) {
                console.warn('⚠️ قاعدة البيانات غير مهيأة');
                resolve();
                return;
            }
            
            const transaction = db.transaction(['deletedFiles'], 'readwrite');
            const objectStore = transaction.objectStore('deletedFiles');
            
            // احذف جميع السجلات القديمة أولاً
            const clearRequest = objectStore.clear();
            
            clearRequest.onsuccess = function() {
                // أضف جميع الملفات المحذوفة الحالية
                deletedFiles.forEach(file => {
                    try {
                        objectStore.put({  // استخدم put بدلاً من add
                            id: file.id,
                            name: file.name,
                            type: file.type,
                            size: file.size,
                            data: file.data,  // ✅ حفظ البيانات الكاملة
                            deletedAt: file.deletedAt,
                            uploadedAt: file.uploadedAt,
                            isLocked: file.isLocked || false
                        });
                    } catch (error) {
                        console.error('❌ خطأ في إضافة الملف المحذوف:', file.name, error);
                    }
                });
            };
            
            clearRequest.onerror = function() {
                console.error('❌ خطأ في مسح الملفات المحذوفة القديمة:', clearRequest.error);
            };
            
            transaction.oncomplete = function() {
                console.log('✅ تم حفظ الملفات المحذوفة في IndexedDB بنجاح');
                resolve();
            };
            
            transaction.onerror = function() {
                console.error('❌ خطأ في حفظ الملفات المحذوفة في IndexedDB:', transaction.error);
                reject(transaction.error);
            };
        } catch (error) {
            console.error('❌ خطأ في حفظ الملفات المحذوفة:', error);
            reject(error);
        }
    });
}

// تحميل الملفات المحذوفة من localStorage (metadata فقط)
function loadDeletedFilesFromLocalStorage() {
    try {
        const stored = localStorage.getItem('deletedFilesMetadata_INDEX3');
        if (stored) {
            const deletedMetadata = JSON.parse(stored);
            console.log(`✅ تم تحميل ${deletedMetadata.length} ملف محذوف من localStorage (INDEX3)`);
            return deletedMetadata;
        }
    } catch (error) {
        console.error('❌ خطأ في تحميل الملفات المحذوفة من localStorage:', error);
    }
    return [];
}

// تحميل الملفات المحذوفة من IndexedDB (مع البيانات الكاملة)
async function loadDeletedFilesFromIndexedDB() {
    return new Promise((resolve, reject) => {
        try {
            if (!db) {
                console.warn('⚠️ قاعدة البيانات غير مهيأة');
                resolve([]);
                return;
            }
            
            const transaction = db.transaction(['deletedFiles'], 'readonly');
            const objectStore = transaction.objectStore('deletedFiles');
            const getAllRequest = objectStore.getAll();
            
            getAllRequest.onsuccess = function() {
                const loadedFiles = getAllRequest.result;
                console.log(`✅ تم تحميل ${loadedFiles.length} ملف محذوف من IndexedDB`);
                resolve(loadedFiles);
            };
            
            getAllRequest.onerror = function() {
                console.error('❌ خطأ في تحميل الملفات المحذوفة من IndexedDB');
                resolve([]);
            };
        } catch (error) {
            console.error('❌ خطأ في تحميل الملفات المحذوفة:', error);
            resolve([]);
        }
    });
}

// تحميل الملفات من IndexedDB عند بدء التطبيق
async function loadFilesOnStart() {
    try {
        // تأكد من تهيئة قاعدة البيانات
        if (!db) {
            await initDatabase();
        }
        
        console.log('🔄 جاري تحميل الملفات من IndexedDB...');
        
        // حمل الملفات النشطة من IndexedDB
        const loadedFiles = await loadFilesFromIndexedDB();
        files = loadedFiles || [];
        console.log(`✅ تم تحميل ${files.length} ملف من IndexedDB`);
        
        // حمل الملفات المحذوفة من IndexedDB (مع البيانات الكاملة)
        deletedFiles = await loadDeletedFilesFromIndexedDB() || [];
        console.log(`✅ تم تحميل ${deletedFiles.length} ملف من سلة المحذوفات`);
          // ✅ حمل النسخ الاحتياطية من localStorage المنفصل عن INDEX والبيانات الكاملة من IndexedDB
        const backupMetadata = JSON.parse(localStorage.getItem('backup_files_INDEX3')) || [];
        console.log(`📋 تم تحميل ${backupMetadata.length} معلومات نسخة احتياطية (INDEX3)`);
        
        // تحميل البيانات الكاملة من جدول backupData في IndexedDB
        for (const backupInfo of backupMetadata) {
            const fullBackupFile = await getFullBackupFileData(backupInfo.id);
            if (fullBackupFile) {
                // إذا كانت البيانات الكاملة موجودة، أضفها إلى backupFiles
                if (!backupFiles.find(f => f.id === backupInfo.id)) {
                    backupFiles.push(fullBackupFile);
                }
            }
        }
        console.log(`✅ تم تحميل ${backupFiles.length} ملف من النسخ الاحتياطية`);
        
    } catch (error) {
        console.error('❌ خطأ في تحميل الملفات:', error);
        console.warn('⚠️ لم يتمكن من الوصول إلى قاعدة البيانات');
        
        files = [];
        deletedFiles = [];
        
        showNotification('⚠️ لم يتم العثور على ملفات محفوظة. ابدأ برفع ملفات جديدة.');
    }
    
    currentFilter = 'all';
    displayFiles();
}

// تحميل الملفات من IndexedDB (أثناء الرفع) - لا تستبدل الملفات الموجودة
async function loadFiles() {
    try {
        if (!db) {
            await initDatabase();
        }
        
        // تحميل الملفات النشطة من mediaFiles فقط
        const loadedFiles = await loadFilesFromIndexedDB();
        if (loadedFiles && loadedFiles.length > 0) {
            // ✅ دمج الملفات: الملفات الموجودة + الملفات الجديدة من IndexedDB
            const existingIds = new Set(files.map(f => f.id));
            const newFiles = loadedFiles.filter(f => !existingIds.has(f.id));
            
            if (newFiles.length > 0) {
                files.push(...newFiles);
                console.log(`✅ تم تحميل ${newFiles.length} ملف جديد من mediaFiles`);
            }
        }
        
        // تحميل الملفات المحذوفة من deletedFiles
        const loadedDeletedFiles = await loadDeletedFilesFromIndexedDB();
        if (loadedDeletedFiles && loadedDeletedFiles.length > 0) {
            // ✅ دمج الملفات المحذوفة: الموجودة + الجديدة
            const existingDeletedIds = new Set(deletedFiles.map(f => f.id));
            const newDeletedFiles = loadedDeletedFiles.filter(f => !existingDeletedIds.has(f.id));
            
            if (newDeletedFiles.length > 0) {
                deletedFiles.push(...newDeletedFiles);
                console.log(`✅ تم تحميل ${newDeletedFiles.length} ملف محذوف جديد من deletedFiles`);
            }
        }    } catch (error) {
        console.error('❌ خطأ في تحميل الملفات:', error);
    }
}

// دالة الحصول على شريط معلومات الاشتراك
function getSubscriptionInfoBar() {
    try {
        const currentSub = localStorage.getItem('userSubscription_INDEX3');
        if (!currentSub) {
            return '';
        }
        
        const subInfo = JSON.parse(currentSub);
        const subType = subInfo.type || 'مجاني';
        const expiryDate = subInfo.expiryDate || 'غير محدد';
        
        return `
            <div style="grid-column: 1/-1; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); 
                        color: white; padding: 12px; border-radius: 8px; margin-bottom: 15px; font-size: 12px;">
                🎯 الاشتراك الحالي: <strong>${subType}</strong> | ⏰ ينتهي: ${expiryDate}
            </div>
        `;
    } catch (error) {
        console.warn('⚠️ خطأ في عرض معلومات الاشتراك:', error);
        return '';
    }
}

// عرض الملفات
function displayFiles() {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    
    // ✅ مسح الواجهة تماماً وإعادة بناؤها
    filesList.innerHTML = '';
      // إذا لم توجد ملفات، عرض رسالة فقط
    if (files.length === 0) {
        // ✅ تحديث الإحصائيات حتى لو كانت فارغة
        updateStats([]);
        
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        emptyDiv.innerHTML = '<p>📂 لا توجد ملفات مخفية حتى الآن</p>';
        filesList.appendChild(emptyDiv);
        return;
    }
      // ✅ عرض جميع الملفات مباشرة
    currentFilter = 'all';
    const filteredFiles = getFilteredFiles();
    // ✅ تحديث الإحصائيات عند عرض الملفات
    updateStats(filteredFiles);
    displayFilteredFiles(filteredFiles);
}

// عرض الملف مع كلمة السر
function viewMedia(index) {
    currentMediaIndex = index;
    const file = files[index];
    
    const mediaDisplay = document.getElementById('mediaDisplay');
    mediaDisplay.innerHTML = '';
    
    const isImage = file.type.startsWith('image/');
    const mediaElement = document.createElement(isImage ? 'img' : 'video');
    
    try {
        // تحقق من وجود البيانات
        if (!file.data) {
            throw new Error('بيانات الملف مفقودة');
        }
        
        mediaElement.src = file.data;
        
        if (isImage) {
            mediaElement.style.maxWidth = '100%';
            mediaElement.style.maxHeight = '100%';
            mediaElement.style.width = 'auto';
            mediaElement.style.height = 'auto';
        } else {
            mediaElement.controls = true;
            mediaElement.style.width = '100%';
            mediaElement.style.height = '100%';
            mediaElement.style.objectFit = 'contain';
            mediaElement.crossOrigin = 'anonymous';
            
            // إذا كان الفيديو مضغوطاً، أظهر تنبيهاً
            if (file.isCompressed) {
                const warning = document.createElement('div');
                warning.style.cssText = 'position: absolute; top: 10px; right: 10px; background: #ff9800; color: white; padding: 8px 12px; border-radius: 4px; font-size: 12px; z-index: 1000;';
                warning.textContent = '⚠️ هذا الفيديو مضغوط';
                mediaDisplay.appendChild(warning);
            }
        }
        
        mediaDisplay.appendChild(mediaElement);
    } catch (error) {
        console.error('Error loading media:', error);
        mediaDisplay.innerHTML = '<p style="color: #ff6b6b; font-size: 16px;">❌ خطأ في تحميل الملف: ' + error.message + '</p>';
    }
    
    document.getElementById('mediaPassword').value = '';
    document.getElementById('mediaModal').classList.add('show');
}

// فتح الملف بكلمة السر
function unlockMedia() {
    const password = document.getElementById('mediaPassword').value;
    
    if (!password) {
        showNotification('⚠️ يرجى إدخال كلمة السر');
        return;
    }
    
    // اقرأ كلمة السر الأحدث من التخزين (تأكيد منع الكلمة القديمة)
    const account = JSON.parse(localStorage.getItem('userAccount_INDEX3') || 'null');
    const activePassword = account?.password || '';

    if (password === activePassword) {
        const mediaDisplay = document.getElementById('mediaDisplay');
        const media = mediaDisplay.querySelector('img, video');
        
        if (media) {
            media.classList.add('unlocked');
            media.style.filter = 'none';
            showNotification('✅ تم فتح الملف بنجاح!');
            
            // إخفاء حقل كلمة السر والزر بعد النجاح
            setTimeout(() => {
                const passwordInput = document.getElementById('mediaPassword');
                passwordInput.style.display = 'none';
                
                const unlockBtn = Array.from(document.querySelectorAll('#mediaModal button')).find(btn => btn.textContent === 'فتح');
                if (unlockBtn) unlockBtn.style.display = 'none';
            }, 500);
        }
    } else {
        showNotification('❌ كلمة السر غير صحيحة!');
        document.getElementById('mediaPassword').value = '';
        document.getElementById('mediaPassword').focus();
    }
}

// معالجة Enter في حقل كلمة السر
function handlePasswordKey(event) {
    if (event.key === 'Enter') {
        unlockMedia();
    }
}

// إغلاق Modal
function closeMediaModal() {
    const modal = document.getElementById('mediaModal');
    modal.classList.remove('show');
    
    // تنظيف المحتويات
    setTimeout(() => {
        const mediaDisplay = document.getElementById('mediaDisplay');
        const mediaElements = mediaDisplay.querySelectorAll('img, video');
        mediaElements.forEach(el => {
            if (el.tagName === 'VIDEO') {
                el.pause();
                el.currentTime = 0;
            }
            el.src = '';
            el.classList.remove('unlocked');
        });
        mediaDisplay.innerHTML = '';
        
        // إعادة عناصر النموذج
        const passwordInput = document.getElementById('mediaPassword');
        passwordInput.value = '';
        passwordInput.style.display = 'block';
        
        const modalPasswordSection = document.querySelector('.modal-password-section');
        if (modalPasswordSection) {
            const button = modalPasswordSection.querySelector('button');
            if (button) button.style.display = 'block';
        }
        
        currentMediaIndex = -1;
    }, 300);
}

// حذف ملف (نقل إلى سلة المحذوفات)
// ==================== نقل الملفات إلى المجلد الآمن ====================

// نقل الملف إلى الجهاز (تحميل مباشر)
async function transferFileToFolder(index) {
    const file = files[index];
    
    if (!file) {
        showNotification('❌ الملف غير موجود');
        return;
    }

    try {
        // ✅ انتظر انتهاء التنزيل
        await downloadFileToSystem(file);
        
        showNotification(`✅ تم تحميل الملف: ${file.name}`);
        console.log('📥 تم تحميل الملف:', file.name);
        
    } catch (error) {
        console.error('❌ خطأ في تحميل الملف:', error);
        showNotification('❌ حدث خطأ أثناء تحميل الملف: ' + error.message);
    }
}

// تنزيل الملف إلى النظام
async function downloadFileToSystem(file) {
    return new Promise(async (resolve, reject) => {
        try {
            // ✅ التحقق من وجود البيانات
            if (!file) {
                showNotification('❌ الملف غير موجود');
                console.error('❌ الملف null أو undefined');
                reject(new Error('الملف غير موجود'));
                return;
            }
              // إذا كانت البيانات مفقودة، حاول استرجاعها من IndexedDB
            if (!file.data && file.id) {
                console.warn('⚠️ البيانات مفقودة، جاري محاولة استرجاعها من IndexedDB...');
                
                try {
                    // ✅ جرّب أولاً البحث في mediaFiles (الملفات العادية)
                    let fullFile = await getFileFromIndexedDB(file.id);
                    
                    // إذا لم تُوجد، جرّب البحث في backupData (الملفات المستضافة)
                    if (!fullFile || !fullFile.data) {
                        console.warn('⚠️ الملف غير موجود في mediaFiles، جاري البحث في backupData...');
                        fullFile = await getFullBackupFileData(file.id);
                    }
                    
                    if (fullFile && fullFile.data) {
                        file = fullFile;
                        console.log('✅ تم استرجاع البيانات من IndexedDB');
                    } else {
                        showNotification('❌ لم يتمكن من العثور على بيانات الملف');
                        reject(new Error('بيانات الملف مفقودة'));
                        return;
                    }
                } catch (retrieveError) {
                    console.error('❌ خطأ في استرجاع البيانات:', retrieveError);
                    showNotification('❌ خطأ في استرجاع بيانات الملف');
                    reject(retrieveError);
                    return;
                }
            }
            
            if (!file.data) {
                showNotification('❌ بيانات الملف مفقودة ولا يمكن استرجاعها');
                console.error('❌ الملف بدون بيانات:', file);
                reject(new Error('بيانات الملف مفقودة'));
                return;
            }
            
            console.log('📥 جاري تنزيل الملف:', {
                name: file.name,
                type: file.type,
                size: file.size,
                hasData: !!file.data,
                dataLength: file.data ? file.data.length : 0
            });
            
            // إنشاء blob من البيانات
            let blob;
            
            if (typeof file.data === 'string' && file.data.startsWith('data:')) {
                // تحويل data URL إلى blob
                try {
                    const arr = file.data.split(',');
                    const mimeMatch = arr[0].match(/:(.*?);/);
                    
                    if (!mimeMatch || !mimeMatch[1]) {
                        console.error('❌ خطأ في استخراج MIME type');
                        showNotification('❌ خطأ: صيغة البيانات غير صحيحة');
                        reject(new Error('صيغة البيانات غير صحيحة'));
                        return;
                    }
                    
                    const mime = mimeMatch[1];
                    const bstr = atob(arr[1]);
                    const n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    
                    for (let i = 0; i < n; i++) {
                        u8arr[i] = bstr.charCodeAt(i);
                    }
                    
                    blob = new Blob([u8arr], { type: mime });
                    console.log('✅ تم تحويل data URL إلى blob بنجاح');
                } catch (conversionError) {
                    console.error('❌ خطأ في تحويل data URL:', conversionError);
                    showNotification('❌ خطأ في تحويل البيانات');
                    reject(conversionError);
                    return;
                }
            } else if (typeof file.data === 'string') {
                // إذا كانت نصية لكن ليست data URL، حاول معالجتها كـ base64
                try {
                    const bstr = atob(file.data);
                    const n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    
                    for (let i = 0; i < n; i++) {
                        u8arr[i] = bstr.charCodeAt(i);
                    }
                    
                    blob = new Blob([u8arr], { type: file.type || 'application/octet-stream' });
                    console.log('✅ تم تحويل base64 إلى blob');
                } catch (e) {
                    // إذا فشل، استخدم البيانات مباشرة
                    blob = new Blob([file.data], { type: file.type || 'text/plain' });
                    console.log('✅ تم إنشاء blob من النص مباشرة');
                }
            } else if (file.data instanceof ArrayBuffer || file.data instanceof Uint8Array) {
                blob = new Blob([file.data], { type: file.type || 'application/octet-stream' });
                console.log('✅ تم إنشاء blob من البيانات الثنائية');
            } else {
                blob = new Blob([file.data], { type: file.type || 'application/octet-stream' });
                console.log('✅ تم إنشاء blob من البيانات');
            }
            
            // ✅ تنزيل الملف
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = file.name;
            link.style.display = 'none';
            
            // إضافة الرابط للـ DOM وتنزيل الملف
            document.body.appendChild(link);
            
            // محاولة الضغط على الرابط
            try {
                link.click();
                console.log('✅ تم الضغط على رابط التنزيل');
            } catch (clickError) {
                console.error('❌ خطأ في الضغط على الرابط:', clickError);
                
                // محاولة بديلة
                const event = new MouseEvent('click', {
                    view: window,
                    bubbles: true,
                    cancelable: true
                });
                link.dispatchEvent(event);
            }
            
            // تنظيف
            setTimeout(() => {
                document.body.removeChild(link);
                URL.revokeObjectURL(url);
                console.log('✅ تم تحرير الموارد');
                resolve(); // ✅ حل Promise بعد انتهاء التنزيل
            }, 100);
            
            showNotification(`✅ تم تنزيل الملف: ${file.name}`);
            console.log('📥 تم تنزيل الملف بنجاح:', file.name);
            
        } catch (error) {
            console.error('❌ خطأ في التنزيل:', error);
            showNotification('❌ خطأ في تنزيل الملف: ' + (error.message || 'خطأ غير معروف'));
            reject(error);
        }
    });
}

// ==================== حذف الملفات ====================

async function deleteFile(index) {
    if (confirm('هل تريد حذف هذا الملف؟\n(يمكنك استعادته من سلة المحذوفات)')) {
        const fileToDelete = files[index];
        
        // احصل على المساحة المستخدمة قبل الحذف
        const storageInfoBefore = getStorageInfo();
        const usedSizeBefore = parseFloat(storageInfoBefore.used);
        const fileSize = getSizeInMB(fileToDelete.size);
        
        // تحقق من وجود البيانات
        console.log('📋 حذف الملف:', {
            name: fileToDelete.name,
            hasData: !!fileToDelete.data,
            dataSize: fileToDelete.data ? fileToDelete.data.length : 0,
            usedBefore: usedSizeBefore,
            fileSize: fileSize
        });
        
        files.splice(index, 1);
        
        // أضيف الملف إلى سلة المحذوفات مع البيانات الكاملة
        const deletedFile = {
            id: fileToDelete.id,
            name: fileToDelete.name,
            type: fileToDelete.type,
            size: fileToDelete.size,
            data: fileToDelete.data,  // ✅ حفظ البيانات الكاملة
            uploadedAt: fileToDelete.uploadedAt,
            deletedAt: new Date().toLocaleString('ar-EG'),
            isLocked: fileToDelete.isLocked
        };
        deletedFiles.push(deletedFile);
        
        console.log('💾 جاري حفظ الملف في السلة...', deletedFiles.length);
        
        // احفظ في localStorage (metadata فقط)
        saveDeletedFilesToLocalStorage();
        
        // احفظ البيانات الكاملة في IndexedDB
        try {
            await saveDeletedFilesToIndexedDB();
            console.log('✅ تم حفظ الملف المحذوف في IndexedDB');
        } catch (error) {
            console.error('❌ خطأ في حفظ الملف المحذوف:', error);
            showNotification('⚠️ تم نقل الملف للسلة لكن قد يحدث خطأ عند الاستعادة');
        }
        
        // احذف من mediaFiles في IndexedDB
        if (db && fileToDelete.id) {
            deleteFileFromMediaFiles(fileToDelete.id);
        }
        
        updateStatsAndDisplay();
        
        // ✅ إذا كانت المساحة كانت ممتلئة، أخبر المستخدم أنه يمكنه الآن الاسترجاع
        const storageInfoAfter = getStorageInfo();        const usedSizeAfter = parseFloat(storageInfoAfter.used);
        const availableAfter = parseFloat(storageInfoAfter.available);
        
        if (usedSizeBefore >= 300 && usedSizeAfter < 300) {
            // المساحة كانت ممتلئة والآن متاح مساحة
            showNotification(`🗑️ تم نقل الملف إلى سلة المحذوفات\n\n✅ المساحة المتاحة الآن: ${availableAfter.toFixed(2)}MB\n🔄 يمكنك الآن استرجاع الملفات من السلة أو النسخ الاحتياطية`);
        } else {
            showNotification('🗑️ تم نقل الملف إلى سلة المحذوفات');
        }
    }
}

// ==================== وظائف قائمة المستخدم ====================

function toggleUserMenu() {
    const dropdown = document.getElementById('userDropdown');
    dropdown.classList.toggle('show');
}

// إغلاق القائمة عند النقر خارجها
document.addEventListener('click', function(event) {
    const userMenu = document.querySelector('.user-menu');
    const dropdown = document.getElementById('userDropdown');
    
    if (!userMenu.contains(event.target)) {
        dropdown.classList.remove('show');
    }
});

// إغلاق Modal عند النقر خارجه
window.addEventListener('click', function(event) {
    const modal = document.getElementById('mediaModal');
    if (event.target === modal) {
        closeMediaModal();
    }
});

// ==================== التهيئة ====================

window.addEventListener('load', async function() {    try {
        // تهيئة قاعدة البيانات
        await initDatabase();
    } catch (error) {
        console.warn('⚠️ تحذير: فشل تهيئة IndexedDB', error);
    }
    
    // ✅ مسح فلترة النسخ الاحتياطية عند تحميل الصفحة
    sessionStorage.removeItem('backupFilterDateFrom_INDEX3');
    sessionStorage.removeItem('backupFilterDateTo_INDEX3');
    
    // ✅ تحميل الملفات من IndexedDB عند تحميل الصفحة (في جميع الحالات)
    setTimeout(function() {
        loadFilesOnStart();
    }, 100);
    
    // التحقق من وجود مستخدم مسجل    const account = localStorage.getItem('userAccount_INDEX3');
    if (account) {
        const user = JSON.parse(account);
        currentUser = user.email;
        userPassword = user.password;
        showPage('calculatorPage');
    } else {
        showPage('loginPage');
    }
    
    // تهيئة معالج رفع الملفات
    initFileUpload();
});


// منع التحديد والنسخ من الصور
document.addEventListener('selectstart', function(e) {
    if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') {
        e.preventDefault();
    }
});

// ==================== دالة الإشعارات ====================

function showNotification(message) {
    // إنشاء عنصر الإشعار
    const notification = document.createElement('div');
    notification.className = 'toast-notification';
    notification.innerHTML = message;
    document.body.appendChild(notification);
    
    // إضافة animation
    setTimeout(() => {
        notification.classList.add('show');
    }, 10);
    
    // إزالة الإشعار بعد 3 ثواني
    setTimeout(() => {
        notification.classList.remove('show');
        setTimeout(() => {
            document.body.removeChild(notification);
        }, 300);
    }, 3000);
}

// ==================== دعم لوحة المفاتيح ====================

document.addEventListener('keydown', function(event) {
    const key = event.key;
    
    // الأرقام
    if (key >= '0' && key <= '9') {
        appendNumber(key);
    }
    // العمليات الحسابية
    else if (key === '+') {
        event.preventDefault();
        appendOperator('+');
    }
    else if (key === '-') {
        appendOperator('-');
    }
    else if (key === '*') {
        event.preventDefault();
        appendOperator('*');
    }
    else if (key === '/') {
        event.preventDefault();
        appendOperator('/');
    }
    // النقطة العشرية
    else if (key === '.') {
        appendNumber('.');
    }
    // حساب النتيجة أو فتح الملفات
    else if (key === 'Enter' || key === '=') {
        event.preventDefault();
        calculate();
    }
    // مسح الشاشة
    else if (key === 'Escape') {
        clearDisplay();
    }
    // حذف آخر رقم
    else if (key === 'Backspace') {
        backspace();
    }
});

// ==================== وظائف الفلترة ====================

// عرض سلة المحذوفات
function showTrash() {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    
    // تحديث الفلتر الحالي
    currentFilter = 'trash';
    
    // تحديث الأزرار النشطة
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.remove('active');
        // ابحث عن زر سلة المحذوفات
        if (btn.textContent.includes('سلة') || btn.textContent.includes('🗑️')) {
            btn.classList.add('active');
        }
    });
    
    filesList.innerHTML = '';
    
    // إذا كانت السلة فارغة
    if (deletedFiles.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        emptyDiv.innerHTML = `
            <p>🗑️ سلة المحذوفات فارغة</p>
            <p style="font-size: 12px; margin-top: 10px;">الملفات المحذوفة ستظهر هنا</p>
        `;
        filesList.appendChild(emptyDiv);
        return;
    }
    
    // عرض الملفات المحذوفة
    deletedFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const isImage = file.type.startsWith('image/');
        
        // استخدم أيقونة بدلاً من الصورة (لأننا نحتفظ بـ metadata فقط)
        const iconElement = document.createElement('div');
        iconElement.style.cssText = `
            width: 100%; height: 100%; 
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; font-size: 40px;
            opacity: 0.6;
        `;
        iconElement.textContent = isImage ? '🖼️' : '🎥';
          fileItem.innerHTML = `
            <div class="file-preview" style="position: relative; background: #f0f0f0;">
                ${iconElement.outerHTML}
                <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.7); color: white; padding: 10px 15px; border-radius: 5px; font-size: 12px;">
                    تم حذفه
                </span>
            </div>
            <div class="file-name">${file.name}</div>
            <div class="file-name" style="font-size: 11px; color: #999;">📦 ${file.size}</div>
            <div class="file-name" style="font-size: 10px; color: #f44336;">🕐 ${file.deletedAt}</div>
            <div class="file-actions">
                <button class="file-btn" onclick="restoreFile(${index})" style="background: #4CAF50;">↩️ استعادة</button>
                <button class="file-btn delete" onclick="deleteFilePermanently(${index})">🗑️ حذف نهائي</button>
            </div>
        `;
        
        filesList.appendChild(fileItem);
    });
}

// استعادة ملف من سلة المحذوفات
function restoreFile(index) {
    if (confirm('هل تريد استعادة هذا الملف؟')) {
        const fileToRestore = deletedFiles[index];
        
        // ===== فحص حدود الاستعادة للـ INDEX3 =====
        // 1. فحص عدد الملفات المستعادة
        const currentRestoredCount = files.length;
        if (currentRestoredCount >= MAX_RESTORE_FILES) {
            showNotification(`⚠️ لا يمكن استعادة أكثر من ${MAX_RESTORE_FILES} ملفات في INDEX3`);
            return;
        }
        
        // 2. فحص حجم الملف المستعاد
        if (fileToRestore.size > MAX_RESTORE_SIZE) {
            showNotification(`⚠️ حجم الملف كبير جداً (الحد الأقصى للاستعادة 300MB)`);
            return;
        }
        
        // 3. فحص الحجم الكلي بعد الاستعادة - بناءً على MAX_UPLOAD_SIZE_INDEX3 (300MB)
        const storageInfo = getStorageInfo();
        const usedSize = parseFloat(storageInfo.used);
        const availableSize = parseFloat(storageInfo.available);
        const fileSize = parseFloat(fileToRestore.size);
        
        // ✅ التحقق: إذا كانت المساحة المستخدمة تساوي 300MB تماماً، لا يمكن الاسترجاع
        if (usedSize >= 300) {
            showNotification(`❌ المساحة المتاحة ممتلئة (${usedSize}MB من 300MB)\n\n🗑️ يرجى حذف بعض الملفات أولاً لتحرير المساحة`);
            return;
        }
        
        // ✅ التحقق: إذا كان الملف سيتجاوز الحد الأقصى
        if (fileSize > availableSize) {
            showNotification(`⚠️ المساحة المتاحة غير كافية\n\n📊 المساحة المتاحة: ${availableSize.toFixed(2)}MB\n📦 حجم الملف: ${fileSize.toFixed(2)}MB\n\n🗑️ يرجى حذف ملفات لتحرير المساحة الكافية`);
            return;
        }
        
        console.log('🔍 البحث عن الملف في السلة:', {
            name: fileToRestore.name,
            id: fileToRestore.id,
            hasLocalData: !!fileToRestore.data,
            dbExists: !!db
        });
        
        // التحقق من أن قاعدة البيانات مهيأة
        if (!db) {
            console.error('❌ قاعدة البيانات غير مهيأة');
            showNotification('❌ خطأ: قاعدة البيانات غير متاحة!');
            return;
        }
        
        // التحقق من توفر جدول deletedFiles
        if (!db.objectStoreNames.contains('deletedFiles')) {
            console.warn('⚠️ جدول deletedFiles غير موجود - سيتم إعادة فتح قاعدة البيانات');
            initDatabase().then(() => {
                restoreFile(index);
            }).catch(err => {
                console.error('❌ فشل تهيئة قاعدة البيانات:', err);
                showNotification('❌ خطأ: فشل تحديث قاعدة البيانات');
            });
            return;
        }
        
        try {
            const transaction = db.transaction(['deletedFiles'], 'readonly');
            const objectStore = transaction.objectStore('deletedFiles');
            const getRequest = objectStore.get(fileToRestore.id);
            
            getRequest.onsuccess = function() {
                const fullFile = getRequest.result;
                  console.log('📦 نتيجة البحث:', {
                    found: !!fullFile,
                    hasData: !!fullFile?.data,
                    dataSize: fullFile?.data ? fullFile.data.length : 0
                });
                
                if (fullFile && fullFile.data) {
                    // ✅ الملف موجود مع البيانات الكاملة في IndexedDB
                    const restoredFile = {
                        id: fullFile.id,
                        name: fullFile.name,
                        type: fullFile.type,
                        size: fullFile.size,
                        data: fullFile.data,  // ✅ البيانات الكاملة
                        uploadedAt: fullFile.uploadedAt,
                        isLocked: fullFile.isLocked || false
                    };
                    
                    // احذف من السلة أولاً (قبل الحفظ)
                    deletedFiles.splice(index, 1);
                    
                    // أضف للملفات النشطة
                    files.push(restoredFile);
                    console.log('✅ تم إضافة الملف للملفات النشطة');
                    
                    // احفظ التحديثات
                    saveFiles();
                    
                    // احفظ السلة المحدثة بدون الملف المستعاد
                    saveDeletedFilesToLocalStorage();
                    saveDeletedFilesToIndexedDB();
                      showNotification('✅ تم استعادة الملف بنجاح!');
                    
                    // أعد عرض السلة فوراً (الملف سيختفي)
                    setTimeout(() => showTrash(), 100);
                } else if (fileToRestore.data) {
                    // الملف موجود في السلة محلياً (في الذاكرة)
                    console.warn('⚠️ البيانات موجودة محلياً لكن ليست في IndexedDB');
                    files.push(fileToRestore);
                    deletedFiles.splice(index, 1);
                    saveFiles();
                    
                    showNotification('✅ تم استعادة الملف بنجاح (من الذاكرة)!');
                    showTrash();                } else {
                    console.error('❌ الملف المحذوف لا يحتوي على بيانات', fullFile);
                    showNotification('❌ خطأ: بيانات الملف مفقودة من السلة!');
                }            };
            
            getRequest.onerror = function() {
                console.error('❌ خطأ في جلب الملف من السلة:', getRequest.error);
                showNotification('❌ خطأ: ' + (getRequest.error?.message || 'خطأ في جلب الملف'));
            };
            
            transaction.onerror = function() {
                console.error('❌ خطأ في التعاملية:', transaction.error);
                showNotification('❌ خطأ في العملية: ' + (transaction.error?.message || 'حاول مرة أخرى'));
            };
        } catch (error) {
            console.error('❌ خطأ في استعادة الملف:', error);
            showNotification('❌ خطأ: ' + error.message);
        }
    }
}

// حذف نهائي من سلة المحذوفات
async function deleteFilePermanently(index) {
    if (confirm('هل تريد حذف هذا الملف نهائياً؟\n⚠️ سيتم حفظه في النسخة الاحتياطية ويمكن استعادته لاحقاً')) {        const fileToDelete = deletedFiles[index];
        console.log('🗑️ حذف نهائي للملف:', fileToDelete.name);
        
        // ✅ حفظ الملف بالبيانات الكاملة
        const backupFile = {
            id: fileToDelete.id,
            name: fileToDelete.name,
            type: fileToDelete.type,
            size: fileToDelete.size,
            uploadedAt: fileToDelete.uploadedAt,
            deletedAt: fileToDelete.deletedAt,
            backedUpAt: new Date().toLocaleString('ar-EG'),
            data: fileToDelete.data // ✅ احفظ البيانات الكاملة
        };
        
        backupFiles.push(backupFile);
        
        // حفظ النسخس الاحتياطية في localStorage (معلومات فقط) - منفصل عن INDEX
        try {
            let backupData = JSON.parse(localStorage.getItem('backup_files_INDEX3')) || [];
            
            // احفظ معلومات النسخة الاحتياطية بدون البيانات الثقيلة
            const backupInfo = {
                id: backupFile.id,
                name: backupFile.name,
                type: backupFile.type,
                size: backupFile.size,
                uploadedAt: backupFile.uploadedAt,
                deletedAt: backupFile.deletedAt,
                backedUpAt: backupFile.backedUpAt
            };
            
            backupData.push(backupInfo);
            
            // الاحتفاظ بآخر 50 نسخة احتياطية فقط
            if (backupData.length > 50) {
                backupData = backupData.slice(-50);
                // احذف الملفات القديمة من backupFiles أيضاً
                backupFiles = backupFiles.slice(-50);
            }
            
            localStorage.setItem('backup_files_INDEX3', JSON.stringify(backupData));
            console.log('💾 تم حفظ معلومات النسخة الاحتياطية في INDEX3:', fileToDelete.name);
        } catch (error) {
            console.warn('⚠️ تحذير: تعذر حفظ النسخة الاحتياطية في localStorage (قد يكون التخزين ممتلئاً):', error);
        }
        
        // ✅ حفظ البيانات الكاملة في IndexedDB (للاسترجاع لاحقاً)
        if (db && fileToDelete.data) {
            try {
                const transaction = db.transaction(['backupData'], 'readwrite');
                
                // إنشاء جدول backupData إذا لم يكن موجوداً
                if (!db.objectStoreNames.contains('backupData')) {
                    console.warn('⚠️ جدول backupData غير موجود - سيتم إعادة فتح قاعدة البيانات');
                } else {
                    const objectStore = transaction.objectStore('backupData');
                    objectStore.put(backupFile);
                    
                    transaction.oncomplete = function() {
                        console.log('✅ تم حفظ البيانات الكاملة في IndexedDB');
                    };
                }
            } catch (error) {
                console.warn('⚠️ خطأ في حفظ البيانات الكاملة في IndexedDB:', error);
            }
        }
        
        // احذف من السلة في الذاكرة أولاً
        deletedFiles.splice(index, 1);
        
        // احذف من IndexedDB (جدول deletedFiles)
        if (db && fileToDelete.id) {
            try {
                const transaction = db.transaction(['deletedFiles'], 'readwrite');
                const objectStore = transaction.objectStore('deletedFiles');
                objectStore.delete(fileToDelete.id);
                
                transaction.oncomplete = function() {
                    console.log('✅ تم حذف الملف نهائياً من جدول deletedFiles');
                };
            } catch (error) {
                console.error('❌ خطأ في حذف الملف نهائياً:', error);
            }
        }
          // احفظ السلة المحدثة في localStorage و IndexedDB
        saveDeletedFilesToLocalStorage();
        await saveDeletedFilesToIndexedDB();
          showNotification('🗑️ تم حذف الملف نهائياً ✓\n💾 تم حفظه في النسخة الاحتياطية');
        
        // أعد عرض السلة فوراً (الملف سيختفي)
        setTimeout(() => showTrash(), 100);
    }
}

// عرض النسخ الاحتياطية
function showBackup() {    currentFilter = 'backup';
    
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    
    // تحديث الأزرار النشطة
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.remove('active');
        // ابحث عن زر النسخ الاحتياطية
        if (btn.textContent.includes('نسخ') || btn.textContent.includes('💾')) {
            btn.classList.add('active');
        }
    });
    
    filesList.innerHTML = '';
    
    // تحميل النسخ الاحتياطية من localStorage (INDEX3 منفصل)
    let backupDataFromStorage = JSON.parse(localStorage.getItem('backup_files_INDEX3')) || [];
    
    // إذا كانت النسخ الاحتياطية فارغة
    if (backupDataFromStorage.length === 0 && backupFiles.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        emptyDiv.innerHTML = `
            <p>💾 لا توجد نسخ احتياطية</p>
            <p style="font-size: 12px; margin-top: 10px;">الملفات المحذوفة نهائياً ستُحفظ هنا</p>
        `;
        filesList.appendChild(emptyDiv);
        return;
    }
      // عرض الملفات المحفوظة احتياطياً
    let displayFiles = backupDataFromStorage.length > 0 ? backupDataFromStorage : backupFiles;
    
    // إضافة حقول فلترة التاريخ
    const filterDiv = document.createElement('div');
    filterDiv.style.cssText = 'grid-column: 1/-1; background: #f5f5f5; padding: 15px; border-radius: 8px; border-left: 4px solid #ff9800; margin-bottom: 15px;';
    filterDiv.innerHTML = `
        <div style="display: flex; gap: 10px; align-items: center; flex-wrap: wrap;">
            <label style="font-size: 13px; font-weight: bold; color: #333;">📅 فلترة حسب التاريخ:</label>
            <div style="display: flex; gap: 10px; align-items: center;">
                <label style="font-size: 12px; color: #666;">من:</label>
                <input type="date" id="backupDateFrom" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
            </div>
            <div style="display: flex; gap: 10px; align-items: center;">
                <label style="font-size: 12px; color: #666;">إلى:</label>
                <input type="date" id="backupDateTo" style="padding: 8px; border: 1px solid #ddd; border-radius: 4px; font-size: 12px;" />
            </div>
            <button onclick="applyBackupDateFilter()" style="padding: 8px 15px; background: #ff9800; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px; font-weight: bold;">🔍 فلترة</button>
            <button onclick="clearBackupDateFilter()" style="padding: 8px 15px; background: #999; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 12px;">❌ إلغاء</button>
        </div>
    `;
    filesList.appendChild(filterDiv);
      // فلترة الملفات - إذا كانت هناك تاريخ محفوظ في sessionStorage
    const savedDateFrom = sessionStorage.getItem('backupFilterDateFrom_INDEX3');
    const savedDateTo = sessionStorage.getItem('backupFilterDateTo_INDEX3');
    
    if (savedDateFrom) {
        document.getElementById('backupDateFrom').value = savedDateFrom;
    }
    if (savedDateTo) {
        document.getElementById('backupDateTo').value = savedDateTo;
    }
    
    // إذا لم تكن هناك فلترة محفوظة، اعرض رسالة إخفاء الملفات
    if (!savedDateFrom && !savedDateTo) {
        const hiddenDiv = document.createElement('div');
        hiddenDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        hiddenDiv.innerHTML = `
            <p style="font-size: 16px; margin-bottom: 10px;">📂 الملفات المخفية</p>
            <p style="font-size: 13px; margin: 5px 0;">الملفات تظهر بعد إدخال نطاق التاريخ</p>
            <p style="font-size: 11px; color: #aaa; margin-top: 15px;">👇 ادخل التاريخ "من" و "إلى" أعلاه ثم اضغط 🔍 فلترة</p>
        `;
        filesList.appendChild(hiddenDiv);
        return;
    }
      // تطبيق الفلترة - الملفات تظهر فقط بعد إدخال التاريخ
    // معالجة صيغة ISO من input type="date" (YYYY-MM-DD)
    let fromDate;
    if (savedDateFrom) {
        const [year, month, day] = savedDateFrom.split('-');
        fromDate = new Date(year, month - 1, day);
        fromDate.setHours(0, 0, 0, 0);
    } else {
        fromDate = new Date('1900-01-01');
    }
    
    let toDate;
    if (savedDateTo) {
        const [year, month, day] = savedDateTo.split('-');
        toDate = new Date(year, month - 1, day);
    } else {
        toDate = new Date('2100-12-31');
    }
    
    // ضبط toDate لتشمل اليوم بالكامل (حتى آخر ثانية)
    toDate.setHours(23, 59, 59, 999);
    
    displayFiles = displayFiles.filter(file => {
        if (!file.backedUpAt) return false;
        
        // محاولة تحليل تاريخ النسخ الاحتياطية
        const fileDate = parseBackupDate(file.backedUpAt);
        if (!fileDate) return false;
        
        return fileDate >= fromDate && fileDate <= toDate;
    });
    
    // إذا كانت الملفات المفلترة فارغة
    if (displayFiles.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        emptyDiv.innerHTML = `
            <p>📂 لا توجد ملفات في نطاق التاريخ المحدد</p>
        `;
        filesList.appendChild(emptyDiv);
        return;
    }
    
    // عرض الملفات المحفوظة احتياطياً
    displayFiles.forEach((file, originalIndex) => {
        // البحث عن الفهرس الأصلي في القائمة الكاملة
        let realIndex = backupDataFromStorage.length > 0 
            ? backupDataFromStorage.indexOf(file)
            : backupFiles.indexOf(file);
        
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.style.cssText = 'display: flex; flex-direction: column;';
        
        const isImage = file.type.startsWith('image/');
        
        // استخدم أيقونة بدلاً من الصورة
        const iconElement = document.createElement('div');
        iconElement.style.cssText = `
            width: 100%; height: 100px;
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, #ff9800 0%, #f57c00 100%);
            color: white; font-size: 40px;
            opacity: 0.7;
            border-radius: 4px;
        `;
        iconElement.textContent = isImage ? '🖼️' : '🎥';
        
        fileItem.innerHTML = `
            <div class="file-preview" style="position: relative; background: #fff3e0; border-radius: 4px; overflow: hidden;">
                ${iconElement.outerHTML}
                <span style="position: absolute; top: 5px; right: 5px; background: rgba(255, 152, 0, 0.9); color: white; padding: 5px 8px; border-radius: 3px; font-size: 11px;">
                    نسخة احتياطية
                </span>
            </div>
            <div class="file-name" style="margin-top: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
            <div class="file-name" style="font-size: 11px; color: #999;">📦 ${file.size}</div>
            <div class="file-name" style="font-size: 10px; color: #ff9800;">💾 ${file.backedUpAt}</div>
            <div class="file-actions">
                <button class="file-btn" onclick="restoreFromBackup(${realIndex})" style="background: #ff9800;">♻️ استرجاع</button>
                <button class="file-btn delete" onclick="deleteBackupFile(${realIndex})">🗑️ حذف</button>
            </div>
        `;
        
        filesList.appendChild(fileItem);
    });
    
    // عرض إحصائيات النسخ الاحتياطية
    const statsDiv = document.createElement('div');
    statsDiv.style.cssText = 'grid-column: 1/-1; background: #fff3e0; padding: 15px; border-radius: 8px; margin-top: 15px; border-left: 4px solid #ff9800;';
    statsDiv.innerHTML = `
        <p style="margin: 5px 0; font-size: 13px; color: #e65100;">
            💾 عدد النسخ الاحتياطية المعروضة: <strong>${displayFiles.length}</strong> من <strong>${backupDataFromStorage.length > 0 ? backupDataFromStorage.length : backupFiles.length}</strong><br>
            ⚠️ ملاحظة: يتم الاحتفاظ بآخر 50 نسخة احتياطية فقط
        </p>
    `;
    filesList.appendChild(statsDiv);
}

// دالة تحليل تاريخ النسخ الاحتياطية
function parseBackupDate(dateString) {
    // الصيغة المتوقعة: "٢٠‏/٤‏/٢٠٢٦ ١١:٤٩:٤٤ م" (أرقام عربية)
    // أو "20/4/2026, 11:49:44 AM" (أرقام إنجليزية)
    try {
        // تحويل الأرقام العربية إلى إنجليزية
        const arabicToEnglish = (str) => {
            const arabicNumbers = ['٠', '١', '٢', '٣', '٤', '٥', '٦', '٧', '٨', '٩'];
            const englishNumbers = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9'];
            let result = str;
            for (let i = 0; i < 10; i++) {
                result = result.replace(new RegExp(arabicNumbers[i], 'g'), englishNumbers[i]);
            }
            return result;
        };
        
        let normalizedDate = arabicToEnglish(dateString);
        
        // محاولة تحليل التاريخ
        // الصيغة: "20/4/2026, 11:49:44 AM"
        const parts = normalizedDate.split(',')[0]; // احصل على الجزء الأول فقط (التاريخ)
        const dateParts = parts.split('/');
        
        if (dateParts.length === 3) {
            const day = parseInt(dateParts[0]);
            const month = parseInt(dateParts[1]);
            const year = parseInt(dateParts[2]);
            
            // إنشاء تاريخ جديد
            const date = new Date(year, month - 1, day); // الشهر يبدأ من 0
            
            if (isNaN(date.getTime())) {
                return null;
            }
            
            // تعيين الوقت إلى منتصف الليل لمقارنة صحيحة
            date.setHours(0, 0, 0, 0);
            return date;
        }
        
        return null;
    } catch (e) {
        console.warn('⚠️ خطأ في تحليل التاريخ:', dateString, e);
        return null;
    }
}

// دالة تطبيق فلترة التاريخ
function applyBackupDateFilter() {
    const dateFrom = document.getElementById('backupDateFrom').value;
    const dateTo = document.getElementById('backupDateTo').value;
    
    if (!dateFrom && !dateTo) {
        showNotification('⚠️ يرجى اختيار تاريخ واحد على الأقل');
        return;
    }
      // حفظ الفلترة في sessionStorage
    if (dateFrom) sessionStorage.setItem('backupFilterDateFrom_INDEX3', dateFrom);
    if (dateTo) sessionStorage.setItem('backupFilterDateTo_INDEX3', dateTo);
    
    // إعادة عرض النسخ الاحتياطية بالفلترة الجديدة
    showBackup();
    showNotification('✅ تم تطبيق الفلترة');
}

// دالة إلغاء فلترة التاريخ
function clearBackupDateFilter() {
    sessionStorage.removeItem('backupFilterDateFrom_INDEX3');
    sessionStorage.removeItem('backupFilterDateTo_INDEX3');
    document.getElementById('backupDateFrom').value = '';
    document.getElementById('backupDateTo').value = '';
    showBackup();
    showNotification('✅ تم إلغاء الفلترة');
}

// استرجاع ملف من النسخة الاحتياطية
function restoreFromBackup(index) {
    // احصل على البيانات من localStorage (INDEX3 فقط) أولاً
    let backupDataFromStorage = JSON.parse(localStorage.getItem('backup_files_INDEX3')) || [];
    let displayFiles = backupDataFromStorage.length > 0 ? backupDataFromStorage : backupFiles;
    
    const fileToRestore = displayFiles[index];      // التحقق من نطاق التاريخ
    const savedDateFrom = sessionStorage.getItem('backupFilterDateFrom_INDEX3');
    const savedDateTo = sessionStorage.getItem('backupFilterDateTo_INDEX3');
      if (savedDateFrom || savedDateTo) {
        // معالجة صيغة ISO من input type="date" (YYYY-MM-DD)
        let fromDate;
        if (savedDateFrom) {
            const [year, month, day] = savedDateFrom.split('-');
            fromDate = new Date(year, month - 1, day);
            fromDate.setHours(0, 0, 0, 0);
        } else {
            fromDate = new Date('1900-01-01');
        }
        
        let toDate;
        if (savedDateTo) {
            const [year, month, day] = savedDateTo.split('-');
            toDate = new Date(year, month - 1, day);
        } else {
            toDate = new Date('2100-12-31');
        }
        
        // ضبط toDate لتشمل اليوم بالكامل
        toDate.setHours(23, 59, 59, 999);
        
        const fileDate = parseBackupDate(fileToRestore.backedUpAt);
        if (!fileDate || fileDate < fromDate || fileDate > toDate) {
            showNotification('⚠️ هذا الملف خارج نطاق التاريخ المحدد');
            return;
        }
    }    if (confirm('هل تريد استرجاع هذا الملف من النسخة الاحتياطية؟')) {
        
        // ===== فحص المساحة المتاحة =====
        const storageInfo = getStorageInfo();
        const usedSize = parseFloat(storageInfo.used);
        const availableSize = parseFloat(storageInfo.available);
        const fileSize = parseFloat(fileToRestore.size);
        
        // ✅ التحقق: إذا كانت المساحة المستخدمة تساوي 300MB تماماً، لا يمكن الاسترجاع
        if (usedSize >= 300) {
            showNotification(`❌ المساحة المتاحة ممتلئة (${usedSize}MB من 300MB)\n\n🗑️ يرجى حذف بعض الملفات أولاً لتحرير المساحة`);
            return;
        }
        
        // ✅ التحقق: إذا كان الملف سيتجاوز الحد الأقصى
        if (fileSize > availableSize) {
            showNotification(`⚠️ المساحة المتاحة غير كافية\n\n📊 المساحة المتاحة: ${availableSize.toFixed(2)}MB\n📦 حجم الملف: ${fileSize.toFixed(2)}MB\n\n🗑️ يرجى حذف ملفات لتحرير المساحة الكافية`);
            return;
        }
        
        // 🔍 البحث عن البيانات الكاملة من backupFiles
        let fullFileData = backupFiles.find(f => f.id === fileToRestore.id);
        
        // إذا كانت البيانات موجودة في backupFiles مباشرة
        if (fullFileData && fullFileData.data) {
            console.log('✅ تم العثور على البيانات الكاملة في backupFiles');
            restoreBackupFileDirect(fileToRestore, fullFileData.data);
        } 
        // إذا كانت البيانات موجودة في fileToRestore (من localStorage)
        else if (fileToRestore.data) {
            console.log('✅ تم العثور على البيانات الكاملة في fileToRestore');
            restoreBackupFileDirect(fileToRestore, fileToRestore.data);
        }
        // جرب البحث في IndexedDB (جدول backupData)
        else {
            console.warn('⚠️ جاري البحث في IndexedDB عن البيانات الكاملة...');
            getFullBackupFileData(fileToRestore.id).then(fullFile => {
                if (fullFile && fullFile.data) {
                    console.log('✅ تم العثور على البيانات الكاملة في IndexedDB');
                    restoreBackupFileDirect(fileToRestore, fullFile.data);
                } else {
                    showNotification('❌ للأسف، بيانات الملف غير موجودة. قد يكون الملف قد حُذف من قاعدة البيانات.');
                    console.error('❌ بيانات الملف مفقودة تماماً:', fileToRestore.id);
                }
            });
        }
    }
}

// دالة مساعدة: استرجاع الملف مباشرة بعد الحصول على البيانات الكاملة
function restoreBackupFileDirect(fileToRestore, fileData) {
    const restoredFile = {
        id: fileToRestore.id,
        name: fileToRestore.name,
        type: fileToRestore.type,
        data: fileData,  // ✅ البيانات الكاملة
        size: fileToRestore.size,
        uploadedAt: fileToRestore.uploadedAt,
        restoredAt: new Date().toLocaleString('ar-EG'),
        isLocked: fileToRestore.isLocked || true,
        isCompressed: fileToRestore.isCompressed || false
    };
    
    files.push(restoredFile);
    saveFiles();
    
    // حذف من النسخة الاحتياطية
    if (backupFiles.length > 0) {
        backupFiles = backupFiles.filter(f => f.id !== fileToRestore.id);
    }
      // تحديث localStorage (INDEX3)
    let backupData = JSON.parse(localStorage.getItem('backup_files_INDEX3')) || [];
    backupData = backupData.filter(f => f.id !== fileToRestore.id);
    localStorage.setItem('backup_files_INDEX3', JSON.stringify(backupData));
    
    // حذف من IndexedDB (backupData)
    if (db && db.objectStoreNames.contains('backupData')) {
        try {
            const transaction = db.transaction(['backupData'], 'readwrite');
            const objectStore = transaction.objectStore('backupData');
            objectStore.delete(fileToRestore.id);
        } catch (error) {
            console.warn('⚠️ خطأ في حذف الملف من backupData:', error);
        }
    }
    
    showNotification(`✅ تم استرجاع الملف: ${fileToRestore.name}`);
    console.log('♻️ تم استرجاع الملف من النسخة الاحتياطية:', fileToRestore.name);
    
    // إعادة عرض النسخ الاحتياطية
    showBackup();
      // تحديث قائمة الملفات الرئيسية
    updateStatsAndDisplay();
}

// دالة للبحث عن البيانات الكاملة من IndexedDB (جدول backupData)
async function getFullBackupFileData(fileId) {
    return new Promise((resolve, reject) => {
        try {
            if (!db || !db.objectStoreNames.contains('backupData')) {
                console.warn('⚠️ جدول backupData غير متاح');
                resolve(null);
                return;
            }
            
            const transaction = db.transaction(['backupData'], 'readonly');
            const objectStore = transaction.objectStore('backupData');
            const request = objectStore.get(fileId);
            
            request.onsuccess = function() {
                const fullFile = request.result;
                if (fullFile && fullFile.data) {
                    console.log('✅ تم العثور على البيانات الكاملة في IndexedDB:', fileId);
                    resolve(fullFile);
                } else {
                    console.warn('⚠️ البيانات الكاملة غير موجودة في IndexedDB:', fileId);
                    resolve(null);
                }
            };
            
            request.onerror = function() {
                console.error('❌ خطأ في البحث في IndexedDB:', request.error);
                resolve(null);
            };
        } catch (error) {
            console.error('❌ خطأ في دالة getFullBackupFileData:', error);
            resolve(null);
        }
    });
}

// حذف ملف من النسخة الاحتياطية
function deleteBackupFile(index) {
    if (confirm('هل تريد حذف هذا الملف من النسخة الاحتياطية نهائياً؟\n⚠️ لن تتمكن من استعادته')) {
        // ✅ احصل على الملف من backupFiles بناءً على الفهرس
        const fileToDelete = backupFiles[index];
        
        if (!fileToDelete) {
            console.error('❌ الملف غير موجود في backupFiles:', index);
            showNotification('❌ خطأ: الملف غير موجود');
            return;
        }
        
        console.log('🗑️ حذف الملف من النسخة الاحتياطية:', fileToDelete.name, 'ID:', fileToDelete.id);
          // ✅ حذف الملف من backupFiles array بناءً على المعرّف وليس الفهرس
        backupFiles = backupFiles.filter(f => f.id !== fileToDelete.id);
        
        // تحديث localStorage (INDEX3) - احذف الملف من قائمة المعلومات
        let backupData = JSON.parse(localStorage.getItem('backup_files_INDEX3')) || [];
        backupData = backupData.filter(f => f.id !== fileToDelete.id);
        localStorage.setItem('backup_files_INDEX3', JSON.stringify(backupData));
        
        // احذف من IndexedDB أيضاً إذا كان موجوداً
        if (db && db.objectStoreNames.contains('backupData') && fileToDelete.id) {
            try {
                const transaction = db.transaction(['backupData'], 'readwrite');
                const objectStore = transaction.objectStore('backupData');
                objectStore.delete(fileToDelete.id);
                
                transaction.oncomplete = function() {
                    console.log('✅ تم حذف الملف من IndexedDB backupData');
                };
            } catch (error) {
                console.warn('⚠️ خطأ في حذف الملف من IndexedDB:', error);
            }
        }
        
        showNotification('🗑️ تم حذف الملف من النسخة الاحتياطية');
        console.log('✅ تم حذف الملف بنجاح - العدد المتبقي:', backupFiles.length);
        
        // إعادة عرض النسخ الاحتياطية
        showBackup();
    }
}

function filterFiles(type) {
    currentFilter = type;
    
    // تحديث أزرار الفلترة
    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => btn.classList.remove('active'));
    
    // تحديث الزر النشط فقط إذا كان الحدث موجود
    if (event && event.target) {
        event.target.classList.add('active');
    } else {
        // إذا لم يكن هناك حدث، ابحث عن الزر المناسب
        filterButtons.forEach(btn => {
            if ((type === 'all' && btn.textContent.includes('جميع')) ||
                (type === 'images' && btn.textContent.includes('صور')) ||
                (type === 'videos' && btn.textContent.includes('فيديو'))) {
                btn.classList.add('active');
            }
        });
    }
    
    // تحديث الإحصائيات والملفات المعروضة
    updateStatsAndDisplay();
}

// دالة التحديث المركزية للإحصائيات والعرض
function updateStatsAndDisplay() {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    
    // ✅ مسح الواجهة تماماً
    filesList.innerHTML = '';
    
    // الحصول على الملفات المفلترة
    const filteredFiles = getFilteredFiles();
    
    // تحديث الإحصائيات
    updateStats(filteredFiles);
    
    // عرض الملفات المفلترة (بدون مسح إضافي)
    displayFilteredFiles(filteredFiles);
}

// دالة للحصول على الملفات المفلترة
function getFilteredFiles() {
    if (currentFilter === 'all') {
        return files;
    } else if (currentFilter === 'images') {
        return files.filter(file => file.type.startsWith('image/'));
    } else if (currentFilter === 'videos') {
        return files.filter(file => file.type.startsWith('video/'));
    }
    return files;
}

// دالة تحديث الإحصائيات
function updateStats(filteredFiles) {
    // ✅ حساب إجمالي حجم جميع الملفات المحملة (ليس المفلترة فقط)
    let totalUsedSize = 0;
    files.forEach(file => {
        totalUsedSize += getSizeInMB(file.size);
    });
    
    // عد الصور والفيديوهات من الملفات المفلترة
    const imagesCount = filteredFiles.filter(f => f.type.startsWith('image/')).length;
    const videosCount = filteredFiles.filter(f => f.type.startsWith('video/')).length;
    
    // ✅ حساب المساحة المتبقية من 300 MB الكلية
    const maxStorage = 300;
    const availableSpace = Math.max(0, maxStorage - totalUsedSize).toFixed(2);
    
    // تحديث العناصر
    const usedSpaceEl = document.getElementById('usedSpace');
    const availableSpaceEl = document.getElementById('availableSpace');
    const filesCountEl = document.getElementById('filesCount');
    const imagesCountEl = document.getElementById('imagesCount');
    const videosCountEl = document.getElementById('videosCount');
    
    if (usedSpaceEl) {
        usedSpaceEl.textContent = totalUsedSize.toFixed(2) + ' MB';
        // ✅ تغيير اللون إذا وصلت المساحة للحد الأقصى
        if (totalUsedSize >= 20) {
            usedSpaceEl.style.color = '#f44336';
            usedSpaceEl.style.fontWeight = 'bold';
        } else if (totalUsedSize >= 15) {
            usedSpaceEl.style.color = '#ff9800';
            usedSpaceEl.style.fontWeight = 'bold';
        } else {
            usedSpaceEl.style.color = 'inherit';
            usedSpaceEl.style.fontWeight = 'normal';
        }
    }
    
    if (availableSpaceEl) {
        availableSpaceEl.textContent = availableSpace + ' MB';
        // ✅ تغيير اللون بناءً على المساحة المتاحة
        if (availableSpace <= 0) {
            availableSpaceEl.style.color = '#f44336';
            availableSpaceEl.style.fontWeight = 'bold';
        } else if (availableSpace <= 5) {
            availableSpaceEl.style.color = '#ff9800';
            availableSpaceEl.style.fontWeight = 'bold';
        } else {
            availableSpaceEl.style.color = 'inherit';
            availableSpaceEl.style.fontWeight = 'normal';
        }
    }
    
    if (filesCountEl) filesCountEl.textContent = filteredFiles.length;
    if (imagesCountEl) imagesCountEl.textContent = imagesCount;
    if (videosCountEl) videosCountEl.textContent = videosCount;
}

// دالة عرض الملفات المفلترة
function displayFilteredFiles(filteredFiles) {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    
    // إذا لم توجد ملفات مفلترة
    if (filteredFiles.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        
        let emptyMessage = '📂 لا توجد ملفات';
        if (currentFilter === 'images') {
            emptyMessage = '🖼️ لا توجد صور';
        } else if (currentFilter === 'videos') {
            emptyMessage = '🎥 لا توجد فيديوهات';
        }
        
        emptyDiv.innerHTML = `
            <p>${emptyMessage}</p>
            <p style="font-size: 12px; margin-top: 10px;">قم برفع ملفات جديدة</p>
        `;
        filesList.appendChild(emptyDiv);
        return;
    }
    
    // عرض الملفات
    filteredFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        
        const isImage = file.type.startsWith('image/');
        const mediaElement = isImage ? 'img' : 'video';
        
        // الحصول على الفهرس الأصلي في القائمة الكاملة
        const originalIndex = files.indexOf(file);
        
        // التأكد من أن البيانات موجودة
        let mediaData = file.data ? file.data : null;
        
        // إذا كانت البيانات فارغة، أظهر صورة افتراضية
        if (!mediaData) {
            mediaData = 'data:' + file.type + ';base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        }
        
        // أضف شارة ضغط إذا كان الملف مضغوطاً
        const compressedBadge = file.isCompressed ? '<span style="position: absolute; top: 5px; right: 5px; background: #ff9800; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px;">مضغوط</span>' : '';
        
        fileItem.innerHTML = `
            <div class="file-preview" onclick="viewMedia(${originalIndex})" style="position: relative;">
                <${mediaElement} src="${mediaData}" style="width: 100%; height: 100%; object-fit: cover;" ${!isImage ? 'controls' : ''} onerror="this.src='data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 width=%22100%22 height=%22100%22%3E%3Crect fill=%22%23f0f0f0%22 width=%22100%22 height=%22100%22/%3E%3C/svg%3E'">
                </${mediaElement}>
                ${compressedBadge}
            </div>
            <div class="file-name">${file.name}</div>
            <div class="file-name" style="font-size: 11px; color: #999;">📦 ${file.size}</div>
            <div class="file-actions">
                <button class="file-btn" onclick="viewMedia(${originalIndex})">👁️ عرض</button>
                <button class="file-btn transfer" onclick="transferFileToFolder(${originalIndex})">📤 نقل</button>
                <button class="file-btn delete" onclick="deleteFile(${originalIndex})">🗑️ حذف</button>
            </div>
        `;
        
        filesList.appendChild(fileItem);
    });
}

// ==================== دالة الرسالة الأمنية المتقدمة ====================

// عرض معلومات التخزين الآمن بعد رفع الملف
function showSecurityAlert(fileName, fileSize, fileType) {
    const securityAlert = document.createElement('div');
    securityAlert.id = 'securityAlert';
    securityAlert.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0, 0, 0, 0.7);
        display: flex;
        align-items: center;
        justify-content: center;
        z-index: 10000;
    `;
    
    const alertBox = document.createElement('div');
    alertBox.style.cssText = `
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        border-radius: 15px;
        padding: 30px;
        max-width: 500px;
        width: 90%;
        color: white;
        box-shadow: 0 10px 40px rgba(0, 0, 0, 0.3);
    `;
    
    const mediaType = fileType.startsWith('image/') ? '🖼️ صورة' : '🎥 فيديو';
    const storageFolder = 'IndexedDB-Storage';
    
    alertBox.innerHTML = `
        <div style="text-align: right; direction: rtl;">
            <div style="font-size: 22px; margin-bottom: 15px; font-weight: bold;">
                ✅ تم رفع الملف بنجاح!
            </div>
            
            <div style="background: rgba(255, 255, 255, 0.2); padding: 12px; border-radius: 8px; margin: 12px 0; font-size: 13px;">
                <div style="margin: 6px 0;">📄 <strong>النوع:</strong> ${mediaType}</div>
                <div style="margin: 6px 0;">📛 <strong>الاسم:</strong> ${fileName}</div>
                <div style="margin: 6px 0;">📦 <strong>الحجم:</strong> ${fileSize}</div>
            </div>
            
            <div style="background: rgba(255, 255, 255, 0.15); padding: 12px; border-radius: 8px; margin: 12px 0; border-right: 4px solid #FFD700;">
                <div style="font-size: 14px; font-weight: bold; margin-bottom: 8px;">🔒 مسار التخزين الآمن:</div>
                <div style="font-size: 12px; background: rgba(0, 0, 0, 0.3); padding: 8px; border-radius: 4px; font-family: monospace;">
                    /storage/app/${storageFolder}/
                </div>
            </div>
            
            <div style="background: rgba(255, 200, 0, 0.2); padding: 10px; border-radius: 8px; margin: 12px 0; font-size: 12px; line-height: 1.5;">
                ⚠️ <strong>تنبيه أمني:</strong> الملف الأصلي موجود في الاستديو. يُفضل حذفه لضمان أمان أفضل!
            </div>
        </div>
        
        <button onclick="closeSecurityAlert()" style="
            width: 100%;
            margin-top: 15px;
            background: rgba(255, 255, 255, 0.9);
            color: #667eea;
            border: none;
            padding: 12px;
            border-radius: 8px;
            font-size: 14px;
            font-weight: bold;
            cursor: pointer;
        ">✓ تم الفهم</button>
    `;
    
    securityAlert.appendChild(alertBox);
    document.body.appendChild(securityAlert);
    
    setTimeout(() => closeSecurityAlert(), 8000);
}

function closeSecurityAlert() {
    const alert = document.getElementById('securityAlert');
    if (alert) alert.remove();
}

// ==================== وظائف طلب الإذن ====================

// عرض شاشة طلب الإذن
function showPermissionModal() {
    const modal = document.getElementById('permissionModal');
    if (modal) {
        modal.style.display = 'flex';
        console.log('📋 تم عرض شاشة طلب الإذن');
    }
}

// عند الضغط على "موافق"
async function allowPermission() {
    localStorage.setItem('pr_safe_permission_INDEX3', 'true');
    hasStoragePermission = true;

    const modal = document.getElementById('permissionModal');
    if (modal) {
        modal.style.display = 'none';
    }

    showNotification('✅ تم قبول الإذن — يمكنك الآن رفع الملفات');
    console.log('✅ تم قبول إذن الوصول');

    try {
        await createPrSafeFolder();
    } catch (e) {
        console.warn('تخطي مجلد pr_safe على القرص (لا يوجد خادم محلي):', e?.message || e);
    }
}

// عند الضغط على "رفض"
function denyPermission() {
    localStorage.setItem('pr_safe_permission_INDEX3', 'false');
    hasStoragePermission = false;
    
    showNotification('⛔ تم رفض الإذن - لن يتم حفظ الملفات');
    console.log('⛔ تم رفض إذن الوصول');
    
    const modal = document.getElementById('permissionModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// إنشاء مجلد pr_safe على القرص (اختياري — يحتاج خادماً محلياً على المنفذ 3000)
async function createPrSafeFolder() {
    const folderPath = 'C:\\pr_safe';
    try {
        const response = await fetch('http://localhost:3000/api/create-backup-folder', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ path: folderPath, indexName: 'INDEX3' }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            console.warn('خادم pr_safe:', data.message || response.statusText);
            return null;
        }
        const prSafeFolderInfo = {
            path: folderPath,
            created: new Date().toLocaleString('ar-EG'),
            status: 'created',
            serverResponse: data,
        };
        localStorage.setItem('pr_safe_folder', JSON.stringify(prSafeFolderInfo));
        showNotification('📁 تم إنشاء مجلد pr_safe على النظام (خادم محلي)');
        console.log('✅ تم إنشاء مجلد فعلي:', folderPath, data);
        return prSafeFolderInfo;
    } catch (error) {
        console.warn('لا خادم محلي على 3000 — التخزين يبقى في المتصفح فقط:', error.message);
        return null;
    }
}

// التحقق من الإذن عند تحميل الملفات (لا نعرض نافذة موافقة — الرفع يبدأ مباشرة)
function checkPermissionBeforeUpload() {
    return true;
}

// ==================== وظائف النسخ الاحتياطية ====================

// عرض النسخ الاحتياطية - تم تعريفها بالفعل في السطر 1717

// ==================== نظام الخطط والاشتراكات ====================

/**
 * التحقق من صحة الاشتراك الحالي
 */
function checkSubscriptionValidity() {
    if (typeof PlanSystem === 'undefined') {
        console.warn('⚠️ نظام الخطط غير محمل');
        return false;
    }

    return PlanSystem.isSubscriptionValid();
}

/**
 * الحصول على معلومات الاشتراك الحالي
 */
function getCurrentSubscriptionInfo() {
    if (typeof PlanSystem === 'undefined') {
        return null;
    }

    return PlanSystem.getSubscriptionInfo();
}

/**
 * التحقق من أن المستخدم لديه ميزة معينة
 */
function hasFeature(featureName) {
    const subscription = getCurrentSubscriptionInfo();
    if (!subscription || !subscription.isValid) {
        return false;
    }

    const features = {
        'transfer': subscription.transferFiles,
        'no_ads': subscription.noAds,
        'filter': true,
        'restore': true,
        'upload': true
    };

    return features[featureName] !== false;
}

/**
 * الحصول على حد التخزين بناءً على الاشتراك
 */
function getStorageLimit() {
    const subscription = getCurrentSubscriptionInfo();
    if (!subscription || !subscription.isValid) {
        return 20;
    }

    return subscription.storage;
}

/**
 * عرض معلومات الاشتراك في واجهة المستخدم
 */
function displaySubscriptionInfo() {
    const subscription = getCurrentSubscriptionInfo();
    
    if (!subscription || !subscription.isValid) {
        console.log('❌ لا يوجد اشتراك فعال');
        return;
    }

    console.log('✅ معلومات الاشتراك:', {
        plan: subscription.planName,
        storage: subscription.storage,
        daysRemaining: subscription.daysRemaining
    });
}

/**
 * فحص انتهاء صلاحية الاشتراك
 */
function checkSubscriptionExpiration() {
    if (typeof PlanSystem === 'undefined') {
        return;
    }

    const subscription = getCurrentSubscriptionInfo();
    
    if (!subscription) {
        return;
    }

    const todayKey = new Date().toISOString().slice(0, 10);
    const notifyOncePerDay = (level, message) => {
        const key = `sub_notify_INDEX3_${level}_${todayKey}`;
        if (localStorage.getItem(key) === '1') return;
        if (typeof showNotification === 'function') {
            showNotification(message);
        }
        localStorage.setItem(key, '1');
    };

    if (subscription.isExpired) {
        notifyOncePerDay('expired', '⚠️ انتهت صلاحية اشتراكك وتم تحويل الحساب إلى الخطة المجانية.');
        alert('⚠️ انتهت صلاحية اشتراكك. يرجى تجديد الاشتراك.');
        localStorage.removeItem('currentSubscription_INDEX3');
        localStorage.removeItem('userSubscription_INDEX3');
        window.location.href = 'index3.html';
        return true;
    }

    if (subscription.daysRemaining && subscription.daysRemaining <= 3) {
        notifyOncePerDay('3days', `⚠️ اشتراكك سينتهي خلال ${subscription.daysRemaining} أيام.`);
        console.warn(`⚠️ سينتهي اشتراكك خلال ${subscription.daysRemaining} أيام`);
    } else if (subscription.daysRemaining && subscription.daysRemaining <= 7) {
        notifyOncePerDay('7days', `ℹ️ تنبيه: اشتراكك سينتهي خلال ${subscription.daysRemaining} أيام.`);
    }

    return false;
}

/**
 * ترحيل الاشتراكات القديمة لتصبح مدة الصلاحية 180 يوم (مرة واحدة).
 */
function migrateSubscriptionDurationIfNeeded() {
    try {
        const raw = localStorage.getItem('userSubscription_INDEX3');
        if (!raw) return;

        const subscription = JSON.parse(raw);
        if (!subscription || subscription.status !== 'active') return;
        if (subscription.durationDays === 180) return;

        subscription.expiryDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
        subscription.durationDays = 180;
        localStorage.setItem('userSubscription_INDEX3', JSON.stringify(subscription));
        console.log('✅ تم تحديث مدة الاشتراك الحالي (INDEX3) إلى 180 يوم');
    } catch (error) {
        console.warn('⚠️ تعذر ترحيل مدة الاشتراك (INDEX3):', error);
    }
}

/**
 * تهيئة نظام الخطط عند دخول الصفحة
 */
function initSubscriptionSystem() {
    if (typeof PlanSystem === 'undefined') {
        console.warn('⚠️ نظام الخطط لم يتم تحميله');
        return;
    }

    console.log('✅ تم تهيئة نظام الخطط');
    migrateSubscriptionDurationIfNeeded();
    
    checkSubscriptionExpiration();
    displaySubscriptionInfo();
}

// ==================== تهيئة التطبيق ====================

// دالة تهيئة شاملة للتطبيق
async function initializeApp() {
    try {
        console.log('🔧 جاري تهيئة التطبيق...');
        
        // 1. تهيئة قاعدة البيانات
        console.log('📊 جاري تهيئة قاعدة البيانات...');
        await initDatabase();
        
        // 2. تحميل الملفات المحفوظة
        console.log('📂 جاري تحميل الملفات المحفوظة...');
        try {
            files = await loadFilesFromIndexedDB();
            console.log(`✅ تم تحميل ${files.length} ملف`);
        } catch (error) {
            console.error('⚠️ لم يتم تحميل الملفات:', error);
            files = [];
        }
        
        // 3. تحميل الملفات المحذوفة
        try {
            deletedFiles = await loadDeletedFilesFromIndexedDB();
            console.log(`✅ تم تحميل ${deletedFiles.length} ملف محذوف`);
        } catch (error) {
            console.error('⚠️ لم يتم تحميل الملفات المحذوفة:', error);
            deletedFiles = [];
        }
        
        // 4. تهيئة نظام الخطط
        console.log('💳 جاري تهيئة نظام الخطط...');
        initSubscriptionSystem();
        
        // 5. تهيئة نظام التحميل
        console.log('⬆️ جاري تهيئة نظام التحميل...');
        initFileUpload();
        
        console.log('✅ تم تهيئة التطبيق بنجاح');
        
    } catch (error) {
        console.error('❌ خطأ في تهيئة التطبيق:', error);
        showNotification('❌ حدث خطأ في تهيئة التطبيق');
    }
}

// تهيئة التطبيق عند تحميل الصفحة
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initializeApp);
} else {
    // إذا كانت الصفحة مُحملة بالفعل
    initializeApp();
}

// فتح صفحة الملفات عند النقر على المنطقة المخفية
document.querySelector('.hidden-zone')?.addEventListener('dblclick', function() {
    toggleMediaPage();
});

