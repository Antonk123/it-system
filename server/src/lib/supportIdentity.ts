import type { Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
export interface SupportIdentity {
  issuer: string;
  subject: string;
  name: string;
  email: string;
}
export function supportIdentity(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const secret = process.env.NAVET_SUPPORT_SECRET;
  const issuer = process.env.NAVET_SUPPORT_ISSUER;
  if (
    !secret ||
    secret.length < 32 ||
    !issuer ||
    secret === process.env.JWT_SECRET
  ) {
    res.status(503).json({ error: "Mina ärenden är inte aktiverat." });
    return;
  }
  try {
    const raw = req.get("X-Navet-Support");
    if (!raw || raw.length > 4096) throw new Error("Missing assertion");
    const p = jwt.verify(raw, secret, {
      algorithms: ["HS256"],
      issuer,
      audience: "it-ticket:self-service",
      maxAge: "5m",
    });
    if (
      typeof p === "string" ||
      p.scope !== "own-tickets" ||
      typeof p.sub !== "string" ||
      !p.sub ||
      p.sub.length > 128 ||
      typeof p.exp !== "number" ||
      typeof p.iat !== "number" ||
      p.exp - p.iat > 300 ||
      typeof p.name !== "string" ||
      !p.name.trim() ||
      p.name.length > 100 ||
      typeof p.email !== "string" ||
      p.email.length > 255 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(p.email)
    )
      throw new Error("Invalid assertion");
    res.locals.supportIdentity = {
      issuer,
      subject: p.sub,
      name: p.name,
      email: p.email,
    } satisfies SupportIdentity;
    next();
  } catch {
    res
      .status(401)
      .json({ error: "Öppna Felanmälan i Navet igen för att fortsätta." });
  }
}
