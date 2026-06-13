// api/auth.ts
// Server-side auth handler. Password hash lives in Vercel KV, never on the client.
// Actions: status | setup | verify | change | check
// Tokens are 30-day HMAC-signed expiry timestamps — stateless, no KV lookup to verify.
// Changing the password rotates the signing secret, invalidating all existing tokens.

import type { VercelRequest, VercelResponse } from "@vercel/node";
import { pbkdf2 as pbkdf2Cb, randomBytes, createHmac, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { Redis } from "@upstash/redis";

const kv = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
});

const pbkdf2 = promisify(pbkdf2Cb);

const ITERATIONS = 200_000;
const TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const RATE_LIMIT_MAX = 10;
const RATE_LIMIT_TTL_S = 3600;

const KV_HASH = "pw_hash";
const KV_SALT = "pw_salt";
const KV_SECRET = "auth_secret";

function asString(v: unknown): string {
  return typeof v === "string" ? v : "";
}
function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}

async function hashPassword(password: string, salt: Buffer): Promise<string> {
  const key = await pbkdf2(password, salt, ITERATIONS, 32, "sha256");
  return key.toString("base64");
}

function makeToken(secret: string): string {
  const exp = (Date.now() + TOKEN_TTL_MS).toString();
  const sig = createHmac("sha256", secret).update(exp).digest("hex");
  return `${exp}.${sig}`;
}

function verifyToken(token: string, secret: string): boolean {
  const dot = token.lastIndexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const exp = parseInt(payload, 10);
  if (isNaN(exp) || Date.now() > exp) return false;
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  try {
    return timingSafeEqual(Buffer.from(sig, "hex"), Buffer.from(expected, "hex"));
  } catch {
    return false;
  }
}

function getIp(req: VercelRequest): string {
  const fwd = req.headers["x-forwarded-for"];
  return (typeof fwd === "string" ? fwd.split(",")[0] : "unknown").trim();
}

async function isRateLimited(ip: string): Promise<boolean> {
  const count = (await kv.get<number>(`rl:${ip}`)) ?? 0;
  return count >= RATE_LIMIT_MAX;
}

async function recordFailure(ip: string): Promise<void> {
  const key = `rl:${ip}`;
  const count = (await kv.get<number>(key)) ?? 0;
  await kv.set(key, count + 1, { ex: RATE_LIMIT_TTL_S });
}

async function clearFailures(ip: string): Promise<void> {
  await kv.del(`rl:${ip}`);
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = asRecord(req.body);
  if (!body) {
    res.status(400).json({ error: "Bad request" });
    return;
  }

  const action = asString(body.action);

  // ── status ───────────────────────────────────────────────────────────────
  if (action === "status") {
    const hash = await kv.get<string>(KV_HASH);
    res.status(200).json({ configured: hash !== null });
    return;
  }

  // ── check (validate a stored session token) ───────────────────────────────
  if (action === "check") {
    const token = asString(body.token);
    const secret = await kv.get<string>(KV_SECRET);
    if (!token || !secret) {
      res.status(200).json({ valid: false });
      return;
    }
    res.status(200).json({ valid: verifyToken(token, secret) });
    return;
  }

  // ── setup (first-time only) ───────────────────────────────────────────────
  if (action === "setup") {
    const existing = await kv.get<string>(KV_HASH);
    if (existing !== null) {
      res.status(409).json({ error: "Password already configured." });
      return;
    }
    const password = asString(body.password);
    if (password.length < 8) {
      res.status(400).json({ error: "Password must be at least 8 characters." });
      return;
    }
    const salt = randomBytes(16);
    const hash = await hashPassword(password, salt);
    const secret = randomBytes(32).toString("hex");
    await Promise.all([
      kv.set(KV_HASH, hash),
      kv.set(KV_SALT, salt.toString("base64")),
      kv.set(KV_SECRET, secret),
    ]);
    res.status(200).json({ token: makeToken(secret) });
    return;
  }

  // ── verify (unlock) ───────────────────────────────────────────────────────
  if (action === "verify") {
    const ip = getIp(req);
    if (await isRateLimited(ip)) {
      res.status(429).json({ error: "Too many failed attempts. Try again later." });
      return;
    }
    const password = asString(body.password);
    const [hash, saltB64] = await Promise.all([
      kv.get<string>(KV_HASH),
      kv.get<string>(KV_SALT),
    ]);
    if (hash === null || saltB64 === null) {
      res.status(404).json({ error: "No password configured." });
      return;
    }
    const attempt = await hashPassword(password, Buffer.from(saltB64, "base64"));
    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(attempt, "base64"), Buffer.from(hash, "base64"));
    } catch {
      match = false;
    }
    if (!match) {
      await recordFailure(ip);
      res.status(401).json({ error: "Incorrect password." });
      return;
    }
    await clearFailures(ip);
    const secret = await kv.get<string>(KV_SECRET) ?? randomBytes(32).toString("hex");
    res.status(200).json({ token: makeToken(secret) });
    return;
  }

  // ── change password ───────────────────────────────────────────────────────
  if (action === "change") {
    const ip = getIp(req);
    if (await isRateLimited(ip)) {
      res.status(429).json({ error: "Too many failed attempts. Try again later." });
      return;
    }
    const oldPassword = asString(body.oldPassword);
    const newPassword = asString(body.newPassword);
    if (newPassword.length < 8) {
      res.status(400).json({ error: "New password must be at least 8 characters." });
      return;
    }
    const [hash, saltB64] = await Promise.all([
      kv.get<string>(KV_HASH),
      kv.get<string>(KV_SALT),
    ]);
    if (hash === null || saltB64 === null) {
      res.status(404).json({ error: "No password configured." });
      return;
    }
    const attempt = await hashPassword(oldPassword, Buffer.from(saltB64, "base64"));
    let match = false;
    try {
      match = timingSafeEqual(Buffer.from(attempt, "base64"), Buffer.from(hash, "base64"));
    } catch {
      match = false;
    }
    if (!match) {
      await recordFailure(ip);
      res.status(401).json({ error: "Incorrect current password." });
      return;
    }
    await clearFailures(ip);
    const newSalt = randomBytes(16);
    const newHash = await hashPassword(newPassword, newSalt);
    const newSecret = randomBytes(32).toString("hex");
    await Promise.all([
      kv.set(KV_HASH, newHash),
      kv.set(KV_SALT, newSalt.toString("base64")),
      kv.set(KV_SECRET, newSecret),
    ]);
    res.status(200).json({ token: makeToken(newSecret) });
    return;
  }

  res.status(400).json({ error: "Unknown action." });
}
