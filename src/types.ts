// src/types.ts

export type OpportunityType = "trading" | "swe";
export type OpportunityStatus = "new" | "saved" | "applied" | "hidden" | "expired";
export type Provider = "anthropic" | "openai" | "gemini";
export type Recency = "week" | "month" | "year" | "any";

export interface Opportunity {
  id: string;
  company: string;
  title: string;
  type: OpportunityType;
  location: string;
  url: string;
  pay: string;
  deadline: string;
  why: string;
  status: OpportunityStatus;
  firstSeen: number;
}

export interface ScanRun {
  ts: number;
  provider: Provider;
  model: string;
  queries: string[];
  foundCount: number;
  newCount: number;
  error: string | null;
}

export interface AppState {
  opportunities: Record<string, Opportunity>;
  runs: ScanRun[];
  lastRun: number | null;
}

/** Which AI does the searching, and the keys for each option. */
export interface ProviderConfig {
  provider: Provider;
  models: Record<Provider, string>;
  keys: Record<Provider, string>;
}

/** What to search for — fed to the AI so it tailors its queries. */
export interface SearchConfig {
  educationContext: string;
  interests: string;
  programTypes: string[];
  locations: string;
  targetFirms: string;
  recency: Recency;
  maxResults: number;
  priorityNote: string;
}

/** Request body sent to /api/scan. */
export interface ScanRequest {
  provider: Provider;
  model: string;
  apiKey: string;
  search: SearchConfig;
  knownSlugs: string[];
}

export interface ScanApiResponse {
  queries: string[];
  findings: Array<{
    company: string;
    title: string;
    type: OpportunityType;
    location: string;
    url: string;
    pay: string;
    deadline: string;
    why: string;
  }>;
}

export const PROGRAM_TYPE_OPTIONS: readonly string[] = [
  "Summer internship",
  "Off-cycle internship",
  "Penultimate-year internship",
  "Insight day / Spring week",
  "Trading academy",
  "Graduate program",
  "Thesis / research project",
];

export const DEFAULT_PROVIDER_CONFIG: ProviderConfig = {
  provider: "gemini",
  models: {
    anthropic: "claude-sonnet-4-6",
    openai: "gpt-4.1",
    gemini: "gemini-2.5-flash",
  },
  keys: { anthropic: "", openai: "", gemini: "" },
};

export const DEFAULT_SEARCH_CONFIG: SearchConfig = {
  educationContext:
    "2nd-year BSc Computer Science student at TU Delft, Netherlands",
  interests:
    "Quant trading (top priority), quantitative research, software engineering",
  programTypes: [
    "Summer internship",
    "Off-cycle internship",
    "Insight day / Spring week",
    "Trading academy",
  ],
  locations: "Anywhere — Netherlands, London, US, remote",
  targetFirms:
    "Optiver, IMC Trading, Flow Traders, Da Vinci Derivatives, Jane Street, Citadel Securities, Hudson River Trading, Jump Trading, SIG, DRW, Five Rings, Maven, Google, Databricks, ASML, Adyen, Booking.com",
  recency: "month",
  maxResults: 6,
  priorityNote: "Prioritize trading firms; only prestigious or well-paid roles.",
};

export const EMPTY_STATE: AppState = {
  opportunities: {},
  runs: [],
  lastRun: null,
};

export const PROVIDER_LABELS: Record<Provider, string> = {
  anthropic: "Claude",
  openai: "ChatGPT",
  gemini: "Gemini",
};

export const PROVIDER_MODELS: Record<Provider, Array<{ id: string; label: string }>> = {
  anthropic: [
    { id: "claude-sonnet-4-6",        label: "Claude Sonnet 4.6 — recommended" },
    { id: "claude-opus-4-7",           label: "Claude Opus 4.7 — most capable" },
    { id: "claude-haiku-4-5-20251001", label: "Claude Haiku 4.5 — fastest" },
  ],
  openai: [
    { id: "gpt-4.1",      label: "GPT-4.1 — recommended" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 Mini — cheaper" },
    { id: "gpt-4o",       label: "GPT-4o" },
    { id: "gpt-4o-mini",  label: "GPT-4o Mini — cheaper" },
  ],
  gemini: [
    { id: "gemini-2.5-flash",      label: "Gemini 2.5 Flash — recommended" },
    { id: "gemini-2.0-flash",      label: "Gemini 2.0 Flash" },
    { id: "gemini-2.0-flash-lite", label: "Gemini 2.0 Flash Lite — cheapest" },
    { id: "gemini-1.5-pro",        label: "Gemini 1.5 Pro" },
    { id: "gemini-1.5-flash",      label: "Gemini 1.5 Flash" },
  ],
};
