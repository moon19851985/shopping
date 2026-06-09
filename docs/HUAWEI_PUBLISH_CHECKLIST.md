# قائمة النشر على AppGallery — ماذا نجهّز وأين؟

## ✅ جاهز في المشروع (محلياً)

| البند | الحالة |
|-------|--------|
| توقيع Release (keystore) | `mobile/credentials/` + `keystore.properties` |
| إعداد Gradle للتوقيع | `plugins/withAndroidReleaseSigning.js` |
| اسم الحزمة | `com.gostasrv.app` |
| إعدادات الإنتاج | `mobile/app.config.ts` + `.env.production.example` |
| فحص الجاهزية | `cd mobile && npm run publish:check` |
| بناء AAB | `npm run prebuild:android` ثم `npm run build:release` |
| سياسة الخصوصية (داخل التطبيق) | `app/more/privacy.tsx` |
| دفع هواوي (هيكل) | `src/services/huaweiIap.ts` + `POST /api/payment/huawei/verify` |

## 🔲 تحتاج أنت (خارج الكود)

### 1) حساب مطوّر هواوي
- [AppGallery Connect](https://developer.huawei.com/consumer/en/service/josp/agc/index.html)
- إنشاء التطبيق: `com.gostasrv.app`
- تسجيل **SHA-256**: `npm run keystore:sha256`

### 2) ملفات التطبيق
- `assets/icon.png` و `adaptive-icon.png` (1024×1024) — راجع `mobile/assets/README.md`
- لقطات شاشة للمتجر (3–5 صور)

### 3) خادم الإنتاج (Backend)
- نطاق HTTPS مثل `https://api.yourdomain.com`
- انسخ `mobile/.env.production.example` → `.env.production` وضبط `EXPO_PUBLIC_API_URL`
- في `backend/.env`: `PUBLIC_BASE_URL` و SendGrid و JWT قوي

### 4) هواوي HMS
- تحميل `agconnect-services.json` → `mobile/android/app/` (بعد prebuild)
- تفعيل **In-App Purchases** + Merchant Service
- تثبيت: `npm install @hmscore/react-native-hms-iap` (بعد prebuild)
- `EXPO_PUBLIC_HUAWEI_IAP=true` في `.env.production`

### 5) بيانات صفحة المتجر
- وصف التطبيق (عربي/إنجليزي)
- فئة: طعام / توصيل
- رابط سياسة الخصوصية (`EXPO_PUBLIC_PRIVACY_URL`)
- بريد دعم (`EXPO_PUBLIC_SUPPORT_EMAIL`)

### 6) اختبار على جهاز هواوي
- GPS والخرائط (بدون Google — قد تحتاج HMS Map لاحقاً)
- إشعارات الكابتن
- دفع IAP حقيقي

## أوامر سريعة

```bash
cd mobile
npm run publish:check
npm run prebuild:android
npm run build:release
```

الملف للرفع: `android/app/build/outputs/bundle/release/app-release.aab`
