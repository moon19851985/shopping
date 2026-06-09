import nodemailer from "nodemailer";
import sgMail from "@sendgrid/mail";

function getFromAddress() {
  return process.env.SMTP_FROM ?? process.env.MAIL_FROM ?? process.env.SENDGRID_FROM;
}

function getTransporter() {
  const host = process.env.SMTP_HOST;
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({
    host,
    port: Number(process.env.SMTP_PORT ?? 587),
    secure: process.env.SMTP_SECURE === "true",
    auth: { user, pass },
  });
}

type MailPayload = { to: string; subject: string; html: string; text: string };

async function deliverMail(payload: MailPayload) {
  const from = getFromAddress();
  const appName = process.env.APP_NAME ?? "قسطاس";

  if (process.env.SENDGRID_API_KEY && from) {
    sgMail.setApiKey(process.env.SENDGRID_API_KEY);
    await sgMail.send({
      to: payload.to,
      from: { email: from, name: appName },
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    return;
  }

  const transporter = getTransporter();
  if (transporter && from) {
    await transporter.sendMail({
      from: `"${appName}" <${from}>`,
      to: payload.to,
      subject: payload.subject,
      html: payload.html,
      text: payload.text,
    });
    return;
  }

  if (process.env.ALLOW_DEV_OTP_LOG === "true") {
    console.log(`[DEV] بريد → ${payload.to}: ${payload.subject}`);
    console.log(payload.text);
    return;
  }

  throw new Error("إعدادات البريد غير مكتملة");
}

export async function sendActivationEmail(to: string, name: string, code: string) {
  const appName = process.env.APP_NAME ?? "قسطاس";
  const expiry = process.env.OTP_EXPIRY_MINUTES ?? 15;

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 480px; margin: auto;">
      <h2 style="color: #E85D04;">${appName}</h2>
      <p>مرحباً ${name}،</p>
      <p>كود تفعيل حسابك هو:</p>
      <p style="font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center;">${code}</p>
      <p style="color: #666;">صالح لمدة ${expiry} دقيقة.</p>
    </div>`;

  try {
    await deliverMail({
      to,
      subject: `كود تفعيل حسابك — ${appName}`,
      html,
      text: `كود التفعيل: ${code}`,
    });
  } catch (err) {
    if (process.env.ALLOW_DEV_OTP_LOG === "true") {
      console.warn("[DEV] فشل إرسال التفعيل:", code, err);
      return;
    }
    throw err;
  }
}

export type ReceiptItem = {
  name: string;
  restaurantName: string;
  quantity: number;
  lineTotal: number;
};

export type PaymentReceiptData = {
  customerName: string;
  customerEmail: string;
  orderId: string;
  invoiceNumber: string;
  transactionId: string;
  paymentMethod: "VISA" | "MADA" | "COD";
  subtotal: number;
  deliveryFee: number;
  total: number;
  deliveryAddress: string;
  items: ReceiptItem[];
  paidAt: string;
};

export async function sendPaymentReceipt(data: PaymentReceiptData) {
  const appName = process.env.APP_NAME ?? "قسطاس";
  const methodLabel =
    data.paymentMethod === "VISA"
      ? "Visa"
      : data.paymentMethod === "MADA"
        ? "مدى mada"
        : "دفع عند الاستلام";
  const isCod = data.paymentMethod === "COD";

  const itemsHtml = data.items
    .map(
      (i) =>
        `<tr>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${i.name}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:right">${i.restaurantName}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${i.quantity}</td>
          <td style="padding:8px;border-bottom:1px solid #eee;text-align:left">${i.lineTotal.toFixed(2)} ر.س</td>
        </tr>`
    )
    .join("");

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; max-width: 560px; margin: auto; color: #1A1A1A;">
      <h2 style="color: #E85D04;">${appName} — ${isCod ? "تأكيد طلب" : "إيصال دفع"}</h2>
      <p>مرحباً ${data.customerName}،</p>
      <p>${
        isCod
          ? `تم تأكيد طلبك. ستدفع <strong>${data.total.toFixed(2)} ر.س</strong> نقداً عند الاستلام.`
          : `تم استلام دفعتك بنجاح عبر <strong>${methodLabel}</strong>.`
      }</p>
      <table style="width:100%;margin:16px 0;background:#FAFAFA;border-radius:8px;padding:12px">
        <tr><td style="padding:6px"><strong>رقم الفاتورة:</strong></td><td>${data.invoiceNumber}</td></tr>
        <tr><td style="padding:6px"><strong>مرجع النظام:</strong></td><td style="font-size:11px;color:#666">${data.orderId}</td></tr>
        <tr><td style="padding:6px"><strong>رقم العملية:</strong></td><td>${data.transactionId}</td></tr>
        <tr><td style="padding:6px"><strong>التاريخ:</strong></td><td>${data.paidAt}</td></tr>
        <tr><td style="padding:6px"><strong>العنوان:</strong></td><td>${data.deliveryAddress}</td></tr>
      </table>
      <table style="width:100%;border-collapse:collapse;margin-top:12px">
        <thead>
          <tr style="background:#E85D04;color:#fff">
            <th style="padding:8px">المنتج</th>
            <th style="padding:8px">المطعم</th>
            <th style="padding:8px">الكمية</th>
            <th style="padding:8px">المبلغ</th>
          </tr>
        </thead>
        <tbody>${itemsHtml}</tbody>
      </table>
      <div style="margin-top:16px;text-align:right;line-height:1.8">
        <div>المجموع: ${data.subtotal.toFixed(2)} ر.س</div>
        <div>التوصيل: ${data.deliveryFee.toFixed(2)} ر.س</div>
        <div style="font-size:20px;font-weight:bold;color:#E85D04">الإجمالي: ${data.total.toFixed(2)} ر.س</div>
      </div>
      <p style="color:#888;font-size:12px;margin-top:24px">${
        isCod
          ? "هذا تأكيد إلكتروني — الدفع عند استلام الطلب من الكابتن"
          : "هذا إيصال إلكتروني — الدفع تجريبي (Visa/مدى)"
      }</p>
    </div>`;

  const itemsText = data.items
    .map((i) => `- ${i.name} (${i.restaurantName}) ×${i.quantity} = ${i.lineTotal} ر.س`)
    .join("\n");

  const text = `${isCod ? "تأكيد طلب" : "إيصال دفع"} ${appName}
رقم الفاتورة: ${data.invoiceNumber}
رقم العملية: ${data.transactionId}
طريقة الدفع: ${methodLabel}
${itemsText}
الإجمالي: ${data.total} ر.س`;

  await deliverMail({
    to: data.customerEmail,
    subject: `${isCod ? "تأكيد الطلب" : "إيصال الدفع"} — طلب ${data.orderId.slice(-8)} | ${appName}`,
    html,
    text,
  });
}
