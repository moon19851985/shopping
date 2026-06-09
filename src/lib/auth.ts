import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import type { Request, Response, NextFunction } from "express";
export type Role = "CUSTOMER" | "RESTAURANT" | "CAPTAIN" | "ADMIN";

const secret = new TextEncoder().encode(
  process.env.JWT_SECRET ?? "dev-secret-change-me"
);

export type JwtPayload = {
  sub: string;
  role: Role;
  email: string;
};

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 10);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export async function signToken(payload: JwtPayload) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: "HS256" })
    .setExpirationTime("30d")
    .sign(secret);
}

export async function verifyToken(token: string): Promise<JwtPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret);
    return payload as unknown as JwtPayload;
  } catch {
    return null;
  }
}

export function authMiddleware(roles?: Role[]) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const header = req.headers.authorization;
    const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "غير مصرح" });
      return;
    }
    const payload = await verifyToken(token);
    if (!payload) {
      res.status(401).json({ error: "جلسة غير صالحة" });
      return;
    }
    if (roles && !roles.includes(payload.role)) {
      res.status(403).json({ error: "ليس لديك صلاحية" });
      return;
    }
    req.user = payload;
    next();
  };
}
