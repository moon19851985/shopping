/**
 * عنوان خادم GOSTA في الإنتاج (HTTPS فقط).
 * اتركه فارغاً أثناء التطوير — يُستخدم اكتشاف localhost / Wi‑Fi كالسابق.
 * للنشر: ضع رابط API ثم npm run sync:www && npm run android:bundle
 * أو: set PR_SAFE_AUTH_API_BASE=https://api.example.com && npm run set:production-api
 */
window.__PR_SAFE_AUTH_API_BASE__ = 'https://gosta.onrender.com';