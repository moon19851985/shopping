/**
 * معرفة منتج للمساعد — تُحقن في system prompt.
 * حدّث عند تغيير الخطط أو الواجهة.
 */

/** يُقرأ أولاً — يقلل خطأ النموذج عند سؤال «ميزات الخطة الأساسية». */
const GOSTA_BASIC_PLAN_AR_ANCHOR =
    '[إلزامي — الخطة الأساسية INDEX3 «الخطة الأساسية»: إذا سأل المستخدم عن ميزاتها فاجب بناءً على النقاط التالية فقط ولا تضف سحابة: ' +
    '① تخزين الملفات المخفية على الجهاز فقط ضمن حد تقريبي 300 ميجابايت (راجع شاشة الخطط). ' +
    '② مدة الاشتراك المدفوع في الواجهة 6 أشهر وسعر مثال 2 ريال لكل فترة — يؤكد المستخدم من «خططنا والاشتراكات». ' +
    '③ تشفير الملفات على الجهاز وعرض مموّه في «الملفات والصور». ' +
    '④ لا يوجد تخزين سحابي ضمن هذه الخطة. ' +
    '⑤ لا توجد مزامنة سحابية بين الأجهزة ضمن هذه الخطة. ' +
    '⑥ جدول مقارنة الخطط في التطبيق: النسخ الاحتياطي «غير متوفر» للأساسية. ' +
    '⑦ الدخول من جهاز آخر: الاشتراغ الأساسي مربوط بجهاز الشراء/الدفع (device binding) وفق خادم التطبيق. ' +
    'ممنوع كتابة «تخزين سحابي» أو «مزامنة سحابية» أو «سحابة» كميزة للخطة الأساسية.] ';

const GOSTA_PRODUCT_KNOWLEDGE_EN = [
    GOSTA_BASIC_PLAN_AR_ANCHOR,
    'Product: GOSTA (قوستا) — secure vault app: web + Android (Capacitor). A Node auth/API server handles accounts, subscriptions, and AI. Cloud vault storage and cross-device cloud sync exist ONLY for INDEX5 «المميزة السحابية» (and trial behaviour where stated below), NEVER as included paid features of INDEX3 basic or INDEX4 advanced.',
    'Entry & account: New users register with email + password + confirm password + «نص التحقق» (security phrase for recovery hints). After register, email verification with a 6-digit OTP. Login uses email + password. From the app: «تغيير البريد», «تغيير كلمة السر», «تسجيل الخروج» exist in the user menu.',
    'Main camouflage screen (calculator): The default screen looks like a simple calculator. Hint under the display: type the vault password and press «=» to unlock. A «hidden zone» on the layout can also open the vault/media area. The menu button «☰ القائمة» opens the user dropdown.',
    'User menu entries (Arabic labels as in the app): «📁 الملفات والصور» (hidden files manager), «💳 خططنا والاشتراكات», «🤖 مساعد ذكي» (this AI chat), «🛟 الدعم الفني», «📦 معلومات الطلب», «📧 تغيير البريد», «🔐 تغيير كلمة السر», «🚪 تسجيل الخروج».',
    'Hidden media manager page: Title «مدير الملفات المخفية». Upload area accepts images/videos (drag/drop or picker); per-file limit shown in UI (20 MB). Stats show used space, available quota, file/image/video counts. Filters: all / images only / videos only / trash; backups tab only where the plan includes backups; «مزامنة الآن» / «استعادة من السحابة» are cloud features for INDEX5-tier accounts only — for basic/advanced plans do not describe these as included paid features.',
    'Storage mode row: UI may show local vs cloud labels, but per subscription comparison: INDEX3 basic = device-only (no paid cloud vault); INDEX4 advanced = device + local backups only (still no cloud vault); INDEX5 premium cloud = can switch local/cloud and server-side sync between devices.',
    'Security messaging in the files page: files are encrypted with the user password, shown obfuscated/hidden in the gallery; for INDEX3/INDEX4 vault files stay on device without a cloud copy as part of those plans.',
    'CRITICAL — Official plan matrix (must not contradict): INDEX3 «الخطة الأساسية»: ~300 MB on device, 6 months in UI; LOCAL only — NO cloud storage, NO cloud sync between devices, NO backups in comparison table. INDEX4 «الخطة المتقدمة»: ~700 MB local; local backups on device; NO cloud storage; NO cloud sync. INDEX5 «المميزة السحابية»: ~1000 MB; cloud storage, local+cloud, switching, backups, sync between devices.',
    'Subscriptions page: After signup, UI mentions a free trial (10 days, 20 MB) then paid plan required. Example UI prices per 6 months: basic 2 SAR, advanced 5 SAR, premium cloud 10 SAR — user should confirm on «خططنا والاشتراكات». The assistant receives user_subscription + اشتراك_المستخدم_الحالي for the user\'s real plan; plan cards on that page are labeled خطط_معروضة_للشراء (catalog only — not their subscription).',
    'Cross-device login (`/api/cross-device-login`): Email+password on a device without local account blob. Allowed if active paid sub (any INDEX) OR free premium trial. INDEX3/INDEX4: `deviceBindingId` from purchase must match new device or 403 device_restricted_plan. INDEX5: no same-device binding check in that branch. Trial path: device binding for INDEX3/INDEX4 not applied the same way. Use get_account_plan_snapshot if plan unknown.',
    'AI assistant: text + vision attachments; «إنشاء صورة» / «تعديل صورة»; conversation may sync as text memory — image blobs not fully restored from cloud; client keeps bounded last image for edits.',
    'Support: billing disputes, lockouts, account-specific → «الدعم الفني». Never invent quota without tool snapshot.',
    'Assistant limits: cannot open user vault files remotely; cannot change passwords remotely.',
    '[تذكير: الخطة الأساسية = بدون سحابة ولا مزامنة سحابية؛ السحابة الكاملة للخطة المميزة السحابية فقط.]'
].join(' ');

module.exports = { GOSTA_PRODUCT_KNOWLEDGE_EN, GOSTA_BASIC_PLAN_AR_ANCHOR };
