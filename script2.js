// متغيرات عامة - INDEX2 (مستقل تماماً عن INDEX3 و INDEX4)
/** تخزين مرتبط بالبريد الحالي (user-storage-scope.js) */
function lsScopedGet_INDEX2(k) {
    return typeof gostaLsGetScoped_INDEX2 === 'function' ? gostaLsGetScoped_INDEX2(k) : localStorage.getItem(k);
}
function lsScopedSet_INDEX2(k, v) {
    if (typeof gostaLsSetScoped_INDEX2 === 'function') gostaLsSetScoped_INDEX2(k, v);
    else localStorage.setItem(k, v);
}
function lsScopedRemove_INDEX2(k) {
    if (typeof gostaLsRemoveScoped_INDEX2 === 'function') gostaLsRemoveScoped_INDEX2(k);
    else localStorage.removeItem(k);
}

let currentUser = null;
let userPassword = '';
let displayValue = '0';
let files = [];
let deletedFiles = []; // سلة المحذوفات
let backupFiles = []; // النسخ الاحتياطية (الملفات المحذوفة نهائياً)
let cloudActiveFileIds_INDEX2 = new Map(); // للعرض فقط: يحدد الملفات المرفوعة للسحابة
/** أثناء رفع دفعة ملفات: يُستخدم لإعادة محاولة القراءة من IndexedDB إن تأخرت المعاملات */
let __prSafePendingUploadCount_INDEX2 = 0;
/** يمنع إشعار «لم تختر ملفات» عند تصفير input بعد رفع ناجح */
let __gostaSuppressEmptyFileInputChange_INDEX2 = false;
let __prSafeRecentUploadedFileIds_INDEX2 = [];
let currentMediaIndex = -1;
let currentFilter = 'all'; // متغير لتتبع الفلترة الحالية
let vaultFileSearchQuery_INDEX2 = '';
let db = null; // قاعدة بيانات IndexedDB
let encryptionKey = null; // مفتاح التشفير
let currentMediaData = {
    encryptedData: null,
    fileType: null,
    isEncrypted: false
}; // متغير لحفظ بيانات الملف الحالي المشفرة

// ===== حدود التخزين الخاصة بـ INDEX2 =====
const FREE_PLAN_STORAGE_MB_INDEX2 = 1000;
const MAX_UPLOAD_SIZE_INDEX2 = FREE_PLAN_STORAGE_MB_INDEX2 * 1024 * 1024; // حد الخطة المجانية
const MAX_RESTORE_FILES = 50; // 50 ملف كحد أقصى للاستعادة
const MAX_RESTORE_SIZE = FREE_PLAN_STORAGE_MB_INDEX2 * 1024 * 1024; // حد الاستعادة للخطة المجانية

/** حتى يُدخل كود التفعيل لا يُعتبر المستخدم «مسجّلاً» — لا يُحفظ userAccount_INDEX2 قبل التفعيل */
const PENDING_EMAIL_VERIFY_KEY_INDEX2 = 'pendingEmailVerify_INDEX2';
const STORAGE_MODE_KEY_INDEX2 = 'storageMode_INDEX2'; // local | cloud
const VAULT_BLUR_ENABLED_KEY_INDEX2 = 'vaultBlurEnabled_INDEX2'; // '1' | '0'
const VAULT_LOCKED_PREVIEW_DATA_URL_INDEX2 =
    "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='400' height='300'%3E%3Crect fill='%2324263a' width='100%25' height='100%25'/%3E%3Ccircle cx='200' cy='130' r='36' fill='%23ffffff18' stroke='%23ffffff55' stroke-width='3'/%3E%3Crect x='178' y='168' width='44' height='52' rx='8' fill='%23ffffff18' stroke='%23ffffff55' stroke-width='3'/%3E%3C/svg%3E";
const CLOUD_ACTIVE_IDS_KEY_INDEX2 = 'cloudActiveFileIds_INDEX2';
const CLOUD_LIFECYCLE_IDS_KEY_INDEX2 = 'cloudLifecycleFileIds_INDEX2';
let cloudLifecycleFileIds_INDEX2 = new Map();
/** ملفات رُفعت للواجهة وما زال رفعها إلى R2 قيد التنفيذ — للوسم السحابي فوراً */
let cloudUploadPendingIds_INDEX2 = new Map();
const USER_FOLDERS_KEY_INDEX2 = 'userFolders_INDEX2';
const UNCAT_FOLDER_ID_INDEX2 = '__uncategorized__';
const FREE_PREMIUM_TRIAL_DAYS_INDEX2 = 10;
const VAULT_DOCUMENT_MIMES_INDEX2 = [
    'application/pdf',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel'
];
let selectedUploadFolderId_INDEX2 = UNCAT_FOLDER_ID_INDEX2;
let currentFolderFilterId_INDEX2 = null;
const DEVICE_BINDING_KEY_INDEX2 = 'deviceBindingId_INDEX2';
/** لقطة واجهة عند فتح المساعد من الزر العائم (لوحة جانبية) — تُدمج مع ui_context عند الإرسال */
var gostaAiFabLaunchSnapshot_INDEX2 = '';
var gostaAiFabBackdropClickBound_INDEX2 = false;

function inferVaultMimeFromName_INDEX2(name, fallback) {
    var n = String(name || '').toLowerCase();
    if (n.endsWith('.pdf')) {
        return 'application/pdf';
    }
    if (n.endsWith('.xlsx')) {
        return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    }
    if (n.endsWith('.xls')) {
        return 'application/vnd.ms-excel';
    }
    return fallback || 'application/octet-stream';
}

function isVaultDocumentType_INDEX2(type, name) {
    var t = String(type || '').toLowerCase();
    if (t === 'application/pdf' || t.indexOf('spreadsheet') >= 0 || t.indexOf('excel') >= 0) {
        return true;
    }
    if (VAULT_DOCUMENT_MIMES_INDEX2.indexOf(t) >= 0) {
        return true;
    }
    var n = String(name || '').toLowerCase();
    return n.endsWith('.pdf') || n.endsWith('.xlsx') || n.endsWith('.xls');
}

function isSupportedVaultUpload_INDEX2(file) {
    if (!file) {
        return false;
    }
    return (
        file.type.startsWith('image/') ||
        file.type.startsWith('video/') ||
        isVaultDocumentType_INDEX2(file.type, file.name)
    );
}

function getVaultFileKind_INDEX2(file) {
    if (!file) {
        return 'other';
    }
    if (file.type && file.type.startsWith('image/')) {
        return 'image';
    }
    if (file.type && file.type.startsWith('video/')) {
        return 'video';
    }
    if (isVaultDocumentType_INDEX2(file.type, file.name)) {
        return 'document';
    }
    return 'other';
}

function isVaultPdfFile_INDEX2(file) {
    var t = String((file && file.type) || '').toLowerCase();
    var n = String((file && file.name) || '').toLowerCase();
    return t === 'application/pdf' || n.endsWith('.pdf');
}

function isVaultExcelFile_INDEX2(file) {
    if (!file || isVaultPdfFile_INDEX2(file)) {
        return false;
    }
    var t = String(file.type || '').toLowerCase();
    var n = String((file.name || '')).toLowerCase();
    return (
        n.endsWith('.xlsx') ||
        n.endsWith('.xls') ||
        t.indexOf('spreadsheet') >= 0 ||
        t.indexOf('excel') >= 0
    );
}

function getVaultDocumentIcon_INDEX2(file) {
    return isVaultPdfFile_INDEX2(file) ? '📄' : '📊';
}

/** شارة زاوية على بطاقة الملف تميّز PDF أو Excel */
function setVaultFilesCarouselLayout_INDEX2(enabled) {
    var list = document.getElementById('filesList');
    var hint = document.getElementById('vaultFilesScrollHint_INDEX2');
    var wrap = document.getElementById('vaultFilesScrollWrap_INDEX2');
    if (list) {
        list.classList.toggle('vault-files-carousel', !!enabled);
    }
    if (hint) {
        hint.style.display = enabled ? '' : 'none';
    }
    if (wrap) {
        wrap.classList.toggle('vault-files-scroll-wrap--active', !!enabled);
    }
}

function getVaultDocCornerBadgeHtml_INDEX2(file) {
    if (!file || getVaultFileKind_INDEX2(file) !== 'document') {
        return '';
    }
    if (isVaultPdfFile_INDEX2(file)) {
        return '<span class="vault-doc-corner-badge vault-doc-corner-badge--pdf" title="ملف PDF" aria-label="PDF">PDF</span>';
    }
    if (isVaultExcelFile_INDEX2(file)) {
        return '<span class="vault-doc-corner-badge vault-doc-corner-badge--excel" title="ملف Excel" aria-label="Excel">XLS</span>';
    }
    return '';
}

function getVaultTrashIcon_INDEX2(file) {
    var kind = getVaultFileKind_INDEX2(file);
    if (kind === 'image') {
        return '🖼️';
    }
    if (kind === 'video') {
        return '🎥';
    }
    if (kind === 'document') {
        return getVaultDocumentIcon_INDEX2(file);
    }
    return '📁';
}

function getVaultDocumentCardSvgDataUrl_INDEX2(file) {
    var icon = getVaultDocumentIcon_INDEX2(file);
    var label = String((file && file.name) || 'مستند')
        .replace(/[<>&"']/g, '')
        .slice(0, 28);
    var svg =
        "<svg xmlns='http://www.w3.org/2000/svg' width='300' height='200'>" +
        "<rect width='100%' height='100%' fill='#eef1fb'/>" +
        "<text x='150' y='88' text-anchor='middle' font-size='48'>" +
        icon +
        '</text>' +
        "<text x='150' y='128' text-anchor='middle' font-size='13' fill='#4a5d85' font-family='Tahoma,sans-serif'>" +
        label +
        '</text></svg>';
    return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

var __vaultDocBlobUrl_INDEX2 = null;

function revokeVaultDocBlobUrl_INDEX2() {
    if (__vaultDocBlobUrl_INDEX2) {
        try {
            URL.revokeObjectURL(__vaultDocBlobUrl_INDEX2);
        } catch (e) {
            /* ignore */
        }
        __vaultDocBlobUrl_INDEX2 = null;
    }
}

function resetCurrentMediaDataForVaultFile_INDEX2(file) {
    var kind = getVaultFileKind_INDEX2(file);
    currentMediaData = {
        encryptedData: file && file.isEncrypted ? file.data : null,
        isEncrypted: !!(file && file.isEncrypted),
        fileType:
            (file && file.type) || inferVaultMimeFromName_INDEX2(file && file.name, 'application/octet-stream'),
        fileKind: kind,
        decryptedData: null
    };
}

function buildVaultDataUrl_INDEX2(file, decryptedBase64OrDataUrl) {
    var raw = String(decryptedBase64OrDataUrl || '');
    if (raw.startsWith('data:')) {
        return raw;
    }
    var mime =
        (file && file.type) || inferVaultMimeFromName_INDEX2(file && file.name, 'application/octet-stream');
    return 'data:' + mime + ';base64,' + raw;
}

function dataUrlToBlob_INDEX2(dataUrl) {
    var parts = String(dataUrl).split(',');
    var mime = 'application/octet-stream';
    if (parts[0] && parts[0].indexOf('data:') === 0) {
        var m = parts[0].match(/data:([^;]+)/);
        if (m && m[1]) {
            mime = m[1];
        }
    }
    var b64 = parts.length > 1 ? parts[1] : parts[0];
    var bstr = atob(b64);
    var n = bstr.length;
    var u8 = new Uint8Array(n);
    for (var i = 0; i < n; i++) {
        u8[i] = bstr.charCodeAt(i);
    }
    return new Blob([u8], { type: mime });
}

var VAULT_EXCEL_MAX_ROWS_INDEX2 = 500;

function buildVaultExcelTableHtml_INDEX2(rows, truncated) {
    if (!rows || !rows.length) {
        return '<p class="vault-excel-empty">الورقة فارغة</p>';
    }
    var maxCols = 0;
    rows.forEach(function (r) {
        if (r && r.length > maxCols) {
            maxCols = r.length;
        }
    });
    var html = '<table class="vault-excel-table"><tbody>';
    rows.forEach(function (row, ri) {
        html += '<tr>';
        for (var c = 0; c < maxCols; c++) {
            var cell = row && row[c] != null ? row[c] : '';
            if (cell instanceof Date) {
                cell = cell.toLocaleString('ar');
            } else {
                cell = String(cell);
            }
            var tag = ri === 0 ? 'th' : 'td';
            html += '<' + tag + '>' + escapeHtml_INDEX2(cell) + '</' + tag + '>';
        }
        html += '</tr>';
    });
    html += '</tbody></table>';
    if (truncated) {
        html +=
            '<p class="vault-excel-truncated">عرض أول ' +
            VAULT_EXCEL_MAX_ROWS_INDEX2 +
            ' صف فقط — استخدم «تنزيل» للملف كاملاً.</p>';
    }
    return html;
}

function renderVaultExcelDownloadFallback_INDEX2(mediaDisplay, file, downloadUrl) {
    var wrap = document.createElement('div');
    wrap.className = 'vault-doc-open-actions';
    wrap.style.cssText = 'text-align:center;padding:24px;';
    wrap.innerHTML =
        '<p style="margin:0 0 8px;font-size:18px;font-weight:700;color:#333;">📊 ' +
        escapeHtml_INDEX2(file.name) +
        '</p><p style="margin:0 0 16px;color:#666;font-size:13px;">تعذر عرض الجدول داخل التطبيق.</p>';
    var dlBtn = createVaultDocFooterButton_INDEX2({
        variant: 'excel',
        label: '📥 تنزيل Excel',
        ariaLabel: 'تنزيل ' + (file && file.name ? file.name : 'Excel'),
        onClick: function () {
            var a = document.createElement('a');
            a.href = downloadUrl;
            a.download = ensureDownloadFileName_INDEX2(
                file.name,
                file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            );
            document.body.appendChild(a);
            a.click();
            a.remove();
        }
    });
    wrap.appendChild(dlBtn);
    mediaDisplay.appendChild(wrap);
}

async function renderVaultExcelInApp_INDEX2(mediaDisplay, file, dataUrl, downloadUrl) {
    mediaDisplay.classList.add('vault-excel-mode');
    mediaDisplay.innerHTML =
        '<div class="vault-excel-viewer"><div class="vault-excel-loading">جاري فتح Excel…</div></div>';

    if (typeof XLSX === 'undefined') {
        mediaDisplay.innerHTML = '';
        renderVaultExcelDownloadFallback_INDEX2(mediaDisplay, file, downloadUrl);
        return;
    }

    try {
        var ab = await dataUrlToBlob_INDEX2(dataUrl).arrayBuffer();
        var wb = XLSX.read(ab, { type: 'array', cellDates: true });
        var sheetNames = wb.SheetNames || [];
        if (!sheetNames.length) {
            throw new Error('لا توجد أوراق في الملف');
        }

        var shell = document.createElement('div');
        shell.className = 'vault-excel-viewer';

        var header = document.createElement('div');
        header.className = 'vault-excel-header';
        header.innerHTML =
            '<span class="vault-excel-title">📊 ' + escapeHtml_INDEX2(file.name) + '</span>';
        shell.appendChild(header);

        var tabs = document.createElement('div');
        tabs.className = 'vault-excel-tabs';
        shell.appendChild(tabs);

        var tableWrap = document.createElement('div');
        tableWrap.className = 'vault-excel-table-wrap';
        shell.appendChild(tableWrap);

        function showSheet(sheetName) {
            var ws = wb.Sheets[sheetName];
            if (!ws) {
                tableWrap.innerHTML = '<p class="vault-excel-empty">ورقة غير متاحة</p>';
                return;
            }
            var rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '', raw: false });
            var truncated = false;
            if (rows.length > VAULT_EXCEL_MAX_ROWS_INDEX2) {
                rows = rows.slice(0, VAULT_EXCEL_MAX_ROWS_INDEX2);
                truncated = true;
            }
            tableWrap.innerHTML = buildVaultExcelTableHtml_INDEX2(rows, truncated);
        }

        sheetNames.forEach(function (name, idx) {
            var tabBtn = document.createElement('button');
            tabBtn.type = 'button';
            tabBtn.className = 'vault-excel-tab' + (idx === 0 ? ' active' : '');
            tabBtn.textContent = name;
            tabBtn.onclick = function () {
                tabs.querySelectorAll('.vault-excel-tab').forEach(function (b) {
                    b.classList.remove('active');
                });
                tabBtn.classList.add('active');
                showSheet(name);
            };
            tabs.appendChild(tabBtn);
        });

        var dlBtn = createVaultDocFooterButton_INDEX2({
            variant: 'excel',
            label: '📥 تنزيل الملف',
            ariaLabel: 'تنزيل ' + (file && file.name ? file.name : 'Excel'),
            onClick: function () {
                var a = document.createElement('a');
                a.href = downloadUrl;
                a.download = ensureDownloadFileName_INDEX2(
                    file.name,
                    file.type || 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
                );
                document.body.appendChild(a);
                a.click();
                a.remove();
            }
        });
        appendVaultDocFooterActions_INDEX2(shell, dlBtn);

        mediaDisplay.innerHTML = '';
        mediaDisplay.appendChild(shell);
        showSheet(sheetNames[0]);
    } catch (excelErr) {
        console.error('[vault-excel]', excelErr);
        mediaDisplay.innerHTML = '';
        renderVaultExcelDownloadFallback_INDEX2(mediaDisplay, file, downloadUrl);
        showNotification('⚠️ تعذر عرض Excel داخل التطبيق — يمكنك تنزيله.');
    }
}

function vaultAssetUrl_INDEX2(relativePath) {
    try {
        return new URL(relativePath, window.location.href).href;
    } catch (e) {
        return relativePath;
    }
}

function ensurePdfJsLib_INDEX2() {
    if (window.pdfjsLib && window.__pdfjsConfigured_INDEX2) {
        return Promise.resolve(window.pdfjsLib);
    }
    if (!window.__pdfJsLoadPromise_INDEX2) {
        window.__pdfJsLoadPromise_INDEX2 = import(vaultAssetUrl_INDEX2('vendor/pdfjs/pdf.min.mjs'))
            .then(function (pdfjs) {
                pdfjs.GlobalWorkerOptions.workerSrc = vaultAssetUrl_INDEX2(
                    'vendor/pdfjs/pdf.worker.min.mjs'
                );
                window.pdfjsLib = pdfjs;
                window.__pdfjsConfigured_INDEX2 = true;
                return pdfjs;
            })
            .catch(function (err) {
                window.__pdfJsLoadPromise_INDEX2 = null;
                throw err;
            });
    }
    return window.__pdfJsLoadPromise_INDEX2;
}

async function dataUrlToArrayBuffer_INDEX2(dataUrl) {
    var blob = dataUrlToBlob_INDEX2(dataUrl);
    return await blob.arrayBuffer();
}

function createVaultDocFooterButton_INDEX2(opts) {
    var isLink = !!opts.href;
    var el = document.createElement(isLink ? 'a' : 'button');
    if (!isLink) {
        el.type = 'button';
    } else {
        el.href = opts.href;
        el.target = '_blank';
        el.rel = 'noopener noreferrer';
    }
    el.className = 'vault-doc-footer-btn' + (opts.variant ? ' vault-doc-footer-btn--' + opts.variant : '');
    el.textContent = opts.label || '';
    if (opts.ariaLabel) {
        el.setAttribute('aria-label', opts.ariaLabel);
    }
    if (typeof opts.onClick === 'function') {
        el.addEventListener('click', opts.onClick);
    }
    return el;
}

function appendVaultDocFooterActions_INDEX2(parent, childEl) {
    var row = document.createElement('div');
    row.className = 'vault-doc-footer-actions';
    row.appendChild(childEl);
    parent.appendChild(row);
}

function appendVaultPdfExternalLink_INDEX2(parent, displayUrl, file) {
    var extLink = createVaultDocFooterButton_INDEX2({
        href: displayUrl,
        variant: 'pdf',
        label: '↗ فتح PDF في نافذة جديدة',
        ariaLabel: 'فتح ' + (file && file.name ? file.name : 'PDF') + ' في نافذة جديدة'
    });
    appendVaultDocFooterActions_INDEX2(parent, extLink);
}

function renderVaultPdfIframeFallback_INDEX2(container, displayUrl, file) {
    container.innerHTML = '';
    var iframe = document.createElement('iframe');
    iframe.className = 'vault-pdf-frame';
    iframe.src = displayUrl;
    iframe.title = file && file.name ? file.name : 'PDF';
    iframe.setAttribute('loading', 'lazy');
    container.appendChild(iframe);
}

async function renderVaultPdfInApp_INDEX2(mediaDisplay, file, dataUrl) {
    revokeVaultDocBlobUrl_INDEX2();
    mediaDisplay.innerHTML = '';
    mediaDisplay.classList.remove('vault-video-mode', 'vault-image-mode', 'vault-excel-mode');
    mediaDisplay.classList.add('vault-pdf-mode');

    var displayUrl = dataUrl;
    try {
        __vaultDocBlobUrl_INDEX2 = URL.createObjectURL(dataUrlToBlob_INDEX2(dataUrl));
        displayUrl = __vaultDocBlobUrl_INDEX2;
    } catch (blobErr) {
        console.warn('[vault-doc] blob url:', blobErr);
    }

    var shell = document.createElement('div');
    shell.className = 'vault-pdf-viewer';

    var status = document.createElement('p');
    status.className = 'vault-pdf-status';
    status.textContent = 'جاري فتح PDF…';
    shell.appendChild(status);

    var canvasWrap = document.createElement('div');
    canvasWrap.className = 'vault-pdf-canvas-wrap';
    shell.appendChild(canvasWrap);

    mediaDisplay.appendChild(shell);

    var maxPagesToRender = 24;
    try {
        var pdfjs = await ensurePdfJsLib_INDEX2();
        var pdfBytes = await dataUrlToArrayBuffer_INDEX2(dataUrl);
        var loadingTask = pdfjs.getDocument({ data: pdfBytes });
        var pdf = await loadingTask.promise;
        status.remove();

        var pageCount = pdf.numPages || 0;
        var pagesToDraw = Math.min(pageCount, maxPagesToRender);

        for (var pageNum = 1; pageNum <= pagesToDraw; pageNum++) {
            var page = await pdf.getPage(pageNum);
            var viewport = page.getViewport({ scale: 1.15 });
            var canvas = document.createElement('canvas');
            canvas.className = 'vault-pdf-page-canvas';
            var ctx = canvas.getContext('2d');
            canvas.width = Math.floor(viewport.width);
            canvas.height = Math.floor(viewport.height);
            await page.render({ canvasContext: ctx, viewport: viewport }).promise;
            canvasWrap.appendChild(canvas);
            if (pageNum === 1) {
                applyVaultMediaOrientation_INDEX2(canvas.width, canvas.height);
            }
        }

        if (pageCount > maxPagesToRender) {
            var trunc = document.createElement('p');
            trunc.className = 'vault-pdf-truncated';
            trunc.textContent =
                'عرض أول ' +
                maxPagesToRender +
                ' صفحة — استخدم «تنزيل» أو الرابط أدناه للملف كاملاً.';
            canvasWrap.appendChild(trunc);
        }

        appendVaultPdfExternalLink_INDEX2(shell, displayUrl, file);
    } catch (pdfErr) {
        console.warn('[vault-pdf]', pdfErr);
        status.textContent = 'جاري المحاولة بطريقة بديلة…';
        try {
            canvasWrap.innerHTML = '';
            renderVaultPdfIframeFallback_INDEX2(canvasWrap, displayUrl, file);
            status.remove();
            appendVaultPdfExternalLink_INDEX2(shell, displayUrl, file);
        } catch (iframeErr) {
            status.textContent = 'تعذر عرض PDF داخل التطبيق. استخدم الرابط أدناه.';
            appendVaultPdfExternalLink_INDEX2(shell, displayUrl, file);
        }
    }
}

function renderVaultDocumentUnlocked_INDEX2(mediaDisplay, file, dataUrl) {
    revokeVaultDocBlobUrl_INDEX2();
    mediaDisplay.classList.remove('vault-pdf-mode', 'vault-excel-mode');

    if (isVaultPdfFile_INDEX2(file)) {
        renderVaultPdfInApp_INDEX2(mediaDisplay, file, dataUrl);
        return;
    }

    mediaDisplay.innerHTML = '';
    var displayUrl = dataUrl;
    try {
        __vaultDocBlobUrl_INDEX2 = URL.createObjectURL(dataUrlToBlob_INDEX2(dataUrl));
        displayUrl = __vaultDocBlobUrl_INDEX2;
    } catch (blobErr) {
        console.warn('[vault-doc] blob url:', blobErr);
    }

    if (isVaultExcelFile_INDEX2(file)) {
        renderVaultExcelInApp_INDEX2(mediaDisplay, file, dataUrl, displayUrl);
    } else {
        renderVaultExcelDownloadFallback_INDEX2(mediaDisplay, file, displayUrl);
    }
}

function applyHydratedDataToVaultFile_INDEX2(file, index, hydrated) {
    if (!hydrated || !hydrated.data) {
        return false;
    }
    file.data = hydrated.data;
    if (hydrated.s3Key) {
        file.s3Key = hydrated.s3Key;
    }
    if (hydrated.storageBackend) {
        file.storageBackend = hydrated.storageBackend;
    }
    if (typeof index === 'number' && files[index] && fileIdKey_INDEX2(files[index].id) === fileIdKey_INDEX2(file.id)) {
        files[index].data = hydrated.data;
        if (hydrated.s3Key) {
            files[index].s3Key = hydrated.s3Key;
        }
        if (hydrated.storageBackend) {
            files[index].storageBackend = hydrated.storageBackend;
        }
    }
    return true;
}

function inferCloudCategoryFromS3Key_INDEX2(s3Key) {
    var key = String(s3Key || '');
    if (/\/backup\//.test(key)) {
        return 'backup';
    }
    if (/\/deleted\//.test(key)) {
        return 'deleted';
    }
    if (/\/files\//.test(key)) {
        return 'files';
    }
    return null;
}

function canHydrateCloudRecord_INDEX2(record) {
    if (!record || !canUseCloudStorage_INDEX2()) {
        return false;
    }
    return fileIsStoredInCloud_INDEX2(record) || isFileKnownInCloud_INDEX2(record);
}

async function fetchCloudRecordHydratedAnyCategory_INDEX2(record, categoryHint) {
    if (!record || record.data) {
        return record;
    }
    if (!canHydrateCloudRecord_INDEX2(record)) {
        return record;
    }
    var order = [];
    var fromKey = inferCloudCategoryFromS3Key_INDEX2(record.s3Key);
    if (fromKey) {
        order.push(fromKey);
    }
    if (categoryHint && order.indexOf(categoryHint) < 0) {
        order.push(categoryHint);
    }
    ['files', 'deleted', 'backup'].forEach(function (c) {
        if (order.indexOf(c) < 0) {
            order.push(c);
        }
    });
    for (var i = 0; i < order.length; i++) {
        var hydrated = await fetchCloudRecordHydratedForRestore_INDEX2(record, order[i]);
        if (hydrated && hydrated.data) {
            return hydrated;
        }
    }
    return record;
}

async function fetchCloudRecordHydratedForView_INDEX2(file) {
    return fetchCloudRecordHydratedAnyCategory_INDEX2(file, 'files');
}

async function ensureVaultFileDataForView_INDEX2(file, index) {
    if (!file) {
        throw new Error('no_file');
    }
    if (file.data) {
        return file;
    }
    if (!file.id) {
        throw new Error('no_data');
    }
    if (!db) {
        await initDatabase();
    }
    var full = await getFileFromIndexedDB(file.id);
    if (full && full.data) {
        applyHydratedDataToVaultFile_INDEX2(file, index, full);
        return file;
    }
    if (
        canHydrateCloudRecord_INDEX2(file) ||
        (canUseCloudStorage_INDEX2() && isRestoredCloudVaultFile_INDEX2(file)) ||
        (canUseCloudStorage_INDEX2() && file.id)
    ) {
        var fromCloud = await fetchCloudRecordHydratedForView_INDEX2(file);
        if (applyHydratedDataToVaultFile_INDEX2(file, index, fromCloud)) {
            if (fromCloud.s3Key || fromCloud.storageBackend) {
                markCloudLifecycleFileId_INDEX2(file.id);
                cloudActiveFileIds_INDEX2.set(fileIdKey_INDEX2(file.id), true);
                persistCloudActiveFileIds_INDEX2();
            }
            try {
                await saveFileToIndexedDB(typeof index === 'number' && files[index] ? files[index] : file);
            } catch (idbErr) {
                console.warn('[vault] save hydrated file to IDB:', idbErr);
            }
            return typeof index === 'number' && files[index] ? files[index] : file;
        }
    }
    throw new Error('missing_data');
}

function getVaultUploadMaxStorageMb_INDEX2() {
    var maxStorage = FREE_PLAN_STORAGE_MB_INDEX2;
    var subscription = lsScopedGet_INDEX2('userSubscription_INDEX2');
    if (subscription) {
        try {
            var sub = JSON.parse(subscription);
            var expiryDate = new Date(sub.expiryDate);
            if (new Date() <= expiryDate && sub.status === 'active') {
                maxStorage = sub.storage || maxStorage;
            }
        } catch (e) {
            /* ignore */
        }
    }
    return maxStorage;
}

/** يرفض فقط إذا تجاوز إجمالي التخزين حد الخطة — لا حد منفصل لحجم ملف واحد */
function vaultUploadFitsPlanQuota_INDEX2(fileSizeBytes) {
    var maxStorageLimit = getVaultUploadMaxStorageMb_INDEX2();
    var currentTotal = 0;
    files.forEach(function (f) {
        currentTotal += getSizeInMB(f.size);
    });
    var newFileSizeMb = fileSizeBytes / 1024 / 1024;
    if (currentTotal + newFileSizeMb > maxStorageLimit) {
        return {
            ok: false,
            maxStorageLimit: maxStorageLimit,
            currentTotal: currentTotal,
            newFileSizeMb: newFileSizeMb
        };
    }
    return { ok: true, maxStorageLimit: maxStorageLimit };
}

function parseDateSafeMs_INDEX2(v) {
    if (!v) return NaN;
    const raw = String(v).trim();
    let ms = new Date(raw).getTime();
    if (Number.isFinite(ms)) return ms;
    // دعم التواريخ المحلية العربية مثل: ٧‏/٥‏/٢٠٢٦ ١٠:٥٧:٤٨ ص
    const normalized = raw
        .replace(/[\u200e\u200f]/g, '')
        .replace(/[٠-٩]/g, function (d) {
            return String('٠١٢٣٤٥٦٧٨٩'.indexOf(d));
        })
        .replace(/\s*ص\s*/g, ' AM ')
        .replace(/\s*م\s*/g, ' PM ');
    ms = new Date(normalized).getTime();
    return Number.isFinite(ms) ? ms : NaN;
}

function hasFreePremiumTrialAccess_INDEX2() {
    try {
        const now = Date.now();
        const trialMs = FREE_PREMIUM_TRIAL_DAYS_INDEX2 * 24 * 60 * 60 * 1000;
        if (!Number.isFinite(now) || !Number.isFinite(trialMs) || trialMs <= 0) return false;
        const accRaw = localStorage.getItem('userAccount_INDEX2');
        if (!accRaw) return false;
        const acc = JSON.parse(accRaw);
        if (!acc || acc.emailVerified === false) return false;
        const createdAtMs = parseDateSafeMs_INDEX2(acc.createdAt) || parseDateSafeMs_INDEX2(acc.verifiedAt);
        if (!Number.isFinite(createdAtMs)) return false;
        return now - createdAtMs <= trialMs;
    } catch (e) {
        return false;
    }
}

function getOrCreateDeviceBindingId_INDEX2() {
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

function getStorageMode_INDEX2() {
    const mode = (localStorage.getItem(STORAGE_MODE_KEY_INDEX2) || 'local').trim().toLowerCase();
    return mode === 'cloud' ? 'cloud' : 'local';
}

function canUseCloudStorage_INDEX2() {
    try {
        // إذا صار المستخدم على خطة مدفوعة أساسية/متقدمة، تُقفل السحابة والمزامنة نهائياً.
        // المطلوب: السماح بالمزامنة فقط أثناء التجربة المجانية الحالية.
        if (typeof getActiveSubscriptionPlan_INDEX2 === 'function') {
            const activePlan = String(getActiveSubscriptionPlan_INDEX2() || '').toUpperCase();
            if (activePlan === 'INDEX3' || activePlan === 'INDEX4') {
                return false;
            }
        }
        if (hasFreePremiumTrialAccess_INDEX2()) {
            return true;
        }
        if (typeof getActiveSubscriptionPlan_INDEX2 === 'function' && getActiveSubscriptionPlan_INDEX2() === 'INDEX5') {
            return true;
        }
        if (typeof getSubscriptionInfo === 'function') {
            const sub = getSubscriptionInfo();
            if (!sub || sub.status !== 'active') return false;
            const t = String(sub.type || sub.plan || '').toUpperCase();
            if (t !== 'INDEX5') return false;
            const exp = sub.expiryDate ? new Date(sub.expiryDate) : null;
            if (exp && !isNaN(exp.getTime()) && new Date() > exp) return false;
            return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

function shouldForceLocalOnlyPlan_INDEX2() {
    try {
        if (typeof getActiveSubscriptionPlan_INDEX2 !== 'function') return false;
        const activePlan = String(getActiveSubscriptionPlan_INDEX2() || '').toUpperCase();
        return activePlan === 'INDEX3' || activePlan === 'INDEX4';
    } catch (e) {
        return false;
    }
}

function demoteCloudTaggedFilesToLocalIfNeeded_INDEX2() {
    if (!shouldForceLocalOnlyPlan_INDEX2()) return;
    if (!(cloudActiveFileIds_INDEX2 instanceof Map) || cloudActiveFileIds_INDEX2.size === 0) return;
    updateCloudActiveFileIds_INDEX2([]);
    try {
        if (typeof showNotification === 'function') {
            showNotification('📱 تم تحويل ملفاتك السحابية السابقة إلى وسم محلي لأن الخطة الحالية محلية فقط.');
        }
    } catch (e) {}
}

function toggleVaultToolsDrawer_INDEX2() {
    var drawer = document.getElementById('vaultToolsDrawer_INDEX2');
    if (!drawer) {
        return;
    }
    var open = drawer.classList.toggle('vault-tools-drawer--open');
    var btn = document.getElementById('vaultToolsToggle_INDEX2');
    var panel = document.getElementById('vaultToolsPanel_INDEX2');
    var title = document.getElementById('vaultToolsToggleTitle_INDEX2');
    if (btn) {
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    }
    if (panel) {
        panel.setAttribute('aria-hidden', open ? 'false' : 'true');
    }
    if (title) {
        title.textContent = open ? 'إخفاء إعدادات الرفع' : 'إعدادات الرفع';
    }
}

function refreshVaultToolsToggleSummary_INDEX2() {
    var sub = document.getElementById('vaultToolsToggleSub_INDEX2');
    var chips = document.getElementById('vaultToolsToggleChips_INDEX2');
    var mode = getStorageMode_INDEX2();
    var hasCloud = canUseCloudStorage_INDEX2();
    var storageShort = mode === 'cloud' && hasCloud ? 'سحابة' : 'محلي';
    var storageChip = mode === 'cloud' && hasCloud ? '☁️ سحابة' : '📱 محلي';
    var blurOn = isVaultBlurEnabled_INDEX2();
    var blurShort = blurOn ? 'تمويه' : 'بدون تمويه';
    var blurChip = blurOn ? '🔒 مفعّل' : '👁️ مفتوح';
    var folderShort = 'بدون مجلد';
    var folderChip = '📁 بدون مجلد';
    var uploadSel = document.getElementById('uploadFolderSelect_INDEX2');
    if (uploadSel && uploadSel.selectedOptions && uploadSel.selectedOptions[0]) {
        var opt = uploadSel.selectedOptions[0];
        var raw = (opt.textContent || '').replace(/^📁\s*/, '').trim();
        if (opt.value === UNCAT_FOLDER_ID_INDEX2) {
            folderShort = 'بدون مجلد';
            folderChip = '📁 بدون مجلد';
        } else if (raw) {
            folderShort = raw.length > 16 ? raw.slice(0, 14) + '…' : raw;
            folderChip = '📁 ' + folderShort;
        }
    }
    if (sub) {
        sub.textContent = storageShort + ' · ' + blurShort + ' · ' + folderShort;
    }
    if (chips) {
        chips.innerHTML =
            '<span class="vault-tools-chip">' +
            storageChip +
            '</span><span class="vault-tools-chip">' +
            blurChip +
            '</span><span class="vault-tools-chip vault-tools-chip--folder">' +
            escapeHtml_INDEX2(folderChip) +
            '</span>';
    }
}

function refreshCloudFeaturesUi_INDEX2() {
    demoteCloudTaggedFilesToLocalIfNeeded_INDEX2();
    const hasCloudPlan = canUseCloudStorage_INDEX2();
    if (!hasCloudPlan) {
        localStorage.setItem(STORAGE_MODE_KEY_INDEX2, 'local');
    }
    const mode = getStorageMode_INDEX2();
    const summary = document.getElementById('storageModeSummary_INDEX2');
    const btnLocal = document.getElementById('btnStorageLocal_INDEX2');
    const btnCloud = document.getElementById('btnStorageCloud_INDEX2');
    const hint = document.getElementById('storageModeHint_INDEX2');
    if (summary) {
        summary.textContent =
            mode === 'cloud' && hasCloudPlan
                ? '☁️ السحابة (مع نسخ احتياطي على الخادم)'
                : '📱 على الجهاز فقط (محلي)';
    }
    if (btnLocal) {
        btnLocal.classList.toggle('active', mode === 'local' || !hasCloudPlan);
    }
    if (btnCloud) {
        btnCloud.classList.toggle('active', mode === 'cloud' && hasCloudPlan);
        btnCloud.disabled = !hasCloudPlan;
        btnCloud.style.opacity = hasCloudPlan ? '1' : '0.55';
        btnCloud.title = hasCloudPlan ? '' : 'يتطلب الخطة المميزة السحابية (INDEX5)';
    }
    if (hint) {
        if (hasCloudPlan) {
            hint.style.display = 'none';
            hint.textContent = '';
        } else {
            hint.style.display = 'block';
            hint.textContent =
                '☁️ التخزين السحابي والتبديل الكامل متاحان مع «الخطة المميزة السحابية» من صفحة الاشتراكات.';
        }
    }
    const syncBtn = document.getElementById('filterBtnCloudSync_INDEX2');
    const restoreBtn = document.getElementById('filterBtnCloudRestore_INDEX2');
    if (syncBtn) syncBtn.style.display = hasCloudPlan ? '' : 'none';
    if (restoreBtn) restoreBtn.style.display = hasCloudPlan ? '' : 'none';
    refreshVaultToolsToggleSummary_INDEX2();
}

function selectStorageLocal_INDEX2() {
    setStorageMode_INDEX2('local');
    showNotification('📱 تم اختيار الحفظ على الجهاز (محلي).');
}

function selectStorageCloud_INDEX2() {
    if (!canUseCloudStorage_INDEX2()) {
        showNotification('☁️ السحابة متاحة مع الخطة المميزة السحابية — افتح «خططنا والاشتراكات».');
        refreshCloudFeaturesUi_INDEX2();
        return;
    }
    setStorageMode_INDEX2('cloud');
    showNotification('☁️ تم اختيار وضع السحابة. لن يتم الرفع إلا عند الضغط على «مزامنة الآن».');
}

function setStorageMode_INDEX2(mode) {
    const wantsCloud = mode === 'cloud';
    const normalized = wantsCloud && canUseCloudStorage_INDEX2() ? 'cloud' : 'local';
    localStorage.setItem(STORAGE_MODE_KEY_INDEX2, normalized);
    refreshCloudFeaturesUi_INDEX2();
    return normalized;
}

function isVaultBlurEnabled_INDEX2() {
    return localStorage.getItem(VAULT_BLUR_ENABLED_KEY_INDEX2) !== '0';
}

function setVaultBlurEnabled_INDEX2(enabled) {
    localStorage.setItem(VAULT_BLUR_ENABLED_KEY_INDEX2, enabled ? '1' : '0');
    refreshVaultBlurSettingUi_INDEX2();
    if (typeof displayFiles === 'function' && files && files.length >= 0) {
        try {
            if (typeof updateStatsAndDisplay === 'function') {
                updateStatsAndDisplay();
            } else {
                displayFiles();
            }
        } catch (eRefresh) {}
    }
    showNotification(
        enabled
            ? '🔒 تم تفعيل التمويه — الملفات تُفتح بكلمة السر.'
            : '👁️ تم تعطيل التمويه — الفتح مباشر بدون كلمة سر.'
    );
}

function refreshVaultBlurSettingUi_INDEX2() {
    var enabled = isVaultBlurEnabled_INDEX2();
    var btnOn = document.getElementById('btnVaultBlurOn_INDEX2');
    var btnOff = document.getElementById('btnVaultBlurOff_INDEX2');
    var hint = document.getElementById('vaultBlurHint_INDEX2');
    var infoBlur = document.getElementById('vaultInfoBlurLine_INDEX2');
    if (btnOn) {
        btnOn.classList.toggle('active', enabled);
    }
    if (btnOff) {
        btnOff.classList.toggle('active', !enabled);
    }
    if (hint) {
        hint.textContent = enabled
            ? 'المعاينة والفتح مموّهان حتى تدخل كلمة سر الحساب.'
            : 'الفتح مباشر وواضح — بدون حقل كلمة سر في نافذة العرض.';
    }
    if (infoBlur) {
        infoBlur.textContent = enabled
            ? 'الملفات مخفية بتمويه حتى إدخال كلمة السر'
            : 'التمويه معطّل — عرض مباشر للملفات';
    }
    syncVaultMediaModalChrome_INDEX2(enabled);
    refreshVaultToolsToggleSummary_INDEX2();
}

function syncVaultMediaModalChrome_INDEX2(blurEnabled) {
    var enabled = blurEnabled !== undefined ? !!blurEnabled : isVaultBlurEnabled_INDEX2();
    var passwordSection = document.querySelector('#mediaModal .modal-password-section');
    var passwordInput = document.getElementById('mediaPassword');
    if (passwordSection) {
        passwordSection.style.display = enabled ? '' : 'none';
        passwordSection.style.animation = 'none';
    }
    if (passwordInput) {
        passwordInput.style.display = enabled ? '' : 'none';
        if (!enabled) {
            passwordInput.value = '';
        }
    }
    if (passwordSection) {
        var unlockBtn = passwordSection.querySelector('button');
        if (unlockBtn) {
            unlockBtn.style.display = enabled ? '' : 'none';
        }
    }
}

function ensureEncryptionKeyFromAccount_INDEX2() {
    try {
        var account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (account) {
            return applyVaultEncryptionKeyFromAccount_INDEX2(account);
        }
    } catch (e) {}
    return false;
}

/** فك تشفير بملفّات الحساب الحالي (مفتاح الخزنة + كلمة السر إن اختلفا) */
function decryptFileDataForAccount_INDEX2(encryptedBase64, account) {
    if (!encryptedBase64 || !account) {
        return null;
    }
    const keys = getVaultDecryptKeys_INDEX2(account);
    for (let i = 0; i < keys.length; i++) {
        const base64 = decryptFileDataWithKey_INDEX2(encryptedBase64, keys[i]);
        if (base64) {
            encryptionKey = keys[i];
            return base64;
        }
    }
    return null;
}

let vaultKeyNormalizeTimer_INDEX2 = null;
function scheduleVaultKeyNormalization_INDEX2(account) {
    if (!account) {
        return;
    }
    if (vaultKeyNormalizeTimer_INDEX2) {
        clearTimeout(vaultKeyNormalizeTimer_INDEX2);
    }
    vaultKeyNormalizeTimer_INDEX2 = setTimeout(function () {
        vaultKeyNormalizeTimer_INDEX2 = null;
        migrateVaultEncryptionToSeedIfNeeded_INDEX2(account)
            .then(function () {
                applyVaultEncryptionKeyFromAccount_INDEX2(account);
            })
            .catch(function (eNorm) {
                console.warn('[vault-normalize]', eNorm);
            });
    }, 400);
}

async function migrateVaultEncryptionToSeedIfNeeded_INDEX2(account) {
    if (!account || !account.vaultKeySeed || !account.password) {
        return null;
    }
    const seedKey = deriveVaultKeyFromSeed_INDEX2(account.email, account.vaultKeySeed);
    const pwdKey = deriveEncryptionKeyBytes(account.password);
    if (!seedKey || !pwdKey) {
        return null;
    }
    if (vaultKeyFingerprint_INDEX2(seedKey) === vaultKeyFingerprint_INDEX2(pwdKey)) {
        return null;
    }
    const stats = await reEncryptAllStoresWithKeys_INDEX2(pwdKey, seedKey);
    applyVaultEncryptionKeyFromAccount_INDEX2(account);
    return stats;
}

async function migrateVaultFromLegacyPasswordIfStored_INDEX2(account) {
    const legacy = getVaultLegacyPasswordForMigration_INDEX2();
    if (!legacy || !account || !account.password || legacy === account.password) {
        clearVaultLegacyPassword_INDEX2();
        return null;
    }
    const stats = await reEncryptVaultFilesAfterPasswordChange_INDEX2(
        account,
        legacy,
        account.password
    );
    clearVaultLegacyPassword_INDEX2();
    if (account.vaultKeySeed) {
        await migrateVaultEncryptionToSeedIfNeeded_INDEX2(account);
    }
    applyVaultEncryptionKeyFromAccount_INDEX2(account);
    return stats;
}

function decryptVaultFileToDataUrl_INDEX2(file) {
    if (!file) {
        return null;
    }
    if (!file.isEncrypted) {
        return buildVaultDataUrl_INDEX2(file, file.data);
    }
    if (!ensureEncryptionKeyFromAccount_INDEX2()) {
        return null;
    }
    var account = null;
    try {
        account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    } catch (eAcc) {}
    if (!account) {
        return null;
    }
    var enc = extractEncryptedBase64FromStoredData_INDEX2(file.data);
    var decrypted = decryptFileDataForAccount_INDEX2(enc || file.data, account);
    if (!decrypted) {
        return null;
    }
    scheduleVaultKeyNormalization_INDEX2(account);
    return buildVaultDataUrl_INDEX2(file, decrypted);
}

function getVaultCardPreviewSpec_INDEX2(file, blurOn, videoPlaceholder) {
    var kind = getVaultFileKind_INDEX2(file);
    if (blurOn) {
        if (kind === 'document') {
            return { tag: 'img', src: getVaultDocumentCardSvgDataUrl_INDEX2(file), blur: true };
        }
        return { tag: 'img', src: VAULT_LOCKED_PREVIEW_DATA_URL_INDEX2, blur: true };
    }
    if (kind === 'document') {
        return { tag: 'img', src: getVaultDocumentCardSvgDataUrl_INDEX2(file), blur: false, pending: false };
    }
    if (file.__cardPreviewUrl_INDEX2) {
        return {
            tag: kind === 'video' ? 'video' : 'img',
            src: file.__cardPreviewUrl_INDEX2,
            blur: false,
            pending: false
        };
    }
    var clearUrl = null;
    if (file.data) {
        clearUrl = decryptVaultFileToDataUrl_INDEX2(file);
        if (clearUrl) {
            file.__cardPreviewUrl_INDEX2 = clearUrl;
        }
    }
    if (clearUrl) {
        return {
            tag: kind === 'video' ? 'video' : 'img',
            src: clearUrl,
            blur: false,
            pending: false
        };
    }
    return {
        tag: kind === 'video' ? 'video' : 'img',
        src: videoPlaceholder,
        blur: false,
        pending: true
    };
}

function buildVaultCardPreviewElement_INDEX2(spec) {
    var el = document.createElement(spec.tag === 'video' ? 'video' : 'img');
    el.className = 'vault-card-preview-media';
    if (spec.src) {
        el.src = spec.src;
    }
    if (spec.tag === 'video') {
        el.muted = true;
        el.playsInline = true;
        el.setAttribute('playsinline', '');
        el.preload = 'metadata';
        el.setAttribute('aria-hidden', 'true');
    }
    el.style.width = '100%';
    el.style.height = '100%';
    el.style.objectFit = 'cover';
    el.style.filter = spec.blur ? 'blur(15px)' : 'none';
    el.style.transition = 'filter 0.5s ease-in-out';
    el.draggable = false;
    return el;
}

function applyVaultCardPreviewSrc_INDEX2(fileItem, file, previewUrl) {
    if (!fileItem || !previewUrl) {
        return;
    }
    var kind = getVaultFileKind_INDEX2(file);
    var preview = fileItem.querySelector('.file-preview');
    if (!preview) {
        return;
    }
    file.__cardPreviewUrl_INDEX2 = previewUrl;
    var existing = preview.querySelector('.vault-card-preview-media');
    var wantVideo = kind === 'video';
    if (existing && ((wantVideo && existing.tagName === 'VIDEO') || (!wantVideo && existing.tagName === 'IMG'))) {
        existing.src = previewUrl;
        existing.style.filter = 'none';
        return;
    }
    if (existing) {
        existing.remove();
    }
    var spec = {
        tag: wantVideo ? 'video' : 'img',
        src: previewUrl,
        blur: false
    };
    var mediaEl = buildVaultCardPreviewElement_INDEX2(spec);
    var actions = preview.querySelector('.file-actions');
    if (actions) {
        preview.insertBefore(mediaEl, actions);
    } else {
        preview.insertBefore(mediaEl, preview.firstChild);
    }
}

async function hydrateVaultCardPreviews_INDEX2() {
    if (isVaultBlurEnabled_INDEX2()) {
        return;
    }
    var items = document.querySelectorAll('#filesList .file-item[data-file-index]');
    for (var i = 0; i < items.length; i++) {
        var item = items[i];
        var idx = parseInt(item.getAttribute('data-file-index'), 10);
        if (isNaN(idx) || !files[idx]) {
            continue;
        }
        var file = files[idx];
        var kind = getVaultFileKind_INDEX2(file);
        if (kind === 'document') {
            continue;
        }
        if (file.__cardPreviewUrl_INDEX2) {
            applyVaultCardPreviewSrc_INDEX2(item, file, file.__cardPreviewUrl_INDEX2);
            continue;
        }
        try {
            await ensureVaultFileDataForView_INDEX2(file, idx);
            var url = decryptVaultFileToDataUrl_INDEX2(files[idx]);
            if (url) {
                applyVaultCardPreviewSrc_INDEX2(item, files[idx], url);
            }
        } catch (eCard) {
            /* skip card */
        }
    }
}

function appendVaultLockedOverlay_INDEX2(mediaDisplay) {
    var hiddenMessage = document.createElement('div');
    hiddenMessage.className = 'vault-media-locked-overlay';
    hiddenMessage.style.cssText =
        'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);background:rgba(0,0,0,0.7);color:white;padding:20px 30px;border-radius:10px;text-align:center;pointer-events:none;z-index:100;';
    hiddenMessage.innerHTML =
        '<div style="font-size:32px;margin-bottom:10px;">🔒</div>' +
        '<div style="font-size:14px;font-weight:bold;">الملف مخفي</div>' +
        '<div style="font-size:12px;margin-top:8px;opacity:0.8;">أدخل كلمة السر للمشاهدة</div>';
    mediaDisplay.appendChild(hiddenMessage);
}

function clearVaultMediaModalLayout_INDEX2() {
    var modal = document.getElementById('mediaModal');
    if (!modal) {
        return;
    }
    modal.classList.remove(
        'vault-media-modal--video',
        'vault-media-modal--image',
        'vault-media-modal--document',
        'vault-media-modal--pdf',
        'vault-media-modal--excel',
        'vault-media-modal--portrait',
        'vault-media-modal--landscape'
    );
}

function applyVaultMediaOrientation_INDEX2(width, height) {
    if (!width || !height) {
        return;
    }
    var modal = document.getElementById('mediaModal');
    if (!modal) {
        return;
    }
    if (width >= height) {
        modal.classList.add('vault-media-modal--landscape');
        modal.classList.remove('vault-media-modal--portrait');
    } else {
        modal.classList.add('vault-media-modal--portrait');
        modal.classList.remove('vault-media-modal--landscape');
    }
}

function syncVaultMediaModalLayout_INDEX2(file) {
    var modal = document.getElementById('mediaModal');
    if (!modal) {
        return;
    }
    clearVaultMediaModalLayout_INDEX2();
    var kind = getVaultFileKind_INDEX2(file);
    if (kind === 'video') {
        modal.classList.add('vault-media-modal--video');
    } else if (kind === 'image') {
        modal.classList.add('vault-media-modal--image');
    } else if (kind === 'document') {
        if (isVaultPdfFile_INDEX2(file)) {
            modal.classList.add('vault-media-modal--document', 'vault-media-modal--pdf');
            applyVaultMediaOrientation_INDEX2(595, 842);
        } else {
            modal.classList.add('vault-media-modal--excel');
        }
    }
}

function bindVaultVideoLayoutOnMeta_INDEX2(video) {
    function applyLayout() {
        if (!video || !video.videoWidth) {
            return;
        }
        applyVaultMediaOrientation_INDEX2(video.videoWidth, video.videoHeight);
    }
    video.addEventListener('loadedmetadata', applyLayout);
    if (video.readyState >= 1) {
        applyLayout();
    }
}

function bindVaultImageLayoutOnLoad_INDEX2(img) {
    function applyLayout() {
        if (!img || !img.naturalWidth) {
            return;
        }
        applyVaultMediaOrientation_INDEX2(img.naturalWidth, img.naturalHeight);
    }
    img.addEventListener('load', applyLayout);
    if (img.complete && img.naturalWidth) {
        applyLayout();
    }
}

function renderVaultImageInApp_INDEX2(mediaDisplay, file, dataUrl, opts) {
    opts = opts || {};
    mediaDisplay.innerHTML = '';
    mediaDisplay.classList.remove('vault-video-mode', 'vault-pdf-mode', 'vault-excel-mode');
    mediaDisplay.classList.add('vault-image-mode');

    var stage = document.createElement('div');
    stage.className = 'vault-image-stage';

    var img = document.createElement('img');
    img.className = 'vault-image-player' + (opts.locked ? ' vault-image-player--locked' : ' unlocked');
    img.alt = file && file.name ? file.name : 'صورة';
    img.draggable = false;
    if (opts.locked) {
        img.src = VAULT_LOCKED_PREVIEW_DATA_URL_INDEX2;
    } else {
        img.src = dataUrl;
        bindVaultImageLayoutOnLoad_INDEX2(img);
    }

    stage.appendChild(img);
    mediaDisplay.appendChild(stage);
}

function renderVaultDocLockedPreview_INDEX2(mediaDisplay, file) {
    mediaDisplay.innerHTML = '';
    mediaDisplay.classList.remove('vault-video-mode', 'vault-image-mode', 'vault-excel-mode');
    mediaDisplay.classList.add('vault-pdf-mode');

    var stage = document.createElement('div');
    stage.className = 'vault-doc-locked-stage vault-doc-unlock-target';
    stage.innerHTML =
        '<div class="vault-doc-locked-icon">' +
        getVaultDocumentIcon_INDEX2(file) +
        '</div>' +
        '<div class="vault-doc-locked-name">' +
        escapeHtml_INDEX2(file.name) +
        '</div>' +
        '<div class="vault-doc-locked-hint">أدخل كلمة السر لفتح المستند</div>';
    mediaDisplay.appendChild(stage);
}

function renderVaultVideoInApp_INDEX2(mediaDisplay, file, dataUrl, opts) {
    opts = opts || {};
    mediaDisplay.innerHTML = '';
    mediaDisplay.classList.remove('vault-pdf-mode', 'vault-excel-mode');
    mediaDisplay.classList.add('vault-video-mode');

    var stage = document.createElement('div');
    stage.className = 'vault-video-stage';

    var video = document.createElement('video');
    video.className = 'vault-video-player' + (opts.locked ? ' vault-video-player--locked' : '');
    video.src = opts.locked ? VAULT_LOCKED_PREVIEW_DATA_URL_INDEX2 : dataUrl;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.playsInline = true;
    video.preload = opts.locked ? 'metadata' : 'auto';

    if (opts.locked) {
        video.controls = false;
        video.muted = true;
    } else {
        video.controls = true;
        video.classList.add('unlocked');
        bindVaultVideoLayoutOnMeta_INDEX2(video);
    }

    if (file.isCompressed && !opts.locked) {
        var warning = document.createElement('div');
        warning.className = 'vault-video-compressed-badge';
        warning.textContent = '⚠️ فيديو مضغوط';
        stage.appendChild(warning);
    }

    stage.appendChild(video);
    mediaDisplay.appendChild(stage);
}

function renderVaultMediaUnlocked_INDEX2(mediaDisplay, file, dataUrl) {
    var fileKind = getVaultFileKind_INDEX2(file);

    mediaDisplay.classList.remove('vault-video-mode', 'vault-image-mode');

    if (fileKind === 'document') {
        renderVaultDocumentUnlocked_INDEX2(mediaDisplay, file, dataUrl);
        return;
    }

    if (fileKind === 'video') {
        renderVaultVideoInApp_INDEX2(mediaDisplay, file, dataUrl, { locked: false });
        return;
    }

    if (fileKind === 'image') {
        renderVaultImageInApp_INDEX2(mediaDisplay, file, dataUrl, { locked: false });
        return;
    }
}

function openSupportModal_INDEX2() {
    const modal = document.getElementById('supportModal_INDEX2');
    if (!modal) return;
    const emailInput = document.getElementById('supportEmail_INDEX2');
    const subjectInput = document.getElementById('supportSubject_INDEX2');
    const msgInput = document.getElementById('supportMessage_INDEX2');
    const fileInput = document.getElementById('supportAttachments_INDEX2');
    try {
        const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        const savedEmail = (localStorage.getItem('currentUserEmail_INDEX2') || '').trim() || String(account?.email || '').trim();
        if (emailInput && savedEmail) emailInput.value = savedEmail;
    } catch (e) {}
    if (subjectInput) subjectInput.value = '';
    if (msgInput) msgInput.value = '';
    if (fileInput) fileInput.value = '';
    modal.style.display = 'block';
}

function closeSupportModal_INDEX2() {
    const modal = document.getElementById('supportModal_INDEX2');
    if (modal) modal.style.display = 'none';
}

/** محادثة المساعد الذكي (تُرسل للخادم فقط، بدون مفتاح API في المتصفح) */
var GOSTA_ASSISTANT_PROFILE_KEY = 'gostaAssistantProfileV1';
var aiChatHistory_INDEX2 = [];
/** آخر صورة مُنشأة/مُعدَّلة في فقاعة السجل — لمسار تعديل من مربع الإرسال دون إعادة رفع */
var lastAiImageDataUrlForEdit_INDEX2 = '';
var LAST_AI_IMAGE_DATA_URL_MAX_CHARS_INDEX2 = 14 * 1024 * 1024;
/** تخزين مؤقت لآخر صورة في الجلسة (تبويب واحد) — حجم أقصى أصغر من sessionStorage النموذجي */
var AI_LAST_IMAGE_SESSION_KEY_INDEX2 = 'gostaAiLastImageDataUrlV1';
var AI_LAST_IMAGE_SESSION_MAX_CHARS_INDEX2 = Math.floor(2.5 * 1024 * 1024);
var aiChatLogResizeInitialized_INDEX2 = false;
/** عند تجاوز هذا العدد تُلخّص الرسائل الأقدم وتُدمج في ملخص الملف الشخصي */
var AI_CHAT_ROLLUP_AFTER_INDEX2 = 28;
var AI_CHAT_ROLLUP_KEEP_INDEX2 = 14;
/** يحفظ نسخة نصية من السجل لنفس تبويب المتصفح (تحديث الصفحة لا يمحو السياق) */
var AI_CHAT_SESSION_KEY_INDEX2 = 'gostaAiChatWireV1';
/** حقائق مثبتة تُرسل للخادم مع المزامنة / الـ hybrid memory */
var GOSTA_PINNED_FACTS_KEY = 'gostaAiPinnedFactsV1';
/** ذاكرة محادثة على الجهاز — تُلحق تلقائياً ولا تُمسح عند «مسح» السجل */
var GOSTA_AI_DEVICE_MEMORY_KEY = 'gostaAiDeviceMemoryV1';
var GOSTA_AI_DEVICE_MEMORY_MAX = 3800;
var aiConversationId_INDEX2 = null;

function compactAiDeviceMemoryLine_INDEX2(s, max) {
    var t = String(s || '')
        .replace(/\s+/g, ' ')
        .trim();
    if (t.length > max) {
        t = t.slice(0, max - 1) + '…';
    }
    return t;
}

function mergeIntoAiDeviceMemoryStore_INDEX2(fragment) {
    var line = String(fragment || '').replace(/\s+/g, ' ').trim();
    if (!line) {
        return;
    }
    try {
        var prev = localStorage.getItem(GOSTA_AI_DEVICE_MEMORY_KEY) || '';
        var next = prev ? prev + '\n' + line : line;
        while (next.length > GOSTA_AI_DEVICE_MEMORY_MAX) {
            var cut = next.indexOf('\n');
            if (cut < 0) {
                next = next.slice(-GOSTA_AI_DEVICE_MEMORY_MAX);
                break;
            }
            next = next.slice(cut + 1);
        }
        localStorage.setItem(GOSTA_AI_DEVICE_MEMORY_KEY, next);
    } catch (e) {}
}

/** توحيد نص لاستخراج العمر: أرقام هندية عربية → ASCII، و ی الفارسية → ي العربية (لوحة مفاتيح الجوال) */
function normalizeMemoryExtractionText_INDEX2(s) {
    var t = String(s || '')
        .replace(/\s+/g, ' ')
        .replace(/\u06CC/g, '\u064A')
        .trim();
    var arabicIndic = '٠١٢٣٤٥٦٧٨٩';
    var ascii = '0123456789';
    var out = [];
    for (var i = 0; i < t.length; i++) {
        var c = t.charAt(i);
        var ix = arabicIndic.indexOf(c);
        out.push(ix >= 0 ? ascii.charAt(ix) : c);
    }
    return out.join('');
}

/** يستخرج حقائق بسيطة من نص المستخدم فور الإرسال (قبل رد المساعد) — يحل مشكلة «عمري 41» إذا لم يُكمَّل الحفظ بعد الرد */
function noteUserStatedFactsInDeviceMemory_INDEX2(userText) {
    var raw = String(userText || '').replace(/\s+/g, ' ').trim();
    if (!raw || raw === '(صورة)') {
        return;
    }
    var norm = normalizeMemoryExtractionText_INDEX2(raw);
    var prev = '';
    try {
        prev = localStorage.getItem(GOSTA_AI_DEVICE_MEMORY_KEY) || '';
    } catch (e) {}
    var ageM =
        norm.match(/(?:أنا\s+)?(?:عمري|عُمري|عمرى)\s*[:：]?\s*(\d{1,3})\b/u) ||
        norm.match(/بلغت\s+من\s+العمر\s*[:：]?\s*(\d{1,3})\b/u) ||
        norm.match(/\b(\d{1,3})\s*سنة(?:\s|$|[,.،])/u);
    if (ageM) {
        var age = ageM[1];
        if (prev.indexOf('عمر المستخدم ' + age) === -1 && prev.indexOf('عمري ' + age) === -1) {
            mergeIntoAiDeviceMemoryStore_INDEX2('• حقيقة (المستخدم): عمر المستخدم ' + age + ' سنة.');
        }
    }
    var nameM = norm.match(/اسمي\s+(.{1,50})/u);
    if (nameM) {
        var nm = String(nameM[1] || '')
            .replace(/[,.،؛!؟].*$/u, '')
            .trim();
        if (nm.length >= 2 && prev.indexOf(nm) === -1) {
            mergeIntoAiDeviceMemoryStore_INDEX2('• حقيقة (المستخدم): الاسم المذكور ' + nm + '.');
        }
    }
}

/** يُستدعى بعد رد المساعد الناجح — يُرسل لاحقاً ضمن assistantContext.persistent_memory */
function appendAiDeviceMemoryFromExchange_INDEX2(userContent, assistantContent) {
    var u = compactAiDeviceMemoryLine_INDEX2(userContent, 280);
    var a = compactAiDeviceMemoryLine_INDEX2(assistantContent, 480);
    if (!u && !a) {
        return;
    }
    mergeIntoAiDeviceMemoryStore_INDEX2('• مس: ' + (u || '(بدون نص)') + ' | م: ' + (a || '…'));
}

function aiConvStorageKey_INDEX2(email) {
    return 'gostaAiConvId_' + String(email || '').trim().toLowerCase();
}
var aiChatRollupInFlight_INDEX2 = false;
var aiTypingBubbleEl_INDEX2 = null;
var aiVoiceRecognition_INDEX2 = null;
var aiVoiceRecording_INDEX2 = false;
var aiVoiceMediaRecorder_INDEX2 = null;
var aiVoiceMediaChunks_INDEX2 = [];
var aiVoiceMediaStream_INDEX2 = null;
var aiVoiceFallbackAttempted_INDEX2 = false;

function aiChatEscapeHtml_INDEX2(s) {
    const d = document.createElement('div');
    d.textContent = s;
    return d.innerHTML;
}

function appendAiChatBubble_INDEX2(role, text, imageDataUrls) {
    const log = document.getElementById('aiChatLog_INDEX2');
    if (!log) return;
    const wrap = document.createElement('div');
    wrap.className = 'ai-chat-bubble';
    if (role === 'user') {
        wrap.className += ' ai-chat-bubble-user';
        var label = document.createElement('div');
        label.innerHTML = '<strong>أنت:</strong><br>' + aiChatEscapeHtml_INDEX2(text || '(صورة)');
        wrap.appendChild(label);
        if (imageDataUrls && imageDataUrls.length) {
            var row = document.createElement('div');
            row.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;margin-top:6px;';
            imageDataUrls.forEach(function (u) {
                var im = document.createElement('img');
                im.src = String(u);
                im.alt = '';
                im.style.cssText =
                    'max-height:72px;max-width:100px;border-radius:6px;object-fit:cover;border:1px solid #90caf9;';
                row.appendChild(im);
            });
            wrap.appendChild(row);
        }
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
        return;
    } else {
        wrap.className += ' ai-chat-bubble-assistant';
        var head = document.createElement('div');
        head.innerHTML = '<strong>GOSTA:</strong>';
        wrap.appendChild(head);
        wrap.appendChild(document.createElement('br'));
        var body = document.createElement('div');
        body.className = 'ai-chat-assistant-content';
        body.textContent = text || '';
        wrap.appendChild(body);
        log.appendChild(wrap);
        log.scrollTop = log.scrollHeight;
        return body;
    }
}

function setAiChatStatus_INDEX2(msg) {
    const el = document.getElementById('aiChatStatus_INDEX2');
    if (!el) return;
    el.textContent = msg || '';
    if (msg && String(msg).trim()) {
        el.setAttribute('aria-busy', 'true');
    } else {
        el.removeAttribute('aria-busy');
    }
}

function clearLastAiImageSession_INDEX2() {
    try {
        sessionStorage.removeItem(AI_LAST_IMAGE_SESSION_KEY_INDEX2);
    } catch (e) {}
}

function persistLastAiImageToSession_INDEX2(url) {
    try {
        var u = String(url || '');
        if (!aiChatDataUrlIsSupported_INDEX2(u) || u.length < 80) return;
        if (u.length > AI_LAST_IMAGE_SESSION_MAX_CHARS_INDEX2) return;
        sessionStorage.setItem(AI_LAST_IMAGE_SESSION_KEY_INDEX2, u);
    } catch (e1) {}
}

function restoreLastAiImageFromSession_INDEX2() {
    try {
        var raw = sessionStorage.getItem(AI_LAST_IMAGE_SESSION_KEY_INDEX2);
        if (!raw || raw.length < 80) return;
        if (raw.length > LAST_AI_IMAGE_DATA_URL_MAX_CHARS_INDEX2) return;
        if (!aiChatDataUrlIsSupported_INDEX2(raw)) return;
        lastAiImageDataUrlForEdit_INDEX2 = raw;
    } catch (e2) {}
}

function copyAiPhotoTemplate_INDEX2() {
    var t = document.getElementById('aiPhotoTemplateSnippet_INDEX2');
    if (!t) return;
    var text = String(t.value || '').trim();
    if (!text) return;
    t.focus();
    t.select();
    var done = function () {
        setAiChatStatus_INDEX2('تم نسخ قالب الوصف');
        setTimeout(function () { setAiChatStatus_INDEX2(''); }, 2500);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done).catch(function () {
            try {
                document.execCommand('copy');
                done();
            } catch (e) {}
        });
    } else {
        try {
            document.execCommand('copy');
            done();
        } catch (e2) {}
    }
}

/** قالب واقعي قياسي (مطابق لمنطق generateRealisticPrompt) */
function generateRealisticPrompt_INDEX2(subject, details) {
    var s = String(subject || '').trim();
    var d = String(details || '').trim();
    var mid = d ? ',' + d : '';
    return (
        'Ultra realistic photo of ' +
        s +
        mid +
        ',natural soft lighting,shallow depth of field,detailed skin texture,photorealistic,cinematic composition,real shadows,very fine detail; no visible text, numbers, watermarks, or dimension labels in the frame'
    );
}

/** نسخة أقوى ضد الكرتون (مطابق لمنطق ultraPhotoPrompt؛ real human proportions أنسب للبشر) */
function ultraPhotoPrompt_INDEX2(subject, details) {
    var s = String(subject || '').trim();
    var d = String(details || '').trim();
    var mid = d ? ',' + d : '';
    return (
        'Ultra realistic RAW photo of ' +
        s +
        mid +
        ',real human proportions,realistic skin texture,real world lighting,cinematic shadows,high dynamic range,sharp focus,professional photography look,depth of field,NOT cartoon,NOT anime,NOT illustration,NOT painting,photorealistic,very fine detail; no visible text, numbers, watermarks, or dimension labels in the frame'
    );
}

/**
 * يقرأ حقل «رسالتك»: السطر الأول = subject، بقية الأسطر تُدمج كـ details.
 * mode: 'realistic' | 'ultra' | 'raw' (يُعامل raw مثل ultra)
 */
function applyGeneratedRealisticPrompt_INDEX2(mode) {
    var ta = document.getElementById('aiChatInput_INDEX2');
    if (!ta) return;
    var m = String(mode == null ? '' : mode)
        .trim()
        .toLowerCase();
    var useUltra = m === 'ultra' || m === 'raw';
    var raw = String(ta.value || '').trim();
    if (!raw) {
        var emptyMsg = 'اكتب وصفاً في «رسالتك» أولاً (جملة واحدة تكفي)، ثم اضغط التحويل.';
        setAiChatStatus_INDEX2(emptyMsg);
        if (typeof showNotification === 'function') {
            showNotification('⚠️ ' + emptyMsg);
        }
        return;
    }
    var lines = raw
        .split(/\r?\n/)
        .map(function (l) {
            return l.trim();
        })
        .filter(Boolean);
    var subject = lines[0];
    var details = lines.length > 1 ? lines.slice(1).join(', ') : '';
    ta.value = useUltra ? ultraPhotoPrompt_INDEX2(subject, details) : generateRealisticPrompt_INDEX2(subject, details);
    var statusMsg = useUltra
        ? 'تم التحويل (RAW) — راجع النص في «رسالتك» ثم 🖼️ إنشاء صورة'
        : 'تم التحويل (قياسي) — راجع النص في «رسالتك» ثم 🖼️ إنشاء صورة';
    setAiChatStatus_INDEX2(statusMsg);
    if (typeof showNotification === 'function') {
        showNotification(useUltra ? '✅ تم تحويل النص إلى وصف RAW.' : '✅ تم تحويل النص إلى وصف واقعي قياسي.');
    }
    setTimeout(function () {
        setAiChatStatus_INDEX2('');
    }, 4000);
}

function setAiVoiceButtonState_INDEX2(isRecording) {
    const btn = document.getElementById('aiVoiceBtn_INDEX2');
    if (!btn) return;
    if (isRecording) {
        btn.classList.add('is-recording');
        btn.textContent = '⏹️ إيقاف التسجيل';
    } else {
        btn.classList.remove('is-recording');
        btn.textContent = '🎤 إرسال صوتي';
    }
}

function stopAiVoiceInput_INDEX2() {
    aiVoiceRecording_INDEX2 = false;
    aiVoiceFallbackAttempted_INDEX2 = false;
    setAiVoiceButtonState_INDEX2(false);
    try {
        if (aiVoiceRecognition_INDEX2) aiVoiceRecognition_INDEX2.stop();
    } catch (e) {}
    try {
        if (aiVoiceMediaRecorder_INDEX2 && aiVoiceMediaRecorder_INDEX2.state !== 'inactive') {
            aiVoiceMediaRecorder_INDEX2.stop();
        }
    } catch (e2) {}
    try {
        if (aiVoiceMediaStream_INDEX2) {
            aiVoiceMediaStream_INDEX2.getTracks().forEach(function (t) { t.stop(); });
        }
    } catch (e3) {}
    aiVoiceMediaStream_INDEX2 = null;
}

function blobToDataUrl_INDEX2(blob) {
    return new Promise(function (resolve, reject) {
        try {
            const reader = new FileReader();
            reader.onload = function () { resolve(String(reader.result || '')); };
            reader.onerror = function () { reject(reader.error || new Error('blob_read_failed')); };
            reader.readAsDataURL(blob);
        } catch (e) {
            reject(e);
        }
    });
}

async function submitRecordedVoiceToAi_INDEX2(blob) {
    try {
        await waitForAuthDiscoveryIfNeeded();
    } catch (e) {}
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showNotification('❌ لم يتم العثور على الخادم. شغّل npm run auth-server');
        return;
    }
    const dataUrl = await blobToDataUrl_INDEX2(blob);
    setAiChatStatus_INDEX2('⏳ جاري تحويل الصوت إلى نص...');
    const r = await fetch(AUTH.apiBase + '/api/ai/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioDataUrl: dataUrl })
    });
    const data = await r.json().catch(function () { return {}; });
    if (!r.ok || !data.ok) {
        const msg = (data && data.message) || (data && data.error) || ('تعذر الطلب (' + r.status + ')');
        throw new Error(msg);
    }
    const text = String(data.text || '').trim();
    if (!text) {
        setAiChatStatus_INDEX2('');
        showNotification('⚠️ لم يتم التقاط كلام واضح. حاول مرة أخرى بصوت أعلى.');
        return;
    }
    const input = document.getElementById('aiChatInput_INDEX2');
    if (input) input.value = text;
    setAiChatStatus_INDEX2('✅ تم تحويل الصوت إلى نص. جاري الإرسال...');
    await sendAiChatMessage_INDEX2();
}

async function startMediaRecorderVoice_INDEX2() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia || typeof MediaRecorder === 'undefined') {
        showNotification('⚠️ الإدخال الصوتي غير مدعوم في هذا المتصفح.');
        return;
    }
    aiVoiceMediaChunks_INDEX2 = [];
    aiVoiceMediaStream_INDEX2 = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mimeCandidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];
    let pickedMime = '';
    for (var i = 0; i < mimeCandidates.length; i++) {
        if (typeof MediaRecorder.isTypeSupported === 'function' && MediaRecorder.isTypeSupported(mimeCandidates[i])) {
            pickedMime = mimeCandidates[i];
            break;
        }
    }
    aiVoiceMediaRecorder_INDEX2 = pickedMime
        ? new MediaRecorder(aiVoiceMediaStream_INDEX2, { mimeType: pickedMime })
        : new MediaRecorder(aiVoiceMediaStream_INDEX2);
    aiVoiceMediaRecorder_INDEX2.ondataavailable = function (ev) {
        if (ev.data && ev.data.size > 0) aiVoiceMediaChunks_INDEX2.push(ev.data);
    };
    aiVoiceMediaRecorder_INDEX2.onstop = async function () {
        try {
            const mt =
                (aiVoiceMediaRecorder_INDEX2 && aiVoiceMediaRecorder_INDEX2.mimeType) ||
                (pickedMime || 'audio/webm');
            const blob = new Blob(aiVoiceMediaChunks_INDEX2, { type: mt });
            aiVoiceMediaChunks_INDEX2 = [];
            if (!blob || !blob.size) {
                setAiChatStatus_INDEX2('');
                showNotification('⚠️ لم يتم تسجيل صوت. حاول مرة أخرى.');
                return;
            }
            await submitRecordedVoiceToAi_INDEX2(blob);
        } catch (e) {
            console.error('voice media recorder stop:', e);
            setAiChatStatus_INDEX2('');
            showNotification('❌ تعذر تحويل الصوت إلى نص.');
        } finally {
            try {
                if (aiVoiceMediaStream_INDEX2) {
                    aiVoiceMediaStream_INDEX2.getTracks().forEach(function (t) { t.stop(); });
                }
            } catch (e2) {}
            aiVoiceMediaStream_INDEX2 = null;
        }
    };
    aiVoiceMediaRecorder_INDEX2.start();
    aiVoiceRecording_INDEX2 = true;
    setAiVoiceButtonState_INDEX2(true);
    setAiChatStatus_INDEX2('🎙️ جاري التسجيل... اضغط الزر مرة أخرى للإيقاف');
}

function toggleAiVoiceInput_INDEX2() {
    var SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (aiVoiceRecording_INDEX2) {
        stopAiVoiceInput_INDEX2();
        setAiChatStatus_INDEX2('');
        return;
    }
    if (!SR) {
        startMediaRecorderVoice_INDEX2()
            .catch(function (e) {
                console.error('startMediaRecorderVoice_INDEX2', e);
                aiVoiceRecording_INDEX2 = false;
                setAiVoiceButtonState_INDEX2(false);
                setAiChatStatus_INDEX2('');
                showNotification('❌ تعذر بدء التسجيل الصوتي. تأكد من إذن المايكروفون.');
            });
        return;
    }
    if (!aiVoiceRecognition_INDEX2) {
        aiVoiceRecognition_INDEX2 = new SR();
        aiVoiceRecognition_INDEX2.lang = 'ar-SA';
        aiVoiceRecognition_INDEX2.continuous = false;
        aiVoiceRecognition_INDEX2.interimResults = true;
        aiVoiceRecognition_INDEX2.maxAlternatives = 1;
        aiVoiceRecognition_INDEX2.onresult = function (ev) {
            var finalText = '';
            var partial = '';
            for (var i = ev.resultIndex; i < ev.results.length; i++) {
                var txt = String(ev.results[i][0] && ev.results[i][0].transcript ? ev.results[i][0].transcript : '');
                if (ev.results[i].isFinal) finalText += txt + ' ';
                else partial += txt + ' ';
            }
            const input = document.getElementById('aiChatInput_INDEX2');
            if (input) {
                input.value = String((finalText || partial || '')).trim();
            }
            if (partial && !finalText) setAiChatStatus_INDEX2('🎙️ جاري الاستماع...');
            if (finalText.trim()) {
                setAiChatStatus_INDEX2('✅ تم تحويل الصوت إلى نص. جاري الإرسال...');
                sendAiChatMessage_INDEX2();
            }
        };
        aiVoiceRecognition_INDEX2.onerror = function (ev) {
            aiVoiceRecording_INDEX2 = false;
            setAiVoiceButtonState_INDEX2(false);
            const code = String(ev && ev.error ? ev.error : 'unknown');
            if (
                (code === 'network' || code === 'not-allowed' || code === 'service-not-allowed') &&
                !aiVoiceFallbackAttempted_INDEX2
            ) {
                aiVoiceFallbackAttempted_INDEX2 = true;
                setAiChatStatus_INDEX2('↻ جاري التحويل لوضع تسجيل بديل...');
                startMediaRecorderVoice_INDEX2()
                    .catch(function (e) {
                        console.error('voice fallback start failed:', e);
                        setAiChatStatus_INDEX2('');
                        showNotification('❌ تعذر بدء التسجيل البديل (' + code + ').');
                    });
                return;
            }
            if (code !== 'no-speech' && code !== 'aborted') {
                showNotification('❌ تعذر التقاط الصوت (' + code + ').');
            }
            setAiChatStatus_INDEX2('');
        };
        aiVoiceRecognition_INDEX2.onend = function () {
            aiVoiceRecording_INDEX2 = false;
            setAiVoiceButtonState_INDEX2(false);
            if (String(document.getElementById('aiChatStatus_INDEX2')?.textContent || '').includes('الاستماع')) {
                setAiChatStatus_INDEX2('');
            }
        };
    }
    try {
        aiVoiceRecording_INDEX2 = true;
        setAiVoiceButtonState_INDEX2(true);
        setAiChatStatus_INDEX2('🎙️ ابدأ الكلام الآن...');
        aiVoiceRecognition_INDEX2.start();
    } catch (e) {
        aiVoiceRecording_INDEX2 = false;
        setAiVoiceButtonState_INDEX2(false);
        showNotification('❌ تعذر بدء التسجيل الصوتي.');
        setAiChatStatus_INDEX2('');
    }
}

function showAiTypingIndicator_INDEX2() {
    const log = document.getElementById('aiChatLog_INDEX2');
    if (!log) return;
    hideAiTypingIndicator_INDEX2();
    const wrap = document.createElement('div');
    wrap.className = 'ai-chat-bubble ai-chat-bubble-assistant ai-chat-bubble-typing';
    wrap.innerHTML =
        '<strong>GOSTA:</strong><br>' +
        '<span class="ai-chat-typing-dots" aria-label="typing">' +
        '<span></span><span></span><span></span>' +
        '</span>';
    aiTypingBubbleEl_INDEX2 = wrap;
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
}

function hideAiTypingIndicator_INDEX2() {
    if (aiTypingBubbleEl_INDEX2 && aiTypingBubbleEl_INDEX2.parentNode) {
        aiTypingBubbleEl_INDEX2.parentNode.removeChild(aiTypingBubbleEl_INDEX2);
    }
    aiTypingBubbleEl_INDEX2 = null;
}

function loadAssistantProfileFromStorage_INDEX2() {
    try {
        var raw = localStorage.getItem(GOSTA_ASSISTANT_PROFILE_KEY);
        if (!raw) return {};
        var o = JSON.parse(raw);
        return o && typeof o === 'object' ? o : {};
    } catch (e) {
        return {};
    }
}

function patchAssistantConversationSummary_INDEX2(summaryText) {
    try {
        var p = loadAssistantProfileFromStorage_INDEX2();
        p.conversation_summary = String(summaryText || '').trim().slice(0, 2000);
        localStorage.setItem(GOSTA_ASSISTANT_PROFILE_KEY, JSON.stringify(p));
    } catch (e) {}
}

/**
 * يضغط السطر الزمني للمحادثة: يطلب من الخادم ملخصاً للجزء الأقدم ويحتفظ بآخر رسائل فقط.
 * لا يُفشل إرسال الرسالة عند الخطأ — يُكمِل بسجل كامل.
 * ضبط الحساسية: غيّر AI_CHAT_ROLLUP_AFTER_INDEX2 / AI_CHAT_ROLLUP_KEEP_INDEX2 أعلاه إن فُقد سياق مهم أو أردت تقليل طلبات الملخص.
 */
async function maybeRollupAiHistory_INDEX2() {
    if (aiChatRollupInFlight_INDEX2) return;
    if (aiChatHistory_INDEX2.length <= AI_CHAT_ROLLUP_AFTER_INDEX2) return;
    var keep = AI_CHAT_ROLLUP_KEEP_INDEX2;
    var head = aiChatHistory_INDEX2.slice(0, aiChatHistory_INDEX2.length - keep);
    if (head.length < 2) return;
    aiChatRollupInFlight_INDEX2 = true;
    try {
        await waitForAuthDiscoveryIfNeeded();
    } catch (e) {}
    try {
        var AUTH = window.PR_SAFE_AUTH || {};
        if (!AUTH.apiBase) return;
        var prev = String(loadAssistantProfileFromStorage_INDEX2().conversation_summary || '').trim();
        var wireHead = head.map(function (m) {
            var c = String(m.content || '').trim();
            if (m.role === 'user' && m.images && m.images.length) {
                c = (c || '(صورة)') + ' [' + m.images.length + ' صورة]';
            }
            return { role: m.role, content: c.slice(0, 8000) };
        });
        var r = await fetch(AUTH.apiBase + '/api/ai/summarize-history', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                messages: wireHead,
                previousSummary: prev.slice(0, 2000)
            })
        });
        var data = await r.json().catch(function () {
            return {};
        });
        if (!r.ok || !data.ok || !data.summary) return;
        var merged = prev
            ? prev.slice(0, 1500) + '\n\n—\n' + String(data.summary).trim()
            : String(data.summary).trim();
        if (merged.length > 2000) {
            merged = merged.slice(-2000);
        }
        patchAssistantConversationSummary_INDEX2(merged);
        aiChatHistory_INDEX2 = aiChatHistory_INDEX2.slice(-keep);
        persistAiChatHistoryToSession_INDEX2();
        syncAiConversationToServer_INDEX2();
    } catch (e) {
        console.warn('maybeRollupAiHistory_INDEX2', e);
    } finally {
        aiChatRollupInFlight_INDEX2 = false;
    }
}

function loadAssistantProfileForm_INDEX2() {
    var p = loadAssistantProfileFromStorage_INDEX2();
    var nameEl = document.getElementById('aiAssistantPrefName_INDEX2');
    var langEl = document.getElementById('aiAssistantPrefLang_INDEX2');
    var shortEl = document.getElementById('aiAssistantPrefShort_INDEX2');
    var intEl = document.getElementById('aiAssistantPrefInterests_INDEX2');
    var persEl = document.getElementById('aiAssistantPrefPersona_INDEX2');
    var styEl = document.getElementById('aiAssistantPrefStyle_INDEX2');
    var sumEl = document.getElementById('aiAssistantPrefSummary_INDEX2');
    if (nameEl) nameEl.value = String(p.name || '');
    if (langEl) langEl.value = String(p.language || 'auto');
    if (shortEl) shortEl.checked = !!p.likes_short_answers;
    if (intEl) {
        intEl.value = Array.isArray(p.interested_in) ? p.interested_in.join('، ') : String(p.interested_in || '');
    }
    if (persEl) persEl.value = String(p.persona || '');
    if (styEl) styEl.value = String(p.response_style || '');
    if (sumEl) sumEl.value = String(p.conversation_summary || '');
}

function saveAssistantProfileFromForm_INDEX2() {
    var nameEl = document.getElementById('aiAssistantPrefName_INDEX2');
    var langEl = document.getElementById('aiAssistantPrefLang_INDEX2');
    var shortEl = document.getElementById('aiAssistantPrefShort_INDEX2');
    var intEl = document.getElementById('aiAssistantPrefInterests_INDEX2');
    var persEl = document.getElementById('aiAssistantPrefPersona_INDEX2');
    var styEl = document.getElementById('aiAssistantPrefStyle_INDEX2');
    var sumEl = document.getElementById('aiAssistantPrefSummary_INDEX2');
    var interests = [];
    if (intEl && intEl.value) {
        interests = String(intEl.value)
            .split(/[,،;؛]/)
            .map(function (s) { return String(s || '').trim(); })
            .filter(Boolean)
            .slice(0, 12);
    }
    var o = {
        name: nameEl ? String(nameEl.value || '').trim().slice(0, 80) : '',
        language: langEl ? String(langEl.value || 'auto').trim() : 'auto',
        likes_short_answers: !!(shortEl && shortEl.checked),
        interested_in: interests,
        persona: persEl ? String(persEl.value || '').trim().slice(0, 60) : '',
        response_style: styEl ? String(styEl.value || '').trim().slice(0, 140) : '',
        conversation_summary: sumEl ? String(sumEl.value || '').trim().slice(0, 2000) : ''
    };
    try {
        localStorage.setItem(GOSTA_ASSISTANT_PROFILE_KEY, JSON.stringify(o));
        showNotification('✅ تم حفظ تفضيلات المساعد على هذا الجهاز.');
    } catch (e) {
        showNotification('❌ تعذر الحفظ في المتصفح.');
    }
}

/** يُرسل مع /api/ai/chat — بدون حقول فارغة */
/**
 * لقطة نصية للواجهة النشطة — تُرسل مع المساعد حتى يفسّر «هنا» والشاشة الحالية.
 * لا تُقرأ قيمة حقل الحاسبة (#display) حتى لا تُرسل كلمة مرور الخزنة.
 */
function buildAppUiContextSnapshotForAi_INDEX2() {
    var parts = [];
    try {
        var active = document.querySelector('.page.active');
        var pageId = active && active.id ? String(active.id) : '';
        parts.push('شاشة_نشطة:' + (pageId || 'غير_معروف'));
        var aiModal = document.getElementById('aiChatModal_INDEX2');
        if (aiModal) {
            var disp = window.getComputedStyle(aiModal).display;
            if (disp !== 'none') {
                parts.push('نافذة_مساعد:مفتوحة');
                var mt = aiModal.querySelector('.ai-chat-title');
                if (mt) {
                    var tt = String(mt.textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 120);
                    if (tt.length > 1) {
                        parts.push('عنوان_المساعد:' + tt);
                    }
                }
            }
        }
        if (typeof buildUserSubscriptionSnapshotForAi_INDEX2 === 'function') {
            parts.push(buildUserSubscriptionSnapshotForAi_INDEX2());
        }
        var subBar = document.getElementById('subscriptionBar');
        if (subBar) {
            var barTxt = String(subBar.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 160);
            if (barTxt.length > 2) {
                parts.push('شريط_الاشتراك:' + barTxt);
            }
        }
        var sm = document.getElementById('storageModeSummary_INDEX2');
        if (sm) {
            var st = String(sm.textContent || '')
                .replace(/\s+/g, ' ')
                .trim()
                .slice(0, 100);
            if (st) {
                parts.push('تخزين_في_الواجهة:' + st);
            }
        }
        if (active) {
            var titles = active.querySelectorAll(
                'h1, h2, h3, .ai-chat-title, .media-header .header-content h2, .media-header .header-subtitle, .subscriptions-header .header-subtitle, .login-box h1'
            );
            var n = 0;
            for (var i = 0; i < titles.length && n < 14; i++) {
                var t = String(titles[i].textContent || '')
                    .replace(/\s+/g, ' ')
                    .trim()
                    .slice(0, 100);
                if (t.length < 2) {
                    continue;
                }
                parts.push('عنوان:' + t);
                n++;
            }
            if (pageId === 'mediaPage') {
                var extras = active.querySelectorAll(
                    '.filter-btn, .upload-section p, .upload-section .upload-info, .upload-section .upload-subtitle'
                );
                var en = 0;
                for (var ei = 0; ei < extras.length && en < 22; ei++) {
                    var et = String(extras[ei].textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 90);
                    if (et.length < 2) {
                        continue;
                    }
                    parts.push('واجهة:' + et);
                    en++;
                }
            }
            if (pageId === 'subscriptionsPage') {
                var plans = active.querySelectorAll(
                    '.plan-card .plan-subtitle, .plan-card .plan-price, .comparison-table th'
                );
                var pn = 0;
                for (var pi = 0; pi < plans.length && pn < 16; pi++) {
                    var pt = String(plans[pi].textContent || '')
                        .replace(/\s+/g, ' ')
                        .trim()
                        .slice(0, 80);
                    if (pt.length < 2) {
                        continue;
                    }
                    parts.push('خطط_معروضة_للشراء:' + pt);
                    pn++;
                }
            }
        }
    } catch (e) {
        parts.push('ui_snapshot_error');
    }
    var out = parts.join('|');
    if (out.length > 3200) {
        out = out.slice(0, 3200);
    }
    return out;
}

function getAssistantContextForApi_INDEX2() {
    var p = loadAssistantProfileFromStorage_INDEX2();
    var ctx = {};
    if (p.name) ctx.name = String(p.name).slice(0, 80);
    if (p.language && p.language !== 'auto') ctx.language = String(p.language).slice(0, 12);
    if (p.likes_short_answers) ctx.likes_short_answers = true;
    if (Array.isArray(p.interested_in) && p.interested_in.length) {
        ctx.interested_in = p.interested_in.map(function (x) { return String(x).slice(0, 48); }).slice(0, 10);
    }
    if (p.persona) ctx.persona = String(p.persona).slice(0, 60);
    if (p.response_style) ctx.response_style = String(p.response_style).slice(0, 140);
    if (p.conversation_summary) ctx.conversation_summary = String(p.conversation_summary).slice(0, 2000);
    var acct = getCurrentUserEmailForCloud_INDEX2();
    if (acct && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(acct)) {
        ctx.account_email = String(acct).trim().toLowerCase().slice(0, 120);
    }
    try {
        var pinRaw = localStorage.getItem(GOSTA_PINNED_FACTS_KEY);
        if (pinRaw) {
            var pins = JSON.parse(pinRaw);
            if (Array.isArray(pins) && pins.length) {
                ctx.pinned_facts = pins
                    .map(function (x) {
                        return String(x || '').trim().slice(0, 500);
                    })
                    .filter(Boolean)
                    .slice(0, 24);
            }
        }
    } catch (e) {}
    try {
        var memRaw = localStorage.getItem(GOSTA_AI_DEVICE_MEMORY_KEY);
        if (memRaw) {
            var pm = String(memRaw).trim().slice(0, GOSTA_AI_DEVICE_MEMORY_MAX);
            if (pm) {
                ctx.persistent_memory = pm;
            }
        }
    } catch (e2) {}
    try {
        if (typeof getUserSubscriptionContextForAi_INDEX2 === 'function') {
            var subCtx = getUserSubscriptionContextForAi_INDEX2();
            if (subCtx && subCtx.status) {
                ctx.user_subscription = subCtx;
            }
        }
    } catch (eSub) {}
    try {
        var uiParts = [];
        if (gostaAiFabLaunchSnapshot_INDEX2) {
            uiParts.push('لقطة_عند_فتح_لوحة_جانبية:' + gostaAiFabLaunchSnapshot_INDEX2);
        }
        var uiLive = buildAppUiContextSnapshotForAi_INDEX2();
        if (uiLive) {
            uiParts.push('لحظة_الإرسال:' + uiLive);
        }
        if (uiParts.length) {
            ctx.ui_context = uiParts.join('||');
        }
    } catch (eU) {}
    return Object.keys(ctx).length ? ctx : undefined;
}

function syncAiChatPrefsToggleButton_INDEX2() {
    var dlg = document.getElementById('aiChatPrefsDialog_INDEX2');
    var btn = document.getElementById('aiChatPrefsToggle_INDEX2');
    if (!btn) return;
    var open = !!(dlg && dlg.open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    btn.classList.toggle('is-open', open);
}

function toggleAiChatPrefs_INDEX2() {
    var dlg = document.getElementById('aiChatPrefsDialog_INDEX2');
    if (!dlg) return;
    if (dlg.open) {
        closeAiChatPrefsDialog_INDEX2();
        return;
    }
    if (typeof dlg.showModal === 'function') {
        dlg.showModal();
    } else {
        dlg.setAttribute('open', '');
    }
    syncAiChatPrefsToggleButton_INDEX2();
}

function closeAiChatPrefsDialog_INDEX2() {
    var dlg = document.getElementById('aiChatPrefsDialog_INDEX2');
    if (!dlg) return;
    if (typeof dlg.close === 'function') {
        dlg.close();
    } else {
        dlg.removeAttribute('open');
    }
    syncAiChatPrefsToggleButton_INDEX2();
}

function closeAiChatPrefsPanel_INDEX2() {
    closeAiChatPrefsDialog_INDEX2();
}

function openAiPhotoAdvancedDialog_INDEX2() {
    var dlg = document.getElementById('aiChatPhotoAdvancedDialog_INDEX2');
    if (!dlg) return;
    if (typeof dlg.showModal === 'function') {
        dlg.showModal();
    } else {
        dlg.setAttribute('open', '');
    }
}

function closeAiPhotoAdvancedDialog_INDEX2() {
    var dlg = document.getElementById('aiChatPhotoAdvancedDialog_INDEX2');
    if (!dlg) return;
    if (typeof dlg.close === 'function') {
        dlg.close();
    } else {
        dlg.removeAttribute('open');
    }
}

function syncGostaAiFabVisibility_INDEX2() {
    var fab = document.getElementById('gostaAiFabBtn_INDEX2');
    if (!fab) {
        return;
    }
    if (
        typeof isGostaAppAssistantEnabledForUsers_INDEX2 === 'function' &&
        !isGostaAppAssistantEnabledForUsers_INDEX2()
    ) {
        fab.style.display = 'none';
        fab.setAttribute('aria-hidden', 'true');
        return;
    }
    /** زر المساعد العائم: المجاني أثناء التجربة النشطة فقط، أو INDEX5 — مخفي عن INDEX3/4 وعن المجاني بعد انتهاء التجربة (isFreePlanUsageLocked) */
    var paidPlan =
        typeof getActiveSubscriptionPlan_INDEX2 === 'function'
            ? getActiveSubscriptionPlan_INDEX2()
            : null;
    var freeTrialEndedLocked =
        !paidPlan &&
        typeof isFreePlanUsageLocked_INDEX2 === 'function' &&
        isFreePlanUsageLocked_INDEX2();
    var showFabForPlan = paidPlan === 'INDEX5' || (!paidPlan && !freeTrialEndedLocked);
    var login = document.getElementById('loginPage');
    var calc = document.getElementById('calculatorPage');
    var media = document.getElementById('mediaPage');
    var subs = document.getElementById('subscriptionsPage');
    var onMain =
        (calc && calc.classList.contains('active')) ||
        (media && media.classList.contains('active')) ||
        (subs && subs.classList.contains('active'));
    var verifyOpen = false;
    try {
        var vs = document.getElementById('emailVerifySection');
        if (vs && window.getComputedStyle(vs).display !== 'none') {
            verifyOpen = true;
        }
    } catch (eV) {}
    var aiModal = document.getElementById('aiChatModal_INDEX2');
    var aiOpen = false;
    try {
        aiOpen = !!(aiModal && window.getComputedStyle(aiModal).display !== 'none');
    } catch (eM) {}
    var hide =
        !showFabForPlan ||
        !onMain ||
        (login && login.classList.contains('active')) ||
        verifyOpen ||
        aiOpen;
    fab.style.display = hide ? 'none' : 'flex';
    fab.setAttribute('aria-hidden', hide ? 'true' : 'false');
}

function wireGostaAdminAiFabOnce_INDEX2() {
    var fab = document.getElementById('gostaAdminAiFabBtn');
    if (!fab || fab.dataset.gostaFabWired === '1') {
        return;
    }
    fab.dataset.gostaFabWired = '1';
    fab.style.display = 'flex';
    fab.setAttribute('aria-hidden', 'false');
    fab.addEventListener('click', function () {
        if (typeof openAiChatModal_INDEX2 === 'function') {
            openAiChatModal_INDEX2(true);
        }
    });
}

function wireGostaAiFabOnce_INDEX2() {
    var fab = document.getElementById('gostaAiFabBtn_INDEX2');
    if (!fab || fab.dataset.gostaFabWired === '1') {
        return;
    }
    fab.dataset.gostaFabWired = '1';
    fab.addEventListener('click', function () {
        if (typeof openAiChatModal_INDEX2 === 'function') {
            openAiChatModal_INDEX2(true);
        }
        try {
            syncGostaAiFabVisibility_INDEX2();
        } catch (e2) {}
    });
    syncGostaAiFabVisibility_INDEX2();
}

function openAiChatModal_INDEX2(fromFab) {
    if (!gostaAppAssistantUserGuard_INDEX2()) return;
    const modal = document.getElementById('aiChatModal_INDEX2');
    if (!modal) return;
    const fabMode = fromFab === true;
    if (fabMode) {
        gostaAiFabLaunchSnapshot_INDEX2 = buildAppUiContextSnapshotForAi_INDEX2();
        document.body.classList.add('gosta-ai-side-drawer');
        modal.classList.add('ai-chat-modal--side-drawer');
    } else {
        gostaAiFabLaunchSnapshot_INDEX2 = '';
        document.body.classList.remove('gosta-ai-side-drawer');
        modal.classList.remove('ai-chat-modal--side-drawer');
    }
    modal.style.display = 'flex';
    if (!gostaAiFabBackdropClickBound_INDEX2) {
        gostaAiFabBackdropClickBound_INDEX2 = true;
        modal.addEventListener('click', function (ev) {
            if (ev.target !== modal) {
                return;
            }
            if (document.body.classList.contains('gosta-ai-side-drawer')) {
                closeAiChatModal_INDEX2();
            }
        });
    }
    closeAiChatPrefsPanel_INDEX2();
    closeAiPhotoAdvancedDialog_INDEX2();
    try {
        var emOpen = getCurrentUserEmailForCloud_INDEX2();
        if (emOpen) {
            var sid = localStorage.getItem(aiConvStorageKey_INDEX2(emOpen));
            if (sid) {
                aiConversationId_INDEX2 = sid;
            }
        }
    } catch (e) {}
    if (aiChatHistory_INDEX2.length === 0) {
        restoreAiChatHistoryFromSession_INDEX2();
    }
    restoreLastAiImageFromSession_INDEX2();
    initAiChatLogResize_INDEX2();
    requestAnimationFrame(function () {
        applySavedAiChatLogHeight_INDEX2();
        clampAiChatLogHeightToLayout_INDEX2();
    });
    var log = document.getElementById('aiChatLog_INDEX2');
    if (log && aiChatHistory_INDEX2.length > 0 && log.childElementCount === 0) {
        rehydrateAiChatLogFromHistory_INDEX2();
    }
    loadAssistantProfileForm_INDEX2();
    const input = document.getElementById('aiChatInput_INDEX2');
    if (input) setTimeout(function () { input.focus(); }, 120);
    try {
        syncGostaAiFabVisibility_INDEX2();
    } catch (eFab2) {}
}

function closeAiChatModal_INDEX2() {
    stopAiVoiceInput_INDEX2();
    closeAiChatPrefsPanel_INDEX2();
    closeAiPhotoAdvancedDialog_INDEX2();
    const modal = document.getElementById('aiChatModal_INDEX2');
    if (modal) {
        modal.style.display = 'none';
        modal.classList.remove('ai-chat-modal--side-drawer');
    }
    document.body.classList.remove('gosta-ai-side-drawer');
    gostaAiFabLaunchSnapshot_INDEX2 = '';
    try {
        syncGostaAiFabVisibility_INDEX2();
    } catch (eFab) {}
}

function clearAiChatHistory_INDEX2() {
    aiChatHistory_INDEX2 = [];
    lastAiImageDataUrlForEdit_INDEX2 = '';
    clearLastAiImageSession_INDEX2();
    aiConversationId_INDEX2 = null;
    hideAiTypingIndicator_INDEX2();
    const log = document.getElementById('aiChatLog_INDEX2');
    if (log) log.innerHTML = '';
    const imgIn = document.getElementById('aiChatImages_INDEX2');
    if (imgIn) imgIn.value = '';
    setAiChatStatus_INDEX2('');
    try {
        sessionStorage.removeItem(AI_CHAT_SESSION_KEY_INDEX2);
        var em = getCurrentUserEmailForCloud_INDEX2();
        if (em) {
            localStorage.removeItem(aiConvStorageKey_INDEX2(em));
        }
    } catch (e) {}
}

async function syncAiConversationToServer_INDEX2() {
    try {
        await waitForAuthDiscoveryIfNeeded();
        var AUTH = window.PR_SAFE_AUTH || {};
        var email = getCurrentUserEmailForCloud_INDEX2();
        if (!email || !AUTH.apiBase || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return;
        }
        var em = email.trim().toLowerCase();
        var cid = localStorage.getItem(aiConvStorageKey_INDEX2(em)) || aiConversationId_INDEX2;
        if (!cid && typeof crypto !== 'undefined' && crypto.randomUUID) {
            cid = crypto.randomUUID();
        }
        if (!cid) {
            return;
        }
        aiConversationId_INDEX2 = cid;
        localStorage.setItem(aiConvStorageKey_INDEX2(em), cid);
        var p = loadAssistantProfileFromStorage_INDEX2();
        var pinned = [];
        try {
            var pr = localStorage.getItem(GOSTA_PINNED_FACTS_KEY);
            pinned = pr ? JSON.parse(pr) : [];
            if (!Array.isArray(pinned)) {
                pinned = [];
            }
        } catch (e2) {
            pinned = [];
        }
        var body = {
            conversationId: cid,
            accountEmail: em,
            messages: cloneAiHistoryForSessionStorage_INDEX2(aiChatHistory_INDEX2),
            summary: String(p.conversation_summary || '').slice(0, 8000),
            userPreferences: {
                name: p.name,
                language: p.language,
                likes_short_answers: p.likes_short_answers,
                interested_in: p.interested_in,
                persona: p.persona,
                response_style: p.response_style
            },
            pinnedFacts: pinned
        };
        var r = await fetch(AUTH.apiBase + '/api/ai/conversations/sync', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        var data = await r.json().catch(function () {
            return {};
        });
        if (r.ok && data.ok && data.conversationId) {
            aiConversationId_INDEX2 = data.conversationId;
            localStorage.setItem(aiConvStorageKey_INDEX2(em), data.conversationId);
        }
    } catch (e) {
        console.warn('syncAiConversationToServer_INDEX2', e);
    }
}

async function resumeLastAiConversation_INDEX2() {
    try {
        await waitForAuthDiscoveryIfNeeded();
        var AUTH = window.PR_SAFE_AUTH || {};
        var email = getCurrentUserEmailForCloud_INDEX2();
        if (!email || !AUTH.apiBase) {
            showNotification('⚠️ يلزم تشغيل الخادم وتسجيل الدخول لاستئناف المحادثة.');
            return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            showNotification('⚠️ يلزم بريد حساب مفعّل على الخادم.');
            return;
        }
        var em = email.trim().toLowerCase();
        var r = await fetch(AUTH.apiBase + '/api/ai/conversations/last?account_email=' + encodeURIComponent(em));
        var data = await r.json().catch(function () {
            return {};
        });
        if (!r.ok || !data.ok) {
            showNotification(
                data.error === 'account_required'
                    ? '⚠️ يُحفظ السجل للحسابات المفعّلة فقط على الخادم.'
                    : 'ℹ️ لا توجد محادثة محفوظة بعد. أرسل رسالة لتُنشأ تلقائياً.'
            );
            return;
        }
        aiConversationId_INDEX2 = data.conversationId;
        localStorage.setItem(aiConvStorageKey_INDEX2(em), data.conversationId);
        aiChatHistory_INDEX2 = (data.messages || []).map(function (m) {
            return {
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: String(m.content || '')
            };
        });
        if (data.userPreferences && typeof data.userPreferences === 'object') {
            try {
                var cur = loadAssistantProfileFromStorage_INDEX2();
                var merged = Object.assign({}, cur, data.userPreferences);
                localStorage.setItem(GOSTA_ASSISTANT_PROFILE_KEY, JSON.stringify(merged));
            } catch (e3) {}
        }
        if (data.pinnedFacts && Array.isArray(data.pinnedFacts) && data.pinnedFacts.length) {
            try {
                localStorage.setItem(GOSTA_PINNED_FACTS_KEY, JSON.stringify(data.pinnedFacts));
            } catch (e4) {}
        }
        rehydrateAiChatLogFromHistory_INDEX2();
        persistAiChatHistoryToSession_INDEX2();
        loadAssistantProfileForm_INDEX2();
        showNotification('✅ تم استرداد آخر محادثة من الخادم.');
    } catch (e) {
        console.warn('resumeLastAiConversation_INDEX2', e);
        showNotification('❌ تعذر استئناف المحادثة.');
    }
}

/** نسخة خفيفة للتخزين — بدون base64 للصور (تفادياً لملء sessionStorage) */
function cloneAiHistoryForSessionStorage_INDEX2(hist) {
    return hist.map(function (m) {
        var content = String(m.content || '').trim();
        if (m.role === 'user' && m.images && m.images.length) {
            content =
                (content || '(صورة)').trim() +
                ' \n[صور مرفقة سابقاً: ' +
                m.images.length +
                ' — أعد إرفاقها من الجهاز إن احتجت الرجوع لنفس الصور]';
        }
        return { role: m.role === 'assistant' ? 'assistant' : 'user', content: content || '…' };
    });
}

function persistAiChatHistoryToSession_INDEX2() {
    try {
        var compact = cloneAiHistoryForSessionStorage_INDEX2(aiChatHistory_INDEX2);
        sessionStorage.setItem(AI_CHAT_SESSION_KEY_INDEX2, JSON.stringify(compact));
    } catch (e) {
        console.warn('persistAiChatHistoryToSession_INDEX2', e);
    }
}

function restoreAiChatHistoryFromSession_INDEX2() {
    try {
        var raw = sessionStorage.getItem(AI_CHAT_SESSION_KEY_INDEX2);
        if (!raw) {
            return;
        }
        var arr = JSON.parse(raw);
        if (!Array.isArray(arr) || !arr.length) {
            return;
        }
        aiChatHistory_INDEX2 = arr.map(function (m) {
            return {
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: String(m.content || '')
            };
        });
    } catch (e) {
        console.warn('restoreAiChatHistoryFromSession_INDEX2', e);
    }
}

function rehydrateAiChatLogFromHistory_INDEX2() {
    var log = document.getElementById('aiChatLog_INDEX2');
    if (!log || !aiChatHistory_INDEX2.length) {
        return;
    }
    log.innerHTML = '';
    for (var i = 0; i < aiChatHistory_INDEX2.length; i++) {
        var m = aiChatHistory_INDEX2[i];
        if (m.role === 'user') {
            appendAiChatBubble_INDEX2('user', m.content || '', null);
        } else {
            appendAiChatBubble_INDEX2('assistant', m.content || '', null);
        }
    }
    log.scrollTop = log.scrollHeight;
}

/** صور مدعومة من OpenAI عبر data URL (ليس HEIC) */
function aiChatDataUrlIsSupported_INDEX2(url) {
    var s = String(url || '').trim();
    if (!s.startsWith('data:image/') || !/;[\s]*base64,/i.test(s)) return false;
    if (/^data:image\/(heic|heif)/i.test(s)) return false;
    var semi = s.indexOf(';');
    if (semi < 10) return false;
    var base = s.slice(5, semi).toLowerCase().replace(/^image\//, '').split('+')[0];
    var ok = { png: 1, jpeg: 1, jpg: 1, webp: 1, gif: 1, pjpeg: 1, 'x-png': 1 };
    return !!ok[base];
}

/** يُبقي data URL للصور فقط في آخر رسالة مستخدم تحتوي صوراً لتقليل حجم الطلب */
function buildAiChatWireMessages_INDEX2(history) {
    var lastIdx = -1;
    for (var i = history.length - 1; i >= 0; i--) {
        if (history[i].role === 'user' && history[i].images && history[i].images.length) {
            lastIdx = i;
            break;
        }
    }
    return history.map(function (m, i) {
        if (m.role !== 'user' || !m.images || !m.images.length) return m;
        if (i === lastIdx) return m;
        return {
            role: 'user',
            content: String(m.content || '').trim() || '(رسالة مع صور)'
        };
    });
}

/**
 * كشف طلب إنشاء صورة من نص الرسالة (لزر الإرسال) — بدون مرفقات تحليل صور.
 * يُرجع { apiPrompt, original } أو null. أنماط محدودة لتقليل الخطأ على المحادثة العادية.
 */
function tryParseInlineImageGenerationPrompt_INDEX2(text) {
    var raw = String(text || '').trim();
    if (!raw) return null;
    var norm = raw.replace(/[\u200c\u200f\u200e]/g, '').replace(/^\s*🖼️\s*/u, '').replace(/\s+/g, ' ').trim();
    if (!norm) return null;
    var patterns = [
        /^(?:إنشاء|انشاء|ابدع|اصنع|اعمل)\s+صورة\s*:?\s*(.+)$/u,
        /^(?:ارسم|أرسم)(?:\s+لي)?(?:\s+صورة)?\s*:?\s*(.+)$/u,
        /^(?:create|generate|make|draw)\s+(?:an\s+)?image\s*:?\s*(.+)$/i,
        /^draw\s+(?:me\s+)?(?:a\s+)?(?:picture|photo)\s+(?:of\s+)?(.+)$/i,
        /^make\s+(?:me\s+)?(?:a\s+)?(?:picture|photo)\s+(?:of\s+)?(.+)$/i
    ];
    var i;
    for (i = 0; i < patterns.length; i++) {
        var m = patterns[i].exec(norm);
        if (m && m[1]) {
            var sub = String(m[1] || '').trim();
            if (!sub) return null;
            var apiPrompt = sub.length >= 4 ? sub : norm;
            if (apiPrompt.length < 4) return null;
            return { apiPrompt: apiPrompt, original: raw };
        }
    }
    return null;
}

/**
 * كشف طلب تعديل آخر صورة من مربع الإرسال (يحتاج lastAiImageDataUrlForEdit_INDEX2).
 * يُرجع { editPrompt, original } أو null — صياغات محافظة لتقليل الخطأ على المحادثة.
 */
function tryParseInlineImageEditIntent_INDEX2(text) {
    var raw = String(text || '').trim();
    if (!raw || raw.length < 6 || raw.length > 2000) return null;
    if (tryParseInlineImageGenerationPrompt_INDEX2(raw)) return null;
    var norm = raw.replace(/[\u200c\u200f\u200e]/g, '').replace(/\s+/g, ' ').trim();

    var hasImageDeixis =
        /(?:من|في|على|عن)\s+(?:هذه\s+)?الصورة/u.test(norm) ||
        /(?:هذه|تلك|آخر)\s+صورة/u.test(norm) ||
        /الصورة\s+(?:السابقة|الأخيرة|المُنشأة|المنشأة)/u.test(norm) ||
        /(?:^|[\s،,.])(?:منها|عنها|فيها)(?:[\s،,.]|$)/u.test(norm) ||
        /(?:from|on)\s+the\s+image/i.test(norm) ||
        /\bthis\s+image\b/i.test(norm) ||
        /\bthat\s+image\b/i.test(norm) ||
        /\bthe\s+image\s+above\b/i.test(norm);

    var arVisual =
        /قرون|خلفية|لون|لو(?:ن|ني)|إضاءة|ضوء|سماء|سحاب|سحب|وجه|عين|عيون|فم|يد|يدان|قدم|ملابس|شعر|نص|خط|شعار|شجرة|بحر|جبل|غروب|نهار|ليل|زاوية|ظل|ضباب|ضبابية|وضوح|حجم|إطار|منظر|مشهد|الطائر|السيارة|الطفل|الحيوان|الغزال/u.test(
            norm
        );
    var enVisual =
        /\b(?:horns?|background|sky|clouds?|face|eyes?|mouth|hands?|feet|clothes|hair|text|logo|tree|sea|ocean|mountain|sunset|lighting|color|shadow|blur|frame|scene|animal|gazelle)\b/i.test(
            norm
        );

    var startsArEdit = /^(?:أزل|ازيل|احذف|أحذف|أضف|أعدل|عدل|عدّل|غيّر|غيّري|اجعل|اجعلها|خفف|قلل|أعد|أترك|ارفع|بدّل|بدل)\s/u.test(
        norm
    );
    var startsEnEdit =
        /^(?:remove|delete|add|change|edit|make|make it|keep|leave|darken|brighten|blur|sharpen)\b/i.test(
            norm
        );

    if (hasImageDeixis) {
        return { editPrompt: raw, original: raw };
    }
    if ((startsArEdit || startsEnEdit) && (arVisual || enVisual) && norm.length >= 8 && norm.length <= 400) {
        return { editPrompt: raw, original: raw };
    }
    return null;
}

function appendOpenAiFriendlyHint_INDEX2(parts, data) {
    var code = String((data && (data.openaiCode || data.error)) || '');
    var msg = String((data && (data.openaiMessage || data.message)) || '');
    var low = (code + ' ' + msg).toLowerCase();
    if (/content_policy|safety|moderation/i.test(low)) {
        parts.push(
            'تلميح: أعد صياغة الطلب بلغة محايدة وبلا عنف أو محتوى محظور، أو قسّمه لخطوات أصغر ثم أعد المحاولة.'
        );
    }
    if ((data && String(data.error || '') === 'rate_limit') || /rate\s*limit|تعذر الطلب \(429\)/i.test(msg)) {
        parts.push('تلميح: حد الطلبات مؤقت — انتظر نحو دقيقة ثم أعد الإرسال.');
    }
    if (/insufficient_quota/i.test(low) || code === 'insufficient_quota') {
        parts.push('تلميح: تحقق من الرصيد وفوترة حساب OpenAI.');
    }
    return parts;
}

function focusInlineEditLastImage_INDEX2() {
    if (!lastAiImageDataUrlForEdit_INDEX2) {
        showNotification(
            '⚠️ لا توجد صورة أخيرة في هذا التبويب. أنشئ صورة أو استخدم «تعديل صورة» مع رفع ملف من الجهاز.'
        );
        return;
    }
    var inp = document.getElementById('aiChatInput_INDEX2');
    if (inp) inp.focus();
    showNotification(
        '💡 اكتب التعديل في «رسالتك» ثم «إرسال». أمثلة: «ازيل القرون من الصورة»، «غيّر الخلفية في الصورة».'
    );
}

var AI_CHAT_LOG_HEIGHT_STORAGE_KEY_INDEX2 = 'gostaAiChatLogHeightPx';

function desktopAiChatMinLogPx_INDEX2() {
    try {
        if (typeof window !== 'undefined' && window.matchMedia) {
            if (window.matchMedia('(min-width: 769px)').matches) {
                return 300;
            }
        }
    } catch (e) {}
    return 120;
}

/** أدنى ارتفاع معقول للسجل: على سطح المكتب ~300px إن سمحت المساحة */
function aiChatLogHeightLowerBound_INDEX2(maxH) {
    return Math.min(desktopAiChatMinLogPx_INDEX2(), Math.max(120, maxH));
}

function clientYFromPointer_INDEX2(e) {
    if (e.touches && e.touches.length) return e.touches[0].clientY;
    if (e.changedTouches && e.changedTouches.length) return e.changedTouches[0].clientY;
    return e.clientY;
}

function computeAiChatLogMaxHeight_INDEX2() {
    var scroll = document.querySelector('.ai-chat-modal .ai-chat-mobile-scroll');
    var usageStrip = scroll ? scroll.querySelector('.ai-chat-usage-details') : null;
    var handle = document.getElementById('aiChatLogResizeHandle_INDEX2');
    if (!scroll) return 560;
    var rect = scroll.getBoundingClientRect();
    var subH = usageStrip ? usageStrip.getBoundingClientRect().height : 0;
    var handleH = handle ? Math.max(handle.offsetHeight || 0, 12) : 12;
    var reserve = 32;
    var mh = Math.floor(rect.height - subH - handleH - reserve);
    return Math.max(120, Math.min(1600, mh));
}

function applySavedAiChatLogHeight_INDEX2() {
    var log = document.getElementById('aiChatLog_INDEX2');
    if (!log) return;
    try {
        var raw = sessionStorage.getItem(AI_CHAT_LOG_HEIGHT_STORAGE_KEY_INDEX2);
        if (!raw) return;
        var n = parseInt(String(raw).trim(), 10);
        if (!n || n < 120) return;
        var maxH = computeAiChatLogMaxHeight_INDEX2();
        var lo = aiChatLogHeightLowerBound_INDEX2(maxH);
        n = Math.min(maxH, Math.max(lo, n));
        log.style.height = n + 'px';
        log.classList.add('ai-chat-log--user-sized');
    } catch (e) {}
}

function clampAiChatLogHeightToLayout_INDEX2() {
    var log = document.getElementById('aiChatLog_INDEX2');
    if (!log || !log.classList.contains('ai-chat-log--user-sized')) return;
    var maxH = computeAiChatLogMaxHeight_INDEX2();
    var lo = aiChatLogHeightLowerBound_INDEX2(maxH);
    var cur = log.getBoundingClientRect().height;
    var n = Math.min(maxH, Math.max(lo, Math.round(cur)));
    if (Math.abs(n - cur) > 1) log.style.height = n + 'px';
    try {
        sessionStorage.setItem(AI_CHAT_LOG_HEIGHT_STORAGE_KEY_INDEX2, String(n));
    } catch (e2) {}
}

function initAiChatLogResize_INDEX2() {
    if (aiChatLogResizeInitialized_INDEX2) return;
    var handle = document.getElementById('aiChatLogResizeHandle_INDEX2');
    var log = document.getElementById('aiChatLog_INDEX2');
    if (!handle || !log) return;
    aiChatLogResizeInitialized_INDEX2 = true;
    var dragging = false;
    var startY = 0;
    var startH = 0;
    function onDown(e) {
        if (e.button !== undefined && e.button !== 0) return;
        dragging = true;
        startY = clientYFromPointer_INDEX2(e);
        startH = log.getBoundingClientRect().height;
        try {
            document.body.style.cursor = 'ns-resize';
            document.body.style.userSelect = 'none';
        } catch (x) {}
        e.preventDefault();
    }
    function onMove(e) {
        if (!dragging) return;
        var y = clientYFromPointer_INDEX2(e);
        var maxH = computeAiChatLogMaxHeight_INDEX2();
        var lo = aiChatLogHeightLowerBound_INDEX2(maxH);
        var nh = Math.min(maxH, Math.max(lo, Math.round(startH + (y - startY))));
        log.style.height = nh + 'px';
        log.classList.add('ai-chat-log--user-sized');
        e.preventDefault();
    }
    function onUp() {
        if (!dragging) return;
        dragging = false;
        try {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        } catch (x2) {}
        clampAiChatLogHeightToLayout_INDEX2();
    }
    handle.addEventListener('mousedown', onDown);
    handle.addEventListener('touchstart', onDown, { passive: false });
    document.addEventListener('mousemove', onMove);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchend', onUp);
    document.addEventListener('touchcancel', onUp);
    handle.addEventListener('keydown', function (ev) {
        if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') {
            ev.preventDefault();
            var maxH = computeAiChatLogMaxHeight_INDEX2();
            var lo = aiChatLogHeightLowerBound_INDEX2(maxH);
            var cur = log.getBoundingClientRect().height;
            var d = ev.key === 'ArrowDown' ? 28 : -28;
            var nh = Math.min(maxH, Math.max(lo, Math.round(cur + d)));
            log.style.height = nh + 'px';
            log.classList.add('ai-chat-log--user-sized');
            try {
                sessionStorage.setItem(AI_CHAT_LOG_HEIGHT_STORAGE_KEY_INDEX2, String(nh));
            } catch (ek) {}
        }
    });
    window.addEventListener(
        'resize',
        function () {
            if (!log.classList.contains('ai-chat-log--user-sized')) return;
            clampAiChatLogHeightToLayout_INDEX2();
        },
        { passive: true }
    );
}

async function sendAiChatMessage_INDEX2() {
    if (!gostaAppAssistantUserGuard_INDEX2()) return;
    const input = document.getElementById('aiChatInput_INDEX2');
    const filesInput = document.getElementById('aiChatImages_INDEX2');
    const text = String((input && input.value) || '').trim();
    const rawFiles =
        filesInput && filesInput.files ? Array.prototype.slice.call(filesInput.files, 0, 4) : [];
    if (!text && rawFiles.length === 0) {
        showNotification('⚠️ اكتب رسالة أو اختر صورة واحدة على الأقل.');
        return;
    }
    if (text && rawFiles.length === 0) {
        var inlineImg = tryParseInlineImageGenerationPrompt_INDEX2(text);
        if (inlineImg) {
            await requestAiImageGeneration_INDEX2(inlineImg.apiPrompt, {
                originalUserText: inlineImg.original
            });
            return;
        }
    }
    if (text && rawFiles.length === 0 && lastAiImageDataUrlForEdit_INDEX2) {
        var inlineEdit = tryParseInlineImageEditIntent_INDEX2(text);
        if (inlineEdit) {
            await requestAiImageEditWithDataUrl_INDEX2(
                inlineEdit.editPrompt,
                lastAiImageDataUrlForEdit_INDEX2,
                { originalUserText: inlineEdit.original, trackHistory: true, clearInputOnSuccess: true }
            );
            return;
        }
    }
    var imageDataUrls = [];
    try {
        for (var fi = 0; fi < rawFiles.length; fi++) {
            var f = rawFiles[fi];
            var sz = Number(f.size || 0);
            if (sz <= 0 || sz > 4 * 1024 * 1024) {
                showNotification('⚠️ تجاهلت صورة أكبر من 4MB: ' + (f.name || ''));
                continue;
            }
            var dataUrl = await readFileAsDataUrl_INDEX2(f);
            if (!aiChatDataUrlIsSupported_INDEX2(dataUrl)) {
                showNotification(
                    '⚠️ صيغة غير مدعومة: ' +
                        (f.name || '') +
                        '\nاستخدم JPG أو PNG أو WebP أو GIF. صور آيفون HEIC: صدّر كـ JPG من تطبيق الصور.'
                );
                continue;
            }
            imageDataUrls.push(dataUrl);
        }
    } catch (e) {
        console.error('ai chat images:', e);
        showNotification('❌ تعذر قراءة الصور.');
        return;
    }
    if (rawFiles.length > 0 && imageDataUrls.length === 0) {
        showNotification(
            '⚠️ لم تُقبل أي صورة. استخدم JPG/PNG/WebP/GIF أو حوّل HEIC إلى JPG (حجم كل صورة حتى 4MB).'
        );
        return;
    }
    try {
        await waitForAuthDiscoveryIfNeeded();
    } catch (e) {}
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showNotification('❌ لم يتم العثور على الخادم. شغّل npm run auth-server');
        return;
    }
    if (input) input.value = '';
    if (filesInput) filesInput.value = '';
    var userMsg = {
        role: 'user',
        content: text || (imageDataUrls.length ? '(صورة)' : ''),
        images: imageDataUrls.length ? imageDataUrls : undefined
    };
    aiChatHistory_INDEX2.push(userMsg);
    appendAiChatBubble_INDEX2('user', userMsg.content, imageDataUrls.length ? imageDataUrls : null);
    persistAiChatHistoryToSession_INDEX2();
    noteUserStatedFactsInDeviceMemory_INDEX2(userMsg.content);
    try {
        var accEnsure = getCurrentUserEmailForCloud_INDEX2();
        if (accEnsure && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accEnsure)) {
            var ekEnsure = aiConvStorageKey_INDEX2(accEnsure);
            if (!localStorage.getItem(ekEnsure) && typeof crypto !== 'undefined' && crypto.randomUUID) {
                var nid = crypto.randomUUID();
                localStorage.setItem(ekEnsure, nid);
                aiConversationId_INDEX2 = nid;
            }
        }
    } catch (e) {}
    setAiChatStatus_INDEX2('GOSTA — جاري التفكير…');
    showAiTypingIndicator_INDEX2();
    var streamUiStarted = false;
    try {
        await maybeRollupAiHistory_INDEX2();
        var chatPayload = {
            messages: buildAiChatWireMessages_INDEX2(aiChatHistory_INDEX2),
            stream: true
        };
        var accChat = getCurrentUserEmailForCloud_INDEX2();
        if (accChat && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(accChat)) {
            chatPayload.accountEmail = String(accChat).trim().toLowerCase();
            var cidChat =
                localStorage.getItem(aiConvStorageKey_INDEX2(accChat)) || aiConversationId_INDEX2;
            if (cidChat) {
                chatPayload.conversationId = cidChat;
            }
        }
        var assistCtx = getAssistantContextForApi_INDEX2();
        if (assistCtx) {
            chatPayload.assistantContext = assistCtx;
        }
        const r = await fetch(AUTH.apiBase + '/api/ai/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(chatPayload)
        });
        const ct = (r.headers.get('content-type') || '').toLowerCase();
        if (!r.ok) {
            hideAiTypingIndicator_INDEX2();
            aiChatHistory_INDEX2.pop();
            const log = document.getElementById('aiChatLog_INDEX2');
            if (log && log.lastChild) log.removeChild(log.lastChild);
            const data = await r.json().catch(function () {
                return {};
            });
            const msg =
                (data && data.message) ||
                (data && data.error) ||
                ('تعذر الطلب (' + r.status + ')');
            setAiChatStatus_INDEX2('');
            var detailParts = ['❌ ' + msg];
            if (data && data.openaiMessage) {
                detailParts.push(String(data.openaiMessage));
            }
            if (data && data.openaiCode) {
                detailParts.push('(' + String(data.openaiCode) + ')');
            }
            appendOpenAiFriendlyHint_INDEX2(detailParts, data);
            showNotification(detailParts.join('\n\n'));
            return;
        }
        if (ct.indexOf('text/event-stream') !== -1) {
            hideAiTypingIndicator_INDEX2();
            streamUiStarted = true;
            const streamBody = appendAiChatBubble_INDEX2('assistant', '');
            const log = document.getElementById('aiChatLog_INDEX2');
            var acc = '';
            const reader = r.body.getReader();
            const dec = new TextDecoder();
            var sseBuf = '';
            while (true) {
                const chunk = await reader.read();
                if (chunk.done) break;
                sseBuf += dec.decode(chunk.value, { stream: true });
                var sep;
                while ((sep = sseBuf.indexOf('\n\n')) >= 0) {
                    const block = sseBuf.slice(0, sep);
                    sseBuf = sseBuf.slice(sep + 2);
                    const lines = block.split('\n');
                    for (var li = 0; li < lines.length; li++) {
                        var line = lines[li].trim();
                        if (line.indexOf('data:') !== 0) continue;
                        var raw = line.slice(5).trim();
                        if (raw === '[DONE]') continue;
                        var j;
                        try {
                            j = JSON.parse(raw);
                        } catch (_) {
                            continue;
                        }
                        if (j.err) {
                            throw new Error(String(j.err));
                        }
                        if (j.c) {
                            acc += j.c;
                            if (streamBody) streamBody.textContent = acc;
                            if (log) log.scrollTop = log.scrollHeight;
                        }
                        if (j.img && j.img.imageDataUrl && aiChatDataUrlIsSupported_INDEX2(j.img.imageDataUrl)) {
                            appendAiGeneratedImageBubble_INDEX2(
                                j.img.revisedPrompt || 'صورة من GOSTA',
                                j.img.imageDataUrl,
                                j.img.revisedPrompt
                            );
                        }
                        if (j.ticket && j.ticket.ticketId) {
                            showNotification('✅ تم إنشاء تذكرة دعم: ' + String(j.ticket.ticketId));
                        }
                    }
                }
            }
            const reply = String(acc).trim() || '…';
            aiChatHistory_INDEX2.push({ role: 'assistant', content: reply });
            appendAiDeviceMemoryFromExchange_INDEX2(userMsg.content, reply);
            persistAiChatHistoryToSession_INDEX2();
            syncAiConversationToServer_INDEX2();
            setAiChatStatus_INDEX2('');
            return;
        }
        const data = await r.json().catch(function () {
            return {};
        });
        if (!data.ok) {
            aiChatHistory_INDEX2.pop();
            const log2 = document.getElementById('aiChatLog_INDEX2');
            if (log2 && log2.lastChild) log2.removeChild(log2.lastChild);
            const msg2 =
                (data && data.message) ||
                (data && data.error) ||
                ('تعذر الطلب (' + r.status + ')');
            setAiChatStatus_INDEX2('');
            var parts2 = ['❌ ' + msg2];
            if (data && data.openaiMessage) parts2.push(String(data.openaiMessage));
            if (data && data.openaiCode) parts2.push('(' + String(data.openaiCode) + ')');
            appendOpenAiFriendlyHint_INDEX2(parts2, data);
            showNotification(parts2.join('\n\n'));
            hideAiTypingIndicator_INDEX2();
            return;
        }
        const replyJson = String(data.reply || '').trim() || '…';
        hideAiTypingIndicator_INDEX2();
        aiChatHistory_INDEX2.push({ role: 'assistant', content: replyJson });
        appendAiDeviceMemoryFromExchange_INDEX2(userMsg.content, replyJson);
        persistAiChatHistoryToSession_INDEX2();
        syncAiConversationToServer_INDEX2();
        appendAiChatBubble_INDEX2('assistant', replyJson);
        if (data.generatedImages && data.generatedImages.length) {
            for (var gi = 0; gi < data.generatedImages.length; gi++) {
                var g = data.generatedImages[gi];
                if (g && g.imageDataUrl && aiChatDataUrlIsSupported_INDEX2(g.imageDataUrl)) {
                    appendAiGeneratedImageBubble_INDEX2(
                        g.revisedPrompt || 'صورة من GOSTA',
                        g.imageDataUrl,
                        g.revisedPrompt
                    );
                }
            }
        }
        if (data.executedSupportTickets && data.executedSupportTickets.length) {
            for (var ti = 0; ti < data.executedSupportTickets.length; ti++) {
                var tk = data.executedSupportTickets[ti];
                if (tk && tk.ticketId) {
                    showNotification('✅ تم إنشاء تذكرة دعم: ' + String(tk.ticketId));
                }
            }
        }
        setAiChatStatus_INDEX2('');
    } catch (e) {
        console.error('sendAiChatMessage_INDEX2', e);
        hideAiTypingIndicator_INDEX2();
        aiChatHistory_INDEX2.pop();
        const log = document.getElementById('aiChatLog_INDEX2');
        if (log) {
            if (streamUiStarted && log.lastChild) {
                log.removeChild(log.lastChild);
            }
            if (log.lastChild) {
                log.removeChild(log.lastChild);
            }
        }
        if (input) input.value = text;
        setAiChatStatus_INDEX2('');
        var errHint = e && e.message ? String(e.message) : '';
        showNotification(
            errHint && errHint.length < 200
                ? '❌ تعذر الاتصال بـ GOSTA.\n' + errHint
                : '❌ تعذر الاتصال بـ GOSTA.'
        );
    }
}

function downloadAiGeneratedImage_INDEX2(imageDataUrl) {
    var url = String(imageDataUrl || '');
    if (!url.startsWith('data:image/')) {
        showNotification('⚠️ لا توجد صورة للتحميل.');
        return;
    }
    var name = 'gosta-ai-' + Date.now() + '.png';
    try {
        var a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.rel = 'noopener';
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        showNotification('✅ بدأ تحميل الصورة.');
    } catch (e) {
        console.error('downloadAiGeneratedImage_INDEX2', e);
        showNotification('❌ تعذر التحميل من هذا المتصفح. جرّب الضغط مطولاً على الصورة ثم «حفظ الصورة».');
    }
}

function appendAiGeneratedImageBubble_INDEX2(prompt, imageDataUrl, revisedPrompt) {
    const log = document.getElementById('aiChatLog_INDEX2');
    if (!log) return;
    const wrap = document.createElement('div');
    wrap.style.marginBottom = '12px';
    wrap.style.padding = '10px';
    wrap.style.borderRadius = '10px';
    wrap.style.background = '#f3e5f5';
    wrap.style.border = '1px solid #ce93d8';
    wrap.style.marginRight = '8px';
    wrap.setAttribute('role', 'group');
    wrap.setAttribute('aria-label', 'صورة من المساعد الذكي');
    var cap = document.createElement('div');
    cap.style.marginBottom = '8px';
    cap.style.fontSize = '13px';
    cap.innerHTML =
        '<strong>🖼️ صورة مُنشأة:</strong><br>' + aiChatEscapeHtml_INDEX2(String(prompt || ''));
    if (revisedPrompt && String(revisedPrompt).trim()) {
        var rp = document.createElement('div');
        rp.style.marginTop = '6px';
        rp.style.fontSize = '11px';
        rp.style.color = '#6a1b9a';
        rp.textContent =
            'الوصف كما وسّعه النموذج (غالباً بالإنجليزية — DALL·E يعيد صياغة الوصف لتحسين النتيجة): ' +
            String(revisedPrompt).trim();
        cap.appendChild(rp);
    }
    wrap.appendChild(cap);
    var im = document.createElement('img');
    im.src = String(imageDataUrl);
    im.alt = String(prompt || 'صورة مُنشأة من المساعد').replace(/[\u0000-\u001f<>]/g, ' ').trim().slice(0, 200) || 'صورة مُنشأة من المساعد';
    im.style.cssText = 'max-width:100%;height:auto;border-radius:8px;display:block;border:1px solid #e1bee7;';
    wrap.appendChild(im);
    var btnRow = document.createElement('div');
    btnRow.style.marginTop = '10px';
    btnRow.style.display = 'flex';
    btnRow.style.flexWrap = 'wrap';
    btnRow.style.gap = '8px';
    var dlBtn = document.createElement('button');
    dlBtn.type = 'button';
    dlBtn.className = 'btn-primary';
    dlBtn.textContent = '⬇️ تحميل الصورة';
    dlBtn.style.cssText = 'padding:8px 14px;font-size:14px;border-radius:8px;cursor:pointer;';
    var dataUrlRef = String(imageDataUrl);
    dlBtn.onclick = function () {
        downloadAiGeneratedImage_INDEX2(dataUrlRef);
    };
    btnRow.appendChild(dlBtn);
    wrap.appendChild(btnRow);
    log.appendChild(wrap);
    log.scrollTop = log.scrollHeight;
    try {
        var u = String(imageDataUrl || '');
        if (
            aiChatDataUrlIsSupported_INDEX2(u) &&
            u.length > 0 &&
            u.length <= LAST_AI_IMAGE_DATA_URL_MAX_CHARS_INDEX2
        ) {
            lastAiImageDataUrlForEdit_INDEX2 = u;
            persistLastAiImageToSession_INDEX2(u);
        }
    } catch (eLastImg) {}
}

function gostaAppAssistantUserGuard_INDEX2() {
    if (
        typeof isGostaAppAssistantEnabledForUsers_INDEX2 === 'function' &&
        !isGostaAppAssistantEnabledForUsers_INDEX2()
    ) {
        showNotification('المساعد الذكي غير متاح حالياً في التطبيق.');
        return false;
    }
    return true;
}

async function requestAiImageGeneration_INDEX2(promptOpt, historyOpts) {
    if (!gostaAppAssistantUserGuard_INDEX2()) return;
    historyOpts = historyOpts || {};
    const input = document.getElementById('aiChatInput_INDEX2');
    var prompt =
        promptOpt != null && String(promptOpt).trim() !== ''
            ? String(promptOpt).trim()
            : String((input && input.value) || '').trim();
    if (prompt.length < 4) {
        showNotification('⚠️ اكتب وصفاً للصورة (مثال: منظر غروب على البحر بألوان دافئة).');
        return;
    }
    try {
        await waitForAuthDiscoveryIfNeeded();
    } catch (e) {}
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showNotification('❌ لم يتم العثور على الخادم. شغّل npm run auth-server');
        return;
    }
    setAiChatStatus_INDEX2('GOSTA — جاري إنشاء الصورة… قد يستغرق نصف دقيقة');
    try {
        const r = await fetch(AUTH.apiBase + '/api/ai/image', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: prompt })
        });
        const data = await r.json().catch(function () {
            return {};
        });
        if (!r.ok || !data.ok || !data.imageDataUrl) {
            setAiChatStatus_INDEX2('');
            var msg =
                (data && data.message) ||
                (data && data.error) ||
                ('تعذر الطلب (' + r.status + ')');
            var parts = ['❌ ' + msg];
            if (data && data.openaiMessage) parts.push(String(data.openaiMessage));
            if (data && data.openaiCode) parts.push('(' + String(data.openaiCode) + ')');
            appendOpenAiFriendlyHint_INDEX2(parts, data);
            showNotification(parts.join('\n\n'));
            return;
        }
        if (input) input.value = '';
        var historyLine =
            historyOpts.originalUserText != null && String(historyOpts.originalUserText).trim() !== ''
                ? String(historyOpts.originalUserText).trim()
                : prompt;
        aiChatHistory_INDEX2.push({
            role: 'user',
            content: '🖼️ طلب إنشاء صورة:\n' + historyLine
        });
        aiChatHistory_INDEX2.push({
            role: 'assistant',
            content: 'تم إنشاء الصورة وعرضها في السجل. يمكنك متابعة المحادثة أو طلب تعديل بصياغة جديدة.'
        });
        appendAiGeneratedImageBubble_INDEX2(historyLine, data.imageDataUrl, data.revisedPrompt);
        try {
            persistAiChatHistoryToSession_INDEX2();
        } catch (ePersist) {}
        setAiChatStatus_INDEX2('');
    } catch (e) {
        console.error('requestAiImageGeneration_INDEX2', e);
        setAiChatStatus_INDEX2('');
        showNotification('❌ تعذر الاتصال بخدمة إنشاء الصور.');
    }
}

/**
 * تعديل صورة عبر data URL (زر التعديل أو آخر صورة من السجل).
 * historyOpts: { trackHistory, originalUserText, clearInputOnSuccess }
 */
async function requestAiImageEditWithDataUrl_INDEX2(prompt, imageDataUrl, historyOpts) {
    historyOpts = historyOpts || {};
    var trackHistory = !!historyOpts.trackHistory;
    var clearInputOnSuccess = !!historyOpts.clearInputOnSuccess;
    const input = document.getElementById('aiChatInput_INDEX2');
    var p = String(prompt || '').trim();
    var img = String(imageDataUrl || '').trim();
    if (p.length < 3) {
        showNotification('⚠️ اكتب وصف تعديل واضح (مثال: غيّر الخلفية إلى استوديو احترافي).');
        return;
    }
    if (!aiChatDataUrlIsSupported_INDEX2(img)) {
        showNotification('⚠️ صيغة الصورة غير مدعومة. استخدم JPG/PNG/WebP/GIF.');
        return;
    }
    try {
        await waitForAuthDiscoveryIfNeeded();
    } catch (e) {}
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showNotification('❌ لم يتم العثور على الخادم. شغّل npm run auth-server');
        return;
    }
    setAiChatStatus_INDEX2('GOSTA — 🛠️ جاري تعديل الصورة… قد يستغرق ذلك عدة ثوانٍ');
    showAiTypingIndicator_INDEX2();
    try {
        const r = await fetch(AUTH.apiBase + '/api/ai/image-edit', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prompt: p, imageDataUrl: img })
        });
        const data = await r.json().catch(function () {
            return {};
        });
        if (!r.ok || !data.ok || !data.imageDataUrl) {
            hideAiTypingIndicator_INDEX2();
            setAiChatStatus_INDEX2('');
            var msg =
                (data && data.message) ||
                (data && data.error) ||
                ('تعذر الطلب (' + r.status + ')');
            var parts = ['❌ ' + msg];
            if (data && data.openaiMessage) parts.push(String(data.openaiMessage));
            if (data && data.openaiCode) parts.push('(' + String(data.openaiCode) + ')');
            appendOpenAiFriendlyHint_INDEX2(parts, data);
            showNotification(parts.join('\n\n'));
            return;
        }
        hideAiTypingIndicator_INDEX2();
        setAiChatStatus_INDEX2('');
        var capLine =
            historyOpts.originalUserText != null && String(historyOpts.originalUserText).trim() !== ''
                ? String(historyOpts.originalUserText).trim()
                : p;
        if (trackHistory) {
            aiChatHistory_INDEX2.push({
                role: 'user',
                content: '🛠️ تعديل آخر صورة:\n' + capLine
            });
            aiChatHistory_INDEX2.push({
                role: 'assistant',
                content: 'تم تعديل الصورة وعرضها في السجل. يمكنك طلب تعديل آخر على النسخة الجديدة.'
            });
        }
        appendAiGeneratedImageBubble_INDEX2('🛠️ تعديل صورة: ' + capLine, data.imageDataUrl, data.revisedPrompt);
        if (trackHistory) {
            try {
                persistAiChatHistoryToSession_INDEX2();
            } catch (ePer2) {}
        }
        if (clearInputOnSuccess && input) input.value = '';
        var okMsg = '✅ تم تعديل الصورة بنجاح.';
        if (data.textOverlayWarning) {
            okMsg += '\n\n⚠️ ' + String(data.textOverlayWarning);
        } else if (data.textOverlayRequested && data.textOverlayApplied === false) {
            okMsg +=
                '\n\n⚠️ طُلب نص على الصورة لكن لم يُؤكَّد رسمه — راجع الصورة؛ قد تحتاج إعادة المحاولة أو صياغة أوضح.';
        }
        showNotification(okMsg);
    } catch (e) {
        console.error('requestAiImageEditWithDataUrl_INDEX2', e);
        hideAiTypingIndicator_INDEX2();
        setAiChatStatus_INDEX2('');
        showNotification('❌ تعذر الاتصال بخدمة تعديل الصور.');
    }
}

async function requestAiImageEdit_INDEX2() {
    if (!gostaAppAssistantUserGuard_INDEX2()) return;
    const input = document.getElementById('aiChatInput_INDEX2');
    const filesInput = document.getElementById('aiChatImages_INDEX2');
    const prompt = String((input && input.value) || '').trim();
    const rawFiles =
        filesInput && filesInput.files ? Array.prototype.slice.call(filesInput.files, 0, 1) : [];
    if (rawFiles.length === 0) {
        showNotification('⚠️ اختر صورة واحدة أولاً ثم اكتب وصف التعديل.');
        return;
    }
    if (prompt.length < 3) {
        showNotification('⚠️ اكتب وصف تعديل واضح (مثال: غيّر الخلفية إلى استوديو احترافي).');
        return;
    }
    let imageDataUrl = '';
    try {
        const f = rawFiles[0];
        const sz = Number(f.size || 0);
        if (sz <= 0 || sz > 8 * 1024 * 1024) {
            showNotification('⚠️ حجم الصورة كبير. الحد الأقصى 8MB.');
            return;
        }
        const url = await readFileAsDataUrl_INDEX2(f);
        if (!aiChatDataUrlIsSupported_INDEX2(url)) {
            showNotification('⚠️ صيغة الصورة غير مدعومة. استخدم JPG/PNG/WebP/GIF.');
            return;
        }
        imageDataUrl = url;
    } catch (e) {
        console.error('requestAiImageEdit_INDEX2 read:', e);
        showNotification('❌ تعذر قراءة الصورة.');
        return;
    }
    await requestAiImageEditWithDataUrl_INDEX2(prompt, imageDataUrl, {
        trackHistory: false,
        clearInputOnSuccess: false
    });
}

function readFileAsDataUrl_INDEX2(file) {
    return new Promise(function (resolve, reject) {
        try {
            const reader = new FileReader();
            reader.onload = function () {
                resolve(String(reader.result || ''));
            };
            reader.onerror = function () {
                reject(reader.error || new Error('read_failed'));
            };
            reader.readAsDataURL(file);
        } catch (e) {
            reject(e);
        }
    });
}

async function submitSupportTicket_INDEX2() {
    const email = String(document.getElementById('supportEmail_INDEX2')?.value || '').trim();
    const subject = String(document.getElementById('supportSubject_INDEX2')?.value || '').trim();
    const message = String(document.getElementById('supportMessage_INDEX2')?.value || '').trim();
    const filesInput = document.getElementById('supportAttachments_INDEX2');
    if (!email || !subject || !message) {
        showNotification('⚠️ أكمل البريد والعنوان وتفاصيل المشكلة أولاً.');
        return;
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        showNotification('⚠️ البريد الإلكتروني غير صحيح.');
        return;
    }
    try {
        await waitForAuthDiscoveryIfNeeded();
    } catch (e) {}
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showNotification('❌ لم يتم العثور على خادم التحقق. شغّل npm run auth-server');
        return;
    }
    const rawFiles = filesInput && filesInput.files ? Array.from(filesInput.files).slice(0, 5) : [];
    let planCode = 'FREE';
    let planName = 'مجاني تجريبي';
    try {
        const subRaw = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (subRaw) {
            const sub = JSON.parse(subRaw);
            const t = String(sub?.type || sub?.plan || '').toUpperCase();
            if (t === 'INDEX3' || t === 'INDEX4' || t === 'INDEX5') {
                planCode = t;
                planName =
                    t === 'INDEX3'
                        ? 'الخطة الأساسية'
                        : t === 'INDEX4'
                        ? 'الخطة المتقدمة'
                        : 'الخطة المميزة السحابية';
            } else if (String(sub?.paymentMethod || '').toLowerCase() === 'trial') {
                planCode = 'FREE_TRIAL';
                planName = 'الخطة المجانية التجريبية';
            }
        } else if (typeof hasFreePremiumTrialAccess_INDEX2 === 'function' && hasFreePremiumTrialAccess_INDEX2()) {
            planCode = 'FREE_TRIAL';
            planName = 'الخطة المجانية التجريبية';
        }
    } catch (e) {}
    const attachments = [];
    try {
        for (const f of rawFiles) {
            const size = Number(f.size || 0);
            if (size <= 0 || size > 5 * 1024 * 1024) {
                showNotification('⚠️ تم تجاهل ملف أكبر من 5MB: ' + (f.name || 'attachment'));
                continue;
            }
            const dataUrl = await readFileAsDataUrl_INDEX2(f);
            attachments.push({
                name: String(f.name || 'attachment'),
                type: String(f.type || 'application/octet-stream'),
                size: size,
                dataUrl: dataUrl
            });
        }
    } catch (e) {
        console.error('support attachments read:', e);
        showNotification('❌ تعذر قراءة المرفقات. حاول من جديد.');
        return;
    }
    try {
        const r = await fetch(AUTH.apiBase + '/api/support/tickets', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email,
                planCode,
                planName,
                subject,
                message,
                attachments
            })
        });
        const data = await r.json().catch(function () {
            return {};
        });
        if (!r.ok || !data.ok) {
            if (r.status === 409 && data && data.error === 'active_ticket_exists') {
                showNotification(
                    'ℹ️ لا يمكنك فتح تذكرة جديدة الآن.\n' +
                        'لديك تذكرة قيد المتابعة برقم: ' +
                        String(data.ticketId || '—') +
                        '\nانتظر حتى يتم إغلاقها ثم افتح تذكرة جديدة.'
                );
                return;
            }
            showNotification('❌ تعذر إرسال التذكرة: ' + (data.error || r.status));
            return;
        }
        closeSupportModal_INDEX2();
        showNotification('✅ تم إرسال التذكرة بنجاح. رقمها: ' + String(data.ticketId || '—'));
    } catch (e) {
        console.error('submitSupportTicket_INDEX2:', e);
        showNotification('❌ خطأ اتصال أثناء إرسال التذكرة.');
    }
}

function getCurrentUserEmailForCloud_INDEX2() {
    return (
        (localStorage.getItem('currentUserEmail_INDEX2') || '').trim() ||
        (function () {
            try {
                const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
                return acc && acc.email ? String(acc.email).trim() : '';
            } catch (e) {
                return '';
            }
        })()
    );
}

function getAuthApiBase_INDEX2() {
    return window.PR_SAFE_AUTH && window.PR_SAFE_AUTH.apiBase ? String(window.PR_SAFE_AUTH.apiBase).trim() : '';
}

function maybeDeleteOriginalFromAndroidGallery_INDEX2(file) {
    try {
        if (!file || !file.name) return;
        if (typeof window === 'undefined' || !window.Capacitor || typeof window.Capacitor.getPlatform !== 'function') return;
        if (window.Capacitor.getPlatform() !== 'android') return;
        if (!window.AndroidMedia || typeof window.AndroidMedia.deleteUploadedOriginal !== 'function') return;
        window.AndroidMedia.deleteUploadedOriginal(file.name, Number(file.size || 0), String(file.type || ''));
    } catch (e) {
        console.warn('⚠️ تعذر طلب حذف النسخة الأصلية من الاستديو:', e);
    }
}

async function syncFilesToCloud_INDEX2(options) {
    var opts = options || {};
    var includeAllLocal = opts.includeAllLocal === true;
    var includeOnlyIdsMap = new Map();
    if (Array.isArray(opts.includeOnlyIds)) {
        opts.includeOnlyIds.forEach(function (id) {
            includeOnlyIdsMap.set(fileIdKey_INDEX2(id), true);
        });
    }
    if (!canUseCloudStorage_INDEX2()) {
        return;
    }
    if (getStorageMode_INDEX2() !== 'cloud' && opts.forceSync !== true) {
        return;
    }
    if (db && opts.skipIdbReload !== true) {
        try {
            const persistedFiles = await loadFilesFromIndexedDB();
            if (Array.isArray(persistedFiles)) {
                files = sortVaultRecordsNewestFirst_INDEX2(persistedFiles);
            }
            const persistedDeleted = await loadDeletedFilesFromIndexedDB();
            if (Array.isArray(persistedDeleted)) {
                deletedFiles = sortVaultRecordsNewestFirst_INDEX2(persistedDeleted);
            }
        } catch (reloadErr) {
            console.warn('[cloud] تعذر إعادة تحميل IndexedDB قبل المزامنة:', reloadErr);
        }
    }
    const email = getCurrentUserEmailForCloud_INDEX2();
    const apiBase = getAuthApiBase_INDEX2();
    if (!email || !apiBase) {
        console.warn('[cloud] تعذر المزامنة: بريد أو عنوان API ناقص', { email: !!email, apiBase: !!apiBase });
        throw new Error('cloud_sync_missing_email_or_api');
    }

    var filesForCloud = includeAllLocal
        ? (Array.isArray(files) ? files.slice() : [])
        : (Array.isArray(files) ? files.filter(function (f) {
              if (!f || f.id === null || f.id === undefined) return false;
              var k = fileIdKey_INDEX2(f.id);
              return cloudActiveFileIds_INDEX2.has(k) || includeOnlyIdsMap.has(k);
          }) : []);
    // السلة والنسخ الاحتياطية تُرسل دائماً كاملة — لا تُصفّى بـ includeOnlyIds (وإلا يُمسح الملف السابق من السحابة)
    var deletedForCloud = Array.isArray(deletedFiles) ? deletedFiles.slice() : [];
    var backupForCloud = Array.isArray(backupFiles) ? backupFiles.slice() : [];
    filesForCloud = await ensureCloudSyncRecordsHaveData_INDEX2(filesForCloud, 'mediaFiles');
    deletedForCloud = await ensureCloudSyncRecordsHaveData_INDEX2(deletedForCloud, 'deletedFiles');
    backupForCloud = await ensureCloudSyncRecordsHaveData_INDEX2(backupForCloud, 'backupFiles');
    filesForCloud = cloudListForSync_INDEX2(filesForCloud, 'files');
    deletedForCloud = cloudListForSync_INDEX2(deletedForCloud, 'deleted');
    backupForCloud = cloudListForSync_INDEX2(backupForCloud, 'backup');
    var normalizedState = normalizeCloudState_INDEX2(filesForCloud, deletedForCloud, backupForCloud);
    const payload = {
        email,
        files: normalizedState.files,
        deletedFiles: normalizedState.deletedFiles,
        backupFiles: normalizedState.backupFiles,
        folders: getUserFoldersListForSync_INDEX2()
    };
    const r = await fetch(apiBase + '/api/cloud-storage/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
    });
    if (!r.ok) throw new Error('cloud_sync_http_' + r.status);
    var syncBody = await r.json().catch(function () { return {}; });
    if (syncBody && syncBody.storageBackend === 'r2') {
        console.log('[cloud] تمت المزامنة عبر R2');
    }
    if (syncBody && syncBody.cloudVaultMeta) {
        applyCloudMetadataToVaultLists_INDEX2(syncBody.cloudVaultMeta);
        reconcileLocalCloudMetadata_INDEX2(
            Array.isArray(syncBody.cloudVaultMeta.files) ? syncBody.cloudVaultMeta.files : []
        );
    } else if (syncBody && Array.isArray(syncBody.cloudFiles)) {
        reconcileLocalCloudMetadata_INDEX2(syncBody.cloudFiles);
        applyCloudMetadataToVaultLists_INDEX2({ files: syncBody.cloudFiles });
    } else {
        applyCloudMetadataToVaultLists_INDEX2({ files: payload.files });
        rebuildCloudActiveFileIdsFromFiles_INDEX2(files);
    }
    try {
        await saveFiles(true);
    } catch (saveAfterSyncErr) {
        console.warn('⚠️ تعذر حفظ وسوم السحابة بعد المزامنة:', saveAfterSyncErr);
    } finally {
        if (Array.isArray(opts.includeOnlyIds)) {
            opts.includeOnlyIds.forEach(function (id) {
                clearCloudUploadPending_INDEX2(id);
            });
        }
    }
}

/**
 * مصدر الحقيقة للوسم «سحابي»: قائمة الملفات النشطة من السيرفر (id + s3Key).
 * يزيل s3Key من الملفات المحلية غير الموجودة في السحابة (يمنع تبديل الوسوم بين جهازين).
 */
function normalizeServerCloudActiveRecord_INDEX2(rec) {
    if (!rec || rec.id === null || rec.id === undefined) {
        return rec;
    }
    var out = Object.assign({}, rec);
    var sk = String(out.s3Key || '').trim();
    if (!out.storageBackend && (sk || canUseCloudStorage_INDEX2())) {
        out.storageBackend = 'r2';
    }
    if (sk || out.storageBackend === 'r2') {
        markCloudLifecycleFileId_INDEX2(out.id);
    }
    return out;
}

function reconcileLocalCloudMetadata_INDEX2(serverActiveFiles) {
    var cloudById = new Map();
    (Array.isArray(serverActiveFiles) ? serverActiveFiles : []).forEach(function (r) {
        if (!r || r.id === null || r.id === undefined) {
            return;
        }
        var norm = normalizeServerCloudActiveRecord_INDEX2(r);
        var sk = String(norm.s3Key || '').trim();
        var sb = String(norm.storageBackend || '').trim() || (canUseCloudStorage_INDEX2() ? 'r2' : '');
        cloudById.set(fileIdKey_INDEX2(norm.id), {
            s3Key: sk || null,
            storageBackend: sb || null
        });
        markCloudLifecycleFileId_INDEX2(norm.id);
    });
    for (var i = 0; i < files.length; i++) {
        var f = files[i];
        if (!f || f.id === null || f.id === undefined) {
            continue;
        }
        var meta = cloudById.get(fileIdKey_INDEX2(f.id));
        if (meta) {
            if (meta.s3Key) {
                files[i].s3Key = meta.s3Key;
            }
            if (meta.storageBackend) {
                files[i].storageBackend = meta.storageBackend;
            }
        } else if (isRestoredCloudVaultFile_INDEX2(f)) {
            if (!files[i].storageBackend) {
                files[i].storageBackend = 'r2';
            }
        } else {
            delete files[i].s3Key;
            delete files[i].storageBackend;
        }
    }
    rebuildCloudActiveFileIdsFromFiles_INDEX2(files);
}

/** بعد مزامنة ناجحة: طبّق s3Key من الحمولة على الملفات في الذاكرة */
function applyCloudMetadataToLocalFiles_INDEX2(cloudFileRecords) {
    applyCloudMetadataToVaultLists_INDEX2({ files: cloudFileRecords });
}

function applyCloudMetadataToVaultLists_INDEX2(meta) {
    if (!meta || typeof meta !== 'object') {
        return;
    }
    function applyToList(targetList, records) {
        var list = Array.isArray(records) ? records : [];
        list.forEach(function (cf) {
            if (!cf || cf.id === null || cf.id === undefined) {
                return;
            }
            var k = fileIdKey_INDEX2(cf.id);
            for (var i = 0; i < targetList.length; i++) {
                if (fileIdKey_INDEX2(targetList[i].id) !== k) {
                    continue;
                }
                if (cf.s3Key) {
                    targetList[i].s3Key = cf.s3Key;
                }
                if (cf.storageBackend) {
                    targetList[i].storageBackend = cf.storageBackend;
                }
                markCloudLifecycleFileId_INDEX2(cf.id);
                break;
            }
        });
    }
    applyToList(files, meta.files);
    applyToList(deletedFiles, meta.deletedFiles);
    applyToList(backupFiles, meta.backupFiles);
}

function fileIdKey_INDEX2(id) {
    if (id === null || id === undefined) {
        return '';
    }
    return String(id);
}

function persistCloudActiveFileIds_INDEX2() {
    var persistedIds = [];
    cloudActiveFileIds_INDEX2.forEach(function (_v, key) {
        persistedIds.push(key);
    });
    try {
        lsScopedSet_INDEX2(CLOUD_ACTIVE_IDS_KEY_INDEX2, JSON.stringify(persistedIds));
    } catch (e) {
        console.warn('⚠️ تعذر حفظ حالة الوسوم السحابية:', e);
    }
}

function removeCloudActiveFileId_INDEX2(fileId) {
    var k = fileIdKey_INDEX2(fileId);
    if (!k) {
        return;
    }
    if (cloudActiveFileIds_INDEX2.delete(k)) {
        persistCloudActiveFileIds_INDEX2();
    }
}

function markCloudLifecycleFileId_INDEX2(fileId) {
    var k = fileIdKey_INDEX2(fileId);
    if (!k) {
        return;
    }
    if (!cloudLifecycleFileIds_INDEX2.has(k)) {
        cloudLifecycleFileIds_INDEX2.set(k, true);
        persistCloudLifecycleFileIds_INDEX2();
    }
}

function unmarkCloudLifecycleFileId_INDEX2(fileId) {
    var k = fileIdKey_INDEX2(fileId);
    if (!k) {
        return;
    }
    if (cloudLifecycleFileIds_INDEX2.delete(k)) {
        persistCloudLifecycleFileIds_INDEX2();
    }
}

function persistCloudLifecycleFileIds_INDEX2() {
    try {
        var ids = [];
        cloudLifecycleFileIds_INDEX2.forEach(function (_v, key) {
            ids.push(key);
        });
        lsScopedSet_INDEX2(CLOUD_LIFECYCLE_IDS_KEY_INDEX2, JSON.stringify(ids));
    } catch (e) {
        console.warn('⚠️ تعذر حفظ معرّفات دورة السحابة:', e);
    }
}

function restoreCloudLifecycleFileIds_INDEX2() {
    try {
        var raw = lsScopedGet_INDEX2(CLOUD_LIFECYCLE_IDS_KEY_INDEX2);
        if (!raw) {
            cloudLifecycleFileIds_INDEX2 = new Map();
            return;
        }
        var ids = JSON.parse(raw);
        var m = new Map();
        if (Array.isArray(ids)) {
            ids.forEach(function (id) {
                if (id !== null && id !== undefined) {
                    m.set(fileIdKey_INDEX2(id), true);
                }
            });
        }
        cloudLifecycleFileIds_INDEX2 = m;
    } catch (e) {
        cloudLifecycleFileIds_INDEX2 = new Map();
    }
}

function updateCloudActiveFileIds_INDEX2(arr) {
    cloudActiveFileIds_INDEX2 = new Map();
    var list = Array.isArray(arr) ? arr : [];
    list.forEach(function (f) {
        if (f && f.id !== null && f.id !== undefined) {
            cloudActiveFileIds_INDEX2.set(fileIdKey_INDEX2(f.id), true);
        }
    });
    persistCloudActiveFileIds_INDEX2();
}

function restoreCloudActiveFileIds_INDEX2() {
    try {
        var raw = lsScopedGet_INDEX2(CLOUD_ACTIVE_IDS_KEY_INDEX2);
        if (!raw) {
            cloudActiveFileIds_INDEX2 = new Map();
            return;
        }
        var ids = JSON.parse(raw);
        var m = new Map();
        if (Array.isArray(ids)) {
            ids.forEach(function (id) {
                if (id !== null && id !== undefined) {
                    m.set(fileIdKey_INDEX2(id), true);
                }
            });
        }
        cloudActiveFileIds_INDEX2 = m;
    } catch (e) {
        cloudActiveFileIds_INDEX2 = new Map();
    }
    restoreCloudLifecycleFileIds_INDEX2();
}

function markCloudUploadPending_INDEX2(fileId) {
    var k = fileIdKey_INDEX2(fileId);
    if (k) {
        cloudUploadPendingIds_INDEX2.set(k, true);
    }
}

function clearCloudUploadPending_INDEX2(fileId) {
    var k = fileIdKey_INDEX2(fileId);
    if (k && cloudUploadPendingIds_INDEX2.delete(k)) {
        return true;
    }
    return false;
}

/** وسم سحابي أثناء الرفع (وضع السحابة) قبل وصول s3Key من الخادم */
function isCloudUploadPendingBadge_INDEX2(file) {
    if (!file || file.id === null || file.id === undefined) {
        return false;
    }
    if (getStorageMode_INDEX2() !== 'cloud' || !canUseCloudStorage_INDEX2()) {
        return false;
    }
    return cloudUploadPendingIds_INDEX2.has(fileIdKey_INDEX2(file.id));
}

function getFileStorageBadgeHtml_INDEX2(file) {
    // الوسم من s3Key/السيرفر — مع وسم سحابي مؤقت أثناء رفع R2 في وضع السحابة.
    var isCloud =
        fileIsStoredInCloud_INDEX2(file) ||
        isCloudUploadPendingBadge_INDEX2(file) ||
        (canUseCloudStorage_INDEX2() && isFileKnownInCloud_INDEX2(file));
    var label = isCloud ? '☁️ سحابي' : '📱 محلي';
    var bg = isCloud ? '#e3f2fd' : '#f3e5f5';
    var color = isCloud ? '#1565c0' : '#6a1b9a';
    return (
        '<span style="display:inline-block;margin-top:4px;padding:2px 8px;border-radius:999px;font-size:11px;font-weight:700;background:' +
        bg +
        ';color:' +
        color +
        ';">' +
        label +
        '</span>'
    );
}

/** هل الملف مُخزَّن فعلياً على السحابة (مصدر الحقيقة: s3Key من السيرفر، وليس localStorage فقط). */
function fileIsStoredInCloud_INDEX2(file) {
    if (!file || file.id === null || file.id === undefined) {
        return false;
    }
    if (String(file.s3Key || '').trim()) {
        return true;
    }
    if (String(file.storageBackend || '').trim() === 'r2') {
        return true;
    }
    return false;
}

function rebuildCloudActiveFileIdsFromFiles_INDEX2(list) {
    cloudActiveFileIds_INDEX2 = new Map();
    var arr = Array.isArray(list) ? list : files;
    arr.forEach(function (f) {
        if (fileIsStoredInCloud_INDEX2(f)) {
            cloudActiveFileIds_INDEX2.set(fileIdKey_INDEX2(f.id), true);
            markCloudLifecycleFileId_INDEX2(f.id);
        }
    });
    persistCloudActiveFileIds_INDEX2();
}

function isFileKnownInCloud_INDEX2(file) {
    if (!file || file.id === null || file.id === undefined) {
        return false;
    }
    if (fileIsStoredInCloud_INDEX2(file)) {
        return true;
    }
    var k = fileIdKey_INDEX2(file.id);
    return cloudLifecycleFileIds_INDEX2.has(k) || cloudActiveFileIds_INDEX2.has(k);
}

// ==================== مجلدات المستخدم اليدوية ====================

function getUserFoldersState_INDEX2() {
    try {
        var raw = lsScopedGet_INDEX2(USER_FOLDERS_KEY_INDEX2);
        if (!raw) {
            return { version: 1, folders: [] };
        }
        var parsed = JSON.parse(raw);
        if (!parsed || !Array.isArray(parsed.folders)) {
            return { version: 1, folders: [] };
        }
        return parsed;
    } catch (e) {
        return { version: 1, folders: [] };
    }
}

function saveUserFoldersState_INDEX2(state) {
    var safe = state && Array.isArray(state.folders) ? state : { version: 1, folders: [] };
    lsScopedSet_INDEX2(USER_FOLDERS_KEY_INDEX2, JSON.stringify(safe));
}

function ensureUserFoldersInitialized_INDEX2() {
    var state = getUserFoldersState_INDEX2();
    if (!Array.isArray(state.folders)) {
        state.folders = [];
    }
    saveUserFoldersState_INDEX2(state);
    return state;
}

function sanitizeFolderName_INDEX2(name) {
    return String(name || '')
        .trim()
        .replace(/\s+/g, ' ')
        .slice(0, 48);
}

function generateUserFolderId_INDEX2() {
    return 'fld_' + Date.now() + '_' + Math.random().toString(36).slice(2, 9);
}

function getUserFoldersList_INDEX2() {
    return ensureUserFoldersInitialized_INDEX2().folders.slice();
}

function getUserFoldersListForSync_INDEX2() {
    return getUserFoldersList_INDEX2().map(function (f) {
        return {
            id: f.id,
            name: f.name,
            createdAt: f.createdAt || null
        };
    });
}

function getFolderNameById_INDEX2(folderId) {
    if (!folderId || folderId === UNCAT_FOLDER_ID_INDEX2) {
        return 'بدون مجلد';
    }
    var list = getUserFoldersList_INDEX2();
    for (var i = 0; i < list.length; i++) {
        if (list[i].id === folderId) {
            return list[i].name;
        }
    }
    return 'مجلد محذوف';
}

function getUploadFolderIdForNewFile_INDEX2() {
    var id = String(selectedUploadFolderId_INDEX2 || UNCAT_FOLDER_ID_INDEX2).trim();
    if (!id || id === UNCAT_FOLDER_ID_INDEX2) {
        return null;
    }
    var exists = getUserFoldersList_INDEX2().some(function (f) {
        return f.id === id;
    });
    return exists ? id : null;
}

function copyFileFolderFields_INDEX2(dest, src) {
    if (!dest || !src) {
        return dest;
    }
    if (src.folderId) {
        dest.folderId = src.folderId;
    } else {
        delete dest.folderId;
    }
    return dest;
}

function applyFoldersFromCloud_INDEX2(remoteFolders) {
    if (!canUseCloudStorage_INDEX2() || !Array.isArray(remoteFolders)) {
        return false;
    }
    var state = ensureUserFoldersInitialized_INDEX2();
    var remoteValid = [];
    var remoteIds = new Set();
    remoteFolders.forEach(function (rf) {
        if (!rf || !rf.id) {
            return;
        }
        var name = sanitizeFolderName_INDEX2(rf.name);
        if (!name) {
            return;
        }
        var id = String(rf.id);
        remoteValid.push({
            id: id,
            name: name,
            createdAt: rf.createdAt || new Date().toISOString()
        });
        remoteIds.add(id);
    });
    if (!remoteValid.length) {
        return false;
    }
    var localById = new Map();
    state.folders.forEach(function (lf) {
        if (lf && lf.id) {
            localById.set(lf.id, lf);
        }
    });
    var merged = remoteValid.map(function (rf) {
        var local = localById.get(rf.id);
        return {
            id: rf.id,
            name: rf.name,
            createdAt: rf.createdAt || (local && local.createdAt) || new Date().toISOString()
        };
    });
    state.folders.forEach(function (lf) {
        if (lf && lf.id && !remoteIds.has(lf.id)) {
            merged.push(lf);
        }
    });
    state.folders = merged;
    saveUserFoldersState_INDEX2(state);
    return true;
}

function mergeFoldersFromCloud_INDEX2(remoteFolders) {
    return applyFoldersFromCloud_INDEX2(remoteFolders);
}

async function loadUserFoldersFromCloud_INDEX2() {
    if (!canUseCloudStorage_INDEX2()) {
        return false;
    }
    var email = getCurrentUserEmailForCloud_INDEX2();
    var apiBase = getAuthApiBase_INDEX2();
    if (!email || !apiBase) {
        return false;
    }
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY) {
            await window.PR_SAFE_AUTH_DISCOVERY;
        }
    } catch (discErr) {
        /* يكمل الجلب */
    }
    var r = await fetch(
        apiBase + '/api/cloud-storage/folders?email=' + encodeURIComponent(email),
        { cache: 'no-store' }
    );
    if (!r.ok) {
        throw new Error('cloud_folders_load_http_' + r.status);
    }
    var data = await r.json().catch(function () {
        return null;
    });
    if (!data || !data.ok) {
        return false;
    }
    var remoteList = Array.isArray(data.folders) ? data.folders : [];
    if (!remoteList.length) {
        if (getUserFoldersList_INDEX2().length) {
            await syncUserFoldersToCloud_INDEX2();
        }
        refreshUserFoldersUI_INDEX2();
        return true;
    }
    var hadRemote = applyFoldersFromCloud_INDEX2(remoteList);
    refreshUserFoldersUI_INDEX2();
    if (hadRemote) {
        var state = ensureUserFoldersInitialized_INDEX2();
        var remoteIds = new Set(
            remoteList.map(function (f) {
                return f && f.id ? String(f.id) : '';
            })
        );
        var hasLocalOnly = state.folders.some(function (lf) {
            return lf && lf.id && !remoteIds.has(lf.id);
        });
        if (hasLocalOnly) {
            await syncUserFoldersToCloud_INDEX2();
        }
    }
    return true;
}

async function syncUserFoldersToCloud_INDEX2() {
    if (!canUseCloudStorage_INDEX2()) {
        return;
    }
    var email = getCurrentUserEmailForCloud_INDEX2();
    var apiBase = getAuthApiBase_INDEX2();
    if (!email || !apiBase) {
        return;
    }
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY) {
            await window.PR_SAFE_AUTH_DISCOVERY;
        }
    } catch (discErr) {
        /* يكمل الرفع */
    }
    var r = await fetch(apiBase + '/api/cloud-storage/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            email: email,
            folders: getUserFoldersListForSync_INDEX2()
        })
    });
    if (!r.ok) {
        throw new Error('cloud_folders_sync_http_' + r.status);
    }
    var body = await r.json().catch(function () {
        return {};
    });
    if (body && Array.isArray(body.folders)) {
        applyFoldersFromCloud_INDEX2(body.folders);
        refreshUserFoldersUI_INDEX2();
    }
}

function scheduleUserFoldersCloudSync_INDEX2() {
    if (!canUseCloudStorage_INDEX2()) {
        return;
    }
    runDeferredDeletePersist_INDEX2(function () {
        return syncUserFoldersToCloud_INDEX2();
    }, 'user-folders-cloud-sync');
}

function createUserFolder_INDEX2(name) {
    var label = sanitizeFolderName_INDEX2(name);
    if (!label) {
        showNotification('⚠️ أدخل اسماً للمجلد');
        return null;
    }
    var state = ensureUserFoldersInitialized_INDEX2();
    var dup = state.folders.some(function (f) {
        return String(f.name).toLowerCase() === label.toLowerCase();
    });
    if (dup) {
        showNotification('⚠️ يوجد مجلد بنفس الاسم');
        return null;
    }
    var folder = { id: generateUserFolderId_INDEX2(), name: label, createdAt: new Date().toISOString() };
    state.folders.push(folder);
    saveUserFoldersState_INDEX2(state);
    refreshUserFoldersUI_INDEX2();
    scheduleUserFoldersCloudSync_INDEX2();
    showNotification('✅ تم إنشاء المجلد: ' + label);
    return folder;
}

function renameUserFolder_INDEX2(folderId, newName) {
    var label = sanitizeFolderName_INDEX2(newName);
    if (!label) {
        showNotification('⚠️ أدخل اسماً صالحاً');
        return false;
    }
    var state = ensureUserFoldersInitialized_INDEX2();
    var target = null;
    state.folders.forEach(function (f) {
        if (f.id === folderId) {
            target = f;
        }
    });
    if (!target) {
        return false;
    }
    var dup = state.folders.some(function (f) {
        return f.id !== folderId && String(f.name).toLowerCase() === label.toLowerCase();
    });
    if (dup) {
        showNotification('⚠️ يوجد مجلد بنفس الاسم');
        return false;
    }
    target.name = label;
    saveUserFoldersState_INDEX2(state);
    refreshUserFoldersUI_INDEX2();
    scheduleUserFoldersCloudSync_INDEX2();
    return true;
}

function deleteUserFolder_INDEX2(folderId) {
    if (!folderId || folderId === UNCAT_FOLDER_ID_INDEX2) {
        return false;
    }
    var state = ensureUserFoldersInitialized_INDEX2();
    var before = state.folders.length;
    state.folders = state.folders.filter(function (f) {
        return f.id !== folderId;
    });
    if (state.folders.length === before) {
        return false;
    }
    saveUserFoldersState_INDEX2(state);
    var touched = false;
    files.forEach(function (f, i) {
        if (f && f.folderId === folderId) {
            delete files[i].folderId;
            touched = true;
        }
    });
    deletedFiles.forEach(function (f, i) {
        if (f && f.folderId === folderId) {
            delete deletedFiles[i].folderId;
            touched = true;
        }
    });
    backupFiles.forEach(function (f, i) {
        if (f && f.folderId === folderId) {
            delete backupFiles[i].folderId;
            touched = true;
        }
    });
    if (selectedUploadFolderId_INDEX2 === folderId) {
        selectedUploadFolderId_INDEX2 = UNCAT_FOLDER_ID_INDEX2;
    }
    if (currentFolderFilterId_INDEX2 === folderId) {
        currentFolderFilterId_INDEX2 = null;
    }
    saveUserFoldersState_INDEX2(state);
    refreshUserFoldersUI_INDEX2();
    scheduleUserFoldersCloudSync_INDEX2();
    if (touched) {
        runDeferredDeletePersist_INDEX2(function () {
            return saveFiles(true).then(function () {
                if (getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2()) {
                    return syncFilesToCloud_INDEX2({ includeAllLocal: true });
                }
            });
        }, 'folder-delete-reassign');
    }
    updateStatsAndDisplay();
    showNotification('✅ تم حذف المجلد — الملفات أصبحت «بدون مجلد»');
    return true;
}

function refreshUserFoldersUI_INDEX2() {
    ensureUserFoldersInitialized_INDEX2();
    var folders = getUserFoldersList_INDEX2();
    var uploadSel = document.getElementById('uploadFolderSelect_INDEX2');
    var filterSel = document.getElementById('folderFilterSelect_INDEX2');
    var manageList = document.getElementById('userFoldersManageList_INDEX2');

    function fillSelect(sel, includeUncat, includeAllFilter) {
        if (!sel) {
            return;
        }
        var prev = sel.value;
        sel.innerHTML = '';
        if (includeAllFilter) {
            var allOpt = document.createElement('option');
            allOpt.value = '__all__';
            allOpt.textContent = '📂 كل المجلدات';
            sel.appendChild(allOpt);
        }
        if (includeUncat) {
            var unc = document.createElement('option');
            unc.value = UNCAT_FOLDER_ID_INDEX2;
            unc.textContent = '📁 بدون مجلد';
            sel.appendChild(unc);
        }
        folders.forEach(function (f) {
            var opt = document.createElement('option');
            opt.value = f.id;
            opt.textContent = '📁 ' + f.name;
            sel.appendChild(opt);
        });
        if (prev && Array.from(sel.options).some(function (o) { return o.value === prev; })) {
            sel.value = prev;
        }
    }

    fillSelect(uploadSel, true, false);
    fillSelect(filterSel, true, true);

    if (uploadSel) {
        if (!uploadSel.value) {
            uploadSel.value = selectedUploadFolderId_INDEX2 || UNCAT_FOLDER_ID_INDEX2;
        }
        selectedUploadFolderId_INDEX2 = uploadSel.value;
    }
    if (filterSel) {
        if (currentFolderFilterId_INDEX2) {
            filterSel.value = currentFolderFilterId_INDEX2;
        } else {
            filterSel.value = '__all__';
        }
    }

    if (manageList) {
        manageList.innerHTML = '';
        if (!folders.length) {
            manageList.innerHTML =
                '<div class="user-folders-empty"><span class="user-folders-empty-icon" aria-hidden="true">📂</span><p>لا توجد مجلدات بعد</p><p class="user-folders-empty-hint">أنشئ أول مجلد من الحقل أعلاه</p></div>';
        } else {
            folders.forEach(function (f) {
                var row = document.createElement('div');
                row.className = 'user-folder-manage-row';
                row.innerHTML =
                    '<span class="user-folder-manage-icon" aria-hidden="true">📁</span>' +
                    '<span class="user-folder-manage-name">' +
                    escapeHtml_INDEX2(f.name) +
                    '</span>' +
                    '<div class="user-folder-manage-actions">' +
                    '<button type="button" class="user-folder-btn-icon user-folder-btn-rename" title="إعادة تسمية" aria-label="إعادة تسمية" data-folder-rename="' +
                    escapeHtml_INDEX2(f.id) +
                    '">✏️</button>' +
                    '<button type="button" class="user-folder-btn-icon user-folder-btn-delete" title="حذف المجلد" aria-label="حذف المجلد" data-folder-delete="' +
                    escapeHtml_INDEX2(f.id) +
                    '">🗑️</button>' +
                    '</div>';
                manageList.appendChild(row);
            });
        }
    }
    if (typeof updateStats === 'function' && typeof getFilteredFiles === 'function') {
        updateStats(getFilteredFiles());
    }
    refreshVaultToolsToggleSummary_INDEX2();
}

function escapeHtml_INDEX2(s) {
    return String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function onUploadFolderSelectChange_INDEX2() {
    var sel = document.getElementById('uploadFolderSelect_INDEX2');
    selectedUploadFolderId_INDEX2 = sel ? sel.value : UNCAT_FOLDER_ID_INDEX2;
    refreshVaultToolsToggleSummary_INDEX2();
}

function onFolderFilterChange_INDEX2() {
    var sel = document.getElementById('folderFilterSelect_INDEX2');
    var v = sel ? sel.value : '__all__';
    currentFolderFilterId_INDEX2 = v === '__all__' ? null : v;
    updateStatsAndDisplay();
}

function openUserFoldersModal_INDEX2() {
    refreshUserFoldersUI_INDEX2();
    var modal = document.getElementById('userFoldersModal_INDEX2');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeUserFoldersModal_INDEX2() {
    var modal = document.getElementById('userFoldersModal_INDEX2');
    if (modal) {
        modal.style.display = 'none';
    }
}

function submitCreateUserFolder_INDEX2() {
    var input = document.getElementById('newFolderNameInput_INDEX2');
    var name = input ? input.value : '';
    var created = createUserFolder_INDEX2(name);
    if (created && input) {
        input.value = '';
        if (created.id) {
            selectedUploadFolderId_INDEX2 = created.id;
            refreshUserFoldersUI_INDEX2();
            var uploadSel = document.getElementById('uploadFolderSelect_INDEX2');
            if (uploadSel) {
                uploadSel.value = created.id;
            }
        }
    }
}

function bindUserFoldersModal_INDEX2() {
    var modal = document.getElementById('userFoldersModal_INDEX2');
    if (!modal || modal.dataset.bound === '1') {
        return;
    }
    modal.dataset.bound = '1';
    modal.addEventListener('click', function (ev) {
        if (ev.target === modal) {
            closeUserFoldersModal_INDEX2();
        }
    });
    var list = document.getElementById('userFoldersManageList_INDEX2');
    if (list) {
        list.addEventListener('click', function (ev) {
            var delBtn = ev.target.closest('[data-folder-delete]');
            var renBtn = ev.target.closest('[data-folder-rename]');
            if (delBtn) {
                var fid = delBtn.getAttribute('data-folder-delete');
                if (fid) {
                    showVaultConfirmDialog_INDEX2({
                        title: 'حذف المجلد',
                        message: 'حذف المجلد؟ الملفات داخله ستبقى محلياً/سحابياً بدون مجلد.',
                        confirmLabel: 'حذف',
                        variant: 'danger'
                    }).then(function (ok) {
                        if (ok) deleteUserFolder_INDEX2(fid);
                    });
                }
                return;
            }
            if (renBtn) {
                var rid = renBtn.getAttribute('data-folder-rename');
                var folders = getUserFoldersList_INDEX2();
                var cur = folders.find(function (f) { return f.id === rid; });
                var nn = prompt('اسم المجلد الجديد:', cur ? cur.name : '');
                if (nn != null) {
                    renameUserFolder_INDEX2(rid, nn);
                }
            }
        });
    }
}

function getFileFolderBadgeHtml_INDEX2(file) {
    if (!file || !file.folderId) {
        return '';
    }
    return (
        '<div class="file-name" style="font-size:11px;color:#5c6bc0;">📁 ' +
        escapeHtml_INDEX2(getFolderNameById_INDEX2(file.folderId)) +
        '</div>'
    );
}

let pendingMoveFileIndex_INDEX2 = null;

function refreshMoveFileFolderTargetSelect_INDEX2(currentFolderId) {
    var sel = document.getElementById('moveFileFolderTargetSelect_INDEX2');
    if (!sel) {
        return;
    }
    sel.innerHTML = '';
    var unc = document.createElement('option');
    unc.value = UNCAT_FOLDER_ID_INDEX2;
    unc.textContent = '📁 بدون مجلد';
    if (!currentFolderId) {
        unc.selected = true;
    }
    sel.appendChild(unc);
    getUserFoldersList_INDEX2().forEach(function (f) {
        var opt = document.createElement('option');
        opt.value = f.id;
        opt.textContent = '📁 ' + f.name;
        if (currentFolderId === f.id) {
            opt.selected = true;
        }
        sel.appendChild(opt);
    });
}

function openMoveFileToUserFolderModal_INDEX2(fileIndex) {
    if (blockActionUntilUpgrade_INDEX2('نقل بين المجلدات')) {
        return;
    }
    var file = files[fileIndex];
    if (!file) {
        showNotification('❌ الملف غير موجود');
        return;
    }
    if (!getUserFoldersList_INDEX2().length) {
        showNotification('ℹ️ أنشئ مجلداً أولاً من «إدارة المجلدات»');
        openUserFoldersModal_INDEX2();
        return;
    }
    pendingMoveFileIndex_INDEX2 = fileIndex;
    var fileNameEl = document.getElementById('moveFileFolderModalFileName_INDEX2');
    if (fileNameEl) {
        fileNameEl.textContent = String(file.name || 'ملف');
    }
    refreshMoveFileFolderTargetSelect_INDEX2(file.folderId || null);
    var modal = document.getElementById('moveFileFolderModal_INDEX2');
    if (modal) {
        modal.style.display = 'flex';
    }
}

function closeMoveFileToUserFolderModal_INDEX2() {
    pendingMoveFileIndex_INDEX2 = null;
    var modal = document.getElementById('moveFileFolderModal_INDEX2');
    if (modal) {
        modal.style.display = 'none';
    }
}

async function confirmMoveFileToUserFolder_INDEX2() {
    var idx = pendingMoveFileIndex_INDEX2;
    if (idx === null || idx === undefined) {
        return;
    }
    var file = files[idx];
    if (!file) {
        closeMoveFileToUserFolderModal_INDEX2();
        return;
    }
    var sel = document.getElementById('moveFileFolderTargetSelect_INDEX2');
    var targetVal = sel ? sel.value : UNCAT_FOLDER_ID_INDEX2;
    var newFolderId = targetVal === UNCAT_FOLDER_ID_INDEX2 ? null : targetVal;
    var prevFolderId = file.folderId || null;
    if (prevFolderId === newFolderId) {
        closeMoveFileToUserFolderModal_INDEX2();
        showNotification('ℹ️ الملف في هذا المجلد بالفعل');
        return;
    }
    if (newFolderId) {
        file.folderId = newFolderId;
    } else {
        delete file.folderId;
    }
    try {
        await saveFileToIndexedDB(file);
        await saveFiles(true);
        if (isFileKnownInCloud_INDEX2(file) && getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2()) {
            await syncFilesToCloud_INDEX2({ includeOnlyIds: [file.id] });
        }
    } catch (moveErr) {
        console.warn('⚠️ نقل المجلد:', moveErr);
        if (prevFolderId) {
            file.folderId = prevFolderId;
        } else {
            delete file.folderId;
        }
        showNotification('❌ تعذر حفظ نقل المجلد');
        return;
    }
    bumpVaultRecordToFront_INDEX2(files, file);
    closeMoveFileToUserFolderModal_INDEX2();
    updateStatsAndDisplay();
    showNotification('✅ تم النقل إلى: ' + getFolderNameById_INDEX2(newFolderId));
}

function bindMoveFileFolderModal_INDEX2() {
    var modal = document.getElementById('moveFileFolderModal_INDEX2');
    if (!modal || modal.dataset.bound === '1') {
        return;
    }
    modal.dataset.bound = '1';
    modal.addEventListener('click', function (ev) {
        if (ev.target === modal) {
            closeMoveFileToUserFolderModal_INDEX2();
        }
    });
}

function uniqueCloudRecordsById_INDEX2(arr) {
    var input = Array.isArray(arr) ? arr : [];
    var out = [];
    var seen = new Map();
    input.forEach(function (item) {
        if (!item || item.id === null || item.id === undefined) {
            return;
        }
        var key = fileIdKey_INDEX2(item.id);
        if (seen.has(key)) {
            return;
        }
        seen.set(key, true);
        out.push(item);
    });
    return out;
}

function parseVaultRecordDate_INDEX2(value) {
    if (!value) {
        return 0;
    }
    var t = Date.parse(String(value));
    return isNaN(t) ? 0 : t;
}

/** أحدث تاريخ معروف للسجل — للترتيب (الأحدث أولاً في القائمة) */
function getVaultRecordSortTime_INDEX2(record) {
    if (!record) {
        return 0;
    }
    var candidates = [
        record.movedAt,
        record.restoredAt,
        record.backedUpAt,
        record.deletedAt,
        record.uploadedAt
    ];
    var best = 0;
    for (var i = 0; i < candidates.length; i++) {
        var t = parseVaultRecordDate_INDEX2(candidates[i]);
        if (t > best) {
            best = t;
        }
    }
    if (!best && record.id !== null && record.id !== undefined) {
        var num = Number(record.id);
        if (!isNaN(num) && isFinite(num)) {
            best = num;
        }
    }
    return best;
}

function sortVaultRecordsNewestFirst_INDEX2(list) {
    if (!Array.isArray(list) || list.length < 2) {
        return list;
    }
    list.sort(function (a, b) {
        return getVaultRecordSortTime_INDEX2(b) - getVaultRecordSortTime_INDEX2(a);
    });
    return list;
}

function prependVaultRecord_INDEX2(list, record) {
    if (!record || !Array.isArray(list)) {
        return;
    }
    list.unshift(record);
}

/** نقل سجل إلى مقدمة القائمة (بعد النقل بين المجلدات أو الاستعادة) */
function bumpVaultRecordToFront_INDEX2(list, recordOrId) {
    if (!Array.isArray(list) || !list.length) {
        return false;
    }
    var key =
        typeof recordOrId === 'object' && recordOrId
            ? fileIdKey_INDEX2(recordOrId.id)
            : fileIdKey_INDEX2(recordOrId);
    var idx = -1;
    for (var i = 0; i < list.length; i++) {
        if (list[i] && fileIdKey_INDEX2(list[i].id) === key) {
            idx = i;
            break;
        }
    }
    if (idx < 0) {
        return false;
    }
    var item = idx === 0 ? list[0] : list.splice(idx, 1)[0];
    item.movedAt = new Date().toLocaleString('ar-EG');
    if (idx !== 0) {
        list.unshift(item);
    }
    return true;
}

function sortAllVaultListsNewestFirst_INDEX2() {
    sortVaultRecordsNewestFirst_INDEX2(files);
    sortVaultRecordsNewestFirst_INDEX2(deletedFiles);
    sortVaultRecordsNewestFirst_INDEX2(backupFiles);
}

function sanitizeCloudRecordForSync_INDEX2(record) {
    if (!record) {
        return record;
    }
    var out = Object.assign({}, record);
    delete out.__cardPreviewUrl_INDEX2;
    delete out.restoredAt;
    delete out.movedAt;
    return out;
}

/** قبل المزامنة: املأ data من IndexedDB إن كان الملف بلا محتوى في الذاكرة */
async function ensureCloudSyncRecordsHaveData_INDEX2(list, storeName) {
    var arr = Array.isArray(list) ? list.slice() : [];
    if (!arr.length || !db) {
        return arr;
    }
    var store =
        storeName === 'deletedFiles'
            ? 'deletedFiles'
            : storeName === 'backupFiles'
              ? 'backupData'
              : 'mediaFiles';
    for (var i = 0; i < arr.length; i++) {
        var rec = arr[i];
        if (!rec || rec.id === null || rec.id === undefined) {
            continue;
        }
        if (rec.data && String(rec.data).length > 0) {
            continue;
        }
        try {
            var full = await getVaultRecordFromIndexedDBByStore_INDEX2(rec.id, store);
            if (full && full.data && String(full.data).length > 0) {
                arr[i] = Object.assign({}, rec, { data: full.data });
            }
        } catch (idbErr) {
            console.warn('[cloud] تعذر تحميل data من IndexedDB:', rec.id, idbErr);
        }
    }
    return arr;
}

function getVaultRecordFromIndexedDBByStore_INDEX2(fileId, storeName) {
    return new Promise(function (resolve, reject) {
        if (!db) {
            reject(new Error('db_not_ready'));
            return;
        }
        var tx = db.transaction([storeName], 'readonly');
        var req = tx.objectStore(storeName).get(fileId);
        req.onsuccess = function () {
            resolve(req.result || null);
        };
        req.onerror = function () {
            reject(req.error);
        };
    });
}

/** للمزامنة: لا نعيد إرسال data للملفات النشطة إن وُجد s3Key؛ السلة والنسخ الاحتياطية تُرسل data لملء R2. */
function cloudRecordForSync_INDEX2(record, category) {
    if (!record || record.id === null || record.id === undefined) {
        return record;
    }
    var out = sanitizeCloudRecordForSync_INDEX2(record);
    var key = String(out.s3Key || '').trim();
    var cat = category === 'deleted' || category === 'backup' ? category : 'files';
    var hasData = !!(out.data && String(out.data).length > 0);
    if (key && cat === 'files' && !hasData) {
        delete out.data;
        if (!out.storageBackend) {
            out.storageBackend = 'r2';
        }
    } else if (key && !out.storageBackend) {
        out.storageBackend = 'r2';
    }
    return out;
}

function cloudListForSync_INDEX2(list, category) {
    return Array.isArray(list)
        ? list.map(function (r) {
              return cloudRecordForSync_INDEX2(r, category);
          })
        : [];
}

function normalizeCloudState_INDEX2(rawFiles, rawDeleted, rawBackup) {
    var backup = uniqueCloudRecordsById_INDEX2(rawBackup);
    var deleted = uniqueCloudRecordsById_INDEX2(rawDeleted);
    var filesActive = uniqueCloudRecordsById_INDEX2(rawFiles);

    var backupIds = new Map();
    backup.forEach(function (f) {
        backupIds.set(fileIdKey_INDEX2(f.id), true);
    });

    // الملف المحذوف نهائيا لا يظهر في سلة المحذوفات.
    deleted = deleted.filter(function (f) {
        return !backupIds.has(fileIdKey_INDEX2(f.id));
    });

    var deletedIds = new Map();
    deleted.forEach(function (f) {
        deletedIds.set(fileIdKey_INDEX2(f.id), true);
    });

    // أي ملف في السلة أو النسخ الاحتياطية لا يجب أن يظهر نشطا.
    filesActive = filesActive.filter(function (f) {
        var k = fileIdKey_INDEX2(f.id);
        return !deletedIds.has(k) && !backupIds.has(k);
    });

    return {
        files: sortVaultRecordsNewestFirst_INDEX2(filesActive),
        deletedFiles: sortVaultRecordsNewestFirst_INDEX2(deleted),
        backupFiles: sortVaultRecordsNewestFirst_INDEX2(backup)
    };
}

/**
 * استعادة سحابية ذكية: المحلي له أولوية. من السحابة نُضيف فقط ما ليس له نفس المعرّف (id) محلياً — لا تكرار.
 * (يُستخدم في مسارات قديمة؛ التحميل من السحابة يعتمد mergeCloudStateWithServerAuthority_INDEX2.)
 */
function mergeCloudRecordsPreferLocal_INDEX2(localArr, cloudArr) {
    var local = Array.isArray(localArr) ? localArr.slice() : [];
    var seen = new Map();
    local.forEach(function (f) {
        if (f && f.id !== null && f.id !== undefined) {
            seen.set(fileIdKey_INDEX2(f.id), true);
        }
    });
    var cloud = Array.isArray(cloudArr) ? cloudArr : [];
    cloud.forEach(function (c) {
        if (!c || c.id === null || c.id === undefined) {
            return;
        }
        var k = fileIdKey_INDEX2(c.id);
        if (seen.has(k)) {
            for (var i = 0; i < local.length; i++) {
                if (fileIdKey_INDEX2(local[i].id) !== k) {
                    continue;
                }
                if (c.s3Key) {
                    local[i].s3Key = c.s3Key;
                }
                if (c.storageBackend) {
                    local[i].storageBackend = c.storageBackend;
                }
                if (c.data && !local[i].data) {
                    local[i].data = c.data;
                }
                break;
            }
            return;
        }
        seen.set(k, true);
        local.unshift(c);
    });
    return sortVaultRecordsNewestFirst_INDEX2(local);
}

function findLocalRecordById_INDEX2(list, idKey) {
    var arr = Array.isArray(list) ? list : [];
    for (var i = 0; i < arr.length; i++) {
        if (arr[i] && fileIdKey_INDEX2(arr[i].id) === idKey) {
            return arr[i];
        }
    }
    return null;
}

/** دمج سجل سحابي: بيانات السيرفر + المحتوى المحلي إن وُجد */
function mergeCloudRecordFields_INDEX2(localRec, serverRec) {
    if (!serverRec) {
        return localRec;
    }
    var out = Object.assign({}, normalizeServerCloudActiveRecord_INDEX2(serverRec));
    if (localRec) {
        if (localRec.data && !out.data) {
            out.data = localRec.data;
        }
        if (localRec.name && !out.name) {
            out.name = localRec.name;
        }
        if (String(serverRec.s3Key || '').trim()) {
            out.s3Key = serverRec.s3Key;
        } else if (localRec.s3Key && !out.s3Key) {
            out.s3Key = localRec.s3Key;
        }
        if (String(serverRec.storageBackend || '').trim()) {
            out.storageBackend = serverRec.storageBackend;
        } else if (localRec.storageBackend && !out.storageBackend) {
            out.storageBackend = localRec.storageBackend;
        }
        if (localRec.isEncrypted !== undefined && out.isEncrypted === undefined) {
            out.isEncrypted = localRec.isEncrypted;
        }
    }
    return out;
}

function buildCloudCategoryMaps_INDEX2(cloudNormalized) {
    var activeById = new Map();
    var deletedById = new Map();
    var backupById = new Map();
    var allCloudIds = new Map();
    function ingest(list, bucket) {
        (Array.isArray(list) ? list : []).forEach(function (f) {
            if (!f || f.id === null || f.id === undefined) {
                return;
            }
            var k = fileIdKey_INDEX2(f.id);
            allCloudIds.set(k, true);
            bucket.set(k, f);
        });
    }
    ingest(cloudNormalized.files, activeById);
    ingest(cloudNormalized.deletedFiles, deletedById);
    ingest(cloudNormalized.backupFiles, backupById);
    return { activeById: activeById, deletedById: deletedById, backupById: backupById, allCloudIds: allCloudIds };
}

/** هل الملف مرتبط بالسحابة (وسم أو سجل سابق على الخادم) */
function isCloudTrackedLocalFile_INDEX2(f, allCloudIds) {
    if (!f || f.id === null || f.id === undefined) {
        return false;
    }
    var k = fileIdKey_INDEX2(f.id);
    if (fileIsStoredInCloud_INDEX2(f)) {
        return true;
    }
    if (allCloudIds && allCloudIds.has(k)) {
        return true;
    }
    if (cloudActiveFileIds_INDEX2 && cloudActiveFileIds_INDEX2.has(k)) {
        return true;
    }
    return false;
}

/**
 * عند فتح حساب على جهاز آخر: حالة السحابة على الخادم هي المرجع للملفات السحابية.
 * يمنع بقاء نسخة محلية قديمة بعد الحذف من جهاز آخر؛ الملفات المحلية فقط (بدون سحابة) تبقى كما هي.
 */
function mergeCloudStateWithServerAuthority_INDEX2(localFiles, localDeleted, localBackup, cloudNormalized) {
    var maps = buildCloudCategoryMaps_INDEX2(cloudNormalized);
    var outFiles = [];
    var outDeleted = [];
    var outBackup = [];
    var seen = new Map();
    var lf = Array.isArray(localFiles) ? localFiles : [];
    var ld = Array.isArray(localDeleted) ? localDeleted : [];
    var lb = Array.isArray(localBackup) ? localBackup : [];

    maps.activeById.forEach(function (serverRec, k) {
        var localRec =
            findLocalRecordById_INDEX2(lf, k) ||
            findLocalRecordById_INDEX2(ld, k) ||
            findLocalRecordById_INDEX2(lb, k);
        outFiles.push(mergeCloudRecordFields_INDEX2(localRec, serverRec));
        seen.set(k, true);
    });
    maps.deletedById.forEach(function (serverRec, k) {
        if (maps.activeById.has(k)) {
            return;
        }
        var localRec =
            findLocalRecordById_INDEX2(ld, k) ||
            findLocalRecordById_INDEX2(lf, k) ||
            findLocalRecordById_INDEX2(lb, k);
        outDeleted.push(mergeCloudRecordFields_INDEX2(localRec, serverRec));
        seen.set(k, true);
    });
    maps.backupById.forEach(function (serverRec, k) {
        if (maps.activeById.has(k) || maps.deletedById.has(k)) {
            return;
        }
        var localRec =
            findLocalRecordById_INDEX2(lb, k) ||
            findLocalRecordById_INDEX2(ld, k) ||
            findLocalRecordById_INDEX2(lf, k);
        outBackup.push(mergeCloudRecordFields_INDEX2(localRec, serverRec));
        seen.set(k, true);
    });

    function keepLocalOnly(list, target) {
        (Array.isArray(list) ? list : []).forEach(function (f) {
            if (!f || f.id === null || f.id === undefined) {
                return;
            }
            var k = fileIdKey_INDEX2(f.id);
            if (seen.has(k)) {
                return;
            }
            if (isCloudTrackedLocalFile_INDEX2(f, maps.allCloudIds)) {
                return;
            }
            target.push(f);
            seen.set(k, true);
        });
    }
    keepLocalOnly(lf, outFiles);
    (Array.isArray(ld) ? ld : []).forEach(function (f) {
        if (!f || f.id === null || f.id === undefined) {
            return;
        }
        var k = fileIdKey_INDEX2(f.id);
        if (seen.has(k) || maps.backupById.has(k)) {
            return;
        }
        outDeleted.push(f);
        seen.set(k, true);
    });
    keepLocalOnly(lb, outBackup);

    // أزل من السلة المحلية فقط ما نُقل للنسخ الاحتياطية على الخادم — لا لمجرد تأخر الفهرس (سباق حذفين سريع)
    outDeleted = outDeleted.filter(function (f) {
        if (!f || f.id === null || f.id === undefined) {
            return false;
        }
        var k = fileIdKey_INDEX2(f.id);
        return !maps.backupById.has(k);
    });

    return normalizeCloudState_INDEX2(outFiles, outDeleted, outBackup);
}

async function loadFilesFromCloud_INDEX2(options) {
    var opts = options || {};
    var skipDisplay = opts.skipDisplay === true;
    if (!canUseCloudStorage_INDEX2()) return false;
    var cloudWriteMode = getStorageMode_INDEX2() === 'cloud';
    var hydrateFull = opts.hydrate !== false && cloudWriteMode;
    const email = getCurrentUserEmailForCloud_INDEX2();
    const apiBase = getAuthApiBase_INDEX2();
    if (!email || !apiBase) return false;

    var filesUrl =
        apiBase +
        '/api/cloud-storage/files?email=' +
        encodeURIComponent(email) +
        (hydrateFull ? '' : '&hydrate=0');
    const r = await fetch(filesUrl);
    if (!r.ok) {
        throw new Error('cloud_restore_http_' + r.status);
    }
    const data = await r.json().catch(function () { return null; });
    if (!data || !data.ok) return false;

    if (Array.isArray(data.folders)) {
        applyFoldersFromCloud_INDEX2(data.folders);
        refreshUserFoldersUI_INDEX2();
    }

    var localFiles = [];
    try {
        localFiles = await loadFilesFromIndexedDB();
    } catch (eLocal) {
        localFiles = Array.isArray(files) ? files.slice() : [];
    }
    var localDeleted = [];
    try {
        localDeleted = await loadDeletedFilesFromIndexedDB();
    } catch (eDel) {
        localDeleted = Array.isArray(deletedFiles) ? deletedFiles.slice() : [];
    }
    var localBackup = Array.isArray(backupFiles) ? backupFiles.slice() : [];

    var normalizedCloud = normalizeCloudState_INDEX2(data.files, data.deletedFiles, data.backupFiles);
    var cloudFiles = normalizedCloud.files;
    var beforeCount = localFiles.length;
    // السحابة مرجع للحساب؛ المحلي فقط لملفات لم تُرفع بعد.
    var normalizedMerged = mergeCloudStateWithServerAuthority_INDEX2(
        localFiles,
        localDeleted,
        localBackup,
        normalizedCloud
    );
    files = normalizedMerged.files;
    deletedFiles = normalizedMerged.deletedFiles;
    backupFiles = normalizedMerged.backupFiles;
    sortAllVaultListsNewestFirst_INDEX2();
    var deletedIdSet = new Map();
    (Array.isArray(deletedFiles) ? deletedFiles : []).forEach(function (df) {
        if (df && df.id !== null && df.id !== undefined) {
            deletedIdSet.set(fileIdKey_INDEX2(df.id), true);
        }
    });
    if (deletedIdSet.size > 0) {
        files = files.filter(function (f) {
            if (!f || f.id === null || f.id === undefined) {
                return true;
            }
            return !deletedIdSet.has(fileIdKey_INDEX2(f.id));
        });
    }
    reconcileLocalCloudMetadata_INDEX2(cloudFiles);
    applyCloudMetadataToVaultLists_INDEX2({
        files: cloudFiles,
        deletedFiles: normalizedCloud.deletedFiles,
        backupFiles: normalizedCloud.backupFiles
    });
    var addedFromCloud = Math.max(0, files.length - beforeCount);

    try {
        await pruneStaleMediaFilesFromIndexedDB_INDEX2();
        await pruneStaleDeletedFilesFromIndexedDB_INDEX2();
        persistBackupFilesMetadata_INDEX2();
    } catch (pruneAfterCloudErr) {
        console.warn('⚠️ تعذر تنظيف IndexedDB بعد السحابة:', pruneAfterCloudErr);
    }

    await saveFiles(true);
    rebuildCloudActiveFileIdsFromFiles_INDEX2(files);
    if (!skipDisplay) {
        updateStatsAndDisplay();
    } else {
        updateStats(files);
    }
    if (addedFromCloud > 0 && !encryptionKey && !skipDisplay) {
        showNotification(
            'تم جلب الملفات من السحابة.\nافتح الخزنة بكلمة السر نفس الجهاز الأول لفتح الصور والفيديو.',
            6000,
            'info'
        );
    }
    return addedFromCloud;
}

async function syncCloudNow_INDEX2() {
    if (blockActionUntilUpgrade_INDEX2('المزامنة السحابية')) return;
    if (!canUseCloudStorage_INDEX2()) {
        showNotification('ℹ️ التخزين السحابي يعمل فقط مع الخطة المميزة السحابية (INDEX5).');
        return;
    }
    if (getStorageMode_INDEX2() !== 'cloud') {
        showNotification('ℹ️ فعّل وضع التخزين السحابي أولاً.');
        return;
    }
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY) {
            await window.PR_SAFE_AUTH_DISCOVERY;
        }
    } catch (e) {
        /* يكمل المزامنة حتى لو وعد الاكتشاف رُفض */
    }
    showNotification('جاري مزامنة ملفاتك مع السحابة…', 2000, 'info');
    try {
        await syncFilesToCloud_INDEX2({ includeAllLocal: true });
        // تحديث فوري للوسوم (محلي/سحابي) بدون الحاجة لتحديث الصفحة.
        updateStatsAndDisplay();
        var syncNote = 'تمت مزامنة ملفاتك مع السحابة بنجاح.\nتم حفظ نسختك على الخادم.';
        try {
            var st = await fetch(getAuthApiBase_INDEX2() + '/api/cloud-storage/status', { cache: 'no-store' });
            var stj = await st.json().catch(function () { return null; });
            if (stj && stj.backend === 'r2') {
                syncNote += '\n(تخزين Cloudflare R2)';
            }
        } catch (stErr) { /* ignore */ }
        showNotification(syncNote, 4500, 'success');
    } catch (e) {
        console.error('❌ cloud manual sync failed:', e);
        var errMsg =
            'تعذر مزامنة الملفات.\nشغّل خادم التحقق على الكمبيوتر (npm run auth-server)، وتأكد من تسجيل الدخول.';
        if (e && e.message === 'cloud_sync_missing_email_or_api') {
            errMsg =
                'تعذر المزامنة.\nيلزم تسجيل الدخول واتصال بخادم التحقق. للجوال: نفس شبكة الـ Wi‑Fi وقد تحتاج ضبط PR_SAFE_AUTH_OVERRIDE_HOST.';
        }
        showNotification(errMsg, 5000, 'error');
    }
}

async function restoreCloudNow_INDEX2() {
    if (blockActionUntilUpgrade_INDEX2('الاستعادة من السحابة')) return;
    if (!canUseCloudStorage_INDEX2()) {
        showNotification('ℹ️ الاستعادة السحابية متاحة فقط مع الخطة المميزة السحابية (INDEX5).');
        return;
    }
    if (getStorageMode_INDEX2() !== 'cloud') {
        showNotification('ℹ️ فعّل وضع التخزين السحابي أولاً.');
        return;
    }
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY) {
            await window.PR_SAFE_AUTH_DISCOVERY;
        }
    } catch (e) {
        /* يكمل محاولة الاستعادة */
    }
    try {
        const added = await loadFilesFromCloud_INDEX2();
        if (added === false) {
            showNotification('ℹ️ تعذر الاستعادة أو لا توجد بيانات سحابية.');
        } else if (added === 0) {
            showNotification(
                'ℹ️ لم يُضف شيء جديد: الملفات المطابقة في السحابة موجودة محلياً مسبقاً (نفس المعرف).'
            );
        } else {
            showNotification(
                '✅ تم إضافة ' +
                    added +
                    ' ملف(ات) من السحابة دون تكرار ما هو موجود محلياً.'
            );
        }
    } catch (e) {
        console.error('❌ cloud manual restore failed:', e);
        var restoreMsg = '❌ تعذر استرجاع الملفات من السحابة.';
        if (e && e.message === 'cloud_restore_http_403') {
            restoreMsg = '❌ الخادم رفض الاستعادة: يلزم اشتراك INDEX5 فعّال لهذا البريد.';
        } else if (e && e.message === 'cloud_restore_http_404') {
            restoreMsg = '❌ عنوان خادم التحقق غير صحيح. تأكد من تشغيل npm run auth-server.';
        }
        showNotification(restoreMsg);
    }
}

function getPendingEmailVerification_INDEX2() {
    try {
        const raw = localStorage.getItem(PENDING_EMAIL_VERIFY_KEY_INDEX2);
        if (!raw) return null;
        const o = JSON.parse(raw);
        if (o && o.email && o.password) return o;
        return null;
    } catch (e) {
        return null;
    }
}

function setPendingEmailVerification_INDEX2(obj) {
    localStorage.setItem(PENDING_EMAIL_VERIFY_KEY_INDEX2, JSON.stringify(obj));
}

function clearPendingEmailVerification_INDEX2() {
    localStorage.removeItem(PENDING_EMAIL_VERIFY_KEY_INDEX2);
}

function migrateLegacyUnverifiedAccountToPending_INDEX2() {
    try {
        const raw = localStorage.getItem('userAccount_INDEX2');
        if (!raw) return;
        const acc = JSON.parse(raw);
        if (!acc || acc.emailVerified !== false) return;
        if (!acc.email || !acc.password) return;
        if (!getPendingEmailVerification_INDEX2()) {
            setPendingEmailVerification_INDEX2({
                email: acc.email,
                password: acc.password,
                securityAnswer: acc.securityAnswer || '',
                createdAt: acc.createdAt || new Date().toISOString()
            });
        }
        localStorage.removeItem('userAccount_INDEX2');
        localStorage.removeItem('currentUserEmail_INDEX2');
    } catch (ignore) {}
}

// ==================== نظام التشفير ====================

function deriveEncryptionKeyBytesFromMaterial_INDEX2(material) {
    if (!material) {
        return null;
    }
    try {
        const encoder = new TextEncoder();
        const bytes = encoder.encode(String(material));
        const key = new Uint8Array(32);
        for (let i = 0; i < 32; i++) {
            key[i] = bytes[i % bytes.length] ^ ((i * 31 + 7) % 256);
        }
        return key;
    } catch (error) {
        console.error('❌ خطأ في اشتقاق مفتاح التشفير:', error);
        return null;
    }
}

/** مفتاح من كلمة السر (للملفات القديمة والترحيل) */
function deriveEncryptionKeyBytes(password) {
    return deriveEncryptionKeyBytesFromMaterial_INDEX2(password);
}

/** مفتاح ثابت من البريد + بذرة الخادم — لا يتغير عند تغيير كلمة السر */
function deriveVaultKeyFromSeed_INDEX2(email, vaultKeySeed) {
    const em = String(email || '').trim().toLowerCase();
    const seed = String(vaultKeySeed || '').trim();
    if (!em || !seed) {
        return null;
    }
    return deriveEncryptionKeyBytesFromMaterial_INDEX2('gosta-vault-v1|' + em + '|' + seed);
}

function vaultKeyFingerprint_INDEX2(key) {
    if (!key || !key.length) {
        return '';
    }
    return Array.from(key.slice(0, 4)).join(',');
}

function mergeVaultKeySeedIntoAccount_INDEX2(account, serverAccount) {
    if (!account || !serverAccount) {
        return account;
    }
    if (serverAccount.vaultKeySeed) {
        account.vaultKeySeed = serverAccount.vaultKeySeed;
    }
    return account;
}

function getPrimaryVaultEncryptionKey_INDEX2(account) {
    if (!account) {
        return null;
    }
    if (account.vaultKeySeed) {
        return deriveVaultKeyFromSeed_INDEX2(account.email, account.vaultKeySeed);
    }
    if (account.password) {
        return deriveEncryptionKeyBytes(account.password);
    }
    return null;
}

function clearVaultLegacyPassword_INDEX2() {
    try {
        lsScopedRemove_INDEX2('vaultLegacyPassword_INDEX2');
    } catch (e) {}
}

/** مفاتيح فك التشفير للحساب الحالي (بذرة الخزنة + كلمة السر إن لزم — بدون كلمة سر قديمة) */
function getVaultDecryptKeys_INDEX2(account) {
    const keys = [];
    const seen = {};
    function addKey(k) {
        const fp = vaultKeyFingerprint_INDEX2(k);
        if (k && fp && !seen[fp]) {
            seen[fp] = true;
            keys.push(k);
        }
    }
    if (!account) {
        return keys;
    }
    addKey(getPrimaryVaultEncryptionKey_INDEX2(account));
    if (account.password) {
        addKey(deriveEncryptionKeyBytes(account.password));
    }
    return keys;
}

function getVaultLegacyPasswordForMigration_INDEX2() {
    try {
        const legacy = lsScopedGet_INDEX2('vaultLegacyPassword_INDEX2');
        return legacy ? String(legacy) : '';
    } catch (e) {
        return '';
    }
}

function applyVaultEncryptionKeyFromAccount_INDEX2(account) {
    const key = getPrimaryVaultEncryptionKey_INDEX2(account);
    if (key) {
        encryptionKey = key;
        return true;
    }
    return false;
}

/**
 * توليد مفتاح التشفير من كلمة المرور (حتمية - deterministic)
 */
function generateEncryptionKey(password) {
    if (!password) {
        console.error('❌ كلمة المرور فارغة');
        return null;
    }
    const key = deriveEncryptionKeyBytes(password);
    if (key) {
        const fingerprint = Array.from(key.slice(0, 4))
            .map((b) => b.toString(16).padStart(2, '0'))
            .join('');
        console.log('✅ تم توليد مفتاح التشفير بنجاح (SHA: ' + fingerprint + ')');
        encryptionKey = key;
    }
    return key;
}

/**
 * إعادة تشفير جميع الملفات المشفرة بعد تغيير كلمة المرور.
 * الهدف: منع قبول كلمة المرور القديمة بعد التغيير.
 */
async function reEncryptAllStoresWithNewPassword(oldPassword, newPassword) {
    if (!oldPassword || !newPassword) {
        throw new Error('كلمة المرور القديمة أو الجديدة غير متوفرة');
    }
    const oldKey = deriveEncryptionKeyBytes(oldPassword);
    const newKey = deriveEncryptionKeyBytes(newPassword);
    if (!oldKey || !newKey) {
        throw new Error('فشل إنشاء مفاتيح التشفير');
    }
    return reEncryptAllStoresWithKeys_INDEX2(oldKey, newKey);
}

/**
 * بعد تغيير كلمة السر: إعادة تشفير الملفات التي تحتاج تحديثاً فقط (تخطّي ما هو على المفتاح الصحيح مسبقاً).
 */
async function reEncryptVaultFilesAfterPasswordChange_INDEX2(account, oldPassword, newPassword) {
    if (!account || !oldPassword || !newPassword) {
        return { scanned: 0, updated: 0, failed: 0, skipped: 0 };
    }
    if (!db) {
        await initDatabase();
    }
    const accOld = Object.assign({}, account, { password: oldPassword });
    const accNew = Object.assign({}, account, { password: newPassword });
    const targetKey = getPrimaryVaultEncryptionKey_INDEX2(accNew);
    if (!targetKey) {
        throw new Error('فشل إنشاء مفتاح التشفير الجديد');
    }
    const decryptKeys = getVaultDecryptKeys_INDEX2(accOld);
    const legacy = getVaultLegacyPasswordForMigration_INDEX2();
    if (legacy && legacy !== newPassword) {
        const legK = deriveEncryptionKeyBytes(legacy);
        const seenLeg = {};
        decryptKeys.forEach(function (k) {
            seenLeg[vaultKeyFingerprint_INDEX2(k)] = true;
        });
        const fp = vaultKeyFingerprint_INDEX2(legK);
        if (legK && fp && !seenLeg[fp]) {
            decryptKeys.push(legK);
        }
    }
    const stats = { scanned: 0, updated: 0, failed: 0, skipped: 0 };
    const storesToMigrate = ['mediaFiles', 'deletedFiles', 'backupData'];

    function migrateRecord(record) {
        if (!record || !record.isEncrypted || !record.data) {
            return;
        }
        stats.scanned += 1;
        if (decryptFileDataWithKey_INDEX2(record.data, targetKey)) {
            stats.skipped += 1;
            return;
        }
        const fileType = record.type || record.fileType || 'application/octet-stream';
        let decryptedBase64 = null;
        for (let ki = 0; ki < decryptKeys.length; ki++) {
            decryptedBase64 = decryptFileDataWithKey_INDEX2(record.data, decryptKeys[ki]);
            if (decryptedBase64) {
                break;
            }
        }
        if (!decryptedBase64) {
            stats.failed += 1;
            return;
        }
        const dataUrl = 'data:' + fileType + ';base64,' + decryptedBase64;
        encryptionKey = targetKey;
        const reEncrypted = encryptFileData(dataUrl);
        if (!reEncrypted) {
            stats.failed += 1;
            return;
        }
        record.data = reEncrypted;
        record.isEncrypted = true;
        stats.updated += 1;
    }

    try {
        for (let si = 0; si < storesToMigrate.length; si++) {
            const storeName = storesToMigrate[si];
            if (!db.objectStoreNames.contains(storeName)) {
                continue;
            }
            const records = await new Promise(function (resolve, reject) {
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onerror = function () {
                    reject(req.error);
                };
                req.onsuccess = function (event) {
                    resolve(event.target.result || []);
                };
            });
            const updatedRecords = [];
            for (let ri = 0; ri < records.length; ri++) {
                const beforeUpdated = stats.updated;
                migrateRecord(records[ri]);
                if (stats.updated > beforeUpdated) {
                    updatedRecords.push(records[ri]);
                }
            }
            if (updatedRecords.length > 0) {
                await new Promise(function (resolve, reject) {
                    const tx = db.transaction([storeName], 'readwrite');
                    const store = tx.objectStore(storeName);
                    updatedRecords.forEach(function (record) {
                        store.put(record);
                    });
                    tx.oncomplete = function () {
                        resolve();
                    };
                    tx.onerror = function () {
                        reject(tx.error);
                    };
                    tx.onabort = function () {
                        reject(tx.error);
                    };
                });
            }
        }
        const reencryptInMemory = function (arr) {
            if (!Array.isArray(arr)) {
                return;
            }
            arr.forEach(function (item) {
                migrateRecord(item);
            });
        };
        reencryptInMemory(files);
        reencryptInMemory(deletedFiles);
        reencryptInMemory(backupFiles);
    } finally {
        encryptionKey = targetKey;
        clearVaultLegacyPassword_INDEX2();
    }
    return stats;
}

async function reEncryptAllStoresWithKeys_INDEX2(oldKey, newKey) {
    if (!oldKey || !newKey) {
        throw new Error('مفاتيح التشفير غير متوفرة');
    }

    if (!db) {
        await initDatabase();
    }

    const originalKey = encryptionKey;
    const storesToMigrate = ['mediaFiles', 'deletedFiles', 'backupData'];
    const stats = { scanned: 0, updated: 0, failed: 0 };

    try {
        for (const storeName of storesToMigrate) {
            if (!db.objectStoreNames.contains(storeName)) {
                continue;
            }

            const records = await new Promise((resolve, reject) => {
                const tx = db.transaction([storeName], 'readonly');
                const store = tx.objectStore(storeName);
                const req = store.getAll();
                req.onerror = () => reject(req.error);
                req.onsuccess = (event) => resolve(event.target.result || []);
            });

            const updatedRecords = [];
            for (const record of records) {
                if (!record || !record.isEncrypted || !record.data) {
                    continue;
                }

                stats.scanned += 1;
                const fileType = record.type || record.fileType || 'application/octet-stream';

                let decryptedBase64 = decryptFileDataWithKey_INDEX2(record.data, oldKey);
                if (!decryptedBase64) {
                    if (decryptFileDataWithKey_INDEX2(record.data, newKey)) {
                        continue;
                    }
                    stats.failed += 1;
                    continue;
                }
                if (vaultKeyFingerprint_INDEX2(oldKey) === vaultKeyFingerprint_INDEX2(newKey)) {
                    continue;
                }

                const dataUrl = `data:${fileType};base64,${decryptedBase64}`;
                encryptionKey = newKey;
                const reEncrypted = encryptFileData(dataUrl);
                if (!reEncrypted) {
                    stats.failed += 1;
                    continue;
                }

                record.data = reEncrypted;
                record.isEncrypted = true;
                updatedRecords.push(record);
                stats.updated += 1;
            }

            if (updatedRecords.length > 0) {
                await new Promise((resolve, reject) => {
                    const tx = db.transaction([storeName], 'readwrite');
                    const store = tx.objectStore(storeName);
                    updatedRecords.forEach((record) => store.put(record));
                    tx.oncomplete = () => resolve();
                    tx.onerror = () => reject(tx.error);
                    tx.onabort = () => reject(tx.error);
                });
            }
        }

        // مزامنة البيانات المعروضة حالياً في الذاكرة بدون إعادة تحميل كاملة
        const reencryptInMemory = (arr) => {
            if (!Array.isArray(arr)) return;
            arr.forEach((item) => {
                if (!item || !item.isEncrypted || !item.data) return;
                const fileType = item.type || item.fileType || 'application/octet-stream';
                const decryptedBase64 = decryptFileDataWithKey_INDEX2(item.data, oldKey);
                if (!decryptedBase64) return;
                const dataUrl = `data:${fileType};base64,${decryptedBase64}`;
                encryptionKey = newKey;
                const reEncrypted = encryptFileData(dataUrl);
                if (reEncrypted) item.data = reEncrypted;
            });
        };

        reencryptInMemory(files);
        reencryptInMemory(deletedFiles);
        reencryptInMemory(backupFiles);
    } finally {
        // ثبّت المفتاح الجديد كالمفتاح الفعال للحساب بعد الهجرة
        encryptionKey = newKey || originalKey;
        clearVaultLegacyPassword_INDEX2();
    }

    return stats;
}

/**
 * تشفير بيانات الملف
 */
function encryptFileData(fileData) {
    if (!fileData) {
        console.error('❌ بيانات الملف فارغة');
        return null;
    }
    
    if (!encryptionKey) {
        console.warn('⚠️ مفتاح التشفير غير موجود - سيتم حفظ الملف بدون تشفير');
        return null;
    }
    
    try {
        // إذا كانت البيانات data URL، حولها إلى بايتات
        let dataBytes;
        
        if (typeof fileData === 'string' && fileData.startsWith('data:')) {
            const arr = fileData.split(',');
            const bstr = atob(arr[1]);
            dataBytes = new Uint8Array(bstr.length);
            for (let i = 0; i < bstr.length; i++) {
                dataBytes[i] = bstr.charCodeAt(i);
            }
        } else if (typeof fileData === 'string') {
            const encoder = new TextEncoder();
            dataBytes = encoder.encode(fileData);
        } else {
            dataBytes = new Uint8Array(fileData);
        }
        
        // توليد nonce عشوائي (24 بايت)
        const nonce = nacl.randomBytes(24);
        
        // تشفير البيانات
        const encrypted = nacl.secretbox(dataBytes, nonce, encryptionKey);
        
        if (!encrypted) {
            console.error('❌ فشل التشفير - تحقق من مفتاح التشفير');
            return null;
        }
        
        // دمج nonce و encrypted في array واحد
        const encryptedData = new Uint8Array(nonce.length + encrypted.length);
        encryptedData.set(nonce);
        encryptedData.set(encrypted, nonce.length);
        
        // تحويل إلى base64 للتخزين
        const encryptedBase64 = nacl.util.encodeBase64(encryptedData);
        
        console.log('✅ تم تشفير الملف بنجاح (الحجم المشفر: ' + encryptedBase64.length + ' حرف)');
        return encryptedBase64;
    } catch (error) {
        console.error('❌ خطأ في تشفير الملف:', error);
        return null;
    }
}

/** يستخرج base64 المشفّر من data URL أو نص خام (بعد استعادة R2 قد يأتي بصيغة data:...) */
function extractEncryptedBase64FromStoredData_INDEX2(raw) {
    var s = String(raw || '').trim();
    if (!s) {
        return '';
    }
    if (s.startsWith('data:')) {
        var marker = ';base64,';
        var idx = s.indexOf(marker);
        if (idx >= 0) {
            return s.slice(idx + marker.length);
        }
        var comma = s.indexOf(',');
        if (comma >= 0) {
            return s.slice(comma + 1);
        }
    }
    return s;
}

/**
 * فك تشفير بيانات الملف بمفتاح محدد
 */
function decryptFileDataWithKey_INDEX2(encryptedBase64, key) {
    if (!encryptedBase64 || !key) {
        return null;
    }
    try {
        const payloadB64 = extractEncryptedBase64FromStoredData_INDEX2(encryptedBase64);
        let encryptedData;
        try {
            encryptedData = nacl.util.decodeBase64(payloadB64);
        } catch (e) {
            return null;
        }
        if (!encryptedData || encryptedData.length < 24) {
            return null;
        }
        const nonce = encryptedData.slice(0, 24);
        const encrypted = encryptedData.slice(24);
        const decrypted = nacl.secretbox.open(encrypted, nonce, key);
        if (!decrypted) {
            return null;
        }
        let binaryString = '';
        const chunkSize = 10000;
        for (let i = 0; i < decrypted.length; i += chunkSize) {
            const chunk = decrypted.slice(i, i + chunkSize);
            binaryString += String.fromCharCode.apply(null, chunk);
        }
        return btoa(binaryString);
    } catch (error) {
        return null;
    }
}

/**
 * فك تشفير بيانات الملف (مفاتيح الحساب الحالي فقط)
 */
function decryptFileData(encryptedBase64) {
    if (!encryptedBase64) {
        console.error('❌ البيانات المشفرة فارغة');
        return null;
    }
    let account = null;
    try {
        account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    } catch (eAcc) {}
    if (!account) {
        console.error('❌ مفتاح التشفير غير موجود');
        return null;
    }
    const base64 = decryptFileDataForAccount_INDEX2(encryptedBase64, account);
    if (base64) {
        console.log('✅ تم فك تشفير الملف بنجاح (الحجم: ' + base64.length + ' حرف)');
        return base64;
    }
    console.error('❌ فشل فك التشفير');
    return null;
}

let hasStoragePermission = localStorage.getItem('pr_safe_permission_INDEX2') === 'true'; // متغير لتتبع حالة الإذن (مستقل)

// ==================== إدارة قاعدة البيانات IndexedDB ====================

function initDatabase() {
    return new Promise((resolve, reject) => {
        // إغلاق أي اتصال قديم
        if (db) {
            db.close();
            db = null;
        }

        let dbName = 'mediaAppDB_INDEX2';
        if (typeof getIndexedDBNameForUserEmail_INDEX2 === 'function') {
            const em =
                typeof getCurrentUserEmailForStorage_INDEX2 === 'function'
                    ? getCurrentUserEmailForStorage_INDEX2()
                    : '';
            if (em) dbName = getIndexedDBNameForUserEmail_INDEX2(em);
        }

        const request = indexedDB.open(dbName, 3); // لكل بريد قاعدة منفصلة بعد الترحيل
        
        request.onerror = function() {
            console.error('❌ خطأ في فتح قاعدة البيانات');
            reject(request.error);
        };
          request.onsuccess = function(event) {
            db = event.target.result;
            console.log('✅ تم فتح قاعدة البيانات بنجاح (INDEX2 - الإصدار: 3)');
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
        objectStore.put(fileObject);

        transaction.oncomplete = function () {
            console.log('✅ تم حفظ الملف في IndexedDB (معاملة مكتملة):', fileObject.name);
            resolve();
        };
        transaction.onerror = function () {
            console.error('❌ خطأ في حفظ الملف:', transaction.error);
            reject(transaction.error);
        };
        transaction.onabort = function () {
            reject(transaction.error || new Error('transaction_aborted'));
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
        objectStore.put(fileObject);

        transaction.oncomplete = function () {
            console.log('✅ تم حفظ الملف المحذوف في IndexedDB (معاملة مكتملة):', fileObject.name);
            resolve();
        };
        transaction.onerror = function () {
            console.error('❌ خطأ في حفظ الملف المحذوف:', transaction.error);
            reject(transaction.error);
        };
        transaction.onabort = function () {
            reject(transaction.error || new Error('transaction_aborted'));
        };
    });
}

/**
 * مسح جدول الملفات النشطة في IndexedDB.
 * لازم قبل «استعادة من السحابة» وإلا يبقى المحلي القديم + بيانات السحابة = تكرار في القائمة.
 */
function clearMediaFilesStore_INDEX2() {
    return new Promise(function (resolve, reject) {
        if (!db) {
            resolve();
            return;
        }
        var transaction = db.transaction(['mediaFiles'], 'readwrite');
        transaction.objectStore('mediaFiles').clear();
        transaction.oncomplete = function () {
            console.log('✅ تم مسح الملفات المحلية من IndexedDB قبل تطبيق بيانات السحابة');
            resolve();
        };
        transaction.onerror = function () {
            console.error('❌ فشل مسح mediaFiles:', transaction.error);
            reject(transaction.error);
        };
        transaction.onabort = function () {
            reject(transaction.error || new Error('transaction_aborted'));
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

/** يحذف من mediaFiles أي سجل ليس ضمن قائمة files الحالية (يمنع عودة ملف محذوف بعد تحديث الصفحة). */
/** تنفيذ حفظ/مزامنة الحذف في الخلفية دون تأخير الواجهة */
function runDeferredDeletePersist_INDEX2(workFn, label) {
    Promise.resolve()
        .then(workFn)
        .catch(function (err) {
            console.warn('[delete-bg]' + (label ? ' ' + label : '') + ':', err);
        });
}

async function persistAfterActiveFileDelete_INDEX2(opts) {
    var o = opts || {};
    if (o.saveDeletedMetadata) {
        saveDeletedFilesToLocalStorage();
        await saveDeletedFilesToIndexedDB();
    }
    if (o.removeFromMediaIdb && o.fileId) {
        try {
            await deleteFileFromIndexedDB(o.fileId);
        } catch (idbErr) {
            console.warn('⚠️ تعذر حذف الملف من mediaFiles:', idbErr);
        }
    }
    await saveFiles(true);
    await pruneStaleMediaFilesFromIndexedDB_INDEX2();
    await pruneStaleDeletedFilesFromIndexedDB_INDEX2();
    if (o.cloudSync) {
        await syncFilesToCloud_INDEX2({
            forceSync: true,
            skipIdbReload: true
        });
    }
}

var cloudSyncQueuePromise_INDEX2 = Promise.resolve();

function enqueueCloudSync_INDEX2(workFn) {
    cloudSyncQueuePromise_INDEX2 = cloudSyncQueuePromise_INDEX2
        .then(workFn)
        .catch(function (err) {
            console.warn('[cloud] sync queue:', err);
        });
    return cloudSyncQueuePromise_INDEX2;
}

async function persistAfterPermanentTrashDelete_INDEX2(opts) {
    var o = opts || {};
    saveDeletedFilesToLocalStorage();
    await saveDeletedFilesToIndexedDB();
    if (o.removeFromDeletedIdb && o.fileId && db) {
        try {
            await permanentlyDeleteFile(o.fileId);
        } catch (e) {
            console.warn('⚠️ حذف من deletedFiles:', e);
        }
    }
    if (o.backupFile) {
        try {
            await saveBackupFileToIndexedDB_INDEX2(o.backupFile);
        } catch (backupIdbErr) {
            console.warn('⚠️ حفظ backupData:', backupIdbErr);
        }
    }
    await saveFiles(true);
    await pruneStaleMediaFilesFromIndexedDB_INDEX2();
    await pruneStaleDeletedFilesFromIndexedDB_INDEX2();
    if (o.cloudSync) {
        persistBackupFilesMetadata_INDEX2();
        await syncFilesToCloud_INDEX2({
            includeAllLocal: true,
            forceSync: true,
            skipIdbReload: true
        });
    }
}

async function persistAfterBackupFileDelete_INDEX2(opts) {
    var o = opts || {};
    if (o.removeFromBackupIdb && o.fileId && db && db.objectStoreNames.contains('backupData')) {
        try {
            var txB = db.transaction(['backupData'], 'readwrite');
            txB.objectStore('backupData').delete(o.fileId);
        } catch (e) {
            console.warn('⚠️ حذف من backupData:', e);
        }
    }
    await saveFiles(true);
    if (o.cloudSync) {
        if (o.fileId != null && o.fileId !== undefined) {
            unmarkCloudLifecycleFileId_INDEX2(o.fileId);
            removeCloudActiveFileId_INDEX2(o.fileId);
        }
        await syncFilesToCloud_INDEX2({ includeAllLocal: true });
    }
}

async function persistAfterBulkPermanentTrashDelete_INDEX2(opts) {
    var o = opts || {};
    saveDeletedFilesToLocalStorage();
    await saveDeletedFilesToIndexedDB();
    if (Array.isArray(o.fileIds) && db) {
        for (var i = 0; i < o.fileIds.length; i++) {
            try {
                await permanentlyDeleteFile(o.fileIds[i]);
            } catch (e) {
                console.warn('⚠️ حذف من deletedFiles:', e);
            }
        }
    }
    if (Array.isArray(o.backupRecords)) {
        for (var b = 0; b < o.backupRecords.length; b++) {
            try {
                await saveBackupFileToIndexedDB_INDEX2(o.backupRecords[b]);
            } catch (backupIdbErr) {
                console.warn('⚠️ حفظ backupData:', backupIdbErr);
            }
        }
    }
    await saveFiles(true);
    await pruneStaleMediaFilesFromIndexedDB_INDEX2();
    await pruneStaleDeletedFilesFromIndexedDB_INDEX2();
    if (o.cloudSync) {
        persistBackupFilesMetadata_INDEX2();
        await syncFilesToCloud_INDEX2({
            includeAllLocal: true,
            forceSync: true,
            skipIdbReload: true
        });
    }
}

async function persistAfterBulkBackupDelete_INDEX2(opts) {
    var o = opts || {};
    if (db && db.objectStoreNames.contains('backupData')) {
        try {
            var txClear = db.transaction(['backupData'], 'readwrite');
            txClear.objectStore('backupData').clear();
        } catch (e) {
            console.warn('⚠️ مسح backupData:', e);
        }
    }
    await saveFiles(true);
    if (o.cloudSync) {
        await syncFilesToCloud_INDEX2({ includeAllLocal: true });
    }
}

async function persistAfterTrashRestore_INDEX2(opts) {
    var o = opts || {};
    var preservedData = o.restoredFile && o.restoredFile.data ? o.restoredFile.data : null;
    var preservedS3Key = o.restoredFile && o.restoredFile.s3Key ? o.restoredFile.s3Key : null;
    var preservedBackend = o.restoredFile && o.restoredFile.storageBackend ? o.restoredFile.storageBackend : null;
    var restoredId = o.restoredFile && o.restoredFile.id;

    if (restoredId !== null && restoredId !== undefined) {
        var rkPrep = fileIdKey_INDEX2(restoredId);
        for (var prep = 0; prep < files.length; prep++) {
            if (fileIdKey_INDEX2(files[prep].id) !== rkPrep) {
                continue;
            }
            if (preservedData) {
                files[prep].data = preservedData;
            }
            if (preservedS3Key) {
                files[prep].s3Key = preservedS3Key;
            }
            if (preservedBackend) {
                files[prep].storageBackend = preservedBackend;
            } else if (isRestoredCloudVaultFile_INDEX2(files[prep])) {
                files[prep].storageBackend = 'r2';
            }
            if (o.restoredFile) {
                o.restoredFile.data = files[prep].data;
                o.restoredFile.s3Key = files[prep].s3Key;
                o.restoredFile.storageBackend = files[prep].storageBackend;
            }
            break;
        }
    }

    if (o.restoredFile && o.restoredFile.data && db) {
        try {
            await saveFileToIndexedDB(o.restoredFile);
        } catch (idbSaveErr) {
            console.warn('⚠️ حفظ الملف المستعاد في mediaFiles:', idbSaveErr);
        }
    }
    await saveFiles(true);

    saveDeletedFilesToLocalStorage();
    await saveDeletedFilesToIndexedDB();

    if (o.cloudSync) {
        try {
            await syncFilesToCloud_INDEX2({
                includeAllLocal: true,
                forceSync: true,
                skipIdbReload: true
            });
        } catch (syncErr) {
            console.warn('[cloud-restore] sync after trash restore:', syncErr);
        }
    }

    if (restoredId !== null && restoredId !== undefined) {
        var rk = fileIdKey_INDEX2(restoredId);
        for (var fi = 0; fi < files.length; fi++) {
            if (fileIdKey_INDEX2(files[fi].id) !== rk) {
                continue;
            }
            if (preservedData) {
                files[fi].data = preservedData;
            }
            if (preservedS3Key) {
                files[fi].s3Key = preservedS3Key;
            }
            if (isRestoredCloudVaultFile_INDEX2(files[fi])) {
                if (!files[fi].storageBackend) {
                    files[fi].storageBackend = 'r2';
                }
                cloudActiveFileIds_INDEX2.set(rk, true);
                persistCloudActiveFileIds_INDEX2();
            }
            if (o.restoredFile) {
                o.restoredFile.data = files[fi].data;
                o.restoredFile.s3Key = files[fi].s3Key;
                o.restoredFile.storageBackend = files[fi].storageBackend;
            }
            break;
        }
        if (o.restoredFile && o.restoredFile.data && db) {
            try {
                await saveFileToIndexedDB(o.restoredFile);
            } catch (idbSaveErr2) {
                console.warn('⚠️ إعادة حفظ الملف المستعاد بعد المزامنة:', idbSaveErr2);
            }
        }
    }

    await saveFiles(true);
    await pruneStaleMediaFilesFromIndexedDB_INDEX2();
    await pruneStaleDeletedFilesFromIndexedDB_INDEX2();
}

function mergeTrashRestoreSources_INDEX2(idbRec, memRec) {
    var base = idbRec || memRec;
    if (!base) {
        return null;
    }
    var merged = Object.assign({}, base);
    var other = idbRec && memRec && idbRec !== memRec ? (idbRec === base ? memRec : idbRec) : memRec;
    if (other) {
        if (other.data && !merged.data) {
            merged.data = other.data;
        }
        if (other.s3Key && !merged.s3Key) {
            merged.s3Key = other.s3Key;
        }
        if (other.storageBackend && !merged.storageBackend) {
            merged.storageBackend = other.storageBackend;
        }
    }
    return merged;
}

function getDeletedFileFromIdbById_INDEX2(fileId) {
    return new Promise(function (resolve) {
        if (!db || !db.objectStoreNames.contains('deletedFiles')) {
            resolve(null);
            return;
        }
        var wantKey = fileIdKey_INDEX2(fileId);
        try {
            var tx = db.transaction(['deletedFiles'], 'readonly');
            var store = tx.objectStore('deletedFiles');
            var direct = store.get(fileId);
            direct.onsuccess = function () {
                if (direct.result && direct.result.data) {
                    resolve(direct.result);
                    return;
                }
                var all = store.getAll();
                all.onsuccess = function () {
                    var list = all.result || [];
                    for (var i = 0; i < list.length; i++) {
                        if (list[i] && fileIdKey_INDEX2(list[i].id) === wantKey && list[i].data) {
                            resolve(list[i]);
                            return;
                        }
                    }
                    resolve(direct.result || null);
                };
                all.onerror = function () {
                    resolve(direct.result || null);
                };
            };
            direct.onerror = function () {
                resolve(null);
            };
        } catch (e) {
            resolve(null);
        }
    });
}

async function loadTrashRecordForRestore_INDEX2(fileToRestore) {
    var merged = mergeTrashRestoreSources_INDEX2(null, fileToRestore);
    var fromIdb = await getDeletedFileFromIdbById_INDEX2(fileToRestore && fileToRestore.id);
    return mergeTrashRestoreSources_INDEX2(fromIdb, merged);
}

function buildRestoredFileFromTrashSource_INDEX2(source) {
    if (!source || source.id === null || source.id === undefined) {
        return null;
    }
    var inferredEncrypted =
        typeof source.data === 'string' && source.data && !source.data.startsWith('data:');
    var restored = {
        id: source.id,
        name: source.name,
        type: source.type,
        size: source.size,
        data: source.data,
        uploadedAt: source.uploadedAt,
        isLocked: source.isLocked || false,
        isEncrypted:
            typeof source.isEncrypted === 'boolean' ? source.isEncrypted : inferredEncrypted,
        isCompressed: !!source.isCompressed
    };
    if (source.s3Key) {
        restored.s3Key = source.s3Key;
    }
    if (source.storageBackend) {
        restored.storageBackend = source.storageBackend;
    } else if (source.s3Key || (canUseCloudStorage_INDEX2() && isFileKnownInCloud_INDEX2(source))) {
        restored.storageBackend = 'r2';
    }
    copyFileFolderFields_INDEX2(restored, source);
    return restored;
}

/** استعادة مسموحة إن وُجدت بيانات محلية أو الملف مُخزَّن على السحابة (s3Key) */
function isRestoredCloudVaultFile_INDEX2(file) {
    if (!file) {
        return false;
    }
    if (fileIsStoredInCloud_INDEX2(file)) {
        return true;
    }
    return canUseCloudStorage_INDEX2() && isFileKnownInCloud_INDEX2(file);
}

function canRestoreTrashRecord_INDEX2(record) {
    return !!(record && record.data);
}

/** جلب محتوى ملف سحابي واحد للاستعادة (لا يحمّل كل الحساب). */
function shouldCallCloudHydrateApi_INDEX2(record) {
    if (!record || record.id === null || record.id === undefined || record.data) {
        return false;
    }
    if (!canUseCloudStorage_INDEX2()) {
        return false;
    }
    return canHydrateCloudRecord_INDEX2(record) || true;
}

async function fetchCloudRecordHydratedForRestore_INDEX2(record, category) {
    if (!record || record.id === null || record.id === undefined) {
        return record;
    }
    if (record.data) {
        return record;
    }
    if (!shouldCallCloudHydrateApi_INDEX2(record)) {
        return record;
    }
    var email = getCurrentUserEmailForCloud_INDEX2();
    var apiBase = getAuthApiBase_INDEX2();
    if (!email || !apiBase) {
        return record;
    }
    var cat = category === 'backup' ? 'backup' : category === 'files' ? 'files' : 'deleted';
    try {
        if (window.PR_SAFE_AUTH_DISCOVERY) {
            await window.PR_SAFE_AUTH_DISCOVERY;
        }
    } catch (discErr) {
        /* ignore */
    }
    try {
        var url =
            apiBase +
            '/api/cloud-storage/hydrate-record?email=' +
            encodeURIComponent(email) +
            '&id=' +
            encodeURIComponent(String(record.id)) +
            '&category=' +
            encodeURIComponent(cat);
        var r = await fetch(url);
        var data = await r.json().catch(function () {
            return {};
        });
        if (r.ok && data.ok && data.file) {
            return mergeTrashRestoreSources_INDEX2(data.file, record);
        }
        console.warn('[cloud-restore] hydrate-record failed:', record.id, data.error || r.status);
    } catch (e) {
        console.warn('[cloud-restore] hydrate-record:', e.message || e);
    }
    return record;
}

async function ensureRecordDataForRestore_INDEX2(record, categoryHint) {
    if (!record) {
        return record;
    }
    if (record.data) {
        return record;
    }
    if (shouldCallCloudHydrateApi_INDEX2(record)) {
        return fetchCloudRecordHydratedAnyCategory_INDEX2(record, categoryHint);
    }
    return record;
}

function applyRestoreFromTrash_INDEX2(restoredFile, trashIndex, trashWasCloudHint) {
    if (!restoredFile) {
        showNotification('❌ خطأ: تعذر تجهيز الملف للاستعادة');
        return;
    }
    var wasCloud =
        trashWasCloudHint === true ||
        isRestoredCloudVaultFile_INDEX2(restoredFile);
    if (wasCloud) {
        if (!restoredFile.storageBackend) {
            restoredFile.storageBackend = 'r2';
        }
        markCloudLifecycleFileId_INDEX2(restoredFile.id);
        cloudActiveFileIds_INDEX2.set(fileIdKey_INDEX2(restoredFile.id), true);
        persistCloudActiveFileIds_INDEX2();
    }
    deletedFiles.splice(trashIndex, 1);
    prependVaultRecord_INDEX2(files, restoredFile);
    updateStatsAndDisplay();
    if (currentFilter === 'trash') {
        showTrash({ skipCloudRefresh: true });
    }
    showNotification('✅ تم استعادة الملف بنجاح!');
    var cloudSync = canUseCloudStorage_INDEX2() && wasCloud;
    runDeferredDeletePersist_INDEX2(function () {
        return persistAfterTrashRestore_INDEX2({ cloudSync: cloudSync, restoredFile: restoredFile });
    }, 'trash-restore');
}

async function persistAfterBackupRestore_INDEX2(opts) {
    var o = opts || {};
    var preservedData = o.restoredFile && o.restoredFile.data ? o.restoredFile.data : null;
    var preservedS3Key = o.restoredFile && o.restoredFile.s3Key ? o.restoredFile.s3Key : null;
    var restoredId = o.restoredFile && o.restoredFile.id;

    if (restoredId !== null && restoredId !== undefined) {
        var rkPrep = fileIdKey_INDEX2(restoredId);
        for (var prep = 0; prep < files.length; prep++) {
            if (fileIdKey_INDEX2(files[prep].id) !== rkPrep) {
                continue;
            }
            if (preservedData) {
                files[prep].data = preservedData;
            }
            if (preservedS3Key) {
                files[prep].s3Key = preservedS3Key;
            }
            if (o.restoredFile && o.restoredFile.storageBackend) {
                files[prep].storageBackend = o.restoredFile.storageBackend;
            }
            break;
        }
    }

    if (o.restoredFile && o.restoredFile.data && db) {
        try {
            await saveFileToIndexedDB(o.restoredFile);
        } catch (idbSaveErr) {
            console.warn('⚠️ حفظ الملف المستعاد في mediaFiles:', idbSaveErr);
        }
    }
    await saveFiles(true);

    if (o.fileId && db && db.objectStoreNames.contains('backupData')) {
        try {
            var tx = db.transaction(['backupData'], 'readwrite');
            tx.objectStore('backupData').delete(o.fileId);
        } catch (e) {
            console.warn('⚠️ حذف من backupData:', e);
        }
    }
    persistBackupFilesMetadata_INDEX2();

    if (o.cloudSync) {
        try {
            await syncFilesToCloud_INDEX2({
                includeAllLocal: true,
                forceSync: true,
                skipIdbReload: true
            });
        } catch (syncErr) {
            console.warn('[backup-restore] cloud sync:', syncErr);
        }
    }

    if (preservedData && restoredId !== null && restoredId !== undefined) {
        var rk = fileIdKey_INDEX2(restoredId);
        for (var fi = 0; fi < files.length; fi++) {
            if (fileIdKey_INDEX2(files[fi].id) !== rk) {
                continue;
            }
            files[fi].data = preservedData;
            if (preservedS3Key) {
                files[fi].s3Key = preservedS3Key;
            }
            break;
        }
        if (o.restoredFile && o.restoredFile.data && db) {
            try {
                await saveFileToIndexedDB(o.restoredFile);
            } catch (idbSaveErr2) {
                console.warn('⚠️ إعادة حفظ الملف بعد مزامنة النسخة الاحتياطية:', idbSaveErr2);
            }
        }
    }

    await saveFiles(true);
    await pruneStaleMediaFilesFromIndexedDB_INDEX2();
}

function applyRestoreFromBackup_INDEX2(restoredFile, fileId) {
    if (!restoredFile) {
        showNotification('❌ خطأ: تعذر تجهيز الملف للاستعادة');
        return;
    }
    restoredFile.restoredAt = new Date().toLocaleString('ar-EG');
    var wasCloud = isRestoredCloudVaultFile_INDEX2(restoredFile);
    if (wasCloud && !restoredFile.storageBackend) {
        restoredFile.storageBackend = 'r2';
    }
    prependVaultRecord_INDEX2(files, restoredFile);
    backupFiles = backupFiles.filter(function (f) {
        return f.id !== fileId;
    });
    var backupData = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
    backupData = backupData.filter(function (f) {
        return f.id !== fileId;
    });
    lsScopedSet_INDEX2('backup_files_INDEX2', JSON.stringify(backupData));
    if (wasCloud) {
        cloudActiveFileIds_INDEX2.set(fileIdKey_INDEX2(restoredFile.id), true);
        persistCloudActiveFileIds_INDEX2();
    }
    updateStatsAndDisplay();
    if (currentFilter === 'backup') {
        showBackup({ skipCloudRefresh: true });
    }
    showNotification('✅ تم استرجاع الملف: ' + restoredFile.name);
    var cloudSync = wasCloud && canUseCloudStorage_INDEX2();
    runDeferredDeletePersist_INDEX2(function () {
        return persistAfterBackupRestore_INDEX2({
            fileId: fileId,
            cloudSync: cloudSync,
            restoredFile: restoredFile
        });
    }, 'backup-restore');
}

/** دمج مصادر النسخة الاحتياطية (ذاكرة / مصفوفة / IndexedDB) */
function mergeBackupRestoreSources_INDEX2(idbRec, memRec, listRec) {
    return mergeTrashRestoreSources_INDEX2(
        mergeTrashRestoreSources_INDEX2(idbRec, listRec),
        memRec
    );
}

function attemptRestoreFromBackup_INDEX2(fileToRestore) {
    loadBackupRecordForRestore_INDEX2(fileToRestore)
        .then(function (mergedInitial) {
            if (!mergedInitial) {
                showNotification('❌ تعذر قراءة النسخة الاحتياطية');
                return;
            }
            return ensureRecordDataForRestore_INDEX2(mergedInitial, 'backup').then(function (merged) {
                if (!canRestoreTrashRecord_INDEX2(merged)) {
                    console.error('❌ استعادة نسخة احتياطية فاشلة:', fileToRestore.id, merged);
                    var cloudOnlyMeta =
                        fileIsStoredInCloud_INDEX2(merged) ||
                        fileIsStoredInCloud_INDEX2(fileToRestore) ||
                        (isFileKnownInCloud_INDEX2(merged) && canUseCloudStorage_INDEX2());
                    showNotification(
                        cloudOnlyMeta
                            ? '❌ النسخة الاحتياطية مسجّلة سحابياً لكن المحتوى غير موجود على R2 ولا توجد نسخة محلية. احذفها وأعد رفع الملف.'
                            : '❌ بيانات النسخة الاحتياطية غير متوفرة على هذا الجهاز'
                    );
                    return;
                }
                var restoredFile = buildRestoredFileFromTrashSource_INDEX2(merged);
                if (!restoredFile) {
                    showNotification('❌ خطأ: تعذر تجهيز الملف للاستعادة');
                    return;
                }
                delete restoredFile.deletedAt;
                delete restoredFile.backedUpAt;
                applyRestoreFromBackup_INDEX2(restoredFile, fileToRestore.id);
            });
        })
        .catch(function (err) {
            console.error('❌ استعادة من النسخة الاحتياطية:', err);
            showNotification('❌ خطأ في الاسترجاع: ' + (err && err.message ? err.message : 'حاول مرة أخرى'));
        });
}

/** يزيل من جدول deletedFiles أي سجلّ لم يعد في مصفوفة deletedFiles (بعد مزامنة السحابة). */
function pruneStaleDeletedFilesFromIndexedDB_INDEX2() {
    return new Promise(function (resolve) {
        if (!db) {
            resolve();
            return;
        }
        var allowed = new Map();
        (Array.isArray(deletedFiles) ? deletedFiles : []).forEach(function (f) {
            if (f && f.id !== null && f.id !== undefined) {
                allowed.set(fileIdKey_INDEX2(f.id), true);
            }
        });
        try {
            var transaction = db.transaction(['deletedFiles'], 'readwrite');
            var store = transaction.objectStore('deletedFiles');
            var keysReq = store.getAllKeys();
            keysReq.onsuccess = function (ev) {
                var keys = ev.target.result || [];
                keys.forEach(function (kid) {
                    if (!allowed.has(fileIdKey_INDEX2(kid))) {
                        store.delete(kid);
                    }
                });
            };
            transaction.oncomplete = function () {
                resolve();
            };
            transaction.onerror = function () {
                console.warn('⚠️ pruneStaleDeletedFiles:', transaction.error);
                resolve();
            };
        } catch (e) {
            console.warn('⚠️ pruneStaleDeletedFiles:', e);
            resolve();
        }
    });
}

/** مزامنة metadata النسخ الاحتياطية في localStorage مع مصفوفة backupFiles */
function persistBackupFilesMetadata_INDEX2() {
    try {
        var backupData = (Array.isArray(backupFiles) ? backupFiles : []).map(function (f) {
            return {
                id: f.id,
                name: f.name,
                type: f.type,
                size: f.size,
                uploadedAt: f.uploadedAt,
                deletedAt: f.deletedAt,
                backedUpAt: f.backedUpAt
            };
        });
        lsScopedSet_INDEX2('backup_files_INDEX2', JSON.stringify(backupData));
    } catch (e) {
        console.warn('⚠️ persistBackupFilesMetadata:', e);
    }
}

function pruneStaleMediaFilesFromIndexedDB_INDEX2() {
    return new Promise(function (resolve) {
        if (!db) {
            resolve();
            return;
        }
        var allowed = new Map();
        (Array.isArray(files) ? files : []).forEach(function (f) {
            if (f && f.id !== null && f.id !== undefined) {
                allowed.set(fileIdKey_INDEX2(f.id), true);
            }
        });
        try {
            var transaction = db.transaction(['mediaFiles'], 'readwrite');
            var store = transaction.objectStore('mediaFiles');
            var keysReq = store.getAllKeys();
            keysReq.onsuccess = function (ev) {
                var keys = ev.target.result || [];
                keys.forEach(function (kid) {
                    if (!allowed.has(fileIdKey_INDEX2(kid))) {
                        store.delete(kid);
                    }
                });
            };
            transaction.oncomplete = function () {
                resolve();
            };
            transaction.onerror = function () {
                console.warn('⚠️ pruneStaleMediaFiles:', transaction.error);
                resolve();
            };
        } catch (e) {
            console.warn('⚠️ pruneStaleMediaFiles:', e);
            resolve();
        }
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

async function waitForAuthDiscoveryIfNeeded() {
    if (!window.PR_SAFE_AUTH_DISCOVERY) return;
    try {
        await Promise.race([
            window.PR_SAFE_AUTH_DISCOVERY,
            new Promise(function (r) {
                setTimeout(r, 1200);
            })
        ]);
    } catch (ignore) {}
}

let resendVerifyCooldownTimer = null;

function clearResendVerifyCooldown() {
    if (resendVerifyCooldownTimer) {
        clearInterval(resendVerifyCooldownTimer);
        resendVerifyCooldownTimer = null;
    }
    const btn = document.getElementById('resendVerifyCodeBtn');
    const hint = document.getElementById('resendVerifyCooldownHint');
    if (btn) {
        btn.disabled = false;
        btn.style.opacity = '1';
    }
    if (hint) {
        hint.style.display = 'none';
        hint.textContent = '';
    }
}

function startResendVerifyCooldown(totalSeconds) {
    const btn = document.getElementById('resendVerifyCodeBtn');
    const hint = document.getElementById('resendVerifyCooldownHint');
    clearResendVerifyCooldown();
    const end = Date.now() + totalSeconds * 1000;
    function tick() {
        const left = Math.max(0, Math.ceil((end - Date.now()) / 1000));
        if (btn) {
            btn.disabled = left > 0;
            btn.style.opacity = left > 0 ? '0.65' : '1';
        }
        if (hint) {
            if (left > 0) {
                hint.style.display = 'block';
                hint.textContent = 'يمكنك إعادة إرسال الكود بعد ' + left + ' ثانية.';
            } else {
                hint.style.display = 'none';
                hint.textContent = '';
            }
        }
        if (left <= 0) {
            clearResendVerifyCooldown();
        }
    }
    tick();
    resendVerifyCooldownTimer = setInterval(tick, 1000);
}

async function resendVerificationCode() {
    const btn = document.getElementById('resendVerifyCodeBtn');
    if (btn && btn.disabled) return;

    const email = (document.getElementById('verifyEmailDisplay')?.textContent || '').trim();
    if (!email) {
        alert('⚠️ لم يُعثر على البريد.');
        return;
    }
    const pending = getPendingEmailVerification_INDEX2();
    const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    const loginPw = document.getElementById('loginPassword')?.value || '';
    const password =
        (pending && pending.email === email && pending.password) ||
        (account && account.email === email && account.password) ||
        loginPw;
    if (!password) {
        alert('⚠️ لا يمكن إعادة الإرسال: سجّل الدخول بكلمة السر أولاً أو أنشئ حساباً من هذا الجهاز.');
        return;
    }

    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        alert('⚠️ لم يُضبط عنوان خادم التحقق.');
        return;
    }

    try {
        await waitForAuthDiscoveryIfNeeded();
        const res = await fetch(AUTH.apiBase + '/api/resend-code', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email, password: password })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
            startResendVerifyCooldown(Number(data.retryAfterSec) || 60);
            showNotification('⏳ انتظر قبل إعادة طلب الكود');
            return;
        }
        if (res.status === 401) {
            alert('❌ كلمة السر لا تطابق الخادم. تأكد من كلمة السر ثم أعد المحاولة.');
            return;
        }
        if (res.status === 400 && data.error === 'already_verified') {
            const pend = getPendingEmailVerification_INDEX2();
            const accFix = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            if (pend && pend.email === email) {
                localStorage.setItem(
                    'userAccount_INDEX2',
                    JSON.stringify({
                        email: pend.email,
                        password: pend.password,
                        securityAnswer: pend.securityAnswer || '',
                        createdAt: pend.createdAt || new Date().toLocaleString('ar-EG'),
                        emailVerified: true
                    })
                );
                clearPendingEmailVerification_INDEX2();
            } else if (accFix && accFix.email === email) {
                accFix.emailVerified = true;
                localStorage.setItem('userAccount_INDEX2', JSON.stringify(accFix));
            }
            alert(
                '✅ هذا البريد مفعّل مسبقاً على الخادم.\n\nجرّب «عودة لتسجيل الدخول» ثم الدخول بكلمة السر. إذا ظلّت المشكلة، امسح بيانات الموقع لهذا العنوان من إعدادات المتصفح.'
            );
            return;
        }
        if (res.status === 404) {
            const pend404 = getPendingEmailVerification_INDEX2();
            const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            const sec =
                pend404 && pend404.email === email && pend404.securityAnswer != null
                    ? String(pend404.securityAnswer).trim()
                    : acc && acc.securityAnswer != null
                      ? String(acc.securityAnswer).trim()
                      : '';
            if ((!acc || acc.email !== email) && (!pend404 || pend404.email !== email)) {
                alert(
                    '⚠️ لا يوجد طلب تفعيل لهذا البريد على الخادم، ولا يمكن إعادة الربط تلقائياً (نص التحقق غير محفوظ محلياً).\n\n' +
                        'الحل: من «إنشاء حساب» سجّل من جديد (بنفس البريد إذا كان الخادم يقبل)، أو استخدم بريداً جديداً مع تشغيل auth-server.'
                );
                return;
            }
            if (!sec) {
                alert(
                    '⚠️ لا يوجد طلب تفعيل لهذا البريد على الخادم، ولا يمكن إعادة الربط تلقائياً (نص التحقق غير محفوظ محلياً).\n\n' +
                        'الحل: من «إنشاء حساب» سجّل من جديد (بنفس البريد إذا كان الخادم يقبل)، أو استخدم بريداً جديداً مع تشغيل auth-server.'
                );
                return;
            }
            const res2 = await fetch(AUTH.apiBase + '/api/register', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    email: email,
                    password: password,
                    securityAnswer: sec
                })
            });
            const data2 = await res2.json().catch(() => ({}));
            if (res2.status === 409) {
                alert(
                    'ℹ️ الخادم يعتبر هذا البريد مفعّلاً. اضغط «عودة لتسجيل الدخول» وجرّب الدخول؛ إذا لم ينجح، امسح بيانات الموقع لهذا الموقع وأعد التسجيل.'
                );
                return;
            }
            if (!res2.ok || !data2.ok) {
                alert('❌ تعذر إعادة الربط بالخادم: ' + (data2.error || res2.status));
                return;
            }
            if (data2.emailSent) {
                showNotification('📧 تم ربط الحساب بالخادم وأُرسل كود التفعيل إلى بريدك');
            } else {
                showNotification('⚠️ تم الربط بالخادم لكن لم يُرسل البريد تلقائياً');
                alert(data2.mailError || 'راجع SMTP في ملف .env ونافذة auth-server.');
            }
            startResendVerifyCooldown(60);
            return;
        }
        if (!res.ok || !data.ok) {
            alert('❌ تعذر إعادة الإرسال: ' + (data.error || res.status));
            return;
        }
        if (data.emailSent) {
            showNotification('📧 أُعيد إرسال كود التفعيل إلى بريدك');
            startResendVerifyCooldown(60);
        } else {
            const why = data.mailError || 'تحقق من SMTP في الخادم.';
            alert('لم يُرسل البريد.\n\n' + why);
        }
    } catch (e) {
        console.error(e);
        alert('❌ تعذر الاتصال بخادم التحقق.');
    }
}

function getRegisterAuthSection_INDEX2() {
    return document.getElementById('registerForm')?.closest('.login-container') || null;
}

function showRegisterAuthSection_INDEX2() {
    var section = getRegisterAuthSection_INDEX2();
    var card = document.getElementById('registerForm')?.parentElement;
    if (section) {
        section.style.display = '';
    }
    if (card) {
        card.style.display = '';
    }
}

function hideRegisterAuthSection_INDEX2() {
    var section = getRegisterAuthSection_INDEX2();
    if (section) {
        section.style.display = 'none';
    }
}

function hideForgotPasswordUI() {
    const sec = document.getElementById('forgotPasswordSection');
    if (sec) sec.style.display = 'none';
}

function toggleLoginMode() {
    const loginMode = document.getElementById('loginMode');
    const verifySec = document.getElementById('emailVerifySection');
    if (verifySec) verifySec.style.display = 'none';
    hideForgotPasswordUI();

    if (!getRegisterAuthSection_INDEX2() || !loginMode) {
        console.error('❌ العناصر المطلوبة غير موجودة');
        return;
    }
    
    if (loginMode.style.display === 'none') {
        loginMode.style.display = 'flex';
        hideRegisterAuthSection_INDEX2();
    } else {
        loginMode.style.display = 'none';
        showRegisterAuthSection_INDEX2();
    }
}

/** حسابات قديمة بدون الحقل تُعتبر مفعّلة */
function isEmailVerified(account) {
    if (!account) return false;
    if (account.emailVerified === false) return false;
    return true;
}

function showEmailVerificationUI(email, options = {}) {
    const loginMode = document.getElementById('loginMode');
    const verifySec = document.getElementById('emailVerifySection');
    hideRegisterAuthSection_INDEX2();
    hideForgotPasswordUI();
    if (loginMode) loginMode.style.display = 'none';
    if (verifySec) {
        verifySec.style.display = 'block';
        const hint = document.getElementById('verifyEmailHint');
        const emailEl = document.getElementById('verifyEmailDisplay');
        if (emailEl) emailEl.textContent = email || '';
        if (hint) {
            let h = 'أدخل الكود المُرسل إلى بريدك. يمكنك «إعادة إرسال الكود» من الزر أدناه عند الحاجة.';
            if (options.reopened) {
                h = 'يجب تفعيل بريدك قبل استخدام التطبيق.';
            }
            if (options.emailSent === false) {
                h += ' ⚠️ لم يُرسل البريد تلقائياً (راجع SMTP في الخادم). يمكن للمدير إرسال الكود يدوياً من لوحة التحكم.';
            }
            hint.textContent = h;
        }
        clearResendVerifyCooldown();
    }
    showPage('loginPage');
}

function hideEmailVerificationUI() {
    const verifySec = document.getElementById('emailVerifySection');
    if (verifySec) verifySec.style.display = 'none';
}

function cancelEmailVerification() {
    hideEmailVerificationUI();
    const loginMode = document.getElementById('loginMode');
    hideRegisterAuthSection_INDEX2();
    hideForgotPasswordUI();
    if (loginMode) loginMode.style.display = 'flex';
}

const forgotPasswordState = { email: '' };

function showForgotPasswordError(msg) {
    const el = document.getElementById('forgotPasswordErrorMsg');
    if (el) {
        el.textContent = msg;
        el.style.display = msg ? 'block' : 'none';
    }
}

function showForgotPasswordUI() {
    const loginMode = document.getElementById('loginMode');
    const verifySec = document.getElementById('emailVerifySection');
    const sec = document.getElementById('forgotPasswordSection');
    hideRegisterAuthSection_INDEX2();
    if (loginMode) loginMode.style.display = 'none';
    if (verifySec) verifySec.style.display = 'none';
    forgotPasswordState.email = '';
    const s1 = document.getElementById('forgotPasswordStep1');
    const s2 = document.getElementById('forgotPasswordStep2');
    if (s1) s1.style.display = 'block';
    if (s2) s2.style.display = 'none';
    showForgotPasswordError('');
    if (sec) {
        sec.style.display = 'block';
        showPage('loginPage');
    }
}

function cancelForgotPassword() {
    hideForgotPasswordUI();
    const loginMode = document.getElementById('loginMode');
    hideRegisterAuthSection_INDEX2();
    if (loginMode) loginMode.style.display = 'flex';
    showPage('loginPage');
}

async function requestForgotPasswordCode(email) {
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showForgotPasswordError('⚠️ لم يُضبط عنوان خادم التحقق.');
        return false;
    }
    try {
        await waitForAuthDiscoveryIfNeeded();
        const res = await fetch(`${AUTH.apiBase}/api/request-password-reset`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email: email.trim() })
        });
        const rawText = await res.text().catch(() => '');
        let data = {};
        try {
            data = rawText ? JSON.parse(rawText) : {};
        } catch (parseErr) {
            data = {};
        }
        if (res.status === 429) {
            showForgotPasswordError('⏳ انتظر ' + (data.retryAfterSec || 60) + ' ثانية ثم أعد المحاولة.');
            return false;
        }
        if (!res.ok) {
            if (res.status === 404 && !data.error && /Cannot POST/i.test(rawText)) {
                showForgotPasswordError(
                    '⚠️ خادم التحقق يعمل بنسخة قديمة. أوقف العملية على المنفذ 3000 ثم شغّل: npm run auth-server'
                );
                return false;
            }
            const map = {
                invalid_email: 'البريد غير صالح.',
                not_found: 'البريد غير مسجّل أو غير مفعّل على الخادم. استخدم نفس البريد الذي فعّلته عند التسجيل.'
            };
            showForgotPasswordError(map[data.error] || ('تعذر الإرسال: ' + (data.error || res.status)));
            return false;
        }
        forgotPasswordState.email = email.trim();
        const s1 = document.getElementById('forgotPasswordStep1');
        const s2 = document.getElementById('forgotPasswordStep2');
        const disp = document.getElementById('forgotPasswordEmailDisplay');
        if (s1) s1.style.display = 'none';
        if (s2) s2.style.display = 'block';
        if (disp) disp.textContent = forgotPasswordState.email;
        showForgotPasswordError('');
        if (typeof showNotification === 'function') {
            showNotification('📧 تم إرسال كود إعادة التعيين إلى بريدك');
        }
        return true;
    } catch (e) {
        console.error(e);
        showForgotPasswordError('❌ تعذر الاتصال بالخادم. شغّل: npm run auth-server');
        return false;
    }
}

async function completeForgotPasswordLogin(account, password, subscription) {
    const email = account.email;
    const emailNorm = String(email || '').trim().toLowerCase();
    let prevAccount = null;
    try {
        prevAccount = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    } catch (ePrev) {}
    const oldPassword =
        prevAccount &&
        String(prevAccount.email || '').trim().toLowerCase() === emailNorm &&
        prevAccount.password &&
        prevAccount.password !== password
            ? prevAccount.password
            : null;
    if (oldPassword) {
        try {
            lsScopedSet_INDEX2('vaultLegacyPassword_INDEX2', oldPassword);
        } catch (eLeg) {}
    }

    const fullAccount = {
        email: email,
        password: password,
        securityAnswer: account.securityAnswer || '',
        emailVerified: true,
        createdAt: account.createdAt || new Date().toISOString(),
        vaultKeySeed: account.vaultKeySeed || (prevAccount && prevAccount.vaultKeySeed) || null
    };
    localStorage.setItem('userAccount_INDEX2', JSON.stringify(fullAccount));
    localStorage.setItem('currentUserEmail_INDEX2', email);
    if (typeof activateUserStorageScope_INDEX2 === 'function') {
        activateUserStorageScope_INDEX2(email);
    }
    if (subscription) {
        const isTrialSub =
            typeof isTrialSubscriptionRecord_INDEX2 === 'function' &&
            isTrialSubscriptionRecord_INDEX2(subscription);
        if (!isTrialSub) {
            lsScopedSet_INDEX2('userSubscription_INDEX2', JSON.stringify(subscription));
        } else if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
            stripTrialSubscriptionFromStorage_INDEX2();
        }
    }

    try {
        if (!db) {
            await initDatabase();
        }
        if (oldPassword) {
            const stats = await reEncryptVaultFilesAfterPasswordChange_INDEX2(
                fullAccount,
                oldPassword,
                password
            );
            console.log('[نسيت كلمة السر] ترحيل الملفات:', stats);
            if (typeof showNotification === 'function') {
                showNotification(
                    '🔐 تم تحديث ' + (stats.updated || 0) + ' ملفاً لتعمل بكلمة السر الجديدة'
                );
            }
        } else if (fullAccount.vaultKeySeed) {
            await migrateVaultEncryptionToSeedIfNeeded_INDEX2(fullAccount);
        }
    } catch (migErr) {
        console.warn('[نسيت كلمة السر] ترحيل الملفات:', migErr);
        if (typeof showNotification === 'function') {
            showNotification(
                '⚠️ بعض الملفات القديمة قد تحتاج فتحها بكلمة السر القديمة مرة واحدة لإتمام الترحيل'
            );
        }
    }

    applyVaultEncryptionKeyFromAccount_INDEX2(fullAccount);
    hideForgotPasswordUI();
    finalizeLoginSession_INDEX2(email, password);
    if (typeof showNotification === 'function') {
        showNotification('✅ تم تعيين كلمة السر — خطتك واشتراكك كما هي');
    }
    if (typeof loadFilesFromCloud_INDEX2 === 'function') {
        setTimeout(function () {
            loadFilesFromCloud_INDEX2({ skipDisplay: false }).then(function (added) {
                if (added && typeof showNotification === 'function') {
                    showNotification('☁️ تم استيراد ملفاتك من السحابة');
                }
            }).catch(function () {});
        }, 600);
    }
}

let forgotPasswordHandlersInitialized = false;
function initForgotPasswordHandlers() {
    if (forgotPasswordHandlersInitialized) return;
    forgotPasswordHandlersInitialized = true;

    const reqForm = document.getElementById('forgotPasswordRequestForm');
    if (reqForm) {
        reqForm.addEventListener('submit', async function (ev) {
            ev.preventDefault();
            const email = document.getElementById('forgotPasswordEmail')?.value?.trim() || '';
            if (!email || !isValidEmail(email)) {
                showForgotPasswordError('⚠️ أدخل بريداً إلكترونياً صالحاً.');
                return;
            }
            await requestForgotPasswordCode(email);
        });
    }

    const confirmForm = document.getElementById('forgotPasswordConfirmForm');
    if (confirmForm) {
        confirmForm.addEventListener('submit', async function (ev) {
            ev.preventDefault();
            const email = forgotPasswordState.email || '';
            const code = document.getElementById('forgotPasswordCode')?.value?.trim() || '';
            const newPassword = document.getElementById('forgotPasswordNew')?.value || '';
            const confirmPw = document.getElementById('forgotPasswordConfirm')?.value || '';
            const securityAnswer = document.getElementById('forgotPasswordSecurity')?.value?.trim() || '';
            if (!email) {
                showForgotPasswordError('ابدأ بإدخال بريدك وإرسال الكود.');
                return;
            }
            if (!code || code.length !== 6) {
                showForgotPasswordError('أدخل كود التفعيل (6 أرقام).');
                return;
            }
            if (newPassword.length < 6) {
                showForgotPasswordError('كلمة السر يجب أن تكون 6 أحرف على الأقل.');
                return;
            }
            if (newPassword !== confirmPw) {
                showForgotPasswordError('كلمتا السر غير متطابقتين.');
                return;
            }
            if (!securityAnswer) {
                showForgotPasswordError('أدخل نص التحقق الجديد.');
                return;
            }
            const AUTH = window.PR_SAFE_AUTH || {};
            if (!AUTH.apiBase) {
                showForgotPasswordError('⚠️ لم يُضبط عنوان خادم التحقق.');
                return;
            }
            try {
                await waitForAuthDiscoveryIfNeeded();
                const res = await fetch(`${AUTH.apiBase}/api/confirm-password-reset`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        code,
                        password: newPassword,
                        securityAnswer
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (!res.ok) {
                    const map = {
                        wrong_code: 'الكود غير صحيح.',
                        expired: 'انتهت صلاحية الكود. أعد إرسال الكود.',
                        no_pending: 'لا يوجد طلب نشط. ارجع وأرسل الكود من جديد.',
                        not_found: 'لم يُعثر على الحساب.',
                        password_too_short: 'كلمة السر قصيرة جداً.',
                        missing_fields: 'أكمل جميع الحقول.'
                    };
                    showForgotPasswordError(map[data.error] || ('تعذر التأكيد: ' + (data.error || res.status)));
                    return;
                }
                confirmForm.reset();
                await completeForgotPasswordLogin(data.account || { email }, newPassword, data.subscription);
            } catch (e) {
                console.error(e);
                showForgotPasswordError('❌ تعذر الاتصال بالخادم.');
            }
        });
    }

    const resendBtn = document.getElementById('forgotPasswordResendBtn');
    if (resendBtn) {
        resendBtn.addEventListener('click', async function () {
            const email = forgotPasswordState.email || '';
            if (!email) {
                showForgotPasswordError('أدخل بريدك في الخطوة الأولى أولاً.');
                return;
            }
            await requestForgotPasswordCode(email);
        });
    }
}

let emailVerifyFormInitialized = false;
function initEmailVerificationForm() {
    const form = document.getElementById('emailVerifyForm');
    if (!form || emailVerifyFormInitialized) return;
    emailVerifyFormInitialized = true;
    form.addEventListener('submit', async function(ev) {
        ev.preventDefault();
        const email = (document.getElementById('verifyEmailDisplay')?.textContent || '').trim();
        const code = document.getElementById('verifyCodeInput')?.value?.trim() || '';
        const AUTH = window.PR_SAFE_AUTH || {};
        if (!AUTH.apiBase) {
            alert('⚠️ لم يُضبط عنوان خادم التحقق (pr-safe-auth-config.js).');
            return;
        }
        try {
            await waitForAuthDiscoveryIfNeeded();
            const res = await fetch(`${AUTH.apiBase}/api/verify`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email, code })
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) {
                if (data.error === 'wrong_code') {
                    alert('❌ كود التفعيل غير صحيح.');
                } else {
                    alert('❌ تعذر التحقق: ' + (data.error || res.status));
                }
                return;
            }
            const pending = getPendingEmailVerification_INDEX2();
            const accExisting = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            let account = null;
            if (pending && pending.email === email) {
                account = {
                    email: pending.email,
                    password: pending.password,
                    securityAnswer: pending.securityAnswer || '',
                    createdAt: pending.createdAt || new Date().toLocaleString('ar-EG'),
                    emailVerified: true
                };
            } else if (accExisting && accExisting.email === email) {
                account = accExisting;
                account.emailVerified = true;
            }
            if (!account) {
                alert('❌ بيانات التسجيل المحلي غير متطابقة. أعد إنشاء الحساب من «حساب جديد».');
                return;
            }
            if (data.account) {
                mergeVaultKeySeedIntoAccount_INDEX2(account, data.account);
            }
            localStorage.setItem('userAccount_INDEX2', JSON.stringify(account));
            clearPendingEmailVerification_INDEX2();
            currentUser = email;
            userPassword = account.password;
            localStorage.setItem('currentUserEmail_INDEX2', email);
            if (typeof activateUserStorageScope_INDEX2 === 'function') activateUserStorageScope_INDEX2(email);
            applyVaultEncryptionKeyFromAccount_INDEX2(account);
            migrateVaultEncryptionToSeedIfNeeded_INDEX2(account).catch(function () {});
            hideEmailVerificationUI();
            showPage('calculatorPage');
            showNotification('✅ تم تفعيل البريد والدخول بنجاح!');
            form.reset();
        } catch (err) {
            console.error(err);
            alert('❌ تعذر الاتصال بخادم التحقق. هل شغّلت npm run auth-server؟');
        }
    });

    const resendBtn = document.getElementById('resendVerifyCodeBtn');
    if (resendBtn && !resendBtn.dataset.bound) {
        resendBtn.dataset.bound = '1';
        resendBtn.addEventListener('click', function () {
            resendVerificationCode();
        });
    }
}

/** إكمال جلسة الدخول بعد التحقق من البريد وكلمة السر (محلي أو بعد استيراد الحساب من الخادم). */
function finalizeLoginSession_INDEX2(email, password) {
    currentUser = email;
    userPassword = password;
    localStorage.setItem('currentUserEmail_INDEX2', email);
    if (typeof activateUserStorageScope_INDEX2 === 'function') {
        activateUserStorageScope_INDEX2(email);
    }
    if (typeof syncSubscriptionFromServer_INDEX2 === 'function') {
        syncSubscriptionFromServer_INDEX2(email, password)
            .then(function (syncResult) {
                if (syncResult && syncResult.ok && syncResult.applied) {
                    console.log('[login] تمت مزامنة الاشتراك من الخادم');
                }
                if (typeof refreshSubscriptionUiAfterServerSync_INDEX2 === 'function') {
                    refreshSubscriptionUiAfterServerSync_INDEX2();
                }
            })
            .catch(function (eSync) {
                console.warn('[login] subscription sync:', eSync);
            });
    }
    try {
        var accLogin = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (accLogin) {
            accLogin.password = password;
            applyVaultEncryptionKeyFromAccount_INDEX2(accLogin);
            migrateVaultFromLegacyPasswordIfStored_INDEX2(accLogin)
                .then(function (st) {
                    if (st && st.updated > 0 && typeof showNotification === 'function') {
                        showNotification('🔐 تم ربط الملفات القديمة بكلمة السر الحالية فقط');
                    }
                    return migrateVaultEncryptionToSeedIfNeeded_INDEX2(accLogin);
                })
                .then(function () {
                    clearVaultLegacyPassword_INDEX2();
                })
                .catch(function (eM) {
                    console.warn('[vault-migrate]', eM);
                });
        } else {
            generateEncryptionKey(password);
        }
    } catch (eFin) {
        generateEncryptionKey(password);
    }
    console.log('✅ تم توليد مفتاح التشفير عند تسجيل الدخول');
    alert('✅ مرحباً ' + email);
    const currentSub = lsScopedGet_INDEX2('userSubscription_INDEX2');
    showPage('calculatorPage');
    if (!currentSub) {
        setTimeout(function () {
            if (typeof showNotification === 'function') {
                showNotification('📋 يمكنك الاشتراك في خطة من القائمة ← خططنا والاشتراكات');
            }
        }, 400);
    }
}

// وظيفة لتهيئة معالجات التسجيل والدخول
function initAuthHandlers() {
    const registerForm = document.getElementById('registerForm');
    const loginForm = document.getElementById('loginForm');
    
    if (registerForm) {
        registerForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const email = document.getElementById('email')?.value || '';
            const password = document.getElementById('password')?.value || '';
            const confirmPassword = document.getElementById('confirmPassword')?.value || '';
            
            if (!email || !password || !confirmPassword) {
                alert('⚠️ يرجى ملء جميع الحقول!');
                return;
            }
            
            if (password !== confirmPassword) {
                alert('⚠️ كلمات السر غير متطابقة!');
                return;
            }
            
            if (!isValidEmail(email)) {
                alert('⚠️ البريد الإلكتروني غير صحيح!');
                return;
            }
              if (password.length < 6) {
                alert('⚠️ كلمة السر يجب أن تكون 6 أحرف على الأقل!');
                return;
            }
            
            const securityAnswer = document.getElementById('securityAnswer')?.value || '';
            if (!securityAnswer.trim()) {
                alert('⚠️ يرجى إدخال نص التحقق!');
                return;
            }
            
            const cleanedSecurityAnswer = securityAnswer.trim();
            const AUTH = window.PR_SAFE_AUTH || {};
            if (!AUTH.apiBase) {
                alert('⚠️ لم يُضبط عنوان خادم التحقق (ملف pr-safe-auth-config.js).');
                return;
            }

            try {
                const existingAcc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
                if (existingAcc && typeof isEmailVerified === 'function' && isEmailVerified(existingAcc)) {
                    alert(
                        '⚠️ هذا الجهاز مرتبط بحساب مفعّل بالفعل.\n\nلاستخدام بريد آخر: افتح قائمة المستخدم (☰) واختر «تغيير البريد الإلكتروني» — ولا تُنشئ حساباً جديداً من هنا.'
                    );
                    if (typeof showNotification === 'function') {
                        showNotification('للبريد الجديد استخدم «تغيير البريد» من القائمة');
                    }
                    return;
                }
            } catch (ignore) {}

            try {
                await waitForAuthDiscoveryIfNeeded();

                const res = await fetch(`${AUTH.apiBase}/api/register`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        email,
                        password,
                        securityAnswer: cleanedSecurityAnswer
                    })
                });
                const data = await res.json().catch(() => ({}));
                if (res.status === 409) {
                    alert('⚠️ هذا البريد مسجّل ومفعّل مسبقاً. استخدم تسجيل الدخول.');
                    return;
                }
                if (!res.ok || !data.ok) {
                    alert('❌ تعذر التسجيل على الخادم: ' + (data.error || res.status));
                    return;
                }

                setPendingEmailVerification_INDEX2({
                    email,
                    password,
                    securityAnswer: cleanedSecurityAnswer,
                    createdAt: new Date().toLocaleString('ar-EG')
                });
                localStorage.removeItem('userAccount_INDEX2');
                localStorage.removeItem('currentUserEmail_INDEX2');
                console.log('✅ طلب التسجيل محفوظ — يُعتبر الحساب مسجّلاً في البرنامج بعد إدخال كود التفعيل فقط');

                this.reset();
                showEmailVerificationUI(email, { emailSent: data.emailSent === true });
                if (data.emailSent) {
                    showNotification('📧 تم إرسال كود التفعيل إلى بريدك');
                } else {
                    const why =
                        data.mailError ||
                        'تحقق من إعدادات SMTP في .env ونافذة auth-server، أو أرسل الكود يدوياً من لوحة المدير';
                    console.warn('[تسجيل] لم يُرسل البريد:', why);
                    showNotification('⚠️ لم يُرسل البريد تلقائياً — راجع الطرفية أو لوحة المدير');
                    alert('لم يُرسل البريد تلقائياً.\n\nالسبب (من الخادم):\n' + why);
                }
            } catch (err) {
                console.error(err);
                alert('❌ تعذر الاتصال بخادم التحقق. شغّل: npm run auth-server');
            }
        });
    } else {
        console.warn('⚠️ نموذج التسجيل غير موجود');
    }
    
    if (loginForm) {
        loginForm.addEventListener('submit', async function (e) {
            e.preventDefault();

            const email = document.getElementById('loginEmail')?.value || '';
            const password = document.getElementById('loginPassword')?.value || '';

            if (!email || !password) {
                alert('⚠️ يرجى ملء جميع الحقول!');
                return;
            }

            let account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            const pendingLogin = getPendingEmailVerification_INDEX2();
            const normalizedEmail = String(email || '').trim().toLowerCase();
            const accountEmail = String(account && account.email ? account.email : '').trim().toLowerCase();
            const localAccountMatchesEmail = !!(account && accountEmail && accountEmail === normalizedEmail);

            if (!account && pendingLogin && pendingLogin.email === email && pendingLogin.password === password) {
                this.reset();
                showEmailVerificationUI(email, { emailSent: true, reopened: true });
                showNotification('📧 أكمل التسجيل بإدخال كود التفعيل — لم يُعتبر الحساب مفعّلاً بعد');
                return;
            }

            if (!localAccountMatchesEmail) {
                try {
                    await waitForAuthDiscoveryIfNeeded();
                    const AUTH = window.PR_SAFE_AUTH || {};
                    if (!AUTH.apiBase) {
                        alert(
                            '⚠️ لا يوجد حساب على هذا الجهاز.\n\nلم يُضبط عنوان خادم التحقق، أو شغّل: npm run auth-server'
                        );
                        return;
                    }
                    const res = await fetch(AUTH.apiBase + '/api/cross-device-login', {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                            email: email.trim(),
                            password: password,
                            deviceBindingId: getOrCreateDeviceBindingId_INDEX2()
                        })
                    });
                    const data = await res.json().catch(function () {
                        return {};
                    });
                    if (
                        res.status === 403 &&
                        (
                            data.error === 'index5_required' ||
                            data.error === 'subscription_or_trial_required' ||
                            data.error === 'device_restricted_plan'
                        )
                    ) {
                        alert(
                            '☁️ تسجيل الدخول من جهاز جديد يخضع لنوع الخطة.\n\n' +
                                '• إن كنت ضمن فترة التجربة: تأكد أن الحساب مفعّل ولم تتجاوز 10 أيام من تاريخ إنشائه.\n' +
                                '• الخطة الأساسية / المتقدمة تعمل على جهاز الاشتراك فقط.\n' +
                                '• الخطة المميزة تعمل على كل الأجهزة.\n' +
                                '• إن لم تكن مشتركاً: أنشئ حساباً على هذا الجهاز أو سجّل من جهاز سبق تسجيله عليه.\n\n' +
                                (data.message || '')
                        );
                        return;
                    }
                    if (!res.ok || !data.ok) {
                        if (data.error === 'invalid_credentials') {
                            alert('⚠️ البريد الإلكتروني أو كلمة السر غير صحيحة!');
                        } else {
                            alert(
                                '⚠️ تعذر جلب الحساب من الخادم.\n\nتحقق من الاتصال وتشغيل auth-server، أو أنشئ حساباً من هذا الجهاز.'
                            );
                        }
                        return;
                    }
                    const acc = data.account || {};
                    const fullAccount = {
                        email: acc.email || email.trim(),
                        password: password,
                        securityAnswer: acc.securityAnswer || '',
                        emailVerified: true,
                        createdAt: acc.createdAt || new Date().toISOString(),
                        vaultKeySeed: acc.vaultKeySeed || null
                    };
                    localStorage.setItem('userAccount_INDEX2', JSON.stringify(fullAccount));
                    localStorage.setItem('currentUserEmail_INDEX2', email.trim());
                    if (typeof activateUserStorageScope_INDEX2 === 'function') {
                        activateUserStorageScope_INDEX2(email.trim());
                    }
                    if (data.subscription) {
                        const isTrialSub =
                            typeof isTrialSubscriptionRecord_INDEX2 === 'function' &&
                            isTrialSubscriptionRecord_INDEX2(data.subscription);
                        if (!isTrialSub) {
                            lsScopedSet_INDEX2(
                                'userSubscription_INDEX2',
                                JSON.stringify(data.subscription)
                            );
                        } else if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
                            stripTrialSubscriptionFromStorage_INDEX2();
                        }
                    }
                    finalizeLoginSession_INDEX2(email.trim(), password);
                    this.reset();
                    return;
                } catch (err) {
                    console.error('cross-device-login:', err);
                    alert(
                        '⚠️ تعذر تسجيل الدخول عبر الخادم من هذا الجهاز.\n\nشغّل npm run auth-server أو تأكد من نفس الشبكة، ثم أعد المحاولة.'
                    );
                    return;
                }
            }

            account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            if (account.email === email && account.password === password) {
                if (!isEmailVerified(account)) {
                    this.reset();
                    showEmailVerificationUI(email, { emailSent: true, reopened: true });
                    showNotification('📧 يجب إدخال كود تفعيل البريد أولاً');
                    return;
                }
                finalizeLoginSession_INDEX2(email, password);
                this.reset();
            } else {
                alert('⚠️ البريد الإلكتروني أو كلمة السر غير صحيحة!');
            }
        });
    } else {
        console.warn('⚠️ نموذج تسجيل الدخول غير موجود');
    }
}

function isValidEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

function hideChangePasswordError_INDEX2() {
    const el = document.getElementById('changePasswordErrorMsg');
    if (el) {
        el.style.display = 'none';
        el.textContent = '';
    }
}

function showChangePasswordError_INDEX2(msg) {
    const el = document.getElementById('changePasswordErrorMsg');
    if (el) {
        el.textContent = msg;
        el.style.display = 'block';
    }
}

function closeChangePasswordModal_INDEX2() {
    const modal = document.getElementById('changePasswordModal');
    if (modal) {
        modal.style.display = 'none';
    }
    hideChangePasswordError_INDEX2();
}

function openChangePasswordModal_INDEX2() {
    const dropdown = document.getElementById('userDropdown');
    const userMenu = dropdown ? dropdown.closest('.user-menu') : null;
    if (dropdown) {
        dropdown.classList.remove('show');
    }
    if (userMenu) {
        userMenu.classList.remove('active');
    }

    const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    if (!account) {
        showNotification('لا يوجد حساب مسجل. أنشئ حساباً أولاً.', 'info');
        return;
    }

    const modal = document.getElementById('changePasswordModal');
    if (!modal) {
        return;
    }

    hideChangePasswordError_INDEX2();
    const sec = document.getElementById('changePasswordSecurityInput');
    const np = document.getElementById('changePasswordNewInput');
    const cp = document.getElementById('changePasswordConfirmInput');
    if (sec) sec.value = '';
    if (np) np.value = '';
    if (cp) cp.value = '';

    modal.style.display = 'flex';
}

function changePassword() {
    openChangePasswordModal_INDEX2();
}

async function submitChangePassword_INDEX2() {
    hideChangePasswordError_INDEX2();

    const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    if (!account) {
        showChangePasswordError_INDEX2('لا يوجد حساب مسجل.');
        return;
    }

    const securityAnswer = (document.getElementById('changePasswordSecurityInput') || {}).value || '';
    const newPassword = (document.getElementById('changePasswordNewInput') || {}).value || '';
    const confirmPassword = (document.getElementById('changePasswordConfirmInput') || {}).value || '';

    if (!securityAnswer.trim()) {
        showChangePasswordError_INDEX2('أدخل نص التحقق الذي حفظته عند التسجيل.');
        return;
    }

    const userInput = securityAnswer.trim().toLowerCase();
    const storedAnswer = (account.securityAnswer || '').trim().toLowerCase();

    if (!storedAnswer) {
        showChangePasswordError_INDEX2('لا يوجد نص تحقق مسجل لهذا الحساب.');
        return;
    }

    if (userInput !== storedAnswer) {
        showChangePasswordError_INDEX2('نص التحقق غير صحيح. تحقق من الأحرف والمسافات.');
        return;
    }

    if (!newPassword) {
        showChangePasswordError_INDEX2('أدخل كلمة السر الجديدة.');
        return;
    }

    if (newPassword.length < 6) {
        showChangePasswordError_INDEX2('كلمة السر يجب أن تكون 6 أحرف على الأقل.');
        return;
    }

    if (newPassword !== confirmPassword) {
        showChangePasswordError_INDEX2('كلمة السر وتأكيدها غير متطابقين.');
        return;
    }

    if (newPassword === account.password) {
        showChangePasswordError_INDEX2('كلمة السر الجديدة يجب أن تكون مختلفة عن القديمة.');
        return;
    }

    const oldPassword = account.password;
    let migrationStats = null;
    try {
        if (!db) {
            await initDatabase();
        }
        migrationStats = await reEncryptVaultFilesAfterPasswordChange_INDEX2(
            account,
            oldPassword,
            newPassword
        );
        if (migrationStats.failed > 0) {
            console.warn('[change-password] ملفات لم تُرحَّل:', migrationStats);
        }
    } catch (error) {
        console.error('❌ فشل إعادة تشفير الملفات:', error);
        showChangePasswordError_INDEX2('تعذر تغيير كلمة السر بسبب خطأ في إعادة تشفير الملفات.');
        return;
    }

    account.password = newPassword;
    localStorage.setItem('userAccount_INDEX2', JSON.stringify(account));
    userPassword = newPassword;
    applyVaultEncryptionKeyFromAccount_INDEX2(account);
    scheduleVaultKeyNormalization_INDEX2(account);

    closeChangePasswordModal_INDEX2();
    showNotification('تم تغيير كلمة السر بنجاح. الملفات المشفرة تعمل الآن بالمفتاح الجديد فقط.', 'success');
    console.log('✅ كلمة السر تم تغييرها بنجاح', migrationStats);
}

const changeEmailState = { oldEmail: '', newEmail: '' };

function hideChangeEmailError() {
    const el = document.getElementById('changeEmailErrorMsg');
    if (el) {
        el.style.display = 'none';
        el.textContent = '';
    }
}

function showChangeEmailError(msg) {
    const el = document.getElementById('changeEmailErrorMsg');
    if (el) {
        el.textContent = msg;
        el.classList.add('gosta-panel-error');
        el.style.display = 'block';
    }
}

function openChangeEmailModal() {
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }

    const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    if (!account || !account.email) {
        showNotification('⚠️ سجّل الدخول أو أنشئ حساباً أولاً.');
        return;
    }
    if (!isEmailVerified(account)) {
        showNotification('⚠️ فعّل بريدك الحالي أولاً قبل تغييره.');
        return;
    }
    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showNotification('⚠️ لم يُضبط خادم التحقق (pr-safe-auth-config.js).');
        return;
    }

    changeEmailState.oldEmail = account.email;
    changeEmailState.newEmail = '';

    const modal = document.getElementById('changeEmailModal');
    const s1 = document.getElementById('changeEmailStep1');
    const s2 = document.getElementById('changeEmailStep2');
    if (!modal || !s1 || !s2) {
        return;
    }

    s1.style.display = 'block';
    s2.style.display = 'none';
    hideChangeEmailError();
    const ni = document.getElementById('changeEmailNewInput');
    const pi = document.getElementById('changeEmailPasswordInput');
    const ci = document.getElementById('changeEmailCodeInput');
    if (ni) ni.value = '';
    if (pi) pi.value = '';
    if (ci) ci.value = '';

    modal.style.display = 'flex';
}

function closeChangeEmailModal() {
    const modal = document.getElementById('changeEmailModal');
    if (modal) {
        modal.style.display = 'none';
    }
    hideChangeEmailError();
}

function backChangeEmailStep1() {
    const s1 = document.getElementById('changeEmailStep1');
    const s2 = document.getElementById('changeEmailStep2');
    if (s1) s1.style.display = 'block';
    if (s2) s2.style.display = 'none';
    hideChangeEmailError();
}

async function submitChangeEmailRequest() {
    hideChangeEmailError();
    const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    const newEmail = (document.getElementById('changeEmailNewInput')?.value || '').trim();
    const password = document.getElementById('changeEmailPasswordInput')?.value || '';

    if (!isValidEmail(newEmail)) {
        showChangeEmailError('⚠️ أدخل بريداً إلكترونياً صالحاً.');
        return;
    }
    if (!password) {
        showChangeEmailError('⚠️ أدخل كلمة المرور الحالية.');
        return;
    }
    const oldEmail = (account && account.email) || localStorage.getItem('currentUserEmail_INDEX2') || '';
    if (!oldEmail) {
        showChangeEmailError('⚠️ لم يُعثر على البريد الحالي.');
        return;
    }
    if (oldEmail.toLowerCase() === newEmail.toLowerCase()) {
        showChangeEmailError('⚠️ البريد الجديد مطابق للحالي.');
        return;
    }

    const AUTH = window.PR_SAFE_AUTH || {};
    if (!AUTH.apiBase) {
        showChangeEmailError('⚠️ خادم التحقق غير مضبوط.');
        return;
    }

    try {
        await waitForAuthDiscoveryIfNeeded();
        const res = await fetch(`${AUTH.apiBase}/api/request-email-change`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentEmail: oldEmail, newEmail, password })
        });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) {
            showChangeEmailError('⏳ انتظر ' + (data.retryAfterSec || 60) + ' ثانية ثم أعد المحاولة.');
            return;
        }
        if (!res.ok) {
            const map = {
                unauthorized: 'كلمة المرور غير صحيحة.',
                not_found: 'لم يُعثر على الحساب على الخادم.',
                email_taken: 'البريد الجديد مستخدم بحساب آخر مفعّل.',
                same_email: 'البريد مطابق للحالي.',
                invalid_new_email: 'البريد الجديد غير صالح.'
            };
            showChangeEmailError(map[data.error] || ('تعذر الإرسال: ' + (data.error || res.status)));
            return;
        }
        changeEmailState.oldEmail = oldEmail;
        changeEmailState.newEmail = newEmail;

        const s1 = document.getElementById('changeEmailStep1');
        const s2 = document.getElementById('changeEmailStep2');
        const hint = document.getElementById('changeEmailTargetHint');
        if (s1) s1.style.display = 'none';
        if (s2) s2.style.display = 'block';
        if (hint) hint.textContent = newEmail;

        if (data.emailSent) {
            showNotification('📧 تم إرسال كود التأكيد إلى بريدك الجديد.');
        } else {
            showNotification(
                '⚠️ لم يُرسل البريد تلقائياً (تحقق من SMTP). إن وصلك كود من المشرف أدخله هنا، أو أعد المحاولة لاحقاً.'
            );
        }
    } catch (e) {
        console.error(e);
        showChangeEmailError('❌ تعذر الاتصال بالخادم. هل شغّلت npm run auth-server؟');
    }
}

async function applyEmailChangeLocally(oldEmail, newEmail) {
    const oldL = (oldEmail || '').trim().toLowerCase();
    const newE = (newEmail || '').trim();
    const oTrim = (oldEmail || '').trim();
    try {
        const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (acc && (acc.email || '').trim().toLowerCase() === oldL) {
            acc.email = newE;
            localStorage.setItem('userAccount_INDEX2', JSON.stringify(acc));
        }
    } catch (ignore) {}

    const keysToMove = [
        'userSubscription_INDEX2',
        'subscriptionLogs_INDEX2',
        'mediaFilesMetadata_INDEX2',
        'deletedFilesMetadata_INDEX2',
        'backup_files_INDEX2',
        'transferred_files_INDEX2',
        'freePlanTrialStart_INDEX2'
    ];
    if (oTrim && newE && typeof gostaLsGetScoped_INDEX2 === 'function') {
        keysToMove.forEach(function (k) {
            const v = gostaLsGetScoped_INDEX2(k, oTrim);
            if (v != null) {
                gostaLsSetScoped_INDEX2(k, v, newE);
                gostaLsRemoveScoped_INDEX2(k, oTrim);
            }
        });
    }

    try {
        localStorage.setItem('currentUserEmail_INDEX2', newE);
    } catch (ignore) {}
    currentUser = newE;

    if (db) {
        try {
            db.close();
        } catch (ignore) {}
        db = null;
    }
    if (typeof gostaMigrateIdbEmailChange_INDEX2 === 'function') {
        await gostaMigrateIdbEmailChange_INDEX2(oTrim, newE);
    }
    if (typeof window.onGostaUserStorageScopeChanged_INDEX2 === 'function') {
        await window.onGostaUserStorageScopeChanged_INDEX2();
    } else if (typeof initDatabase === 'function') await initDatabase();

    const subRaw = lsScopedGet_INDEX2('userSubscription_INDEX2');
    if (subRaw) {
        try {
            const sub = JSON.parse(subRaw);
            if ((sub.userEmail || '').trim().toLowerCase() === oldL) {
                sub.userEmail = newE;
                lsScopedSet_INDEX2('userSubscription_INDEX2', JSON.stringify(sub));
            }
        } catch (ignore) {}
    }

    const logsRaw = lsScopedGet_INDEX2('subscriptionLogs_INDEX2');
    if (logsRaw) {
        try {
            const arr = JSON.parse(logsRaw);
            if (Array.isArray(arr)) {
                arr.forEach(function (log) {
                    const u = (log.userEmail || log.email || '').trim().toLowerCase();
                    if (u === oldL) {
                        log.userEmail = newE;
                        if (log.email != null) log.email = newE;
                    }
                });
                lsScopedSet_INDEX2('subscriptionLogs_INDEX2', JSON.stringify(arr));
            }
        } catch (ignore) {}
    }

    if (typeof initSubscriptionSystem === 'function') {
        initSubscriptionSystem();
    }
    if (typeof updateStats === 'function') {
        const filtered = typeof getFilteredFiles === 'function' ? getFilteredFiles() : files;
        updateStats(filtered);
    }
}

async function submitChangeEmailConfirm() {
    hideChangeEmailError();
    const code = (document.getElementById('changeEmailCodeInput')?.value || '').trim();
    if (!/^\d{6}$/.test(code)) {
        showChangeEmailError('⚠️ أدخل كوداً مكوّناً من 6 أرقام.');
        return;
    }

    const AUTH = window.PR_SAFE_AUTH || {};
    const oldEmail = changeEmailState.oldEmail;
    const newEmail = changeEmailState.newEmail;
    if (!oldEmail || !newEmail) {
        showChangeEmailError('⚠️ أعد خطوة إرسال الكود.');
        return;
    }

    try {
        await waitForAuthDiscoveryIfNeeded();
        const res = await fetch(`${AUTH.apiBase}/api/confirm-email-change`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ currentEmail: oldEmail, newEmail, code })
        });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            const map = {
                wrong_code: 'الكود غير صحيح.',
                expired: 'انتهت صلاحية الكود. ارجع واضغط إرسال الكود من جديد.',
                no_pending: 'لا يوجد طلب تغيير نشط. ابدأ من جديد.',
                new_email_mismatch: 'البريد لا يطابق الطلب الأخير.',
                email_taken: 'البريد الجديد أصبح مستخدماً.',
                not_found: 'لم يُعثر على الحساب.'
            };
            showChangeEmailError(map[data.error] || ('تعذر التأكيد: ' + (data.error || res.status)));
            return;
        }

        await applyEmailChangeLocally(oldEmail, newEmail);
        closeChangeEmailModal();
        showNotification('✅ تم تغيير البريد الإلكتروني بنجاح. اشتراكك وملفاتك كما هي.');
    } catch (e) {
        console.error(e);
        showChangeEmailError('❌ تعذر الاتصال بالخادم.');
    }
}

// تسجيل الخروج
function logout() {
    if (confirm('هل أنت متأكد من رغبتك في تسجيل الخروج؟')) {
        // ✅ إغلاق القائمة
        const dropdown = document.getElementById('userDropdown');
        if (dropdown) {
            dropdown.classList.remove('show');
        }
        
        // ✅ إلغاء فلترة النسخ الاحتياطية عند الخروج
        sessionStorage.removeItem('backupFilterDateFrom_INDEX2');
        sessionStorage.removeItem('backupFilterDateTo_INDEX2');
        
        // إعادة تعيين الفلترة الحالية
        currentFilter = 'all';
        
        // ✅ مسح مفتاح التشفير
        encryptionKey = null;
        console.log('🔐 تم حذف مفتاح التشفير');
        
        // مسح البيانات
        currentUser = null;
        userPassword = '';
        displayValue = '0';
        updateDisplay();
        
        showPage('loginPage');
        localStorage.removeItem('currentUserEmail_INDEX2');
        clearPendingEmailVerification_INDEX2();

        // إعادة تعيين النماذج
        const loginForm = document.getElementById('loginForm');
        const registerForm = document.getElementById('registerForm');
        const loginMode = document.getElementById('loginMode');
        const verifySec = document.getElementById('emailVerifySection');
        if (verifySec) verifySec.style.display = 'none';
        
        if (loginForm) loginForm.reset();
        if (registerForm) registerForm.reset();
        if (loginMode) loginMode.style.display = 'none';
        showRegisterAuthSection_INDEX2();
        
        showNotification('👋 تم تسجيل الخروج بنجاح');
    }
}

// مسح سجل النقل
function clearTransferHistory() {
    // إغلاق القائمة أولاً
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }
    
    if (confirm('هل تريد مسح سجل النقل؟\nهذا قد يساعد في تحرير مساحة التخزين.')) {
        lsScopedRemove_INDEX2('transferred_files_INDEX2');
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
        try {
            const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
            if (acc && !isEmailVerified(acc)) {
                clearDisplay();
                showNotification('📧 يجب تفعيل البريد بإدخال الكود قبل استخدام الملفات المخفية');
                showPage('loginPage');
                showEmailVerificationUI(acc.email, { reopened: true });
                return;
            }
        } catch (ignore) {}
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
            let loadedFiles = await loadFilesFromIndexedDB();
            if (
                __prSafePendingUploadCount_INDEX2 > 0 &&
                loadedFiles.length < __prSafePendingUploadCount_INDEX2
            ) {
                await new Promise(function (r) {
                    setTimeout(r, 220);
                });
                const retryLoad = await loadFilesFromIndexedDB();
                if (retryLoad.length > loadedFiles.length) {
                    loadedFiles = retryLoad;
                }
            }
            __prSafePendingUploadCount_INDEX2 = 0;
            __gostaSuppressEmptyFileInputChange_INDEX2 = true;
            clearVaultFileInputs_INDEX2();
            setTimeout(function () {
                __gostaSuppressEmptyFileInputChange_INDEX2 = false;
            }, 150);
            files = loadedFiles || [];
            sortVaultRecordsNewestFirst_INDEX2(files);
            console.log(`✅ تم تحديث الملفات: ${files.length} ملف`);
            
            // عرض الملفات على الفور
            displayFiles();
            console.log('✅ تم تحديث واجهة المستخدم بنجاح');
            // حفظ الحالة محلياً فقط بعد الرفع.
            try {
                await saveFiles(true);
            } catch (saveErr) {
                console.warn('⚠️ بعد التحميل — saveFiles:', saveErr);
            }
            try {
                var uploadedIds = Array.isArray(__prSafeRecentUploadedFileIds_INDEX2)
                    ? __prSafeRecentUploadedFileIds_INDEX2.slice()
                    : [];
                __prSafeRecentUploadedFileIds_INDEX2 = [];
                if (getStorageMode_INDEX2() === 'cloud' && uploadedIds.length > 0) {
                    // في الوضع السحابي: ارفع فقط الملفات الجديدة التي رُفعت أثناء هذا الوضع.
                    await syncFilesToCloud_INDEX2({ includeOnlyIds: uploadedIds });
                    // تحديث فوري لوسم التخزين (محلي/سحابي) بدون تحديث الصفحة.
                    updateStatsAndDisplay();
                }
            } catch (cloudUploadErr) {
                console.warn('⚠️ تعذر رفع الملفات الجديدة للسحابة:', cloudUploadErr);
                uploadedIds.forEach(function (id) {
                    clearCloudUploadPending_INDEX2(id);
                });
            }
        } catch (error) {
            console.error('❌ خطأ في تحديث الملفات:', error);
            displayFiles();
        }
    }, 500);
}

// ==================== وظائف الملفات ====================

function toggleMediaPage() {
    // إغلاق القائمة أولاً
    const dropdown = document.getElementById('userDropdown');
    if (dropdown) {
        dropdown.classList.remove('show');
    }

    try {
        const acc = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        if (acc && !isEmailVerified(acc)) {
            showNotification('📧 يجب تفعيل البريد أولاً');
            showPage('loginPage');
            showEmailVerificationUI(acc.email, { reopened: true });
            return;
        }
    } catch (ignore) {}
    
    const loginPage = document.getElementById('loginPage');
    const calculatorPage = document.getElementById('calculatorPage');
    const mediaPage = document.getElementById('mediaPage');
    
    if (mediaPage.style.display === 'none' || !mediaPage.classList.contains('active')) {
        showPage('mediaPage');
        loadFilesOnStart()
            .then(function () {
                if (canUseCloudStorage_INDEX2()) {
                    return loadFilesFromCloud_INDEX2();
                }
            })
            .then(function () {
                if (typeof updateStatsAndDisplay === 'function') {
                    updateStatsAndDisplay();
                }
            })
            .catch(function (eMediaCloud) {
                console.warn('toggleMediaPage cloud refresh', eMediaCloud);
            });
    } else {
        showPage('calculatorPage');
    }
}

function showPage(pageName) {
    const blockedWhenFreeTrialEnded = ['calculatorPage', 'mediaPage'];
    if (
        blockedWhenFreeTrialEnded.indexOf(pageName) !== -1 &&
        typeof isFreePlanUsageLocked_INDEX2 === 'function' &&
        isFreePlanUsageLocked_INDEX2()
    ) {
        if (typeof showNotification === 'function') {
            showNotification(
                '⏰ انتهت فترة الخطة المجانية التجريبية. يمكنك الدخول للبرنامج لكن كل العمليات مقفلة حتى الترقية.'
            );
        }
    }

    const pages = document.querySelectorAll('.page');
    pages.forEach(page => page.classList.remove('active'));
    document.getElementById(pageName).classList.add('active');

    if (pageName === 'calculatorPage' && typeof displaySubscriptionBar === 'function') {
        displaySubscriptionBar();
    }

    // بانر ترقية ثابت داخل صفحة الملفات — مجاني / تجريبي / أساسي (INDEX3).
    if (pageName === 'mediaPage') {
        refreshCloudFeaturesUi_INDEX2();
        updateBasicPlanUpgradeBanner_INDEX2();
        refreshUserFoldersUI_INDEX2();
        refreshVaultBlurSettingUi_INDEX2();
        syncVaultHeaderLayout_INDEX2();
    }
    try {
        syncGostaAiFabVisibility_INDEX2();
    } catch (eFab3) {}
}

function isUpgradeOnlyMode_INDEX2() {
    try {
        return typeof isFreePlanUsageLocked_INDEX2 === 'function' && isFreePlanUsageLocked_INDEX2();
    } catch (e) {
        return false;
    }
}

function blockActionUntilUpgrade_INDEX2(actionLabel) {
    if (!isUpgradeOnlyMode_INDEX2()) return false;
    var label = actionLabel ? String(actionLabel) : 'هذه الميزة';
    showNotification('🔒 ' + label + ' مقفلة بعد انتهاء المجاني التجريبي. المتاح الآن: الترقية فقط.');
    return true;
}

function buildBackupFileFromTrashRecord_INDEX2(fileToDelete) {
    var backupFile = Object.assign({}, fileToDelete, {
        backedUpAt: new Date().toLocaleString('ar-EG')
    });
    copyFileFolderFields_INDEX2(backupFile, fileToDelete);
    return backupFile;
}

function saveBackupFileToIndexedDB_INDEX2(backupFile) {
    return new Promise(function (resolve, reject) {
        if (!backupFile || !backupFile.data || !db || !db.objectStoreNames.contains('backupData')) {
            resolve();
            return;
        }
        try {
            var tx = db.transaction(['backupData'], 'readwrite');
            tx.objectStore('backupData').put(Object.assign({}, backupFile));
            tx.oncomplete = function () {
                resolve();
            };
            tx.onerror = function () {
                reject(tx.error);
            };
        } catch (e) {
            reject(e);
        }
    });
}

function getBackupFileFromIdbById_INDEX2(fileId) {
    return new Promise(function (resolve) {
        if (!db || !db.objectStoreNames.contains('backupData')) {
            resolve(null);
            return;
        }
        var wantKey = fileIdKey_INDEX2(fileId);
        try {
            var tx = db.transaction(['backupData'], 'readonly');
            var store = tx.objectStore('backupData');
            var direct = store.get(fileId);
            direct.onsuccess = function () {
                if (direct.result && direct.result.data) {
                    resolve(direct.result);
                    return;
                }
                var all = store.getAll();
                all.onsuccess = function () {
                    var list = all.result || [];
                    for (var i = 0; i < list.length; i++) {
                        if (list[i] && fileIdKey_INDEX2(list[i].id) === wantKey && list[i].data) {
                            resolve(list[i]);
                            return;
                        }
                    }
                    resolve(direct.result || null);
                };
                all.onerror = function () {
                    resolve(direct.result || null);
                };
            };
            direct.onerror = function () {
                resolve(null);
            };
        } catch (e) {
            resolve(null);
        }
    });
}

async function loadBackupRecordForRestore_INDEX2(fileToRestore) {
    var listRec = null;
    var wantKey = fileIdKey_INDEX2(fileToRestore && fileToRestore.id);
    for (var i = 0; i < backupFiles.length; i++) {
        if (backupFiles[i] && fileIdKey_INDEX2(backupFiles[i].id) === wantKey) {
            listRec = backupFiles[i];
            break;
        }
    }
    var fromIdb = await getBackupFileFromIdbById_INDEX2(fileToRestore && fileToRestore.id);
    return mergeBackupRestoreSources_INDEX2(fromIdb, fileToRestore, listRec);
}

/** نص تأكيد الحذف النهائي من السلة — يفرّق بين النسخ المحلي والسحابي حسب الخطة */
function getPermanentDeleteConfirmMessage_INDEX2() {
    const q = 'هل تريد حذف هذا الملف نهائياً؟';
    let plan = '';
    try {
        if (typeof getActiveSubscriptionPlan_INDEX2 === 'function') {
            plan = String(getActiveSubscriptionPlan_INDEX2() || '').toUpperCase();
        }
    } catch (e) {
        plan = '';
    }
    if (plan === 'INDEX3') {
        return (
            q +
            '\n⚠️ تُحفظ نسخة على هذا الجهاز فقط. استرجاع الملف من تبويب «النسخ الاحتياطية» يبدأ من الخطة المتقدمة (محلياً على الجهاز). النسخ الاحتياطي والمزامنة السحابية بين الأجهزة للخطة المميزة السحابية فقط — وليست ميزة الخطة المتقدمة.'
        );
    }
    if (plan === 'INDEX4') {
        return (
            q +
            '\n⚠️ سيتم حفظه في النسخة الاحتياطية ويمكن استرجاعه من التبويب على هذا الجهاز. المزامنة أو النسخ الاحتياطي السحابي بين الأجهزة يتطلب الخطة المميزة السحابية فقط.'
        );
    }
    if (typeof canUseCloudStorage_INDEX2 === 'function' && canUseCloudStorage_INDEX2()) {
        return q + '\n⚠️ سيتم حفظه في النسخة الاحتياطية ويمكن استعادته لاحقاً (ومزامنته سحابياً عند التفعيل).';
    }
    return q + '\n⚠️ سيتم حفظه في النسخة الاحتياطية ويمكن استعادته لاحقاً من هذا الجهاز.';
}

function getPermanentDeleteDoneNotification_INDEX2() {
    let plan = '';
    try {
        if (typeof getActiveSubscriptionPlan_INDEX2 === 'function') {
            plan = String(getActiveSubscriptionPlan_INDEX2() || '').toUpperCase();
        }
    } catch (e) {
        plan = '';
    }
    if (plan === 'INDEX3') {
        return (
            '🗑️ تم حذف الملف ✓\n💾 حُفظت نسخة محلية. للاسترجاع من التطبيق: الخطة المتقدمة (على هذا الجهاز). السحابة بين الأجهزة: الخطة المميزة السحابية فقط.'
        );
    }
    if (plan === 'INDEX4') {
        return '🗑️ تم حذف الملف ✓\n💾 حُفظ في النسخ الاحتياطية ويمكن استرجاعه من التبويب على هذا الجهاز.';
    }
    if (typeof canUseCloudStorage_INDEX2 === 'function' && canUseCloudStorage_INDEX2()) {
        return '🗑️ تم حذف الملف ✓\n💾 حُفظ في النسخة الاحتياطية ويمكن استعادته لاحقاً';
    }
    return '🗑️ تم حذف الملف ✓\n💾 حُفظ في النسخة الاحتياطية';
}

const BASIC_UPGRADE_BANNER_DISMISSED_KEY_INDEX2 = 'basicUpgradeBannerDismissed_INDEX2';

function isBasicPlanUser_INDEX2() {
    try {
        if (typeof checkSubscriptionValidity_INDEX2 !== 'function') return false;
        const info = checkSubscriptionValidity_INDEX2();
        return !!(info && info.status === 'active' && String(info.plan || '').toUpperCase() === 'INDEX3');
    } catch (e) {
        return false;
    }
}

/** إظهار بانر الترقية (زر إخفاء): الخطة الأساسية INDEX3 فقط — المجاني يعتمد على شريط الاشتراك */
function shouldShowPlanUpgradeBanner_INDEX2() {
    if (isBasicUpgradeBannerDismissed_INDEX2()) {
        return false;
    }
    return isBasicPlanUser_INDEX2();
}

function getPlanUpgradeBannerMessageHtml_INDEX2() {
    if (isBasicPlanUser_INDEX2()) {
        return (
            '<strong>ترقية موصى بها:</strong> ارفع سعة التخزين وافتح مزايا إضافية بالانتقال إلى الخطة المتقدمة.'
        );
    }
    var daysLeft = null;
    try {
        if (typeof getFreePlanTrialDaysRemaining_INDEX2 === 'function') {
            daysLeft = getFreePlanTrialDaysRemaining_INDEX2();
        }
    } catch (e) {}
    if (daysLeft !== null && daysLeft <= 0) {
        return (
            '<strong>انتهت الخطة المجانية التجريبية:</strong> رقِّ اشتراكك الآن لمتابعة الرفع وفتح الملفات والمزايا.'
        );
    }
    if (daysLeft !== null && daysLeft > 0) {
        return (
            '<strong>الخطة المجانية التجريبية:</strong> متبقي ' +
            daysLeft +
            ' يوماً من التجربة — رقِّ لخطة مدفوعة لمواصلة الاستخدام بعدها.'
        );
    }
    return (
        '<strong>الخطة المجانية التجريبية:</strong> رقِّ لخطة مدفوعة لزيادة التخزين وفتح المزايا الكاملة.'
    );
}

function isBasicUpgradeBannerDismissed_INDEX2() {
    try {
        return lsScopedGet_INDEX2(BASIC_UPGRADE_BANNER_DISMISSED_KEY_INDEX2) === '1';
    } catch (e) {
        return false;
    }
}

function dismissBasicUpgradeBanner_INDEX2() {
    try {
        lsScopedSet_INDEX2(BASIC_UPGRADE_BANNER_DISMISSED_KEY_INDEX2, '1');
    } catch (e) {}
    const el = document.getElementById('basicUpgradeBanner_INDEX2');
    if (el) el.style.display = 'none';
}

function openUpgradeFromBasicBanner_INDEX2() {
    dismissBasicUpgradeBanner_INDEX2();
    if (typeof showSubscriptionsPage === 'function') {
        showSubscriptionsPage();
    } else {
        showPage('subscriptionsPage');
    }
}

/** يثبت ارتفاع الهيدر (وبانر الترقية إن وُجد) لتمرير المحتوى دون إخفاء الهيدر */
function syncVaultHeaderLayout_INDEX2() {
    var mediaPage = document.getElementById('mediaPage');
    if (!mediaPage) return;
    var host = mediaPage.querySelector('.media-container.vault-app');
    var header = mediaPage.querySelector('.vault-app-header');
    if (!host || !header) return;

    var headerH = Math.ceil(header.getBoundingClientRect().height) || 112;
    var bannerH = 0;
    var banner = document.getElementById('basicUpgradeBanner_INDEX2');
    if (banner) {
        banner.style.top = headerH + 'px';
        var bannerVisible =
            banner.style.display !== 'none' &&
            window.getComputedStyle(banner).display !== 'none';
        if (bannerVisible) {
            bannerH = Math.ceil(banner.getBoundingClientRect().height) + 8;
        }
    }

    host.style.setProperty('--vault-header-h', headerH + 'px');
    host.style.setProperty('--vault-banner-h', bannerH + 'px');
    host.style.setProperty('--vault-header-offset', headerH + bannerH + 'px');
}

function updateBasicPlanUpgradeBanner_INDEX2() {
    const mediaPage = document.getElementById('mediaPage');
    if (!mediaPage) return;
    const host = mediaPage.querySelector('.media-container');
    if (!host) return;

    let banner = document.getElementById('basicUpgradeBanner_INDEX2');
    if (!banner) {
        banner = document.createElement('div');
        banner.id = 'basicUpgradeBanner_INDEX2';
        banner.className = 'basic-upgrade-banner';
        banner.innerHTML =
            '<div class="basic-upgrade-banner-text"></div>' +
            '<div class="basic-upgrade-banner-actions">' +
            '<button type="button" class="basic-upgrade-banner-btn" onclick="openUpgradeFromBasicBanner_INDEX2()">ترقية الآن</button>' +
            '<button type="button" class="basic-upgrade-banner-close" onclick="dismissBasicUpgradeBanner_INDEX2()">إخفاء</button>' +
            '</div>';
        const header = host.querySelector('.vault-app-header') || host.querySelector('.media-header');
        if (header && header.nextSibling) {
            host.insertBefore(banner, header.nextSibling);
        } else {
            host.insertBefore(banner, host.firstChild);
        }
    }

    const textEl = banner.querySelector('.basic-upgrade-banner-text');
    if (textEl) {
        textEl.innerHTML = getPlanUpgradeBannerMessageHtml_INDEX2();
    }
    const show = shouldShowPlanUpgradeBanner_INDEX2();
    banner.style.display = show ? 'flex' : 'none';
    syncVaultHeaderLayout_INDEX2();
}

function clearVaultFileInputs_INDEX2() {
    ['fileInputMedia_INDEX2', 'fileInputDocs_INDEX2'].forEach(function (id) {
        var el = document.getElementById(id);
        if (el) {
            el.value = '';
        }
    });
}

function openVaultMediaPicker_INDEX2(ev) {
    if (ev && ev.stopPropagation) {
        ev.stopPropagation();
    }
    if (!checkPermissionBeforeUpload()) {
        return;
    }
    var el = document.getElementById('fileInputMedia_INDEX2');
    if (el) {
        el.click();
    }
}

function openVaultDocsPicker_INDEX2(ev) {
    if (ev && ev.stopPropagation) {
        ev.stopPropagation();
    }
    if (!checkPermissionBeforeUpload()) {
        return;
    }
    var el = document.getElementById('fileInputDocs_INDEX2');
    if (el) {
        el.click();
    }
}

/** معالجة قائمة ملفات مختارة (صور/فيديو/مستندات) */
function processVaultFilesFromInput_INDEX2(newFiles) {
    ensureEncryptionKeyFromAccount_INDEX2();
    const fileList = Array.from(newFiles || []);
    let totalFiles = fileList.length;
    let loadedCount = 0;
    __prSafePendingUploadCount_INDEX2 = totalFiles;

    if (totalFiles === 0) {
        if (__gostaSuppressEmptyFileInputChange_INDEX2 || __prSafePendingUploadCount_INDEX2 > 0) {
            return;
        }
        showNotification('⚠️ لم تختر أي ملفات');
        return;
    }

    showLoadingIndicator('جاري تحميل الملفات (0/' + totalFiles + ')...');
    fileList.forEach(function (file) {
              const isSupported = isSupportedVaultUpload_INDEX2(file);
              if (isSupported) {
                var quota = vaultUploadFitsPlanQuota_INDEX2(file.size);
                if (!quota.ok) {
                    showNotification(
                        '⚠️ تجاوز حد التخزين الأقصى!\n\nالحد الأقصى: ' +
                            quota.maxStorageLimit +
                            ' MB\nالمستخدم: ' +
                            quota.currentTotal.toFixed(2) +
                            ' MB\nحجم الملف: ' +
                            quota.newFileSizeMb.toFixed(2) +
                            ' MB\n\nلا يمكن تحميل: ' +
                            file.name
                    );
                    loadedCount++;
                    updateLoadingProgress((loadedCount / totalFiles) * 100);
                    if (loadedCount === totalFiles) {
                        completeLoading();
                    }
                    return;
                }
                  const reader = new FileReader();                reader.onload = async function(event) {                    try {
                        let fileData = event.target.result;
                        
                        // ✅ تشفير بيانات الملف قبل الحفظ
                        let encryptedData = fileData;
                        if (encryptionKey) {
                            console.log('🔐 جاري تشفير الملف:', file.name);
                            encryptedData = encryptFileData(fileData);
                            if (!encryptedData) {
                                showNotification('❌ خطأ في تشفير الملف: ' + file.name);
                                loadedCount++;
                                updateLoadingProgress((loadedCount / totalFiles) * 100);
                                if (loadedCount === totalFiles) {
                                    completeLoading();
                                }
                                return;
                            }
                            console.log('✅ تم تشفير الملف بنجاح');
                        }
                        
                        // احفظ الملف مشفراً
                        const fileObject = {
                            id: Date.now() + Math.random(),
                            name: file.name,
                            type: file.type || inferVaultMimeFromName_INDEX2(file.name, file.type),
                            data: encryptedData,
                            size: (file.size / 1024 / 1024).toFixed(2) + ' MB',
                            uploadedAt: new Date().toLocaleString('ar-EG'),
                            isLocked: true,
                            isCompressed: false,
                            isEncrypted: !!encryptionKey  // ✅ علامة التشفير
                        };
                        var uploadFolderId = getUploadFolderIdForNewFile_INDEX2();
                        if (uploadFolderId) {
                            fileObject.folderId = uploadFolderId;
                        }
                        
                        try {
                            // ✅ حفظ الملف المشفر في IndexedDB بدون تأخير
                            await saveFileToIndexedDB(fileObject);
                            prependVaultRecord_INDEX2(files, fileObject);
                            __prSafeRecentUploadedFileIds_INDEX2.unshift(fileObject.id);
                            if (getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2()) {
                                markCloudUploadPending_INDEX2(fileObject.id);
                            }
                            // أندرويد فقط: محاولة حذف النسخة الأصلية من الاستديو بعد نجاح الحفظ داخل التطبيق.
                            maybeDeleteOriginalFromAndroidGallery_INDEX2(file);
                            console.log('✅ تم حفظ الملف المشفر في IndexedDB:', fileObject.name);
                        } catch (storageError) {
                            console.error('❌ خطأ في حفظ الملف:', storageError);
                            showNotification('❌ خطأ في حفظ الملف: ' + file.name);
                        }
                        loadedCount++;
                        
                        showNotification('✅ تم اخفاء الملف بنجاح!');
                        
                        // عرض رسالة التخزين الآمن (معطل)
                        // showSecurityAlert(file.name, fileObject.size, file.type);
                        
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
}

function bindVaultFileInputChange_INDEX2(inputId) {
    var input = document.getElementById(inputId);
    if (!input || input.dataset.gostaChangeBound === '1') {
        return;
    }
    input.dataset.gostaChangeBound = '1';
    input.addEventListener('change', function () {
        if (!checkPermissionBeforeUpload()) {
            input.value = '';
            return;
        }
        processVaultFilesFromInput_INDEX2(input.files);
        input.value = '';
    });
}

// معالجة رفع الملفات - يتم إضافتها عند تحميل الصفحة
function initFileUpload() {
    var uploadSection = document.querySelector('.upload-section');
    if (!uploadSection || uploadSection.dataset.gostaUploadInited === '1') {
        return;
    }
    uploadSection.dataset.gostaUploadInited = '1';

    bindVaultFileInputChange_INDEX2('fileInputMedia_INDEX2');
    bindVaultFileInputChange_INDEX2('fileInputDocs_INDEX2');

    var uploadBox = document.getElementById('uploadBox_INDEX2') || document.querySelector('.upload-box');

    if (uploadBox) {
        uploadBox.addEventListener('dragover', function (e) {
            e.preventDefault();
            uploadBox.style.backgroundColor = '#e0e0ff';
            uploadBox.style.borderColor = '#764ba2';
        });

        uploadBox.addEventListener('dragleave', function () {
            uploadBox.style.backgroundColor = '#f8f9ff';
            uploadBox.style.borderColor = '#667eea';
        });

        uploadBox.addEventListener('drop', function (e) {
            e.preventDefault();
            uploadBox.style.backgroundColor = '#f8f9ff';
            uploadBox.style.borderColor = '#667eea';
            if (!checkPermissionBeforeUpload()) {
                return;
            }
            processVaultFilesFromInput_INDEX2(e.dataTransfer.files);
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
        // الحصول على الحد الأقصى من الاشتراك الحالي
        let maxStorage = FREE_PLAN_STORAGE_MB_INDEX2; // MB - الافتراضي (مجاني)
        
        const subscription = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (subscription) {
            try {
                const sub = JSON.parse(subscription);
                // التحقق من الصلاحية
                const expiryDate = new Date(sub.expiryDate);
                if (new Date() <= expiryDate && sub.status === 'active') {
                    maxStorage = sub.storage || 20; // استخدم سعة الاشتراك
                    console.log(`📊 استخدام حد الاشتراك: ${maxStorage} MB`);
                }
            } catch (e) {
                console.warn('⚠️ خطأ في قراءة الاشتراك:', e);
            }
        }
        
        // Calculate actual used storage by summing file sizes
        const usedSize = files.reduce((total, file) => {
            return total + getSizeInMB(file.size);
        }, 0);
        const available = Math.max(0, maxStorage - usedSize);
        
        console.log(`💾 استخدام التخزين: ${usedSize.toFixed(2)}/${maxStorage} MB`);
        
        return {
            used: usedSize.toFixed(2) + ' MB',
            available: available.toFixed(2) + ' MB',
            max: maxStorage + ' MB',
            percentUsed: Math.min(100, (usedSize / maxStorage * 100).toFixed(0))
        };
    } catch (e) {
        console.error('❌ خطأ في حساب التخزين:', e);
        return { used: 'غير معروف', available: 'غير معروف', max: FREE_PLAN_STORAGE_MB_INDEX2 + ' MB' };
    }
}

function getCurrentPlanUiInfo_INDEX2() {
    var planName = 'الخطة المجانية التجريبية';
    var maxStorage = FREE_PLAN_STORAGE_MB_INDEX2;
    try {
        if (hasFreePremiumTrialAccess_INDEX2()) {
            return { planName: 'الخطة التجريبية (كل المزايا)', maxStorage: 1000 };
        }
        var raw = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (!raw) return { planName: planName, maxStorage: maxStorage };
        var sub = JSON.parse(raw);
        if (!sub || sub.status !== 'active') return { planName: planName, maxStorage: maxStorage };
        var expiryDate = new Date(sub.expiryDate);
        if (new Date() > expiryDate) return { planName: planName, maxStorage: maxStorage };
        var t = String(sub.type || sub.plan || '').toUpperCase();
        if (t === 'INDEX3') planName = 'الخطة الأساسية';
        else if (t === 'INDEX4') planName = 'الخطة المتقدمة';
        else if (t === 'INDEX5') planName = 'الخطة المميزة السحابية';
        maxStorage = Number(sub.storage) || maxStorage;
    } catch (e) {}
    return { planName: planName, maxStorage: maxStorage };
}

function updateUploadInfoText_INDEX2(maxStorage) {
    var info = Number(maxStorage) || 20;
    var nodes = document.querySelectorAll('.upload-info');
    if (!nodes || nodes.length === 0) return;
    nodes.forEach(function (el) {
        el.textContent =
            'صور، فيديو، PDF وExcel • يُحسب الحجم من حد الخطة (' + info + ' MB)';
    });
    updateUploadUpgradeCta_INDEX2();
}

function updateUploadUpgradeCta_INDEX2() {
    var btn = document.getElementById('uploadUpgradeBtn_INDEX2');
    var note = document.getElementById('uploadUpgradeNote_INDEX2');
    if (!btn) return;
    var hasPaidPlan = false;
    try {
        var raw = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (raw) {
            var sub = JSON.parse(raw);
            var exp = new Date(sub && sub.expiryDate ? sub.expiryDate : 0);
            var isActive = !!(sub && sub.status === 'active' && !isNaN(exp.getTime()) && new Date() <= exp);
            var isTrialSub =
                String(sub && sub.paymentMethod ? sub.paymentMethod : '').toLowerCase() === 'trial' ||
                String(sub && sub.transactionId ? sub.transactionId : '') === 'trial-free-premium' ||
                String(sub && sub.price ? sub.price : '') === '0';
            hasPaidPlan = isActive && !isTrialSub;
        }
    } catch (e) {
        hasPaidPlan = false;
    }
    if (hasPaidPlan) {
        btn.style.display = 'none';
        if (note) note.style.display = 'none';
        return;
    }
    var daysLeft = null;
    try {
        if (typeof getFreePlanTrialDaysRemaining_INDEX2 === 'function') {
            daysLeft = getFreePlanTrialDaysRemaining_INDEX2();
        }
    } catch (e) {
        daysLeft = null;
    }
    if (note) {
        var line =
            daysLeft === null
                ? '🆓 نسختك المجانية التجريبية. فعّل خطة مدفوعة للاستمرار بمزايا أعلى.'
                : daysLeft <= 0
                ? '⏰ انتهت فترة المجاني التجريبي. رقِّ الآن لمتابعة الاستخدام.'
                : '🆓 متبقي ' + daysLeft + ' يوم من المجاني التجريبي — بعدها يلزم ترقية للاشتراك.';
        note.textContent = line;
        note.style.display = 'block';
    }
    btn.style.display = 'inline-flex';
}

/**
 * التحقق من وجود اشتراك مدفوع فعال حالياً.
 */
function hasActivePaidSubscription() {
    try {
        if (hasFreePremiumTrialAccess_INDEX2()) return true;
        const raw = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (!raw) return false;
        const sub = JSON.parse(raw);
        if (!sub || sub.status !== 'active') return false;
        const expiryDate = new Date(sub.expiryDate);
        return new Date() <= expiryDate;
    } catch (error) {
        console.warn('⚠️ تعذر التحقق من الاشتراك:', error);
        return false;
    }
}

/**
 * في الخطة المجانية: اسمح بفتح الملفات حتى مجموع 20MB فقط.
 */
function getFreePlanOpenableFileIds(maxMB = FREE_PLAN_STORAGE_MB_INDEX2) {
    const openable = new Set();
    let total = 0;

    for (const file of files) {
        const sizeMB = getSizeInMB(file.size);
        if (total + sizeMB <= maxMB) {
            openable.add(file.id);
            total += sizeMB;
        } else {
            break;
        }
    }

    return openable;
}

function canOpenFileBySubscription(file) {
    if (!file) return false;
    if (hasActivePaidSubscription()) return true;
    return getFreePlanOpenableFileIds(FREE_PLAN_STORAGE_MB_INDEX2).has(file.id);
}

// حفظ الملفات في IndexedDB (بدون قطع البيانات)
async function saveFiles(skipCloudSync, forceCloudSync) {
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
        await pruneStaleMediaFilesFromIndexedDB_INDEX2();
        await pruneStaleDeletedFilesFromIndexedDB_INDEX2();

        if (!skipCloudSync && forceCloudSync === true && getStorageMode_INDEX2() === 'cloud') {
            try {
                await syncFilesToCloud_INDEX2({ includeAllLocal: true });
            } catch (cloudError) {
                console.warn('⚠️ فشل مزامنة السحابة:', cloudError);
            }
        }
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
        
        lsScopedSet_INDEX2('mediaFilesMetadata_INDEX2', JSON.stringify(fileMetadata));
        lsScopedSet_INDEX2('deletedFilesMetadata_INDEX2', JSON.stringify(deletedMetadata));
        console.log('✅ تم حفظ معلومات الملفات في localStorage (INDEX2)');
    } catch (error) {
        console.error('❌ خطأ في الحفظ البديل:', error);
    }
}

// حذف أقدم ملف لتحرير المساحة
function deleteOldestFile() {
    if (files.length <= 1) return false;
    
    sortVaultRecordsNewestFirst_INDEX2(files);
    const deletedFile = files.pop();
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
            deletedAt: f.deletedAt,
            uploadedAt: f.uploadedAt,
            isLocked: f.isLocked,
            isEncrypted: !!f.isEncrypted,
            isCompressed: !!f.isCompressed
        }));
        
        lsScopedSet_INDEX2('deletedFilesMetadata_INDEX2', JSON.stringify(deletedMetadata));
        console.log('✅ تم حفظ الملفات المحذوفة في localStorage (INDEX2)');
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
                        var row = Object.assign({}, file, {
                            isLocked: file.isLocked || false,
                            isEncrypted: !!file.isEncrypted,
                            isCompressed: !!file.isCompressed
                        });
                        objectStore.put(row);
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
    try {        const stored = lsScopedGet_INDEX2('deletedFilesMetadata_INDEX2');
        if (stored) {
            const deletedMetadata = JSON.parse(stored);
            console.log(`✅ تم تحميل ${deletedMetadata.length} ملف محذوف من localStorage (INDEX2)`);
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
        const backupMetadata = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
        console.log(`📋 تم تحميل ${backupMetadata.length} معلومات نسخة احتياطية (INDEX2)`);
        
        // تحميل البيانات الكاملة من جدول backupData في IndexedDB
        for (const backupInfo of backupMetadata) {
            const fullBackupFile = await getFullBackupFileData(backupInfo.id);
            if (fullBackupFile) {
                // إذا كانت البيانات الكاملة موجودة، أضفها إلى backupFiles
                if (!backupFiles.find(f => f.id === backupInfo.id)) {
                    prependVaultRecord_INDEX2(backupFiles, fullBackupFile);
                }
            }
        }
        console.log(`✅ تم تحميل ${backupFiles.length} ملف من النسخ الاحتياطية`);
        sortAllVaultListsNewestFirst_INDEX2();

        if (canUseCloudStorage_INDEX2()) {
            try {
                await loadFilesFromCloud_INDEX2({ skipDisplay: true });
            } catch (cloudOnStartErr) {
                console.warn('⚠️ تعذر مزامنة السحابة عند التحميل:', cloudOnStartErr);
            }
        }
        
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
                for (var nf = newFiles.length - 1; nf >= 0; nf--) {
                    prependVaultRecord_INDEX2(files, newFiles[nf]);
                }
                sortVaultRecordsNewestFirst_INDEX2(files);
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
                for (var nd = newDeletedFiles.length - 1; nd >= 0; nd--) {
                    prependVaultRecord_INDEX2(deletedFiles, newDeletedFiles[nd]);
                }
                sortVaultRecordsNewestFirst_INDEX2(deletedFiles);
                console.log(`✅ تم تحميل ${newDeletedFiles.length} ملف محذوف جديد من deletedFiles`);
            }
        }    } catch (error) {
        console.error('❌ خطأ في تحميل الملفات:', error);
    }
}

// دالة الحصول على شريط معلومات الاشتراك
function getSubscriptionInfoBar() {
    try {
        const currentSub = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (!currentSub) {
            return '';
        }
        
        const subInfo = JSON.parse(currentSub);
        const subType = subInfo.type || 'مجاني تجريبي';
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
function toggleInitialEmptyState_INDEX2(show) {
    const emptyState = document.getElementById('emptyState');
    if (!emptyState) return;
    emptyState.style.display = show ? '' : 'none';
}

function displayFiles() {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    
    // ✅ مسح الواجهة تماماً وإعادة بناؤها
    filesList.innerHTML = '';
      // إذا لم توجد ملفات، عرض رسالة فقط
    if (files.length === 0) {
        toggleInitialEmptyState_INDEX2(true);
        updateStats([]);
        setVaultFilesCarouselLayout_INDEX2(true);
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'vault-files-scroll-empty';
        emptyDiv.style.cssText = 'text-align: center; padding: 40px; color: #999;';
        emptyDiv.innerHTML = '<p>📂 لا توجد ملفات مخفية حتى الآن</p>';
        filesList.appendChild(emptyDiv);
        return;
    }
    toggleInitialEmptyState_INDEX2(false);
      // ✅ عرض جميع الملفات مباشرة
    currentFilter = 'all';
    sortVaultRecordsNewestFirst_INDEX2(files);
    const filteredFiles = getFilteredFiles();
    // ✅ تحديث الإحصائيات عند عرض الملفات
    updateStats(filteredFiles);
    displayFilteredFiles(filteredFiles);
}

// عرض الملف مع كلمة السر
async function viewMedia(index) {
    if (blockActionUntilUpgrade_INDEX2('عرض الملفات')) return;
    currentMediaIndex = index;
    var file = files[index];

    if (!canOpenFileBySubscription(file)) {
        var maxLabelOpen = getCurrentPlanUiInfo_INDEX2().maxStorage;
        showNotification(
            '🔒 هذا الملف خارج حد الخطة الحالية (' + maxLabelOpen + 'MB). جدد/رقِّ الاشتراك لفتحه.'
        );
        return;
    }

    var mediaDisplay = document.getElementById('mediaDisplay');
    mediaDisplay.innerHTML = '';
    revokeVaultDocBlobUrl_INDEX2();
    mediaDisplay.style.position = 'relative';

    resetCurrentMediaDataForVaultFile_INDEX2(file);

    try {
        await ensureVaultFileDataForView_INDEX2(file, index);
        var resolvedIdx = files.findIndex(function (f) {
            return f && fileIdKey_INDEX2(f.id) === fileIdKey_INDEX2(file.id);
        });
        if (resolvedIdx >= 0) {
            index = resolvedIdx;
            file = files[index];
        }
        resetCurrentMediaDataForVaultFile_INDEX2(file);
        if (fileIsStoredInCloud_INDEX2(file) || isFileKnownInCloud_INDEX2(file)) {
            updateStatsAndDisplay();
        }
    } catch (loadErr) {
        console.error('[viewMedia] load data:', loadErr);
        var cloudHint =
            canUseCloudStorage_INDEX2() && (fileIsStoredInCloud_INDEX2(file) || isFileKnownInCloud_INDEX2(file))
                ? '\nجرّب «استعادة» أو «مزامنة» من السحابة — قد يكون الملف غير موجود على R2.'
                : '';
        showNotification('❌ تعذر تحميل الملف. تأكد من المزامنة أو أعد رفعه محلياً.' + cloudHint);
        return;
    }

    var fileKind = getVaultFileKind_INDEX2(file);
    var isImage = fileKind === 'image';
    var isDocument = fileKind === 'document';
    var blurOn = isVaultBlurEnabled_INDEX2();

    syncVaultMediaModalChrome_INDEX2(blurOn);
    syncVaultMediaModalLayout_INDEX2(file);

    try {
        if (!blurOn) {
            ensureEncryptionKeyFromAccount_INDEX2();
            var clearUrl = decryptVaultFileToDataUrl_INDEX2(file);
            if (!clearUrl) {
                showNotification('❌ تعذر فتح الملف. تأكد من تسجيل الدخول بكلمة السر الحالية.');
                return;
            }
            currentMediaData.decryptedData = clearUrl;
            currentMediaData.isEncrypted = false;
            renderVaultMediaUnlocked_INDEX2(mediaDisplay, file, clearUrl);
        } else {
            currentMediaData.encryptedData = file.isEncrypted ? file.data : null;
            currentMediaData.isEncrypted = !!file.isEncrypted;
            currentMediaData.decryptedData = null;

            if (isDocument) {
                renderVaultDocLockedPreview_INDEX2(mediaDisplay, file);
            } else if (fileKind === 'video') {
                renderVaultVideoInApp_INDEX2(mediaDisplay, file, null, { locked: true, blurred: true });
            } else {
                renderVaultImageInApp_INDEX2(mediaDisplay, file, null, { locked: true });
            }
            appendVaultLockedOverlay_INDEX2(mediaDisplay);
        }
    } catch (error) {
        console.error('Error loading media:', error);
        mediaDisplay.innerHTML =
            '<p style="color:#ff6b6b;font-size:16px;">❌ خطأ في تحميل الملف: ' + escapeHtml_INDEX2(error.message) + '</p>';
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

    const account = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
    const activePassword = account?.password || '';

    if (!activePassword || password !== activePassword) {
        showNotification('❌ كلمة السر خطأ');
        document.getElementById('mediaPassword').value = '';
        document.getElementById('mediaPassword').focus();
        return;
    }

    try {
        const mediaDisplay = document.getElementById('mediaDisplay');
        const file = files[currentMediaIndex];
        const isDocument = currentMediaData.fileKind === 'document';
        const media = mediaDisplay.querySelector('img, video, .vault-doc-unlock-target');

        if (!file) {
            showNotification('❌ لم يتم العثور على الملف');
            return;
        }
        if (!isDocument && !media) {
            showNotification('❌ لم يتم العثور على الملف');
            return;
        }

        const previousKey = encryptionKey;
        var encSource =
            currentMediaData.encryptedData || (file.isEncrypted && file.data ? file.data : null);
        var needsDecrypt = !!(currentMediaData.isEncrypted || file.isEncrypted) && encSource;

        if (needsDecrypt) {
            applyVaultEncryptionKeyFromAccount_INDEX2(account);
            const decrypted = decryptFileDataForAccount_INDEX2(encSource, account);

            if (!decrypted) {
                encryptionKey = previousKey;
                showNotification('❌ تعذر فتح الملف. تأكد من كلمة السر الحالية للحساب.');
                document.getElementById('mediaPassword').value = '';
                document.getElementById('mediaPassword').focus();
                return;
            }
            scheduleVaultKeyNormalization_INDEX2(account);

            const dataUrl = buildVaultDataUrl_INDEX2(file, decrypted);
            currentMediaData.decryptedData = dataUrl;
            currentMediaData.isEncrypted = false;

            if (isDocument) {
                renderVaultDocumentUnlocked_INDEX2(mediaDisplay, file, dataUrl);
            } else if (getVaultFileKind_INDEX2(file) === 'video') {
                renderVaultVideoInApp_INDEX2(mediaDisplay, file, dataUrl, { locked: false });
            } else if (getVaultFileKind_INDEX2(file) === 'image') {
                renderVaultImageInApp_INDEX2(mediaDisplay, file, dataUrl, { locked: false });
            } else if (media) {
                media.src = dataUrl;
                media.classList.add('unlocked');
                media.style.filter = 'blur(0px)';
                media.style.transition = 'filter 0.5s ease-in-out';
            }
        } else {
            var plainUrl =
                currentMediaData.decryptedData ||
                (file.data ? buildVaultDataUrl_INDEX2(file, file.data) : null);

            if (isDocument && plainUrl) {
                renderVaultDocumentUnlocked_INDEX2(mediaDisplay, file, plainUrl);
            } else if (getVaultFileKind_INDEX2(file) === 'video' && plainUrl) {
                renderVaultVideoInApp_INDEX2(mediaDisplay, file, plainUrl, { locked: false });
            } else if (getVaultFileKind_INDEX2(file) === 'image' && plainUrl) {
                renderVaultImageInApp_INDEX2(mediaDisplay, file, plainUrl, { locked: false });
            } else if (media && media.style) {
                if (plainUrl && (media.tagName === 'IMG' || media.tagName === 'VIDEO')) {
                    media.src = plainUrl;
                }
                media.classList.add('unlocked');
                media.style.filter = 'blur(0px)';
                media.style.transition = 'filter 0.5s ease-in-out';
            }
        }
        
        // ✅ إزالة رسالة "مخفي" بحث دقيق
        mediaDisplay.querySelectorAll('.vault-media-locked-overlay').forEach(function (el) {
            el.style.animation = 'fadeOut 0.3s ease-out';
            setTimeout(function () {
                el.remove();
            }, 300);
        });
        const hiddenMessages = mediaDisplay.querySelectorAll('div');
        hiddenMessages.forEach(div => {
            if (div.classList && div.classList.contains('vault-media-locked-overlay')) {
                return;
            }
            // البحث عن الـ div الذي يحتوي على رسالة "مخفي"
            if (div.style.backgroundColor && div.style.backgroundColor.includes('rgba(0, 0, 0, 0.7)')) {
                div.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => {
                    div.remove();
                }, 300);
            }
        });
        
        // إضافة شارة "مفتوح"
        const unlockedBadge = document.createElement('div');
        unlockedBadge.style.cssText = `
            position: absolute;
            top: 10px;
            right: 10px;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white;
            padding: 8px 15px;
            border-radius: 20px;
            font-size: 12px;
            font-weight: bold;
            z-index: 1000;
            animation: slideIn 0.3s ease-out;
        `;
        unlockedBadge.innerHTML = '🔓 مفتوح';
        mediaDisplay.style.position = 'relative';
        
        // إضافة الـ animation إذا لم تكن موجودة
        if (!document.getElementById('unlockAnimation')) {
            const style = document.createElement('style');
            style.id = 'unlockAnimation';
            style.innerHTML = `
                @keyframes slideIn {
                    from {
                        opacity: 0;
                        transform: translateX(-20px);
                    }
                    to {
                        opacity: 1;
                        transform: translateX(0);
                    }
                }
                @keyframes fadeOut {
                    from {
                        opacity: 1;
                    }
                    to {
                        opacity: 0;
                    }
                }
            `;
            document.head.appendChild(style);
        }
        
        mediaDisplay.appendChild(unlockedBadge);
        showNotification('✅ تم فتح الملف بنجاح!');
        
        // إخفاء حقل كلمة السر والزر بعد النجاح
        setTimeout(() => {
            const passwordInput = document.getElementById('mediaPassword');
            const passwordSection = document.querySelector('.modal-password-section');
            
            if (passwordSection) {
                passwordSection.style.animation = 'fadeOut 0.3s ease-out';
                setTimeout(() => {
                    passwordSection.style.display = 'none';
                }, 300);
            }
        }, 300);
        
    } catch (error) {
        console.error('❌ خطأ في فتح الملف:', error);
        showNotification('❌ خطأ في فتح الملف: ' + error.message);
        document.getElementById('mediaPassword').value = '';
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
    revokeVaultDocBlobUrl_INDEX2();
    var mediaDisplayEl = document.getElementById('mediaDisplay');
    if (mediaDisplayEl) {
        mediaDisplayEl.classList.remove('vault-excel-mode', 'vault-pdf-mode', 'vault-video-mode', 'vault-image-mode');
    }
    clearVaultMediaModalLayout_INDEX2();

    // تنظيف المحتويات
    setTimeout(() => {
        const mediaDisplay = document.getElementById('mediaDisplay');
        if (mediaDisplay) {
            mediaDisplay.classList.remove('vault-excel-mode', 'vault-pdf-mode', 'vault-video-mode', 'vault-image-mode');
        }
        clearVaultMediaModalLayout_INDEX2();
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
        
        const passwordInput = document.getElementById('mediaPassword');
        if (passwordInput) {
            passwordInput.value = '';
        }
        syncVaultMediaModalChrome_INDEX2(isVaultBlurEnabled_INDEX2());
        
        currentMediaData = {
            encryptedData: null,
            fileType: null,
            isEncrypted: false,
            fileKind: null,
            decryptedData: null
        };
        currentMediaIndex = -1;
    }, 300);
}

// حذف ملف (نقل إلى سلة المحذوفات)
// ==================== نقل الملفات إلى المجلد الآمن ====================

// نقل الملف إلى الجهاز (تحميل مباشر)
async function transferFileToFolder(index) {
    if (blockActionUntilUpgrade_INDEX2('نقل الملفات')) return;
    const file = files[index];
    
    if (!file) {
        showNotification('❌ الملف غير موجود');
        return;
    }

    // في المجاني: منع النقل للملفات خارج أول 20MB
    if (!canOpenFileBySubscription(file)) {
        var maxLabelMove = getCurrentPlanUiInfo_INDEX2().maxStorage;
        showNotification('🔒 هذا الملف خارج حد الخطة الحالية (' + maxLabelMove + 'MB). جدد/رقِّ الاشتراك لنقله.');
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

function getExtensionFromMimeType_INDEX2(mimeType) {
    const m = String(mimeType || '').toLowerCase();
    if (m.includes('image/jpeg') || m.includes('image/jpg')) return 'jpg';
    if (m.includes('image/png')) return 'png';
    if (m.includes('image/webp')) return 'webp';
    if (m.includes('image/gif')) return 'gif';
    if (m.includes('image/bmp')) return 'bmp';
    if (m.includes('video/mp4')) return 'mp4';
    if (m.includes('video/webm')) return 'webm';
    if (m.includes('video/quicktime')) return 'mov';
    if (m.includes('video/x-msvideo')) return 'avi';
    if (m.includes('video/mpeg')) return 'mpeg';
    if (m.includes('pdf')) return 'pdf';
    if (m.includes('spreadsheet') || m.includes('excel')) return 'xlsx';
    return '';
}

function ensureDownloadFileName_INDEX2(fileName, mimeType) {
    const baseName = String(fileName || 'file_' + Date.now()).trim();
    const hasExt = /\.[a-z0-9]{2,5}$/i.test(baseName);
    if (hasExt) return baseName;
    const ext = getExtensionFromMimeType_INDEX2(mimeType);
    return ext ? (baseName + '.' + ext) : baseName;
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
            
            // إذا كان الملف مشفراً، يجب فك التشفير أولاً قبل التصدير للجوال.
            let exportData = file.data;
            let exportMime = file.type || 'application/octet-stream';
            if (file.isEncrypted === true) {
                if (typeof decryptFileData !== 'function') {
                    throw new Error('دالة فك التشفير غير متاحة');
                }
                const decryptedBase64 = decryptFileData(file.data);
                if (!decryptedBase64) {
                    throw new Error('فشل فك تشفير الملف قبل التنزيل');
                }
                exportData = `data:${exportMime};base64,${decryptedBase64}`;
                console.log('🔓 تم فك تشفير الملف قبل التنزيل');
            }

            // إنشاء blob من البيانات
            let blob;
            
            if (typeof exportData === 'string' && exportData.startsWith('data:')) {
                // تحويل data URL إلى blob
                try {
                    const arr = exportData.split(',');
                    const mimeMatch = arr[0].match(/:(.*?);/);
                    
                    if (!mimeMatch || !mimeMatch[1]) {
                        console.error('❌ خطأ في استخراج MIME type');
                        showNotification('❌ خطأ: صيغة البيانات غير صحيحة');
                        reject(new Error('صيغة البيانات غير صحيحة'));
                        return;
                    }
                    
                    const mime = mimeMatch[1];
                    exportMime = mime || exportMime;
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
            } else if (typeof exportData === 'string') {
                // إذا كانت نصية لكن ليست data URL، حاول معالجتها كـ base64
                try {
                    const bstr = atob(exportData);
                    const n = bstr.length;
                    const u8arr = new Uint8Array(n);
                    
                    for (let i = 0; i < n; i++) {
                        u8arr[i] = bstr.charCodeAt(i);
                    }
                    
                    blob = new Blob([u8arr], { type: exportMime || 'application/octet-stream' });
                    console.log('✅ تم تحويل base64 إلى blob');
                } catch (e) {
                    // إذا فشل، استخدم البيانات مباشرة
                    blob = new Blob([exportData], { type: exportMime || 'text/plain' });
                    console.log('✅ تم إنشاء blob من النص مباشرة');
                }
            } else if (exportData instanceof ArrayBuffer || exportData instanceof Uint8Array) {
                blob = new Blob([exportData], { type: exportMime || 'application/octet-stream' });
                console.log('✅ تم إنشاء blob من البيانات الثنائية');
            } else {
                blob = new Blob([exportData], { type: exportMime || 'application/octet-stream' });
                console.log('✅ تم إنشاء blob من البيانات');
            }
            
            // ✅ تنزيل الملف
            const url = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = url;
            link.download = ensureDownloadFileName_INDEX2(file.name, exportMime);
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
    if (blockActionUntilUpgrade_INDEX2('حذف الملفات')) return;
    const deleteOk = await showVaultConfirmDialog_INDEX2({
        title: 'حذف الملف',
        message: 'هل تريد حذف هذا الملف؟\n(يمكنك استعادته من سلة المحذوفات)',
        confirmLabel: 'حذف',
        variant: 'danger'
    });
    if (deleteOk) {
        const fileToDelete = files[index];
        const wasCloudFile = isFileKnownInCloud_INDEX2(fileToDelete);
        
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
        
        // نسخة كاملة للسلة (بما فيها data) — ضرورية للاستعادة حتى لو وُسم الملف سحابياً
        const deletedFile = Object.assign({}, fileToDelete, {
            deletedAt: new Date().toLocaleString('ar-EG')
        });
        copyFileFolderFields_INDEX2(deletedFile, fileToDelete);
        prependVaultRecord_INDEX2(deletedFiles, deletedFile);
        try {
            await moveFileToTrash(fileToDelete);
        } catch (trashIdbErr) {
            console.warn('⚠️ حفظ السلة في IndexedDB:', trashIdbErr);
        }

        if (wasCloudFile) {
            markCloudLifecycleFileId_INDEX2(fileToDelete.id);
            removeCloudActiveFileId_INDEX2(fileToDelete.id);
        }

        updateStatsAndDisplay();

        const storageInfoAfter = getStorageInfo();
        const usedSizeAfter = parseFloat(storageInfoAfter.used);
        const availableAfter = parseFloat(storageInfoAfter.available);
        
        if (usedSizeBefore >= 300 && usedSizeAfter < 300) {
            // المساحة كانت ممتلئة والآن متاح مساحة
            showNotification(`🗑️ تم نقل الملف إلى سلة المحذوفات\n\n✅ المساحة المتاحة الآن: ${availableAfter.toFixed(2)}MB\n🔄 يمكنك الآن استرجاع الملفات من السلة أو النسخ الاحتياطية`);
        } else {
            showNotification('🗑️ تم نقل الملف إلى سلة المحذوفات');
        }

        var cloudSync = wasCloudFile && canUseCloudStorage_INDEX2();
        runDeferredDeletePersist_INDEX2(function () {
            return enqueueCloudSync_INDEX2(function () {
                return persistAfterActiveFileDelete_INDEX2({
                    saveDeletedMetadata: true,
                    removeFromMediaIdb: true,
                    fileId: fileToDelete.id,
                    cloudSync: cloudSync
                });
            });
        }, 'active-delete');
    }
}

// ==================== وظائف قائمة المستخدم ====================

function toggleUserMenu(ev) {
    if (ev && typeof ev.stopPropagation === 'function') {
        ev.stopPropagation();
    }
    const dropdown = document.getElementById('userDropdown');
    const userMenu = dropdown ? dropdown.closest('.user-menu') : null;
    if (dropdown) {
        dropdown.classList.toggle('show');
        if (userMenu) {
            userMenu.classList.toggle('active', dropdown.classList.contains('show'));
        }
    } else {
        console.error('❌ القائمة المنسدلة غير موجودة');
    }
}

// إغلاق القائمة عند النقر خارجها (التطبيق فقط — تجنّب كسر لوحة التحكم)
if (!window.GOSTA_ADMIN_ASSISTANT_PAGE) {
    document.addEventListener('click', function (event) {
        const dropdown = document.getElementById('userDropdown');
        if (!dropdown) return;
        const userMenu = dropdown.closest('.user-menu');
        if (!userMenu) return;
        if (!userMenu.contains(event.target)) {
            dropdown.classList.remove('show');
            userMenu.classList.remove('active');
        }
    });

    window.addEventListener('click', function (event) {
        const modal = document.getElementById('mediaModal');
        if (modal && event.target === modal) {
            closeMediaModal();
        }
    });
}

// ==================== التهيئة ====================

window.onGostaUserStorageScopeChanged_INDEX2 = async function () {
    try {
        if (db) {
            db.close();
            db = null;
        }
        await initDatabase();
        loadFilesOnStart().then(function () {
            if (canUseCloudStorage_INDEX2()) {
                return loadFilesFromCloud_INDEX2();
            }
        }).then(function () {
            if (typeof updateStatsAndDisplay === 'function') {
                updateStatsAndDisplay();
            }
        }).catch(function (eCloudScope) {
            console.warn('onGostaUserStorageScopeChanged cloud', eCloudScope);
        });
        if (typeof displaySubscriptionBar === 'function') displaySubscriptionBar();
        if (typeof updateStorageLimitsBySubscription === 'function') updateStorageLimitsBySubscription();
    } catch (e) {
        console.warn('onGostaUserStorageScopeChanged_INDEX2', e);
    }
};

window.addEventListener('load', async function() {    
    try {
        if (typeof runGostaBootstrapStorage_INDEX2 === 'function') {
            await runGostaBootstrapStorage_INDEX2();
        }
        await initDatabase();
    } catch (error) {
        console.warn('⚠️ تحذير: فشل تهيئة IndexedDB', error);
    }
    
    // ✅ مسح فلترة النسخ الاحتياطية عند تحميل الصفحة
    sessionStorage.removeItem('backupFilterDateFrom_INDEX2');
    sessionStorage.removeItem('backupFilterDateTo_INDEX2');
    
    // تحميل الملفات يتم في initializeApp (DOMContentLoaded) — تجنّب loadFilesOnStart هنا لأنه كان يعيد بيانات السلة القديمة بعد المزامنة

    // ✅ التحقق من الاشتراك وعرض شريط الاشتراك
    setTimeout(function() {
        displaySubscriptionBar();
        updateStorageLimitsBySubscription();
        console.log('✅ تم تحديث حالة الاشتراك');
    }, 200);
    
    migrateLegacyUnverifiedAccountToPending_INDEX2();

    /* لا تُفتح الحاسبة إلا لحساب مفعّل ومسجّل دخوله — pending لا يُعد مسجّلاً */
    const accountRaw = localStorage.getItem('userAccount_INDEX2');
    const pendingLoad = getPendingEmailVerification_INDEX2();
    if (!accountRaw && pendingLoad && pendingLoad.email) {
        currentUser = null;
        userPassword = '';
        encryptionKey = null;
        showPage('loginPage');
        showEmailVerificationUI(pendingLoad.email, { reopened: true });
    } else if (accountRaw) {
        const user = JSON.parse(accountRaw);
        if (!isEmailVerified(user)) {
            currentUser = null;
            userPassword = '';
            encryptionKey = null;
            showPage('loginPage');
            showEmailVerificationUI(user.email, { reopened: true });
        } else if (localStorage.getItem('currentUserEmail_INDEX2')) {
            currentUser = user.email;
            userPassword = user.password;
            generateEncryptionKey(user.password);
            showPage('calculatorPage');
        } else {
            currentUser = null;
            userPassword = '';
            showPage('loginPage');
        }
    } else {
        showPage('loginPage');
    }
    
    // تهيئة معالج رفع الملفات
    initFileUpload();
    ensureUserFoldersInitialized_INDEX2();
    refreshUserFoldersUI_INDEX2();
    bindUserFoldersModal_INDEX2();
    bindVaultConfirmDialog_INDEX2();
    bindMoveFileFolderModal_INDEX2();
    if (canUseCloudStorage_INDEX2() && getCurrentUserEmailForCloud_INDEX2()) {
        loadUserFoldersFromCloud_INDEX2().catch(function (folderLoadErr) {
            console.warn('⚠️ تعذر جلب المجلدات من السحابة:', folderLoadErr);
        });
    }
});


// منع التحديد والنسخ من الصور
document.addEventListener('selectstart', function(e) {
    if (e.target.tagName === 'IMG' || e.target.tagName === 'VIDEO') {
        e.preventDefault();
    }
});

// ==================== حوار تأكيد الخزنة ====================

var vaultConfirmResolver_INDEX2 = null;

function showVaultConfirmDialog_INDEX2(opts) {
    opts = opts || {};
    return new Promise(function (resolve) {
        var modal = document.getElementById('vaultConfirmModal_INDEX2');
        var titleEl = document.getElementById('vaultConfirmTitle_INDEX2');
        var messageEl = document.getElementById('vaultConfirmMessage_INDEX2');
        var okBtn = document.getElementById('vaultConfirmOk_INDEX2');
        var cancelBtn = document.getElementById('vaultConfirmCancel_INDEX2');
        if (!modal || !titleEl || !messageEl || !okBtn || !cancelBtn) {
            resolve(window.confirm(String(opts.message || opts.title || 'تأكيد')));
            return;
        }
        if (vaultConfirmResolver_INDEX2) {
            closeVaultConfirmDialog_INDEX2(false);
        }
        vaultConfirmResolver_INDEX2 = resolve;
        titleEl.textContent = opts.title || 'تأكيد';
        messageEl.textContent = typeof opts.message === 'string' ? opts.message : '';
        okBtn.textContent = opts.confirmLabel || 'تأكيد';
        cancelBtn.textContent = opts.cancelLabel || 'إلغاء';
        okBtn.classList.toggle('vault-confirm-modal__btn--danger', opts.variant === 'danger');
        modal.classList.add('show');
        setTimeout(function () {
            okBtn.focus();
        }, 40);
    });
}

function closeVaultConfirmDialog_INDEX2(confirmed) {
    var modal = document.getElementById('vaultConfirmModal_INDEX2');
    if (modal) {
        modal.classList.remove('show');
    }
    var resolver = vaultConfirmResolver_INDEX2;
    vaultConfirmResolver_INDEX2 = null;
    if (resolver) {
        resolver(!!confirmed);
    }
}

function bindVaultConfirmDialog_INDEX2() {
    var modal = document.getElementById('vaultConfirmModal_INDEX2');
    if (!modal || modal.dataset.bound === '1') {
        return;
    }
    modal.dataset.bound = '1';
    var cancelBtn = document.getElementById('vaultConfirmCancel_INDEX2');
    var okBtn = document.getElementById('vaultConfirmOk_INDEX2');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', function () {
            closeVaultConfirmDialog_INDEX2(false);
        });
    }
    if (okBtn) {
        okBtn.addEventListener('click', function () {
            closeVaultConfirmDialog_INDEX2(true);
        });
    }
    modal.addEventListener('click', function (ev) {
        if (ev.target === modal) {
            closeVaultConfirmDialog_INDEX2(false);
        }
    });
    document.addEventListener('keydown', function (ev) {
        if (ev.key !== 'Escape') {
            return;
        }
        if (!modal.classList.contains('show')) {
            return;
        }
        closeVaultConfirmDialog_INDEX2(false);
    });
}

// ==================== دالة الإشعارات ====================

function showNotification(message, durationMs, variant) {
    const ms = typeof durationMs === 'number' && durationMs > 0 ? durationMs : 3200;
    const v = variant === 'success' || variant === 'error' || variant === 'info' ? variant : '';
    const notification = document.createElement('div');
    notification.className = 'toast-notification' + (v ? ' toast-notification--' + v : '');
    notification.setAttribute('role', 'status');
    if (v) {
        const icon = document.createElement('div');
        icon.className = 'toast-notification__icon';
        if (v === 'error') {
            icon.classList.add('toast-notification__icon--error');
        } else if (v === 'info') {
            icon.classList.add('toast-notification__icon--info');
        }
        icon.setAttribute('aria-hidden', 'true');
        icon.textContent = v === 'success' ? '✓' : v === 'error' ? '✕' : '☁';
        const body = document.createElement('div');
        body.className = 'toast-notification__body';
        body.style.whiteSpace = 'pre-line';
        body.textContent = typeof message === 'string' ? message : '';
        notification.appendChild(icon);
        notification.appendChild(body);
    } else {
        notification.innerHTML = message;
    }
    document.body.appendChild(notification);

    setTimeout(function () {
        notification.classList.add('show');
    }, 10);

    setTimeout(function () {
        notification.classList.remove('show');
        setTimeout(function () {
            if (notification.parentNode) {
                notification.parentNode.removeChild(notification);
            }
        }, 300);
    }, ms);
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

function normalizeVaultFileSearchQuery_INDEX2(q) {
    return String(q || '').trim().toLowerCase();
}

function fileMatchesVaultSearch_INDEX2(file, query) {
    if (!query) {
        return true;
    }
    var name = file && file.name ? String(file.name).toLowerCase() : '';
    return name.indexOf(query) !== -1;
}

function filterListByVaultSearch_INDEX2(list) {
    var q = normalizeVaultFileSearchQuery_INDEX2(vaultFileSearchQuery_INDEX2);
    if (!q || !Array.isArray(list)) {
        return list;
    }
    return list.filter(function (file) {
        return fileMatchesVaultSearch_INDEX2(file, q);
    });
}

function syncVaultFileSearchUi_INDEX2() {
    var input = document.getElementById('vaultFileSearchInput_INDEX2');
    var clearBtn = document.getElementById('vaultFileSearchClear_INDEX2');
    if (input && input.value !== vaultFileSearchQuery_INDEX2) {
        input.value = vaultFileSearchQuery_INDEX2;
    }
    if (clearBtn) {
        clearBtn.hidden = !vaultFileSearchQuery_INDEX2;
    }
}

function onVaultFileSearchInput_INDEX2() {
    var input = document.getElementById('vaultFileSearchInput_INDEX2');
    vaultFileSearchQuery_INDEX2 = input ? input.value : '';
    syncVaultFileSearchUi_INDEX2();
    refreshVaultListForCurrentFilter_INDEX2();
}

function clearVaultFileSearch_INDEX2() {
    vaultFileSearchQuery_INDEX2 = '';
    var input = document.getElementById('vaultFileSearchInput_INDEX2');
    if (input) {
        input.value = '';
        input.focus();
    }
    syncVaultFileSearchUi_INDEX2();
    refreshVaultListForCurrentFilter_INDEX2();
}

function refreshVaultListForCurrentFilter_INDEX2() {
    if (currentFilter === 'trash') {
        renderTrashView_INDEX2();
    } else if (currentFilter === 'backup') {
        showBackup({ skipCloudRefresh: true });
    } else if (currentFilter !== 'trash' && currentFilter !== 'backup') {
        updateStatsAndDisplay();
    }
}

function getVaultSearchEmptyMessage_INDEX2(context) {
    var q = normalizeVaultFileSearchQuery_INDEX2(vaultFileSearchQuery_INDEX2);
    if (!q) {
        return null;
    }
    var label = '«' + vaultFileSearchQuery_INDEX2.trim() + '»';
    if (context === 'trash') {
        return '🔍 لا توجد ملفات في سلة المحذوفات تطابق ' + label;
    }
    if (context === 'backup') {
        return '🔍 لا توجد نسخ احتياطية تطابق ' + label;
    }
    return '🔍 لا توجد ملفات تطابق ' + label;
}

/** رسم سلة المحذوفات من الذاكرة (فوري — بدون انتظار السحابة) */
function renderTrashView_INDEX2() {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;

    sortVaultRecordsNewestFirst_INDEX2(deletedFiles);
    setVaultFilesCarouselLayout_INDEX2(false);
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

    const trashToolbar = document.createElement('div');
    trashToolbar.className = 'vault-bulk-actions';
    trashToolbar.innerHTML =
        '<span class="vault-bulk-actions-label">🗑️ ' +
        deletedFiles.length +
        ' ملف في السلة</span>' +
        '<button type="button" class="vault-bulk-btn vault-bulk-btn--danger" onclick="deleteAllTrashPermanently_INDEX2()">🗑️ حذف الكل نهائي</button>';
    filesList.appendChild(trashToolbar);

    var trashItemsToShow = [];
    deletedFiles.forEach(function (file, index) {
        if (fileMatchesVaultSearch_INDEX2(file, normalizeVaultFileSearchQuery_INDEX2(vaultFileSearchQuery_INDEX2))) {
            trashItemsToShow.push({ file: file, index: index });
        }
    });
    var trashSearchEmpty = getVaultSearchEmptyMessage_INDEX2('trash');
    if (trashItemsToShow.length === 0 && trashSearchEmpty) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        emptyDiv.innerHTML = '<p>' + trashSearchEmpty + '</p>';
        filesList.appendChild(emptyDiv);
        return;
    }
    
    // عرض الملفات المحذوفة
    trashItemsToShow.forEach(function (item) {
        var file = item.file;
        var index = item.index;
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';
        fileItem.setAttribute('data-trash-index', String(index));

        // استخدم أيقونة بدلاً من الصورة (لأننا نحتفظ بـ metadata فقط)
        const iconElement = document.createElement('div');
        iconElement.style.cssText = `
            width: 100%; height: 100%; 
            display: flex; align-items: center; justify-content: center;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            color: white; font-size: 40px;
            opacity: 0.6;
        `;
        iconElement.textContent = getVaultTrashIcon_INDEX2(file);
          fileItem.innerHTML = `
            <div class="file-preview" style="position: relative; background: #f0f0f0; cursor: pointer;" onclick="toggleRecycleActionsOverlay_INDEX2('trash', ${index}, event)">
                ${iconElement.outerHTML}
                ${getVaultDocCornerBadgeHtml_INDEX2(file)}
                <span style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0,0,0,0.7); color: white; padding: 10px 15px; border-radius: 5px; font-size: 12px; pointer-events: none;">
                    تم حذفه
                </span>
                <div class="file-actions vault-trash-actions" onclick="event.stopPropagation()">
                    <button type="button" class="vault-recycle-btn vault-recycle-btn--restore" onclick="restoreFile(${index})">↩️ استعادة</button>
                    <button type="button" class="vault-recycle-btn vault-recycle-btn--delete" onclick="deleteFilePermanently(${index})">🗑️ حذف</button>
                </div>
            </div>
            <div class="file-name">${file.name}</div>
            <div class="file-name" style="font-size: 11px; color: #999;">📦 ${file.size}</div>
            <div class="file-name" style="font-size: 10px; color: #f44336;">🕐 ${file.deletedAt}</div>
        `;
        
        filesList.appendChild(fileItem);
    });
    bindFileActionsOverlayDismiss_INDEX2();
}

// عرض سلة المحذوفات
function showTrash(options) {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;

    var opts = options || {};

    currentFilter = 'trash';

    const filterButtons = document.querySelectorAll('.filter-btn');
    filterButtons.forEach(btn => {
        btn.classList.remove('active');
        if (btn.textContent.includes('سلة') || btn.textContent.includes('🗑️')) {
            btn.classList.add('active');
        }
    });

    renderTrashView_INDEX2();

    if (!opts.skipCloudRefresh && getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2()) {
        runDeferredDeletePersist_INDEX2(async function () {
            if (window.PR_SAFE_AUTH_DISCOVERY) {
                await window.PR_SAFE_AUTH_DISCOVERY;
            }
            await loadFilesFromCloud_INDEX2({ skipDisplay: true, hydrate: false });
            if (currentFilter === 'trash') {
                renderTrashView_INDEX2();
            }
        }, 'trash-cloud-refresh');
    }
}

// استعادة ملف من سلة المحذوفات
async function restoreFile(index) {
    if (blockActionUntilUpgrade_INDEX2('استعادة الملفات')) return;
    const restoreOk = await showVaultConfirmDialog_INDEX2({
        title: 'استعادة الملف',
        message: 'هل تريد استعادة هذا الملف؟',
        confirmLabel: 'استعادة'
    });
    if (restoreOk) {
        const fileToRestore = deletedFiles[index];
        
        // ===== فحص حدود الاستعادة للـ INDEX2 =====
        // 1. فحص عدد الملفات المستعادة
        const currentRestoredCount = files.length;
        if (currentRestoredCount >= MAX_RESTORE_FILES) {
            showNotification(`⚠️ لا يمكن استعادة أكثر من ${MAX_RESTORE_FILES} ملفات في GOSTA`);
            return;
        }
          // 2. فحص حجم الملف المستعاد
        const storageInfo = getStorageInfo();
        const usedSize = parseFloat(storageInfo.used);
        const availableSize = parseFloat(storageInfo.available);
        const maxSize = parseFloat(storageInfo.max);
        const fileSize = parseFloat(fileToRestore.size);
        if (fileSize > maxSize) {
            showNotification(`⚠️ حجم الملف كبير جداً (الحد الأقصى للاستعادة ${maxSize}MB)`);
            return;
        }
          // 3. فحص الحجم الكلي بعد الاستعادة - بناء على سعة الخطة الحالية.
        
        // ✅ التحقق: إذا كانت المساحة المستخدمة تساوي 20MB تماماً، لا يمكن الاسترجاع
        if (usedSize >= maxSize) {
            showNotification(`❌ المساحة المتاحة ممتلئة (${usedSize}MB من ${maxSize}MB)\n\n🗑️ يرجى حذف بعض الملفات أولاً لتحرير المساحة`);
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
        
        loadTrashRecordForRestore_INDEX2(fileToRestore)
            .then(function (mergedInitial) {
                if (!mergedInitial) {
                    showNotification('❌ خطأ: تعذر قراءة الملف من السلة');
                    return;
                }
                var trashCloudHint =
                    canHydrateCloudRecord_INDEX2(mergedInitial) ||
                    isFileKnownInCloud_INDEX2(mergedInitial) ||
                    isFileKnownInCloud_INDEX2(fileToRestore);
                return ensureRecordDataForRestore_INDEX2(mergedInitial, 'deleted').then(function (mergedSource) {
                    console.log('📦 نتيجة البحث:', {
                        found: !!mergedSource,
                        hasData: !!mergedSource?.data,
                        cloud: fileIsStoredInCloud_INDEX2(mergedSource)
                    });

                    if (!canRestoreTrashRecord_INDEX2(mergedSource)) {
                        console.error('❌ لا يمكن استعادة الملف — لا بيانات:', mergedSource);
                        var cloudOnlyMeta =
                            fileIsStoredInCloud_INDEX2(mergedSource) ||
                            fileIsStoredInCloud_INDEX2(fileToRestore) ||
                            (isFileKnownInCloud_INDEX2(mergedSource) && canUseCloudStorage_INDEX2());
                        showNotification(
                            cloudOnlyMeta
                                ? '❌ الملف مسجّل سحابياً لكن المحتوى غير موجود على R2 ولا توجد نسخة محلية في السلة. احذفه من السلة وأعد رفع الصورة من المعرض.'
                                : '❌ بيانات الملف غير متوفرة للاستعادة على هذا الجهاز'
                        );
                        return;
                    }

                    var restoredFile = buildRestoredFileFromTrashSource_INDEX2(mergedSource);
                    applyRestoreFromTrash_INDEX2(restoredFile, index, trashCloudHint);
                });
            })
            .catch(function (error) {
                console.error('❌ خطأ في استعادة الملف:', error);
                showNotification('❌ خطأ: ' + (error && error.message ? error.message : 'حاول مرة أخرى'));
            });
    }
}

// حذف نهائي من سلة المحذوفات
async function deleteFilePermanently(index) {
    if (blockActionUntilUpgrade_INDEX2('الحذف النهائي')) return;
    const permanentOk = await showVaultConfirmDialog_INDEX2({
        title: 'حذف نهائي',
        message: getPermanentDeleteConfirmMessage_INDEX2(),
        confirmLabel: 'حذف نهائي',
        variant: 'danger'
    });
    if (permanentOk) {
        const fileToDelete = deletedFiles[index];
        const wasCloudFile = isFileKnownInCloud_INDEX2(fileToDelete);
        console.log('🗑️ حذف نهائي للملف:', fileToDelete.name);

        const fullFromTrash = await loadTrashRecordForRestore_INDEX2(fileToDelete);
        const backupFile = buildBackupFileFromTrashRecord_INDEX2(fullFromTrash || fileToDelete);

        prependVaultRecord_INDEX2(backupFiles, backupFile);
        try {
            await saveBackupFileToIndexedDB_INDEX2(backupFile);
        } catch (backupIdbErr) {
            console.warn('⚠️ حفظ النسخة الاحتياطية في IndexedDB:', backupIdbErr);
        }
        
        // حفظ النسخس الاحتياطية في localStorage (معلومات فقط) - منفصل عن INDEX
        try {
            let backupData = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
            
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
            
            backupData.unshift(backupInfo);
            
            // الاحتفاظ بأحدث 50 نسخة احتياطية فقط
            if (backupData.length > 50) {
                backupData = backupData.slice(0, 50);
                backupFiles = backupFiles.slice(0, 50);
            }
            
            lsScopedSet_INDEX2('backup_files_INDEX2', JSON.stringify(backupData));
            console.log('💾 تم حفظ معلومات النسخة الاحتياطية في INDEX2:', fileToDelete.name);
        } catch (error) {
            console.warn('⚠️ تحذير: تعذر حفظ النسخة الاحتياطية في localStorage (قد يكون التخزين ممتلئاً):', error);
        }
        
        deletedFiles.splice(index, 1);

        if (wasCloudFile) {
            markCloudLifecycleFileId_INDEX2(fileToDelete.id);
            removeCloudActiveFileId_INDEX2(fileToDelete.id);
        }

        showTrash({ skipCloudRefresh: true });
        showNotification(getPermanentDeleteDoneNotification_INDEX2());

        var cloudSyncPerm = wasCloudFile && canUseCloudStorage_INDEX2();
        runDeferredDeletePersist_INDEX2(function () {
            return enqueueCloudSync_INDEX2(function () {
                return persistAfterPermanentTrashDelete_INDEX2({
                    removeFromDeletedIdb: true,
                    fileId: fileToDelete.id,
                    backupFile: backupFile,
                    cloudSync: cloudSyncPerm
                });
            });
        }, 'permanent-trash-delete');
    }
}

async function deleteAllTrashPermanently_INDEX2() {
    if (blockActionUntilUpgrade_INDEX2('الحذف النهائي')) {
        return;
    }
    if (!Array.isArray(deletedFiles) || deletedFiles.length === 0) {
        showNotification('🗑️ سلة المحذوفات فارغة');
        return;
    }
    var count = deletedFiles.length;
    var bulkMsg =
        getPermanentDeleteConfirmMessage_INDEX2().replace('هذا الملف', 'كل الملفات (' + count + ')') +
        '\n\n⚠️ ستُنقل جميعها إلى النسخ الاحتياطية.';
    var permanentOk = await showVaultConfirmDialog_INDEX2({
        title: 'حذف الكل نهائي',
        message: bulkMsg,
        confirmLabel: 'حذف الكل',
        variant: 'danger'
    });
    if (!permanentOk) {
        return;
    }

    var toProcess = deletedFiles.slice();
    var backupRecords = [];
    var cloudIds = [];

    for (var ti = 0; ti < toProcess.length; ti++) {
        var fileToDelete = toProcess[ti];
        var fullFromTrash = await loadTrashRecordForRestore_INDEX2(fileToDelete);
        var backupFile = buildBackupFileFromTrashRecord_INDEX2(fullFromTrash || fileToDelete);
        backupRecords.push(backupFile);
        try {
            await saveBackupFileToIndexedDB_INDEX2(backupFile);
        } catch (backupIdbErr) {
            console.warn('⚠️ حفظ backupData:', backupIdbErr);
        }
        if (isFileKnownInCloud_INDEX2(fileToDelete)) {
            cloudIds.push(fileToDelete.id);
            markCloudLifecycleFileId_INDEX2(fileToDelete.id);
            removeCloudActiveFileId_INDEX2(fileToDelete.id);
        }
    }

    backupRecords.forEach(function (bf) {
        prependVaultRecord_INDEX2(backupFiles, bf);
    });
    if (backupFiles.length > 50) {
        backupFiles = backupFiles.slice(0, 50);
    }
    persistBackupFilesMetadata_INDEX2();

    deletedFiles = [];

    showTrash({ skipCloudRefresh: true });
    showNotification('🗑️ تم حذف ' + count + ' ملف(ات) نهائياً\n💾 حُفظت في النسخ الاحتياطية');

    var cloudSyncBulk = cloudIds.length > 0 && canUseCloudStorage_INDEX2();
    runDeferredDeletePersist_INDEX2(function () {
        return enqueueCloudSync_INDEX2(function () {
            return persistAfterBulkPermanentTrashDelete_INDEX2({
                fileIds: toProcess.map(function (f) {
                    return f.id;
                }),
                backupRecords: backupFiles.slice(),
                cloudSync: cloudSyncBulk
            });
        });
    }, 'bulk-permanent-trash-delete');
}

// عرض النسخ الاحتياطية
function showBackup(options) {
    var opts = options || {};
    // في الخطة الأساسية: الميزة مقفلة وتحتاج ترقية إلى المتقدمة.
    try {
        if (typeof checkSubscriptionValidity_INDEX2 === 'function') {
            const info = checkSubscriptionValidity_INDEX2();
            if (info && info.status === 'active' && info.plan === 'INDEX3') {
                const msg = 'هذه الميزة مفعلة لدى الخطة المتقدمة فقط. هل تريد الترقية الآن؟';
                if (typeof showNotification === 'function') {
                    showNotification('ℹ️ ' + msg);
                } else {
                    alert(msg);
                }
                const wantsUpgrade = confirm(msg);
                if (wantsUpgrade && typeof showSubscriptionsPage === 'function') {
                    showSubscriptionsPage();
                } else if (typeof filterFiles === 'function') {
                    filterFiles('all');
                }
                return;
            }
        }
    } catch (e) {
        console.warn('⚠️ خطأ تحقق النسخ الاحتياطية:', e);
    }

    currentFilter = 'backup';
    
    const filesList = document.getElementById('filesList');
    if (!filesList) return;

    setVaultFilesCarouselLayout_INDEX2(false);
    
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
    
    // تحميل النسخ الاحتياطية من localStorage (INDEX2 منفصل)
    let backupDataFromStorage = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
    sortVaultRecordsNewestFirst_INDEX2(backupFiles);
    if (backupDataFromStorage.length > 0) {
        backupDataFromStorage = backupDataFromStorage.slice();
        sortVaultRecordsNewestFirst_INDEX2(backupDataFromStorage);
    }
    
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
    const totalBackupCount =
        backupDataFromStorage.length > 0 ? backupDataFromStorage.length : backupFiles.length;
    const filterDiv = document.createElement('div');
    filterDiv.className = 'vault-backup-toolbar';
    filterDiv.style.cssText = 'grid-column: 1/-1; background: #f5f5f5; padding: 15px; border-radius: 8px; border-left: 4px solid #ff9800; margin-bottom: 15px;';
    filterDiv.innerHTML = `
        <div class="vault-bulk-actions vault-bulk-actions--inline" style="margin-bottom: 12px;">
            <span class="vault-bulk-actions-label">💾 ${totalBackupCount} نسخة احتياطية</span>
            <button type="button" class="vault-bulk-btn vault-bulk-btn--danger" onclick="deleteAllBackupFiles_INDEX2()">🗑️ حذف الكل</button>
        </div>
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
    const savedDateFrom = sessionStorage.getItem('backupFilterDateFrom_INDEX2');
    const savedDateTo = sessionStorage.getItem('backupFilterDateTo_INDEX2');
    
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

    displayFiles = filterListByVaultSearch_INDEX2(displayFiles);
    
    // إذا كانت الملفات المفلترة فارغة
    if (displayFiles.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.style.cssText = 'grid-column: 1/-1; text-align: center; padding: 40px; color: #999;';
        var backupEmptyMsg = getVaultSearchEmptyMessage_INDEX2('backup');
        emptyDiv.innerHTML = '<p>' + (backupEmptyMsg || '📂 لا توجد ملفات في نطاق التاريخ المحدد') + '</p>';
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
        fileItem.setAttribute('data-backup-index', String(realIndex));

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
            <div class="file-preview" style="position: relative; background: #fff3e0; border-radius: 4px; overflow: hidden; cursor: pointer;" onclick="toggleRecycleActionsOverlay_INDEX2('backup', ${realIndex}, event)">
                ${iconElement.outerHTML}
                <span style="position: absolute; top: 5px; right: 5px; background: rgba(255, 152, 0, 0.9); color: white; padding: 5px 8px; border-radius: 3px; font-size: 11px; pointer-events: none;">
                    نسخة احتياطية
                </span>
                <div class="file-actions vault-backup-actions" onclick="event.stopPropagation()">
                    <button type="button" class="vault-recycle-btn vault-recycle-btn--restore" onclick="restoreFromBackup(${realIndex})">♻️ استرجاع</button>
                    <button type="button" class="vault-recycle-btn vault-recycle-btn--delete" onclick="deleteBackupFile(${realIndex})">🗑️ حذف نهائي</button>
                </div>
            </div>
            <div class="file-name" style="margin-top: 10px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;">${file.name}</div>
            <div class="file-name" style="font-size: 11px; color: #999;">📦 ${file.size}</div>
            <div class="file-name" style="font-size: 10px; color: #ff9800;">💾 ${file.backedUpAt}</div>
        `;
        
        filesList.appendChild(fileItem);
    });
    bindFileActionsOverlayDismiss_INDEX2();

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

    if (!opts.skipCloudRefresh && getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2()) {
        runDeferredDeletePersist_INDEX2(async function () {
            if (window.PR_SAFE_AUTH_DISCOVERY) {
                await window.PR_SAFE_AUTH_DISCOVERY;
            }
            await loadFilesFromCloud_INDEX2({ skipDisplay: true, hydrate: false });
            if (currentFilter === 'backup') {
                showBackup({ skipCloudRefresh: true });
            }
        }, 'backup-cloud-refresh');
    }
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
    if (dateFrom) sessionStorage.setItem('backupFilterDateFrom_INDEX2', dateFrom);
    if (dateTo) sessionStorage.setItem('backupFilterDateTo_INDEX2', dateTo);
    
    // إعادة عرض النسخ الاحتياطية بالفلترة الجديدة
    showBackup();
    showNotification('✅ تم تطبيق الفلترة');
}

// دالة إلغاء فلترة التاريخ
function clearBackupDateFilter() {
    sessionStorage.removeItem('backupFilterDateFrom_INDEX2');
    sessionStorage.removeItem('backupFilterDateTo_INDEX2');
    document.getElementById('backupDateFrom').value = '';
    document.getElementById('backupDateTo').value = '';
    showBackup();
    showNotification('✅ تم إلغاء الفلترة');
}

// استرجاع ملف من النسخة الاحتياطية
async function restoreFromBackup(index) {
    if (blockActionUntilUpgrade_INDEX2('الاسترجاع من النسخة الاحتياطية')) return;
    // احصل على البيانات من localStorage (INDEX2 فقط) أولاً
    let backupDataFromStorage = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
    let displayFiles = backupDataFromStorage.length > 0 ? backupDataFromStorage : backupFiles;
    
    const fileToRestore = displayFiles[index];      // التحقق من نطاق التاريخ
    const savedDateFrom = sessionStorage.getItem('backupFilterDateFrom_INDEX2');
    const savedDateTo = sessionStorage.getItem('backupFilterDateTo_INDEX2');
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
    }
    const backupRestoreOk = await showVaultConfirmDialog_INDEX2({
        title: 'استرجاع من النسخة الاحتياطية',
        message: 'هل تريد استرجاع هذا الملف من النسخة الاحتياطية؟',
        confirmLabel: 'استرجاع'
    });
    if (backupRestoreOk) {
        // ===== فحص المساحة المتاحة =====
        const storageInfo = getStorageInfo();
        const usedSize = parseFloat(storageInfo.used);
        const availableSize = parseFloat(storageInfo.available);
        const maxSize = parseFloat(storageInfo.max);
        const fileSize = parseFloat(fileToRestore.size);
        
        // ✅ التحقق: إذا كانت المساحة المستخدمة تساوي سعة الخطة تماماً، لا يمكن الاسترجاع
        if (usedSize >= maxSize) {
            showNotification(`❌ المساحة المتاحة ممتلئة (${usedSize}MB من ${maxSize}MB)\n\n🗑️ يرجى حذف بعض الملفات أولاً لتحرير المساحة`);
            return;
        }
        
        // ✅ التحقق: إذا كان الملف سيتجاوز الحد الأقصى
        if (fileSize > availableSize) {
            showNotification(`⚠️ المساحة المتاحة غير كافية\n\n📊 المساحة المتاحة: ${availableSize.toFixed(2)}MB\n📦 حجم الملف: ${fileSize.toFixed(2)}MB\n\n🗑️ يرجى حذف ملفات لتحرير المساحة الكافية`);
            return;
        }
        
        attemptRestoreFromBackup_INDEX2(fileToRestore);
    }
}

// دالة للبحث عن البيانات الكاملة من IndexedDB (جدول backupData)
async function getFullBackupFileData(fileId) {
    var rec = await getBackupFileFromIdbById_INDEX2(fileId);
    if (rec && rec.data) {
        console.log('✅ تم العثور على البيانات الكاملة في backupData:', fileId);
    } else {
        console.warn('⚠️ البيانات الكاملة غير موجودة في backupData:', fileId);
    }
    return rec;
}

// حذف ملف من النسخة الاحتياطية
async function deleteAllBackupFiles_INDEX2() {
    var storedBackups = [];
    try {
        storedBackups = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
    } catch (e) {
        storedBackups = [];
    }
    var total = Array.isArray(backupFiles) && backupFiles.length ? backupFiles.length : storedBackups.length;
    if (total === 0) {
        showNotification('💾 لا توجد نسخ احتياطية');
        return;
    }
    var backupDeleteOk = await showVaultConfirmDialog_INDEX2({
        title: 'حذف كل النسخ الاحتياطية',
        message:
            'هل تريد حذف جميع النسخ الاحتياطية (' +
            total +
            ') نهائياً؟\n⚠️ لن تتمكن من استعادتها',
        confirmLabel: 'حذف الكل',
        variant: 'danger'
    });
    if (!backupDeleteOk) {
        return;
    }

    var cloudIds = [];
    var sources = Array.isArray(backupFiles) && backupFiles.length ? backupFiles : storedBackups;
    sources.forEach(function (f) {
        if (isFileKnownInCloud_INDEX2(f)) {
            cloudIds.push(f.id);
            unmarkCloudLifecycleFileId_INDEX2(f.id);
            removeCloudActiveFileId_INDEX2(f.id);
        }
    });

    backupFiles = [];
    lsScopedSet_INDEX2('backup_files_INDEX2', JSON.stringify([]));

    showBackup({ skipCloudRefresh: true });
    showNotification('🗑️ تم حذف كل النسخ الاحتياطية (' + total + ')');

    var cloudSyncAll =
        cloudIds.length > 0 && getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2();
    runDeferredDeletePersist_INDEX2(function () {
        return persistAfterBulkBackupDelete_INDEX2({ cloudSync: cloudSyncAll });
    }, 'bulk-backup-delete');
}

async function deleteBackupFile(index) {
    const backupDeleteOk = await showVaultConfirmDialog_INDEX2({
        title: 'حذف نهائي',
        message: 'هل تريد حذف هذا الملف من النسخة الاحتياطية نهائياً؟\n⚠️ لن تتمكن من استعادته',
        confirmLabel: 'حذف نهائي',
        variant: 'danger'
    });
    if (backupDeleteOk) {
        // ✅ احصل على الملف من backupFiles بناءً على الفهرس
        const fileToDelete = backupFiles[index];
        const wasCloudFile = isFileKnownInCloud_INDEX2(fileToDelete);
        
        if (!fileToDelete) {
            console.error('❌ الملف غير موجود في backupFiles:', index);
            showNotification('❌ خطأ: الملف غير موجود');
            return;
        }
        
        console.log('🗑️ حذف الملف من النسخة الاحتياطية:', fileToDelete.name, 'ID:', fileToDelete.id);
          // ✅ حذف الملف من backupFiles array بناءً على المعرّف وليس الفهرس
        backupFiles = backupFiles.filter(f => f.id !== fileToDelete.id);
        
        // تحديث localStorage (INDEX2) - احذف الملف من قائمة المعلومات
        let backupData = JSON.parse(lsScopedGet_INDEX2('backup_files_INDEX2')) || [];
        backupData = backupData.filter(f => f.id !== fileToDelete.id);
        lsScopedSet_INDEX2('backup_files_INDEX2', JSON.stringify(backupData));
        
        if (wasCloudFile) {
            removeCloudActiveFileId_INDEX2(fileToDelete.id);
        }

        showBackup();
        showNotification('🗑️ تم حذف الملف من النسخة الاحتياطية');
        console.log('✅ تم حذف الملف بنجاح - العدد المتبقي:', backupFiles.length);

        var cloudSyncBackup =
            wasCloudFile && getStorageMode_INDEX2() === 'cloud' && canUseCloudStorage_INDEX2();
        runDeferredDeletePersist_INDEX2(function () {
            return persistAfterBackupFileDelete_INDEX2({
                removeFromBackupIdb: true,
                fileId: fileToDelete.id,
                cloudSync: cloudSyncBackup
            });
        }, 'backup-delete');
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
                (type === 'videos' && btn.textContent.includes('فيديو')) ||
                (type === 'documents' && btn.textContent.includes('مستندات'))) {
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
    closeAllFileActionsOverlays_INDEX2();
    toggleInitialEmptyState_INDEX2(files.length === 0);
    
    // ✅ مسح الواجهة تماماً
    filesList.innerHTML = '';
    
    sortAllVaultListsNewestFirst_INDEX2();
    // الحصول على الملفات المفلترة
    const filteredFiles = getFilteredFiles();
    
    // تحديث الإحصائيات
    updateStats(filteredFiles);
    
    // عرض الملفات المفلترة (بدون مسح إضافي)
    displayFilteredFiles(filteredFiles);
}

// دالة للحصول على الملفات المفلترة
function getFilteredFiles() {
    var list = files;
    if (currentFilter === 'images') {
        list = list.filter(function (file) {
            return file.type.startsWith('image/');
        });
    } else if (currentFilter === 'videos') {
        list = list.filter(function (file) {
            return file.type.startsWith('video/');
        });
    } else if (currentFilter === 'documents') {
        list = list.filter(function (file) {
            return isVaultDocumentType_INDEX2(file.type, file.name);
        });
    }
    if (currentFolderFilterId_INDEX2) {
        if (currentFolderFilterId_INDEX2 === UNCAT_FOLDER_ID_INDEX2) {
            list = list.filter(function (file) {
                return !file.folderId;
            });
        } else {
            list = list.filter(function (file) {
                return file.folderId === currentFolderFilterId_INDEX2;
            });
        }
    }
    return filterListByVaultSearch_INDEX2(list);
}

// دالة تحديث الإحصائيات
function updateStats(filteredFiles) {
    // ✅ حساب إجمالي حجم جميع الملفات المحملة (ليس المفلترة فقط)
    let totalUsedSize = 0;
    files.forEach(file => {
        totalUsedSize += getSizeInMB(file.size);
    });
    
    // عد الصور والفيديوهات والمستندات من الملفات المفلترة
    const imagesCount = filteredFiles.filter(f => f.type.startsWith('image/')).length;
    const videosCount = filteredFiles.filter(f => f.type.startsWith('video/')).length;
    const pdfCount = filteredFiles.filter(function (f) {
        return isVaultPdfFile_INDEX2(f);
    }).length;
    const excelCount = filteredFiles.filter(function (f) {
        return isVaultExcelFile_INDEX2(f);
    }).length;
    const foldersCount = getUserFoldersList_INDEX2().length;
    
    // ✅ الحصول على الحد الأقصى من الاشتراك الحالي
    let maxStorage = FREE_PLAN_STORAGE_MB_INDEX2; // MB - الافتراضي (مجاني)
    
    const subscription = lsScopedGet_INDEX2('userSubscription_INDEX2');
    if (subscription) {
        try {
            const sub = JSON.parse(subscription);
            // التحقق من الصلاحية
            const expiryDate = new Date(sub.expiryDate);
            if (new Date() <= expiryDate && sub.status === 'active') {
                maxStorage = sub.storage || FREE_PLAN_STORAGE_MB_INDEX2; // استخدم سعة الاشتراك
                console.log(`📊 تحديث الإحصائيات بناءً على الاشتراك: ${maxStorage} MB`);
            }
        } catch (e) {
            console.warn('⚠️ خطأ في قراءة الاشتراك:', e);
        }
    }
    
    const availableSpace = Math.max(0, maxStorage - totalUsedSize).toFixed(2);
    
    // تحديث العناصر
    const usedSpaceEl = document.getElementById('usedSpace');
    const availableSpaceEl = document.getElementById('availableSpace');
    const filesCountEl = document.getElementById('filesCount');
    const imagesCountEl = document.getElementById('imagesCount');
    const videosCountEl = document.getElementById('videosCount');
    const foldersCountEl = document.getElementById('foldersCount');
    const pdfCountEl = document.getElementById('pdfCount');
    const excelCountEl = document.getElementById('excelCount');
    
    if (usedSpaceEl) {
        usedSpaceEl.textContent = totalUsedSize.toFixed(2) + ' MB';
        // ✅ تغيير اللون إذا وصلت المساحة للحد الأقصى
        if (totalUsedSize >= maxStorage) {
            usedSpaceEl.style.color = '#f44336';
            usedSpaceEl.style.fontWeight = 'bold';
        } else if (totalUsedSize >= (maxStorage * 0.75)) {
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
        } else if (availableSpace <= (maxStorage * 0.1)) {
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
    if (foldersCountEl) foldersCountEl.textContent = foldersCount;
    if (pdfCountEl) pdfCountEl.textContent = pdfCount;
    if (excelCountEl) excelCountEl.textContent = excelCount;
    updateUploadInfoText_INDEX2(maxStorage);
}

let fileActionsOverlayDocBound_INDEX2 = false;

function closeAllFileActionsOverlays_INDEX2() {
    document.querySelectorAll('.files-grid .file-item.file-actions-open').forEach(function (el) {
        el.classList.remove('file-actions-open');
    });
}

function toggleFileActionsOverlay_INDEX2(fileIndex, ev) {
    if (ev) {
        ev.stopPropagation();
    }
    var list = document.getElementById('filesList');
    if (!list) {
        return;
    }
    var items = list.querySelectorAll('.file-item');
    var willOpen = false;
    items.forEach(function (el) {
        var idx = Number(el.getAttribute('data-file-index'));
        if (idx === fileIndex) {
            willOpen = !el.classList.contains('file-actions-open');
            el.classList.toggle('file-actions-open');
        } else {
            el.classList.remove('file-actions-open');
        }
    });
}

/** سلة المحذوفات / النسخ الاحتياطية — إظهار زرّي الاستعادة والحذف عند الضغط على المعاينة */
function toggleRecycleActionsOverlay_INDEX2(kind, index, ev) {
    if (ev) {
        ev.stopPropagation();
    }
    var list = document.getElementById('filesList');
    if (!list) {
        return;
    }
    var attr = kind === 'backup' ? 'data-backup-index' : 'data-trash-index';
    list.querySelectorAll('.file-item[' + attr + ']').forEach(function (el) {
        var idx = Number(el.getAttribute(attr));
        if (idx === index) {
            el.classList.toggle('file-actions-open');
        } else {
            el.classList.remove('file-actions-open');
        }
    });
}

function bindFileActionsOverlayDismiss_INDEX2() {
    if (fileActionsOverlayDocBound_INDEX2) {
        return;
    }
    fileActionsOverlayDocBound_INDEX2 = true;
    document.addEventListener('click', function () {
        closeAllFileActionsOverlays_INDEX2();
    });
}

// دالة عرض الملفات المفلترة
function displayFilteredFiles(filteredFiles) {
    const filesList = document.getElementById('filesList');
    if (!filesList) return;
    setVaultFilesCarouselLayout_INDEX2(true);
    filesList.innerHTML = '';
    
    // إذا لم توجد ملفات مفلترة
    if (filteredFiles.length === 0) {
        const emptyDiv = document.createElement('div');
        emptyDiv.className = 'vault-files-scroll-empty';
        emptyDiv.style.cssText = 'text-align: center; padding: 40px; color: #999;';
        
        let emptyMessage = getVaultSearchEmptyMessage_INDEX2('main');
        if (!emptyMessage) {
            emptyMessage = '📂 لا توجد ملفات';
            if (currentFilter === 'images') {
                emptyMessage = '🖼️ لا توجد صور';
            } else if (currentFilter === 'videos') {
                emptyMessage = '🎥 لا توجد فيديوهات';
            } else if (currentFilter === 'documents') {
                emptyMessage = '📄 لا توجد مستندات (PDF / Excel)';
            } else if (currentFolderFilterId_INDEX2) {
                emptyMessage = '📁 لا توجد ملفات في هذا المجلد';
            }
        }
        
        emptyDiv.innerHTML = `
            <p>${emptyMessage}</p>
            <p style="font-size: 12px; margin-top: 10px;">قم برفع ملفات جديدة</p>
        `;
        filesList.appendChild(emptyDiv);
        return;
    }
    
    // عرض الملفات
    const videoPreviewPlaceholder = "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='300' height='200'%3E%3Crect width='100%25' height='100%25' fill='%2324263a'/%3E%3Ccircle cx='150' cy='100' r='26' fill='%23ffffff22'/%3E%3Cpolygon points='142,86 142,114 164,100' fill='%23ffffff'/%3E%3C/svg%3E";
    var blurOnCards = isVaultBlurEnabled_INDEX2();
    filteredFiles.forEach((file, index) => {
        const fileItem = document.createElement('div');
        fileItem.className = 'file-item';

        const fileKind = getVaultFileKind_INDEX2(file);
        const isDocument = fileKind === 'document';

        const originalIndex = files.findIndex(function (f) {
            return f && fileIdKey_INDEX2(f.id) === fileIdKey_INDEX2(file.id);
        });
        fileItem.setAttribute('data-file-index', String(originalIndex >= 0 ? originalIndex : index));

        const compressedBadge = file.isCompressed
            ? '<span style="position: absolute; top: 5px; right: 5px; background: #ff9800; color: white; padding: 3px 8px; border-radius: 4px; font-size: 10px; z-index: 5;">مضغوط</span>'
            : '';
        const docCornerBadge = isDocument ? getVaultDocCornerBadgeHtml_INDEX2(file) : '';
        const storageBadge = getFileStorageBadgeHtml_INDEX2(file);
        const isBlockedByPlan = !canOpenFileBySubscription(file);
        const planLockOverlay = isBlockedByPlan
            ? '<div style="position:absolute;inset:0;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:bold;border-radius:8px;pointer-events:none;z-index:7;">🔒 يتطلب اشتراك مدفوع</div>'
            : '';
        const openBtnDisabled = isBlockedByPlan ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : '';
        const transferBtnDisabled = isBlockedByPlan ? 'disabled style="opacity:0.6;cursor:not-allowed;"' : '';
        const lockHintHtml = blurOnCards
            ? '<div class="file-preview-lock-hint" style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); background: rgba(0, 0, 0, 0.7); color: white; padding: 15px 25px; border-radius: 8px; text-align: center; pointer-events: none; z-index: 4;"><div style="font-size: 24px; margin-bottom: 5px;">🔒</div><div style="font-size: 12px; font-weight: bold;">مخفي</div></div>'
            : '';

        const previewSpec = getVaultCardPreviewSpec_INDEX2(file, blurOnCards, videoPreviewPlaceholder);
        const previewDiv = document.createElement('div');
        previewDiv.className = 'file-preview';
        previewDiv.style.cssText = 'position: relative; cursor: pointer;';
        previewDiv.onclick = function (ev) {
            toggleFileActionsOverlay_INDEX2(originalIndex, ev);
        };

        previewDiv.appendChild(buildVaultCardPreviewElement_INDEX2(previewSpec));

        const overlayFrag = document.createElement('div');
        overlayFrag.innerHTML = docCornerBadge + compressedBadge + planLockOverlay + lockHintHtml;
        while (overlayFrag.firstChild) {
            previewDiv.appendChild(overlayFrag.firstChild);
        }

        const actionsDiv = document.createElement('div');
        actionsDiv.className = 'file-actions';
        actionsDiv.onclick = function (ev) {
            ev.stopPropagation();
        };
        actionsDiv.innerHTML =
            '<button type="button" class="file-btn" onclick="event.stopPropagation(); viewMedia(' +
            originalIndex +
            ')" ' +
            openBtnDisabled +
            '>👁️ عرض</button>' +
            '<button type="button" class="file-btn" onclick="event.stopPropagation(); openMoveFileToUserFolderModal_INDEX2(' +
            originalIndex +
            ')" ' +
            transferBtnDisabled +
            ' title="نقل بين المجلدات">📁 مجلد</button>' +
            '<button type="button" class="file-btn transfer" onclick="event.stopPropagation(); transferFileToFolder(' +
            originalIndex +
            ')" ' +
            transferBtnDisabled +
            ' title="تنزيل إلى الجهاز">📥 تنزيل</button>' +
            '<button type="button" class="file-btn delete" onclick="event.stopPropagation(); deleteFile(' +
            originalIndex +
            ')">🗑️ حذف</button>';
        previewDiv.appendChild(actionsDiv);

        fileItem.appendChild(previewDiv);

        var nameEl = document.createElement('div');
        nameEl.className = 'file-name';
        nameEl.textContent = file.name;
        fileItem.appendChild(nameEl);

        var sizeEl = document.createElement('div');
        sizeEl.className = 'file-name';
        sizeEl.style.fontSize = '11px';
        sizeEl.style.color = '#999';
        sizeEl.textContent = '📦 ' + file.size;
        fileItem.appendChild(sizeEl);

        var storageEl = document.createElement('div');
        storageEl.className = 'file-name';
        storageEl.innerHTML = storageBadge;
        fileItem.appendChild(storageEl);

        var folderFrag = document.createElement('div');
        folderFrag.innerHTML = getFileFolderBadgeHtml_INDEX2(file);
        while (folderFrag.firstChild) {
            fileItem.appendChild(folderFrag.firstChild);
        }

        filesList.appendChild(fileItem);
    });
    bindFileActionsOverlayDismiss_INDEX2();
    if (!blurOnCards) {
        hydrateVaultCardPreviews_INDEX2();
    }
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
                ✅ تم اخفاء الملف بنجاح!
            </div>
            
            <!--
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
            -->
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
    localStorage.setItem('pr_safe_permission_INDEX2', 'true');
    hasStoragePermission = true;

    const modal = document.getElementById('permissionModal');
    if (modal) {
        modal.style.display = 'none';
    }

    showNotification('✅ تم قبول الإذن — يمكنك الآن رفع الملفات');
    console.log('✅ تم قبول إذن الوصول');

    // مجلد النسخ على القرص عبر خادم محلي اختياري؛ التخزين الفعلي للملفات في IndexedDB
    try {
        await createPrSafeFolder();
    } catch (e) {
        console.warn('تخطي مجلد pr_safe على القرص (لا يوجد خادم محلي):', e?.message || e);
    }
}

// عند الضغط على "رفض"
function denyPermission() {
    localStorage.setItem('pr_safe_permission_INDEX2', 'false');
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
            body: JSON.stringify({ path: folderPath, indexName: 'INDEX2' }),
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
    if (typeof isFreePlanUsageLocked_INDEX2 === 'function' && isFreePlanUsageLocked_INDEX2()) {
        if (typeof showNotification === 'function') {
            showNotification('⏰ انتهت فترة المجانية التجريبية. يمكنك الدخول فقط، أما الرفع فمقفل حتى الترقية.');
        }
        return false;
    }
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
 * ترحيل الاشتراكات القديمة لتصبح مدة الصلاحية 180 يوم (مرة واحدة).
 */
function migrateSubscriptionDurationIfNeeded() {
    try {
        const raw = lsScopedGet_INDEX2('userSubscription_INDEX2');
        if (!raw) return;

        const subscription = JSON.parse(raw);
        if (!subscription || subscription.status !== 'active') return;
        const isTrialSubscription =
            String(subscription.paymentMethod || '').toLowerCase() === 'trial' ||
            String(subscription.transactionId || '') === 'trial-free-premium' ||
            String(subscription.price || '') === '0' ||
            String(subscription.planName || '').indexOf('تجريب') !== -1;

        // التجربة المجانية ليست اشتراكاً مدفوعاً — أزل السجل الوهمي من التخزين المحلي.
        if (isTrialSubscription) {
            if (typeof stripTrialSubscriptionFromStorage_INDEX2 === 'function') {
                stripTrialSubscriptionFromStorage_INDEX2();
            } else {
                lsScopedRemove_INDEX2('userSubscription_INDEX2');
            }
            console.log('✅ أُزيل سجل التجربة الوهمي (INDEX5) من التخزين المحلي');
            return;
        }

        const planType = String(subscription.type || subscription.plan || '').toUpperCase();
        const isPaidPlan = planType === 'INDEX3' || planType === 'INDEX4' || planType === 'INDEX5';
        if (!isPaidPlan) return;

        // إذا تم ترحيل الخطة المدفوعة سابقاً لا نكرر العملية
        if (Number(subscription.durationDays || 0) === 180) return;

        subscription.expiryDate = new Date(Date.now() + 180 * 24 * 60 * 60 * 1000).toISOString();
        subscription.durationDays = 180;
        lsScopedSet_INDEX2('userSubscription_INDEX2', JSON.stringify(subscription));
        console.log('✅ تم تحديث مدة الاشتراك المدفوع إلى 180 يوم');
    } catch (error) {
        console.warn('⚠️ تعذر ترحيل مدة الاشتراك إلى 180 يوم:', error);
    }
}

// ...existing code...

// ==================== تهيئة التطبيق ====================

// دالة تهيئة شاملة للتطبيق
function hideGostaBootSplash_INDEX2() {
    try {
        var el = document.getElementById('gostaBootSplash');
        if (el) el.style.display = 'none';
    } catch (e) {}
}

async function initializeApp() {
    hideGostaBootSplash_INDEX2();
    if (window.GOSTA_ADMIN_ASSISTANT_PAGE) {
        try {
            console.log('🔧 تهيئة مساعد لوحة التحكم...');
            var prefsDlgAdmin = document.getElementById('aiChatPrefsDialog_INDEX2');
            if (prefsDlgAdmin && !prefsDlgAdmin.dataset.aiPrefsBound) {
                prefsDlgAdmin.dataset.aiPrefsBound = '1';
                prefsDlgAdmin.addEventListener('close', syncAiChatPrefsToggleButton_INDEX2);
            }
            wireGostaAdminAiFabOnce_INDEX2();
        } catch (eAdminAi) {
            console.warn('admin assistant init:', eAdminAi);
        }
        return;
    }
    try {
        console.log('🔧 جاري تهيئة التطبيق...');
        restoreCloudActiveFileIds_INDEX2();
        
        console.log('🔐 جاري تهيئة معالجات المصادقة...');
        initAuthHandlers();
        initEmailVerificationForm();
        initForgotPasswordHandlers();

        try {
            if (typeof wireHuaweiBillingRecoveryListener_INDEX2 === 'function') {
                wireHuaweiBillingRecoveryListener_INDEX2();
            }
            if (typeof recoverHuaweiBillingOnAppResume_INDEX2 === 'function') {
                recoverHuaweiBillingOnAppResume_INDEX2();
            }
        } catch (eHuaweiRec) {
            console.warn('huawei billing recovery:', eHuaweiRec);
        }

        try {
            var prefsDlg = document.getElementById('aiChatPrefsDialog_INDEX2');
            if (prefsDlg && !prefsDlg.dataset.aiPrefsBound) {
                prefsDlg.dataset.aiPrefsBound = '1';
                prefsDlg.addEventListener('close', syncAiChatPrefsToggleButton_INDEX2);
            }
        } catch (ePrefs) {}

        wireGostaAiFabOnce_INDEX2();
        try {
            if (typeof refreshGostaAppAssistantSetting_INDEX2 === 'function') {
                refreshGostaAppAssistantSetting_INDEX2();
            }
        } catch (eAiSet) {}

        migrateLegacyUnverifiedAccountToPending_INDEX2();

        // 0. فحص المستخدم المسجل دخول
        const loggedInUser = localStorage.getItem('currentUserEmail_INDEX2');
        const userAccount = JSON.parse(localStorage.getItem('userAccount_INDEX2') || 'null');
        const pendingBoot = getPendingEmailVerification_INDEX2();

        if (!userAccount && pendingBoot && pendingBoot.email) {
            currentUser = null;
            userPassword = '';
            encryptionKey = null;
            localStorage.removeItem('currentUserEmail_INDEX2');
            showPage('loginPage');
            showEmailVerificationUI(pendingBoot.email, { reopened: true });
            console.log('📧 انتظار تفعيل البريد — الحساب غير مسجّل في البرنامج حتى إدخال الكود');
        } else if (loggedInUser && userAccount) {
            if (!isEmailVerified(userAccount)) {
                localStorage.removeItem('currentUserEmail_INDEX2');
                currentUser = null;
                userPassword = '';
                console.warn('⚠️ حساب بلا تفعيل بريد — إظهار شاشة الكود');
                showPage('loginPage');
                showEmailVerificationUI(userAccount.email, { reopened: true });
            } else {
                currentUser = loggedInUser;
                userPassword = userAccount.password;
                console.log('🔐 جاري توليد مفتاح التشفير من كلمة المرور...');
                generateEncryptionKey(userAccount.password);
            }
        }
        
        // 2. تهيئة قاعدة البيانات
        console.log('📊 جاري تهيئة قاعدة البيانات...');
        await initDatabase();
        
        // 3. تحميل الملفات المحفوظة
        console.log('📂 جاري تحميل الملفات المحفوظة...');
        try {
            files = sortVaultRecordsNewestFirst_INDEX2((await loadFilesFromIndexedDB()) || []);
            console.log(`✅ تم تحميل ${files.length} ملف`);
        } catch (error) {
            console.error('⚠️ لم يتم تحميل الملفات:', error);
            files = [];
        }
          // 4. تحميل الملفات المحذوفة
        try {
            deletedFiles = sortVaultRecordsNewestFirst_INDEX2((await loadDeletedFilesFromIndexedDB()) || []);
            console.log(`✅ تم تحميل ${deletedFiles.length} ملف محذوف`);
        } catch (error) {
            console.error('⚠️ لم يتم تحميل الملفات المحذوفة:', error);
            deletedFiles = [];
        }
        
        // 5. ترحيل مدة الاشتراك ثم مزامنة الاشتراك من الخادم وتهيئة العرض
        console.log('💳 جاري تهيئة نظام الاشتراكات...');
        migrateSubscriptionDurationIfNeeded();
        try {
            if (typeof gostaFlushPendingSubscriptionLogs_INDEX2 === 'function') {
                await gostaFlushPendingSubscriptionLogs_INDEX2();
            }
        } catch (syncErr) {
            console.warn('مزامنة سجل اشتراك للخادم:', syncErr);
        }
        if (loggedInUser && userAccount && userAccount.password) {
            try {
                if (typeof syncSubscriptionFromServer_INDEX2 === 'function') {
                    const pull = await syncSubscriptionFromServer_INDEX2(
                        loggedInUser,
                        userAccount.password
                    );
                    if (pull && pull.ok && pull.applied) {
                        console.log('✅ تم جلب الاشتراك من الخادم عند التشغيل');
                    }
                }
            } catch (pullErr) {
                console.warn('جلب اشتراك من الخادم:', pullErr);
            }
        }
        if (typeof initSubscriptionSystem === 'function') {
            initSubscriptionSystem();
        }
        refreshCloudFeaturesUi_INDEX2();
        updateBasicPlanUpgradeBanner_INDEX2();
        try {
            await loadUserFoldersFromCloud_INDEX2();
        } catch (folderLoadError) {
            console.warn('⚠️ تعذر جلب المجلدات من السحابة:', folderLoadError);
        }
        try {
            await loadFilesFromCloud_INDEX2();
        } catch (cloudLoadError) {
            console.warn('⚠️ تعذر تحميل البيانات من السحابة:', cloudLoadError);
        }

        try {
            if (sessionStorage.getItem('gosta_plan_activated') === '1') {
                sessionStorage.removeItem('gosta_plan_activated');
                if (typeof showNotification === 'function') {
                    showNotification('✅ تم تفعيل خطتك تلقائياً بعد الدفع. المساحة الجديدة جاهزة للاستخدام.');
                }
            }
        } catch (ignore) {}
        
        // 6. تحديث الإحصائيات والعرض الفوري
        console.log('📊 جاري تحديث الإحصائيات...');
        updateStatsAndDisplay();
        
        // 7. تهيئة نظام التحميل
        console.log('⬆️ جاري تهيئة نظام التحميل...');
        initFileUpload();
        ensureUserFoldersInitialized_INDEX2();
        refreshUserFoldersUI_INDEX2();
        bindUserFoldersModal_INDEX2();
        bindVaultConfirmDialog_INDEX2();
        bindMoveFileFolderModal_INDEX2();
        refreshVaultBlurSettingUi_INDEX2();
        
        console.log('✅ تم تهيئة التطبيق بنجاح');

        if (!window.__vaultHeaderLayoutBound_INDEX2) {
            window.__vaultHeaderLayoutBound_INDEX2 = true;
            window.addEventListener('resize', function () {
                var mp = document.getElementById('mediaPage');
                if (mp && mp.classList.contains('active')) {
                    syncVaultHeaderLayout_INDEX2();
                }
            });
            window.addEventListener('orientationchange', function () {
                setTimeout(syncVaultHeaderLayout_INDEX2, 160);
            });
        }

        const cem = document.getElementById('changeEmailModal');
        if (cem && !cem.dataset.backdropBound) {
            cem.dataset.backdropBound = '1';
            cem.addEventListener('click', function (ev) {
                if (ev.target === cem) {
                    closeChangeEmailModal();
                }
            });
        }
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

// فتح صفحة الملفات عند النقر على المنطقة المخفية (التطبيق فقط)
if (!window.GOSTA_ADMIN_ASSISTANT_PAGE) {
    document.querySelector('.hidden-zone')?.addEventListener('dblclick', function () {
        toggleMediaPage();
    });
}


