# ربط SendGrid لكود التفعيل

## 1. API Key

1. ادخل [SendGrid API Keys](https://app.sendgrid.com/settings/api_keys)
2. **Create API Key** → صلاحية **Restricted** مع **Mail Send** فقط (أو Full Access للتطوير)
3. انسخ المفتاح (يبدأ بـ `SG.`) — يظهر مرة واحدة فقط

## 2. توثيق المرسل (مهم)

بدون هذا لن تُرسل الرسائل:

- **Single Sender:** [Sender Authentication](https://app.sendgrid.com/settings/sender_auth/senders) → أضف بريدك وفعّله من الرابط في الإيميل
- **أو Domain Authentication** لنطاقك (أفضل للإنتاج)

## 3. ملف `.env`

```env
SENDGRID_API_KEY=SG.xxxxxxxx
SMTP_FROM=بريدك-الموثّق@example.com
ALLOW_DEV_OTP_LOG=false
```

`SMTP_FROM` يجب أن يطابق بريداً موثّقاً في SendGrid.

## 4. تشغيل

```bash
cd backend
npm run dev
```

سجّل حساباً جديداً — يصل كود 6 أرقام إلى البريد.

## بديل: SMTP

```env
SMTP_HOST=smtp.sendgrid.net
SMTP_PORT=587
SMTP_USER=apikey
SMTP_PASS=نفس_SENDGRID_API_KEY
SMTP_FROM=بريد-موثّق@example.com
```

(اترك `SENDGRID_API_KEY` فارغاً لاستخدام SMTP فقط)
