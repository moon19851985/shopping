// ==================== عرض معلومات الطلب والاشتراك ====================

function escapeOrderHtml(s) {
    if (s == null) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/"/g, '&quot;');
}

function resolveOrderStatusUserEmail(subscriptionRaw) {
    let email = (localStorage.getItem('currentUserEmail_INDEX2') || '').trim();
    if (email) return email;
    try {
        const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (acc && acc.email) {
            email = String(acc.email).trim();
            if (email) return email;
        }
    } catch (ignore) {}
    if (subscriptionRaw) {
        try {
            const sub = JSON.parse(subscriptionRaw);
            if (sub && sub.userEmail) return String(sub.userEmail).trim();
        } catch (ignore) {}
    }
    if (typeof currentUser !== 'undefined' && currentUser) {
        return String(currentUser).trim();
    }
    return '';
}

/**
 * عرض معلومات الطلب والاشتراك الحالي
 */
function showOrderStatus() {
    try {
        const modal = document.getElementById('orderStatusModal');
        const content = document.getElementById('orderStatusContent');
        
        // الحصول على معلومات الاشتراك
        const subscription =
            typeof gostaLsGetScoped_INDEX2 === 'function'
                ? gostaLsGetScoped_INDEX2('userSubscription_INDEX2')
                : localStorage.getItem('userSubscription_INDEX2');
        const displayEmail = resolveOrderStatusUserEmail(subscription);
        
        let html = '';
        
        // =========== معلومات الاشتراك ===========
        if (subscription) {
            const sub = JSON.parse(subscription);
            const expiryDate = new Date(sub.expiryDate);
            const today = new Date();
            const daysRemaining = Math.ceil((expiryDate - today) / (1000 * 60 * 60 * 24));
            const planLabel = escapeOrderHtml(sub.planName || sub.type || '');
            const priceLabel = escapeOrderHtml(sub.price != null ? sub.price : '');
            const storageLabel = escapeOrderHtml(sub.storage != null ? String(sub.storage) : '');
            
            html += `
                <div class="gosta-panel-card gosta-panel-card--subscription">
                    <h3>💳 الاشتراك الحالي</h3>
                    <p><strong>الخطة:</strong> ${planLabel}</p>
                    <p><strong>المساحة:</strong> ${storageLabel} MB</p>
                    <p><strong>السعر:</strong> ${priceLabel}</p>
                    <p><strong>الحالة:</strong> <span class="gosta-panel-status--active">✅ نشط</span></p>
                    <p><strong>تاريخ الانتهاء:</strong> ${escapeOrderHtml(new Date(sub.expiryDate).toLocaleDateString('ar-EG'))}</p>
                    <p><strong>الأيام المتبقية:</strong> <span class="gosta-panel-status--warn">${daysRemaining} يوم</span></p>
                </div>
            `;
        } else {
            html += `
                <div class="gosta-panel-card gosta-panel-card--free">
                    <h3>🆓 الخطة المجانية التجريبية</h3>
                    <p><strong>الخطة:</strong> مجاني تجريبي</p>
                    <p><strong>المساحة:</strong> 1000 MB</p>
                    <p><strong>الحالة:</strong> <span class="gosta-panel-status--warn">نشط</span></p>
                    <p class="gosta-panel-muted">قم بالترقية للحصول على مساحة أكبر!</p>
                </div>
            `;
        }
        
        const emailLine = displayEmail ? escapeOrderHtml(displayEmail) : 'غير محدد';
        html += `
            <div class="gosta-panel-card gosta-panel-card--user">
                <h3>👤 بيانات المستخدم</h3>
                <p><strong>البريد الإلكتروني:</strong> ${emailLine}</p>
                <p class="gosta-panel-muted">آخر تحديث: ${escapeOrderHtml(new Date().toLocaleString('ar-EG'))}</p>
            </div>
        `;
        
        content.innerHTML = html;
        modal.style.display = 'flex';
        
        console.log('✅ تم عرض معلومات الطلب والاشتراك');
        
    } catch (error) {
        console.error('❌ خطأ في عرض معلومات الطلب:', error);
        if (typeof showNotification === 'function') {
            showNotification('حدث خطأ في تحميل المعلومات', 'error');
        }
    }
}

/**
 * إغلاق Modal معلومات الطلب
 */
function closeOrderStatusModal() {
    const modal = document.getElementById('orderStatusModal');
    if (modal) {
        modal.style.display = 'none';
    }
}

// إغلاق Modal عند الضغط خارجه
document.addEventListener('DOMContentLoaded', function() {
    const modal = document.getElementById('orderStatusModal');
    
    if (modal) {
        modal.addEventListener('click', function(event) {
            if (event.target === modal) {
                closeOrderStatusModal();
            }
        });
    }
});
