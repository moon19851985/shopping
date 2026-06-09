# نشر التطبيق على Huawei AppGallery مع الدفع الإلكتروني

## 1. AppGallery Connect

1. أنشئ مشروعاً على [AppGallery Connect](https://developer.huawei.com/consumer/en/service/josp/agc/index.html).
2. أضف تطبيق أندرويد بالحزمة: `com.gostasrv.app` (كما في `mobile/app.json`).
3. حمّل **agconnect-services.json** وضعه في `mobile/android/app/` بعد `npx expo prebuild --platform android`.

## 2. تفعيل الدفع (Huawei IAP)

1. **My Projects → Manage APIs** → فعّل **In-App Purchases**.
2. قدّم طلب **Merchant Service** (بيانات بنكية — مراجعة حتى يومين).
3. **Earning → In-App Purchases → Settings** → وقّع الاتفاقية واحفظ **المفتاح العام** للتحقق من التوقيع على السيرفر.
4. أنشئ منتجات IAP من نوع **Consumable** بمعرّفات ديناميكية أو ثابتة؛ التطبيق يرسل `order_{orderId}` عند كل طلب.

## 3. دمج HMS في التطبيق

```bash
cd mobile
npx expo prebuild --platform android
npm install @hmscore/react-native-hms-iap
```

عدّل `mobile/src/services/huaweiIap.ts` لاستدعاء:

- `isEnvReady`
- `createPurchaseIntent` بـ `productId: order_${orderId}`
- إرسال `purchaseToken` إلى `POST /api/payment/huawei/verify`

## 4. التحقق على السيرفر

في `backend/src/routes/payment.ts` فعّل:

```env
HUAWEI_IAP_VERIFY_STRICT=true
```

واستخدم [Huawei IAP Server API](https://developer.huawei.com/consumer/en/doc/development/HMSCore-References-V5/server-api-overview-0000001050122474-V5) للتحقق من `purchaseToken` بالمفتاح العام من AppGallery.

## 5. الخرائط على أجهزة Huawei (بدون Google Play)

للإنتاج على أجهزة هواوي بدون GMS، استبدل `react-native-maps` بـ:

- `@hmscore/react-native-hms-map`

## 6. توقيع الإصدار (Keystore)

```bash
cd mobile
npm run keystore:generate
```

- يُنشئ `credentials/gostasrv-release.jks` و `keystore.properties` (محميان من Git).
- لعرض **SHA-256** لهواوي: `npm run keystore:sha256`
- سجّل SHA-256 في AppGallery Connect → **App information**.

تفاصيل: [mobile/credentials/README.md](../mobile/credentials/README.md)

## 7. بناء ورفع المتجر

```bash
cd mobile
npm run prebuild:android
npm run build:release
```

الملف الجاهز للرفع: `android/app/build/outputs/bundle/release/app-release.aab`

(أو APK: `npm run build:release:apk`)

ارفع **AAB** من AppGallery Connect → **App Services → Publish**.
