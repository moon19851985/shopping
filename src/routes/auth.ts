import { Router } from "express";
import { z } from "zod";
import { db, cuid } from "../db.js";
import { hashPassword, signToken, verifyPassword, authMiddleware } from "../lib/auth.js";
import {
  createAndSendActivationCode,
  canResend,
  verifyOtpCode,
} from "../lib/otp.js";
import { getOrCreateCaptain } from "../lib/captain.js";
import { resolveCityFromCoords } from "../lib/cities.js";

const router = Router();

router.get("/me", authMiddleware(), (req, res) => {
  const user = db.prepare("SELECT id, name, email, phone, role FROM User WHERE id = ?").get(req.user!.sub) as
    | { id: string; name: string; email: string; phone: string | null; role: string }
    | undefined;

  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  res.json({ user: buildProfileResponse(user) });
});

const updateProfileSchema = z
  .object({
    name: z.string().min(2).optional(),
    phone: z
      .string()
      .optional()
      .refine((v) => {
        if (!v?.trim()) return true;
        const digits = v.replace(/\D/g, "");
        return digits.length >= 9 && digits.length <= 15;
      }, "رقم جوال غير صالح (9 أرقام على الأقل)"),
    currentPassword: z.string().min(6).optional(),
    newPassword: z.string().min(6).optional(),
    restaurant: z
      .object({
        name: z.string().min(1),
        description: z.string().optional(),
        address: z.string().min(3),
        lat: z.number(),
        lng: z.number(),
      })
      .optional(),
    captain: z.object({ vehicle: z.string().optional() }).optional(),
  })
  .refine((d) => !d.newPassword || d.currentPassword, {
    message: "أدخل كلمة المرور الحالية لتغييرها",
    path: ["currentPassword"],
  });

router.patch("/me", authMiddleware(), async (req, res) => {
  const parsed = updateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed) });
    return;
  }

  const user = db.prepare("SELECT * FROM User WHERE id = ?").get(req.user!.sub) as
    | {
        id: string;
        name: string;
        email: string;
        phone: string | null;
        role: "CUSTOMER" | "RESTAURANT" | "CAPTAIN";
        passwordHash: string;
      }
    | undefined;

  if (!user) {
    res.status(404).json({ error: "المستخدم غير موجود" });
    return;
  }

  const { name, phone, currentPassword, newPassword, restaurant, captain } = parsed.data;

  if (!name && !phone && !newPassword && !restaurant && !captain) {
    res.status(400).json({ error: "لا توجد بيانات للتحديث" });
    return;
  }

  if (newPassword) {
    if (!(await verifyPassword(currentPassword!, user.passwordHash))) {
      res.status(401).json({ error: "كلمة المرور الحالية غير صحيحة" });
      return;
    }
  }

  if (restaurant && user.role !== "RESTAURANT") {
    res.status(400).json({ error: "بيانات المطعم للمطاعم فقط" });
    return;
  }

  if (captain && user.role !== "CAPTAIN") {
    res.status(400).json({ error: "بيانات الكابتن للكباتن فقط" });
    return;
  }

  if (user.role === "RESTAURANT" && restaurant) {
    const row = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(user.id);
    if (!row) {
      res.status(404).json({ error: "ملف المطعم غير موجود" });
      return;
    }
  }

  const passwordHash = newPassword ? await hashPassword(newPassword) : null;

  const tx = db.transaction(() => {
    const updates: string[] = [];
    const params: unknown[] = [];

    if (name) {
      updates.push("name = ?");
      params.push(name);
    }
    if (phone) {
      updates.push("phone = ?");
      params.push(normalizePhone(phone));
    }
    if (passwordHash) {
      updates.push("passwordHash = ?");
      params.push(passwordHash);
    }

    if (updates.length) {
      params.push(user.id);
      db.prepare(`UPDATE User SET ${updates.join(", ")} WHERE id = ?`).run(...params);
    }

    if (user.role === "RESTAURANT" && restaurant) {
      const city = resolveCityFromCoords(restaurant.lat, restaurant.lng).nameAr;
      db.prepare(
        `UPDATE Restaurant SET name = ?, description = ?, address = ?, lat = ?, lng = ?, city = ? WHERE userId = ?`
      ).run(
        restaurant.name,
        restaurant.description ?? null,
        restaurant.address,
        restaurant.lat,
        restaurant.lng,
        city,
        user.id
      );
    }

    if (user.role === "CAPTAIN" && captain) {
      getOrCreateCaptain(user.id);
      db.prepare(`UPDATE Captain SET vehicle = ? WHERE userId = ?`).run(
        captain.vehicle ?? null,
        user.id
      );
    }
  });
  tx();

  const updated = db.prepare("SELECT id, name, email, phone, role FROM User WHERE id = ?").get(user.id) as {
    id: string;
    name: string;
    email: string;
    phone: string | null;
    role: string;
  };

  res.json({ user: buildProfileResponse(updated), message: "تم تحديث بياناتك بنجاح" });
});

function buildProfileResponse(user: { id: string; name: string; email: string; phone: string | null; role: string }) {
  const restaurant = db
    .prepare(
      `SELECT id, name, description, address, lat, lng FROM Restaurant WHERE userId = ?`
    )
    .get(user.id) as
    | { id: string; name: string; description: string | null; address: string; lat: number; lng: number }
    | undefined;

  let captain = db
    .prepare(`SELECT id, vehicle, isOnline, lat, lng FROM Captain WHERE userId = ?`)
    .get(user.id) as
    | { id: string; vehicle: string | null; isOnline: number; lat: number | null; lng: number | null }
    | undefined;

  if (user.role === "CAPTAIN" && !captain) {
    captain = getOrCreateCaptain(user.id);
  }

  return {
    ...user,
    restaurantId: restaurant?.id,
    captainId: captain?.id,
    restaurant: restaurant ?? null,
    captain: captain
      ? {
          id: captain.id,
          vehicle: captain.vehicle,
          isOnline: Boolean(captain.isOnline),
          hasLocation: captain.lat != null && captain.lng != null,
        }
      : null,
  };
}

const phoneSchema = z
  .string()
  .min(1, "رقم الجوال مطلوب")
  .refine((v) => {
    const digits = v.replace(/\D/g, "");
    return digits.length >= 9 && digits.length <= 15;
  }, "رقم جوال غير صالح (9 أرقام على الأقل)");

function normalizePhone(phone: string) {
  let digits = phone.replace(/\D/g, "");
  if (digits.startsWith("966")) digits = digits.slice(3);
  if (digits.startsWith("0")) digits = digits.slice(1);
  return digits;
}

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(6),
  name: z.string().min(2),
  phone: phoneSchema,
  role: z.enum(["CUSTOMER", "RESTAURANT", "CAPTAIN"]),
  restaurant: z
    .object({
      name: z.string(),
      description: z.string().optional(),
      lat: z.number(),
      lng: z.number(),
      address: z.string(),
    })
    .optional(),
  captain: z.object({ vehicle: z.string().optional() }).optional(),
});

const verifySchema = z.object({
  email: z.string().email(),
  code: z.string().length(6, "كود التفعيل 6 أرقام"),
});

function getUserExtras(userId: string) {
  const restaurant = db.prepare("SELECT id FROM Restaurant WHERE userId = ?").get(userId) as
    | { id: string }
    | undefined;
  const captain = db.prepare("SELECT id FROM Captain WHERE userId = ?").get(userId) as
    | { id: string }
    | undefined;
  return { restaurantId: restaurant?.id, captainId: captain?.id };
}

function formatZodError(parsed: { error: { flatten: () => { fieldErrors: Record<string, string[]>; formErrors: string[] } } }) {
  const flat = parsed.error.flatten();
  const parts = [
    ...flat.formErrors,
    ...Object.entries(flat.fieldErrors).flatMap(([k, v]) =>
      (v ?? []).map((m) => `${k}: ${m}`)
    ),
  ];
  return parts[0] ?? "بيانات غير صالحة";
}

router.post("/register", async (req, res) => {
  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed) });
    return;
  }
  const { email, password, name, phone, role, restaurant, captain } = parsed.data;
  const emailNorm = email.toLowerCase();

  const exists = db.prepare("SELECT id, emailVerified FROM User WHERE email = ?").get(emailNorm) as
    | { id: string; emailVerified: number }
    | undefined;

  if (exists?.emailVerified === 1) {
    res.status(409).json({ error: "البريد مستخدم مسبقاً" });
    return;
  }

  if (role === "RESTAURANT" && !restaurant) {
    res.status(400).json({ error: "بيانات المطعم مطلوبة" });
    return;
  }

  const passwordHash = await hashPassword(password);
  const userId = exists?.id ?? cuid();
  const phoneNorm = normalizePhone(phone);

  const tx = db.transaction(() => {
    if (exists) {
      db.prepare(
        `UPDATE User SET passwordHash = ?, name = ?, phone = ?, role = ?, emailVerified = 0 WHERE id = ?`
      ).run(passwordHash, name, phoneNorm, role, userId);
      db.prepare(`DELETE FROM Restaurant WHERE userId = ?`).run(userId);
      db.prepare(`DELETE FROM Captain WHERE userId = ?`).run(userId);
    } else {
      db.prepare(
        `INSERT INTO User (id, email, passwordHash, name, phone, role, emailVerified) VALUES (?, ?, ?, ?, ?, ?, 0)`
      ).run(userId, emailNorm, passwordHash, name, phoneNorm, role);
    }

    if (role === "RESTAURANT" && restaurant) {
      const city = resolveCityFromCoords(restaurant.lat, restaurant.lng).nameAr;
      db.prepare(
        `INSERT INTO Restaurant (id, userId, name, description, lat, lng, address, city) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        cuid(),
        userId,
        restaurant.name,
        restaurant.description ?? null,
        restaurant.lat,
        restaurant.lng,
        restaurant.address,
        city
      );
    }
    if (role === "CAPTAIN") {
      db.prepare(`INSERT INTO Captain (id, userId, vehicle) VALUES (?, ?, ?)`).run(
        cuid(),
        userId,
        captain?.vehicle ?? null
      );
    }
  });
  tx();

  try {
    await createAndSendActivationCode(emailNorm, name);
  } catch (e) {
    res.status(503).json({
      error: e instanceof Error ? e.message : "تعذر إرسال البريد",
    });
    return;
  }

  res.status(201).json({
    needsVerification: true,
    email: emailNorm,
    message: "تم إرسال كود التفعيل إلى بريدك الإلكتروني",
  });
});

router.post("/verify-email", async (req, res) => {
  const parsed = verifySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: formatZodError(parsed) });
    return;
  }

  const { email, code } = parsed.data;
  const emailNorm = email.toLowerCase();

  const result = await verifyOtpCode(emailNorm, code);
  if (!result.ok) {
    res.status(400).json({ error: result.error });
    return;
  }

  const user = db.prepare("SELECT * FROM User WHERE email = ?").get(emailNorm) as
    | {
        id: string;
        name: string;
        role: "CUSTOMER" | "RESTAURANT" | "CAPTAIN";
        email: string;
        emailVerified: number;
      }
    | undefined;

  if (!user) {
    res.status(404).json({ error: "الحساب غير موجود" });
    return;
  }

  db.prepare(`UPDATE User SET emailVerified = 1 WHERE id = ?`).run(user.id);

  const token = await signToken({ sub: user.id, role: user.role, email: user.email });
  const extras = getUserExtras(user.id);

  res.json({
    token,
    user: { id: user.id, name: user.name, role: user.role, ...extras },
    message: "تم تفعيل الحساب بنجاح",
  });
});

router.post("/resend-code", async (req, res) => {
  const email = (req.body as { email?: string }).email?.toLowerCase();
  if (!email) {
    res.status(400).json({ error: "البريد مطلوب" });
    return;
  }

  const user = db.prepare("SELECT id, name, emailVerified FROM User WHERE email = ?").get(email) as
    | { id: string; name: string; emailVerified: number }
    | undefined;

  if (!user) {
    res.status(404).json({ error: "لا يوجد حساب بهذا البريد" });
    return;
  }

  if (user.emailVerified === 1) {
    res.status(400).json({ error: "الحساب مفعّل مسبقاً" });
    return;
  }

  const cooldown = canResend(email);
  if (!cooldown.ok) {
    res.status(429).json({
      error: `انتظر ${cooldown.waitSec} ثانية قبل إعادة الإرسال`,
    });
    return;
  }

  try {
    await createAndSendActivationCode(email, user.name);
  } catch (e) {
    res.status(503).json({
      error: e instanceof Error ? e.message : "تعذر إرسال البريد",
    });
    return;
  }

  res.json({ message: "تم إرسال كود جديد إلى بريدك" });
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body as { email?: string; password?: string };
  if (!email || !password) {
    res.status(400).json({ error: "البريد وكلمة المرور مطلوبان" });
    return;
  }

  const user = db.prepare("SELECT * FROM User WHERE email = ?").get(email.toLowerCase()) as
    | {
        id: string;
        passwordHash: string;
        name: string;
        role: "CUSTOMER" | "RESTAURANT" | "CAPTAIN";
        email: string;
        emailVerified: number;
      }
    | undefined;

  if (!user || !(await verifyPassword(password, user.passwordHash))) {
    res.status(401).json({ error: "بيانات الدخول غير صحيحة" });
    return;
  }

  if (user.emailVerified !== 1) {
    try {
      await createAndSendActivationCode(user.email, user.name);
    } catch {
      /* ignore send failure on login */
    }
    res.status(403).json({
      error: "يجب تفعيل البريد أولاً",
      needsVerification: true,
      email: user.email,
    });
    return;
  }

  const token = await signToken({ sub: user.id, role: user.role, email: user.email });
  const extras = getUserExtras(user.id);

  res.json({
    token,
    user: {
      id: user.id,
      name: user.name,
      role: user.role,
      ...extras,
    },
  });
});

export default router;
