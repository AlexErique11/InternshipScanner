// api/recheck.ts
// Accepts a list of { id, url } pairs and does a lightweight HTTP HEAD check on each.
// Only marks a listing as dead on an unambiguous 404 or 410 — everything else (timeouts,
// bot blocks, redirects) is treated as alive to avoid false positives.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const TIMEOUT_MS = 4000;
const MAX_JOBS = 50;

function asRecord(v: unknown): Record<string, unknown> | null {
  return typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;
}
function asArray(v: unknown): unknown[] { return Array.isArray(v) ? v : []; }
function asString(v: unknown): string { return typeof v === "string" ? v : ""; }

async function isAlive(url: string): Promise<boolean> {
  if (!url.startsWith("http")) return false;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "HEAD",
      signal: controller.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0 (compatible; JobChecker/1.0)" },
    });
    clearTimeout(timer);
    return res.status !== 404 && res.status !== 410;
  } catch {
    clearTimeout(timer);
    return true; // timeout / bot-block / network error → assume alive
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  const body = asRecord(req.body);
  if (!body) { res.status(400).json({ error: "Bad request" }); return; }

  const jobs = asArray(body.jobs)
    .slice(0, MAX_JOBS)
    .map((j) => { const r = asRecord(j); return { id: asString(r?.id), url: asString(r?.url) }; })
    .filter((j) => j.id !== "" && j.url !== "");

  const results = await Promise.all(
    jobs.map(async ({ id, url }) => ({ id, alive: await isAlive(url) }))
  );

  res.status(200).json({ results });
}
