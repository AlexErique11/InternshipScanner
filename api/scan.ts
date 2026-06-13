// api/scan.ts
// Vercel serverless function. Acts as a provider-agnostic proxy: the client
// sends the chosen provider, model, its API key, and the search config; this
// function calls the right web-search API and returns normalized findings.
//
// Why server-side? Anthropic and OpenAI reject browser-origin (CORS) requests,
// so a unified proxy is the only way all three providers work from one app.
// The key is sent over HTTPS to the user's own deployment and is never logged.

import type { VercelRequest, VercelResponse } from "@vercel/node";

const MAX_KNOWN_SLUGS = 40;
const MAX_SEARCHES = 8;
const MAX_TOKENS = 8000;

type Provider = "anthropic" | "openai" | "gemini";
type Recency = "week" | "month" | "year" | "any";

interface SearchConfig {
  educationContext: string;
  interests: string;
  programTypes: string[];
  locations: string;
  targetFirms: string;
  recency: Recency;
  maxResults: number;
  priorityNote: string;
}

interface Finding {
  company: string;
  title: string;
  type: "trading" | "swe";
  location: string;
  url: string;
  pay: string;
  deadline: string;
  applicationPeriod: string;
  internshipPeriod: string;
  targetYear: string;
  why: string;
}

interface ProviderResult {
  text: string;
  executedQueries: string[];
}

// ---------- safe accessors (narrow unknown without `any`) ----------

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : null;
}
function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// ---------- prompt ----------

const RECENCY_TEXT: Record<Recency, string> = {
  week: "posted or opening within the last 7 days",
  month: "posted or opening within the last 30 days",
  year: "with application windows in the current cycle or year",
  any: "currently open or opening soon",
};

function buildPrompt(config: SearchConfig, knownSlugs: string[]): string {
  const today = new Date().toDateString();
  const programs =
    config.programTypes.length > 0
      ? config.programTypes.join(", ")
      : "internships and prestigious student programs";
  const known = knownSlugs.slice(0, MAX_KNOWN_SLUGS).join(", ") || "none";
  const limit = Math.max(1, Math.min(config.maxResults, 30));

  return `You are a recruiting scout that searches the web for opportunities for one specific candidate.

Candidate context: ${config.educationContext}
Interests / target roles: ${config.interests}
Program types wanted: ${programs}
Locations: ${config.locations}
Target firms (prioritize these, but also include other prestigious matches): ${config.targetFirms}
Recency: prefer postings ${RECENCY_TEXT[config.recency]}.
Extra priority: ${config.priorityNote}

Today is ${today}. Use web search to find CURRENTLY OPEN or soon-opening opportunities that match the above. Skip anything already known: ${known}.

Respond with ONLY a raw JSON object — no markdown fences, no prose before or after:
{"queries":["the search query you ran"],"findings":[{"company":"","title":"","type":"trading"|"swe","location":"","url":"","pay":"","deadline":"","applicationPeriod":"","internshipPeriod":"","targetYear":"","why":""}]}

Return at most ${limit} findings. Field definitions:
- type: "trading" for quant/trading/prop-trading roles, "swe" for software engineering
- deadline: application deadline date only (e.g. "31 Jan 2026")
- applicationPeriod: full window applications are open (e.g. "Oct 2025 – Jan 2026")
- internshipPeriod: when the internship/program itself runs (e.g. "Jun – Aug 2026")
- targetYear: year of study targeted (e.g. "1st/2nd year BSc", "penultimate year", "any year")
- why: one sentence on fit or prestige for this specific candidate
- Leave any unknown field as ""

STRICT URL RULE: The url field must be the exact, complete URL copied verbatim from your web search result — the direct link to the specific job posting page. Never guess, construct, abbreviate, or modify a URL. Never use a company homepage or a generic /careers page. If you did not get a direct posting URL from a search result, leave url as "". A missing URL is far better than a wrong one.`;
}

// ---------- providers ----------

async function callAnthropic(
  apiKey: string,
  model: string,
  prompt: string
): Promise<ProviderResult> {
  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model,
      max_tokens: MAX_TOKENS,
      messages: [{ role: "user", content: prompt }],
      tools: [
        { type: "web_search_20250305", name: "web_search", max_uses: MAX_SEARCHES },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Claude API returned ${response.status}. Check the key at console.anthropic.com, your credit balance, and that web search is enabled in Console settings.`
    );
  }

  const data: unknown = await response.json();
  const blocks = asArray(asRecord(data)?.content);
  const executedQueries: string[] = [];
  let text = "";
  for (const block of blocks) {
    const record = asRecord(block);
    if (record === null) continue;
    if (record.name === "web_search") {
      const query = asString(asRecord(record.input)?.query);
      if (query !== "") executedQueries.push(query);
    }
    if (record.type === "text") text += `${asString(record.text)}\n`;
  }
  return { text, executedQueries };
}

async function callOpenAI(
  apiKey: string,
  model: string,
  prompt: string
): Promise<ProviderResult> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }],
      input: prompt,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `OpenAI API returned ${response.status}. Check the key at platform.openai.com, your credit balance, and that the model "${model}" supports web search.`
    );
  }

  const data: unknown = await response.json();
  const root = asRecord(data);
  const output = asArray(root?.output);
  const executedQueries: string[] = [];
  let text = asString(root?.output_text);

  for (const item of output) {
    const record = asRecord(item);
    if (record === null) continue;
    if (record.type === "web_search_call") {
      const query = asString(asRecord(record.action)?.query);
      if (query !== "") executedQueries.push(query);
    }
    if (record.type === "message" && text === "") {
      for (const part of asArray(record.content)) {
        const partRecord = asRecord(part);
        if (partRecord?.type === "output_text") {
          text += asString(partRecord.text);
        }
      }
    }
  }
  return { text, executedQueries };
}

async function callGemini(
  apiKey: string,
  model: string,
  prompt: string
): Promise<ProviderResult> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      tools: [{ google_search: {} }],
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Gemini API returned ${response.status}. Check the key at aistudio.google.com and that the model "${model}" is available to your account.`
    );
  }

  const data: unknown = await response.json();
  const candidate = asRecord(asArray(asRecord(data)?.candidates)[0]);
  const parts = asArray(asRecord(candidate?.content)?.parts);
  const text = parts.map((part) => asString(asRecord(part)?.text)).join("");
  const grounding = asRecord(candidate?.groundingMetadata);
  const executedQueries = asArray(grounding?.webSearchQueries)
    .map(asString)
    .filter((query) => query !== "");
  return { text, executedQueries };
}

// ---------- parsing & normalization ----------

function extractJsonObject(text: string): Record<string, unknown> {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    throw new Error("The AI did not return parseable JSON. Try again, or switch model in Settings.");
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  const record = asRecord(parsed);
  if (record === null) throw new Error("AI response was not a JSON object.");
  return record;
}

function isSpecificJobUrl(url: string): boolean {
  if (url === "") return false;
  try {
    const path = new URL(url).pathname.replace(/\/$/, "");
    if (path.length < 5) return false;
    if (/^\/(careers?|jobs?|apply|work-?with-?us|join-?us|opportunities?|open-?positions?|positions?)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function normalizeFindings(raw: unknown[]): Finding[] {
  const findings: Finding[] = [];
  for (const item of raw) {
    const record = asRecord(item);
    if (record === null) continue;
    const company = asString(record.company);
    const title = asString(record.title);
    if (company === "" || title === "") continue;
    const rawUrl = asString(record.url);
    findings.push({
      company,
      title,
      type: record.type === "trading" ? "trading" : "swe",
      location: asString(record.location),
      url: isSpecificJobUrl(rawUrl) ? rawUrl : "",
      pay: asString(record.pay),
      deadline: asString(record.deadline),
      applicationPeriod: asString(record.applicationPeriod),
      internshipPeriod: asString(record.internshipPeriod),
      targetYear: asString(record.targetYear),
      why: asString(record.why),
    });
  }
  return findings;
}

// ---------- request parsing ----------

function parseRequest(body: unknown): {
  provider: Provider;
  model: string;
  apiKey: string;
  search: SearchConfig;
  knownSlugs: string[];
} {
  const record = asRecord(body);
  if (record === null) throw new Error("Missing request body.");

  const provider = record.provider;
  if (provider !== "anthropic" && provider !== "openai" && provider !== "gemini") {
    throw new Error("Unknown provider.");
  }

  const apiKey = asString(record.apiKey);
  if (apiKey === "") {
    throw new Error("No API key provided. Add one in the app's Settings tab.");
  }

  const searchRecord = asRecord(record.search) ?? {};
  const recencyRaw = asString(searchRecord.recency);
  const recency: Recency =
    recencyRaw === "week" || recencyRaw === "month" || recencyRaw === "year"
      ? recencyRaw
      : "any";

  const search: SearchConfig = {
    educationContext: asString(searchRecord.educationContext),
    interests: asString(searchRecord.interests),
    programTypes: asArray(searchRecord.programTypes).map(asString).filter((p) => p !== ""),
    locations: asString(searchRecord.locations),
    targetFirms: asString(searchRecord.targetFirms),
    recency,
    maxResults: typeof searchRecord.maxResults === "number" ? searchRecord.maxResults : 6,
    priorityNote: asString(searchRecord.priorityNote),
  };

  const knownSlugs = asArray(record.knownSlugs).map(asString).filter((s) => s !== "");

  return { provider, model: asString(record.model), apiKey, search, knownSlugs };
}

// ---------- handler ----------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  let parsed;
  try {
    parsed = parseRequest(req.body);
  } catch (error) {
    res.status(400).json({ error: error instanceof Error ? error.message : "Bad request" });
    return;
  }

  const { provider, model, apiKey, search, knownSlugs } = parsed;
  const prompt = buildPrompt(search, knownSlugs);

  try {
    let result: ProviderResult;
    if (provider === "anthropic") result = await callAnthropic(apiKey, model, prompt);
    else if (provider === "openai") result = await callOpenAI(apiKey, model, prompt);
    else result = await callGemini(apiKey, model, prompt);

    const parsedJson = extractJsonObject(result.text);
    const reportedQueries = asArray(parsedJson.queries)
      .map(asString)
      .filter((query) => query !== "");
    const findings = normalizeFindings(asArray(parsedJson.findings));

    res.status(200).json({
      queries: [...new Set([...result.executedQueries, ...reportedQueries])],
      findings,
    });
  } catch (error) {
    // Never log the key or request body.
    const detail = error instanceof Error ? error.message : "Unknown error";
    console.error(`Scan failed (provider=${provider}): ${detail}`);
    res.status(502).json({ error: detail });
  }
}
