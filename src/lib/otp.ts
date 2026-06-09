import bcrypt from "bcryptjs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { db, cuid } from "../db.js";
import { sendActivationEmail } from "./email.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const devOtpFile = path.join(__dirname, "../../data/last-otp.json");

/** للاختبار المحلي فقط عند ALLOW_DEV_OTP_LOG=true */
const devCodes = new Map<string, string>();
export function getDevOtpCode(email: string) {
  return devCodes.get(email.toLowerCase());
}

const OTP_LENGTH = 6;
const EXPIRY_MIN = Number(process.env.OTP_EXPIRY_MINUTES ?? 15);
const RESEND_COOLDOWN_SEC = Number(process.env.OTP_RESEND_COOLDOWN_SEC ?? 60);
const MAX_ATTEMPTS = Number(process.env.OTP_MAX_ATTEMPTS ?? 5);

export function generateOtpCode(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

export async function createAndSendActivationCode(email: string, name: string) {
  const code = generateOtpCode();
  const codeHash = await bcrypt.hash(code, 10);
  const expiresAt = new Date(Date.now() + EXPIRY_MIN * 60 * 1000).toISOString();

  db.prepare(`DELETE FROM EmailVerification WHERE email = ?`).run(email.toLowerCase());
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO EmailVerification (id, email, codeHash, expiresAt, attempts, lastSentAt)
     VALUES (?, ?, ?, ?, 0, ?)`
  ).run(cuid(), email.toLowerCase(), codeHash, expiresAt, now);

  if (process.env.ALLOW_DEV_OTP_LOG === "true") {
    devCodes.set(email.toLowerCase(), code);
    fs.mkdirSync(path.dirname(devOtpFile), { recursive: true });
    fs.writeFileSync(devOtpFile, JSON.stringify({ email: email.toLowerCase(), code }));
  }

  await sendActivationEmail(email, name, code);
}

export function canResend(email: string): { ok: boolean; waitSec?: number } {
  const row = db
    .prepare(`SELECT lastSentAt FROM EmailVerification WHERE email = ?`)
    .get(email.toLowerCase()) as { lastSentAt: string } | undefined;

  if (!row) return { ok: true };

  const last = new Date(row.lastSentAt).getTime();
  const elapsed = (Date.now() - last) / 1000;
  if (elapsed < RESEND_COOLDOWN_SEC) {
    return { ok: false, waitSec: Math.ceil(RESEND_COOLDOWN_SEC - elapsed) };
  }
  return { ok: true };
}

export async function verifyOtpCode(
  email: string,
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  const row = db
    .prepare(`SELECT * FROM EmailVerification WHERE email = ?`)
    .get(email.toLowerCase()) as
    | {
        id: string;
        codeHash: string;
        expiresAt: string;
        attempts: number;
      }
    | undefined;

  if (!row) {
    return { ok: false, error: "لا يوجد طلب تفعيل. سجّل من جديد أو أعد إرسال الكود" };
  }

  if (new Date(row.expiresAt) < new Date()) {
    db.prepare(`DELETE FROM EmailVerification WHERE id = ?`).run(row.id);
    return { ok: false, error: "انتهت صلاحية الكود. اطلب كوداً جديداً" };
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    return { ok: false, error: "تجاوزت عدد المحاولات. اطلب كوداً جديداً" };
  }

  const valid = await bcrypt.compare(code, row.codeHash);
  if (!valid) {
    db.prepare(`UPDATE EmailVerification SET attempts = attempts + 1 WHERE id = ?`).run(row.id);
    return { ok: false, error: "كود التفعيل غير صحيح" };
  }

  db.prepare(`DELETE FROM EmailVerification WHERE id = ?`).run(row.id);
  return { ok: true };
}
