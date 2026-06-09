# GOSTASRV — تطبيق خدمات المطاعم

تطبيق جوال (Expo/React Native) لمتجر **Huawei AppGallery** مع API خلفي.

## المميزات

| الميزة | التفاصيل |
|--------|----------|
| سلة متعددة المطاعم | العميل يجمع منتجات من مطاعم مختلفة في طلب واحد |
| عرض مجمّع | الصفحة الرئيسية تعرض الأصناف مجمّعة (مثلاً كل «برجر» من كل المطاعم جنب بعض) |
| فطور / غداء / عشاء | حسب ما يحدده كل مطعم عند رفع المنتج |
| التوصيل | سعر التوصيل = مجموع رسوم المسافة من **كل مطعم** في السلة إلى موقع العميل |
| الكابتن | يرى الطلبات، أول موافق يأخذها، وتتبع موقعه على الخريطة أثناء التوصيل |
| الدفع | Huawei IAP عبر AppGallery Connect |

## هيكل المشروع

```
GOSTASRV/
├── backend/     # API + Socket.io + قاعدة البيانات
├── mobile/      # تطبيق Expo للجوال
└── docs/        # دليل نشر هواوي والدفع
```

## التشغيل السريع

### 1) الخادم

```bash
cd backend
cp .env.example .env
npm install
npm run dev
```

**كود التفعيل على البريد:** عيّن `SENDGRID_API_KEY` و `SMTP_FROM` في `.env` — راجع [docs/SENDGRID.md](docs/SENDGRID.md).  
للتجربة: `ALLOW_DEV_OTP_LOG=true` يطبع الكود في الطرفية عند فشل الإرسال.

يعمل على `http://localhost:4000`

### 2) التطبيق

```bash
cd mobile
npm install
npx expo start
```

على محاكي أندرويد استخدم `10.0.2.2:4000` (مضبوط في `app.json`).

### حسابات تجريبية (بعد seed)

| الدور | البريد | كلمة المرور |
|-------|--------|-------------|
| عميل | customer@test.com | 123456 |
| مطعم 1 | burger@test.com | 123456 |
| مطعم 2 | grill@test.com | 123456 |
| كابتن | captain@test.com | 123456 |
| **مدير المنصة** | admin@gostasrv.com | 123456 (أو `ADMIN_EMAIL` / `ADMIN_PASSWORD` في `.env`) |

لوحة الإدارة: تسجيل الدخول بالحساب أعلاه → **المزيد** → **لوحة الإدارة**.

## نشر على Huawei AppGallery

راجع [docs/HUAWEI_APPGALLERY.md](docs/HUAWEI_APPGALLERY.md) لخطوات:

- AppGallery Connect + `agconnect-services.json`
- تفعيل Merchant Service و In-App Purchases
- بناء APK/AAB و `@hmscore/react-native-hms-iap`

## تدفق الطلب

```
عميل → سلة (مطاعم متعددة) → تقدير توصيل → checkout
     → Huawei IAP → تحقق السيرفر → PAID → المطعم يجهّز
     → READY_FOR_PICKUP → الكباتن → أول قبول → تتبع GPS
```
