// src/App.tsx
// InternshipScanner — configurable internship radar. Pick the AI (Claude / ChatGPT /
// Gemini), enter its key, and configure the search. Auto-scans on open when a
// key is set and the last scan is older than SCAN_INTERVAL_HOURS.

import { useState, useEffect, useRef, useMemo, CSSProperties } from "react";
import {
  AppState,
  Opportunity,
  OpportunityStatus,
  Provider,
  ProviderConfig,
  Recency,
  ScanApiResponse,
  ScanRun,
  SearchConfig,
  PROGRAM_TYPE_OPTIONS,
  PROVIDER_LABELS,
} from "./types";
import {
  loadState,
  saveState,
  loadProviderConfig,
  saveProviderConfig,
  loadSearchConfig,
  saveSearchConfig,
} from "./storage";
import { changePassword, saveToken } from "./auth";

const SCAN_INTERVAL_HOURS = 20;
const MS_PER_HOUR = 60 * 60 * 1000;
const MAX_STORED_RUNS = 30;

const TRACKED_FIRMS = [
  "OPTIVER", "IMC", "FLOW TRADERS", "JANE STREET", "CITADEL SEC", "HRT",
  "DA VINCI", "SIG", "DRW", "JUMP", "FIVE RINGS", "GOOGLE", "DATABRICKS", "ASML",
];

const C = {
  bg: "#0C111B", panel: "#141C2B", panelUp: "#1A2335", line: "#243450",
  amber: "#E8A33D", amberDim: "#8A6526", steel: "#7FA6C9", text: "#E8EDF4",
  dim: "#8C97A9", green: "#5BBE8A", red: "#D06A5E",
} as const;

const fontDisplay = "'Barlow Condensed', sans-serif";
const fontMono = "'IBM Plex Mono', monospace";
const fontBody = "'IBM Plex Sans', sans-serif";

const GLOBAL_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&family=IBM+Plex+Sans:wght@400;500;600&display=swap');
@keyframes tickerScroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
@media (prefers-reduced-motion: reduce) { .ticker-track { animation: none !important; } }
input, textarea, select { font-family: ${fontMono}; }
input::placeholder, textarea::placeholder { color: ${C.dim}; }
`;

type Tab = "radar" | "runs" | "settings";
type Filter = "all" | "trading" | "swe" | "saved";

const PROVIDER_HELP: Record<Provider, { label: string; url: string; note: string }> = {
  gemini: { label: "Gemini", url: "aistudio.google.com", note: "Often free with a student Google account." },
  anthropic: { label: "Claude", url: "console.anthropic.com", note: "Needs API credit (separate from Claude.ai)." },
  openai: { label: "ChatGPT", url: "platform.openai.com", note: "Needs API credit (separate from ChatGPT Plus)." },
};

function slugify(company: string, title: string): string {
  return `${company}::${title}`.toLowerCase().replace(/[^a-z0-9:]+/g, "-");
}

function timeAgo(ts: number | null): string {
  if (ts === null) return "never";
  const hours = Math.floor((Date.now() - ts) / MS_PER_HOUR);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

async function requestScan(
  providerConfig: ProviderConfig,
  search: SearchConfig,
  knownSlugs: string[]
): Promise<ScanApiResponse> {
  const provider = providerConfig.provider;
  const response = await fetch("/api/scan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      provider,
      model: providerConfig.models[provider],
      apiKey: providerConfig.keys[provider],
      search,
      knownSlugs,
    }),
  });
  const payload: unknown = await response.json();
  if (!response.ok) {
    const message =
      typeof payload === "object" && payload !== null && "error" in payload
        ? String((payload as Record<string, unknown>).error)
        : `Scan request failed (${response.status})`;
    throw new Error(message);
  }
  return payload as ScanApiResponse;
}

// ---------- small presentational pieces ----------

function Badge({ children, color, filled = false }: { children: React.ReactNode; color: string; filled?: boolean }) {
  return (
    <span style={{
      fontFamily: fontMono, fontSize: 10, letterSpacing: 1, padding: "2px 7px", borderRadius: 3,
      color: filled ? C.bg : color, background: filled ? color : "transparent",
      border: `1px solid ${color}`, fontWeight: 500, whiteSpace: "nowrap",
    }}>{children}</span>
  );
}

function ActionButton({ label, onClick, color }: { label: string; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={{
      fontFamily: fontMono, fontSize: 11, padding: "7px 12px", background: "transparent",
      color: color ?? C.dim, border: `1px solid ${C.line}`, borderRadius: 4, cursor: "pointer",
    }}>{label}</button>
  );
}

const fieldLabelStyle: CSSProperties = {
  fontFamily: fontMono, fontSize: 10, letterSpacing: 1, color: C.dim,
  textTransform: "uppercase", display: "block", marginBottom: 5,
};
const inputStyle: CSSProperties = {
  width: "100%", boxSizing: "border-box", background: C.bg, color: C.text,
  border: `1px solid ${C.line}`, borderRadius: 4, padding: "9px 10px", fontSize: 13,
};

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={fieldLabelStyle}>{label}</label>
      {children}
    </div>
  );
}

function OpportunityCard({ opp, onSetStatus }: { opp: Opportunity; onSetStatus: (id: string, status: OpportunityStatus) => void }) {
  const isTrading = opp.type === "trading";
  const accent = isTrading ? C.amber : C.steel;
  return (
    <div style={{
      background: C.panel, border: `1px solid ${C.line}`, borderLeft: `3px solid ${accent}`,
      borderRadius: 6, padding: "14px 14px 12px", marginBottom: 10,
    }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
        <Badge color={accent} filled={isTrading}>{isTrading ? "TRADING" : "SWE"}</Badge>
        {opp.status === "new" && <Badge color={C.green}>▲ NEW</Badge>}
        {opp.status === "applied" && <Badge color={C.green} filled>APPLIED</Badge>}
        {opp.status === "saved" && <Badge color={C.steel}>SAVED</Badge>}
      </div>
      <div style={{ fontFamily: fontDisplay, fontSize: 22, fontWeight: 700, lineHeight: 1.1, color: C.text, textTransform: "uppercase" }}>{opp.company}</div>
      <div style={{ fontFamily: fontBody, fontSize: 14, color: C.text, margin: "3px 0 6px" }}>{opp.title}</div>
      <div style={{ fontFamily: fontMono, fontSize: 11, color: C.dim, display: "flex", gap: 14, flexWrap: "wrap" }}>
        {opp.location !== "" && <span>{opp.location}</span>}
        {opp.pay !== "" && <span style={{ color: C.amber }}>{opp.pay}</span>}
        {opp.deadline !== "" && <span>DL: {opp.deadline}</span>}
      </div>
      {opp.why !== "" && <div style={{ fontFamily: fontBody, fontSize: 12.5, color: C.dim, marginTop: 7, lineHeight: 1.45 }}>{opp.why}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
        {opp.url !== "" && (
          <a href={opp.url} target="_blank" rel="noopener noreferrer" style={{
            fontFamily: fontMono, fontSize: 11, padding: "7px 12px", background: accent,
            color: C.bg, borderRadius: 4, textDecoration: "none", fontWeight: 500,
          }}>OPEN POSTING ↗</a>
        )}
        {opp.status !== "saved" && <ActionButton label="SAVE" color={C.steel} onClick={() => onSetStatus(opp.id, "saved")} />}
        {opp.status !== "applied" && <ActionButton label="APPLIED" color={C.green} onClick={() => onSetStatus(opp.id, "applied")} />}
        <ActionButton label="HIDE" onClick={() => onSetStatus(opp.id, "hidden")} />
      </div>
    </div>
  );
}

function RunLog({ runs }: { runs: ScanRun[] }) {
  if (runs.length === 0) {
    return <div style={{ fontFamily: fontMono, fontSize: 12, color: C.dim, padding: 24, textAlign: "center" }}>No scans yet. Run your first scan from the Radar tab.</div>;
  }
  return (
    <div>
      {[...runs].reverse().map((run) => (
        <div key={run.ts} style={{ background: C.panel, border: `1px solid ${C.line}`, borderRadius: 6, padding: 13, marginBottom: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6, alignItems: "center", gap: 8 }}>
            <span style={{ fontFamily: fontMono, fontSize: 11, color: C.text }}>{new Date(run.ts).toLocaleString()}</span>
            {run.error !== null ? <Badge color={C.red}>FAILED</Badge> : <Badge color={C.green}>{run.newCount} NEW / {run.foundCount} FOUND</Badge>}
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 10, color: C.dim, marginBottom: 6 }}>
            via {PROVIDER_LABELS[run.provider]} · {run.model}
          </div>
          {run.error !== null && <div style={{ fontFamily: fontBody, fontSize: 12, color: C.red }}>{run.error}</div>}
          {run.queries.length > 0 && (
            <div style={{ marginTop: 4 }}>
              <div style={{ fontFamily: fontMono, fontSize: 10, color: C.dim, letterSpacing: 1, marginBottom: 4 }}>SEARCHES EXECUTED</div>
              {run.queries.map((query, index) => (
                <div key={index} style={{ fontFamily: fontMono, fontSize: 11.5, color: C.steel, padding: "2px 0" }}>› {query}</div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// ---------- password change ----------

function PasswordChangeSection() {
  const [oldPass, setOldPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [confirmPass, setConfirmPass] = useState("");
  const [status, setStatus] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState("");

  async function handleChange() {
    if (newPass.length < 8) { setErrorMsg("New password must be at least 8 characters."); setStatus("error"); return; }
    if (newPass !== confirmPass) { setErrorMsg("Passwords don't match."); setStatus("error"); return; }
    setStatus("busy"); setErrorMsg("");
    try {
      const token = await changePassword(oldPass, newPass);
      saveToken(token);
      setStatus("done");
      setOldPass(""); setNewPass(""); setConfirmPass("");
      window.setTimeout(() => setStatus("idle"), 2000);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Failed to change password.");
      setStatus("error");
    }
  }

  return (
    <div style={{ marginTop: 28 }}>
      <div style={{ height: 1, background: C.line, marginBottom: 20 }} />
      <h2 style={{ fontFamily: fontDisplay, fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.5 }}>Security</h2>
      <Field label="Current password">
        <input type="password" autoComplete="current-password" value={oldPass}
          onChange={(e) => { setOldPass(e.target.value); setStatus("idle"); setErrorMsg(""); }}
          style={inputStyle} />
      </Field>
      <Field label="New password">
        <input type="password" autoComplete="new-password" value={newPass}
          onChange={(e) => { setNewPass(e.target.value); setStatus("idle"); setErrorMsg(""); }}
          style={inputStyle} />
      </Field>
      <Field label="Confirm new password">
        <input type="password" autoComplete="new-password" value={confirmPass}
          onChange={(e) => { setConfirmPass(e.target.value); setStatus("idle"); setErrorMsg(""); }}
          style={inputStyle} />
      </Field>
      {errorMsg !== "" && (
        <div style={{ fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 10 }}>{errorMsg}</div>
      )}
      <button disabled={status === "busy"} onClick={() => void handleChange()} style={{
        width: "100%", fontFamily: fontDisplay, fontSize: 16, fontWeight: 700, letterSpacing: 1,
        padding: 12, borderRadius: 5, border: "none", cursor: status === "busy" ? "wait" : "pointer",
        background: status === "done" ? C.green : status === "busy" ? C.amberDim : C.amber,
        color: C.bg, textTransform: "uppercase",
      }}>
        {status === "busy" ? "Changing…" : status === "done" ? "Changed ✓" : "Change password"}
      </button>
    </div>
  );
}

// ---------- settings tab ----------

interface SettingsTabProps {
  providerConfig: ProviderConfig;
  searchConfig: SearchConfig;
  onSave: (provider: ProviderConfig, search: SearchConfig) => void;
}

function SettingsTab({ providerConfig, searchConfig, onSave }: SettingsTabProps) {
  const [draftProvider, setDraftProvider] = useState<ProviderConfig>(providerConfig);
  const [draftSearch, setDraftSearch] = useState<SearchConfig>(searchConfig);
  const [savedFlash, setSavedFlash] = useState(false);

  const active = draftProvider.provider;
  const help = PROVIDER_HELP[active];

  function updateSearch<K extends keyof SearchConfig>(key: K, value: SearchConfig[K]): void {
    setDraftSearch((previous) => ({ ...previous, [key]: value }));
  }

  function toggleProgramType(option: string): void {
    setDraftSearch((previous) => {
      const has = previous.programTypes.includes(option);
      return {
        ...previous,
        programTypes: has
          ? previous.programTypes.filter((item) => item !== option)
          : [...previous.programTypes, option],
      };
    });
  }

  function handleSave(): void {
    onSave(draftProvider, draftSearch);
    setSavedFlash(true);
    window.setTimeout(() => setSavedFlash(false), 1800);
  }

  return (
    <div>
      <h2 style={{ fontFamily: fontDisplay, fontSize: 20, fontWeight: 700, color: C.text, margin: "4px 0 12px", textTransform: "uppercase", letterSpacing: 0.5 }}>AI Provider</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 14 }}>
        {(["gemini", "anthropic", "openai"] as Provider[]).map((provider) => (
          <button key={provider} onClick={() => setDraftProvider((p) => ({ ...p, provider }))} style={{
            flex: 1, fontFamily: fontMono, fontSize: 12, padding: "10px 6px", borderRadius: 5, cursor: "pointer",
            background: active === provider ? C.amber : "transparent", color: active === provider ? C.bg : C.dim,
            border: `1px solid ${active === provider ? C.amber : C.line}`, fontWeight: active === provider ? 600 : 400,
          }}>{PROVIDER_LABELS[provider]}</button>
        ))}
      </div>

      <Field label={`${help.label} API key`}>
        <input
          type="password"
          autoComplete="off"
          placeholder={`Paste your ${help.label} key`}
          value={draftProvider.keys[active]}
          onChange={(e) => setDraftProvider((p) => ({ ...p, keys: { ...p.keys, [active]: e.target.value } }))}
          style={inputStyle}
        />
        <div style={{ fontFamily: fontMono, fontSize: 10.5, color: C.dim, marginTop: 5, lineHeight: 1.5 }}>
          Get it at {help.url}. {help.note} Stored only on this device.
        </div>
      </Field>

      <Field label={`${help.label} model`}>
        <input
          value={draftProvider.models[active]}
          onChange={(e) => setDraftProvider((p) => ({ ...p, models: { ...p.models, [active]: e.target.value } }))}
          style={inputStyle}
        />
      </Field>

      <div style={{ height: 1, background: C.line, margin: "20px 0" }} />

      <h2 style={{ fontFamily: fontDisplay, fontSize: 20, fontWeight: 700, color: C.text, margin: "0 0 12px", textTransform: "uppercase", letterSpacing: 0.5 }}>Search Setup</h2>

      <Field label="Your background">
        <input value={draftSearch.educationContext} onChange={(e) => updateSearch("educationContext", e.target.value)} style={inputStyle} />
      </Field>
      <Field label="Interests / roles">
        <input value={draftSearch.interests} onChange={(e) => updateSearch("interests", e.target.value)} style={inputStyle} />
      </Field>

      <Field label="Program types">
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {PROGRAM_TYPE_OPTIONS.map((option) => {
            const selected = draftSearch.programTypes.includes(option);
            return (
              <button key={option} onClick={() => toggleProgramType(option)} style={{
                fontFamily: fontMono, fontSize: 10.5, padding: "6px 10px", borderRadius: 99, cursor: "pointer",
                background: selected ? C.panelUp : "transparent", color: selected ? C.text : C.dim,
                border: `1px solid ${selected ? C.steel : C.line}`,
              }}>{selected ? "✓ " : ""}{option}</button>
            );
          })}
        </div>
      </Field>

      <Field label="Locations">
        <input value={draftSearch.locations} onChange={(e) => updateSearch("locations", e.target.value)} style={inputStyle} />
      </Field>

      <Field label="Target firms (comma-separated)">
        <textarea value={draftSearch.targetFirms} onChange={(e) => updateSearch("targetFirms", e.target.value)} rows={3} style={{ ...inputStyle, resize: "vertical" }} />
      </Field>

      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <Field label="Recency">
            <select value={draftSearch.recency} onChange={(e) => updateSearch("recency", e.target.value as Recency)} style={inputStyle}>
              <option value="week">Past week</option>
              <option value="month">Past month</option>
              <option value="year">This cycle / year</option>
              <option value="any">Any open now</option>
            </select>
          </Field>
        </div>
        <div style={{ width: 110 }}>
          <Field label="Max results">
            <input type="number" min={1} max={12} value={draftSearch.maxResults}
              onChange={(e) => updateSearch("maxResults", Math.max(1, Math.min(12, Number(e.target.value) || 1)))}
              style={inputStyle} />
          </Field>
        </div>
      </div>

      <Field label="Priority note (free text for the AI)">
        <input value={draftSearch.priorityNote} onChange={(e) => updateSearch("priorityNote", e.target.value)} style={inputStyle} />
      </Field>

      <button onClick={handleSave} style={{
        width: "100%", fontFamily: fontDisplay, fontSize: 16, fontWeight: 700, letterSpacing: 1,
        padding: "12px", borderRadius: 5, border: "none", cursor: "pointer",
        background: savedFlash ? C.green : C.amber, color: C.bg, textTransform: "uppercase", marginTop: 6,
      }}>{savedFlash ? "Saved ✓" : "Save settings"}</button>
    </div>
  );
}

// ---------- root ----------

export default function App({ onLock }: { onLock: () => void }) {
  const [state, setState] = useState<AppState | null>(null);
  const [providerConfig, setProviderConfig] = useState<ProviderConfig | null>(null);
  const [searchConfig, setSearchConfig] = useState<SearchConfig | null>(null);
  const [tab, setTab] = useState<Tab>("radar");
  const [filter, setFilter] = useState<Filter>("all");
  const [scanning, setScanning] = useState(false);
  const [statusLine, setStatusLine] = useState("");
  const bootRef = useRef(false);

  useEffect(() => {
    if (bootRef.current) return;
    bootRef.current = true;
    const loadedState = loadState();
    const loadedProvider = loadProviderConfig();
    const loadedSearch = loadSearchConfig();
    setState(loadedState);
    setProviderConfig(loadedProvider);
    setSearchConfig(loadedSearch);

    const hasKey = loadedProvider.keys[loadedProvider.provider] !== "";
    const isStale = loadedState.lastRun === null || Date.now() - loadedState.lastRun > SCAN_INTERVAL_HOURS * MS_PER_HOUR;
    if (hasKey && isStale) {
      void executeScan(loadedState, loadedProvider, loadedSearch);
    } else if (!hasKey) {
      setStatusLine("Add an AI key in Settings to start scanning");
      setTab("settings");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function executeScan(baseState?: AppState, baseProvider?: ProviderConfig, baseSearch?: SearchConfig): Promise<void> {
    const current = baseState ?? state;
    const provider = baseProvider ?? providerConfig;
    const search = baseSearch ?? searchConfig;
    if (current === null || provider === null || search === null || scanning) return;

    if (provider.keys[provider.provider] === "") {
      setStatusLine("No key for the selected AI — open Settings");
      setTab("settings");
      return;
    }

    setScanning(true);
    setStatusLine(`Scanning via ${PROVIDER_LABELS[provider.provider]}…`);

    const run: ScanRun = {
      ts: Date.now(), provider: provider.provider, model: provider.models[provider.provider],
      queries: [], foundCount: 0, newCount: 0, error: null,
    };
    const next: AppState = {
      opportunities: { ...current.opportunities },
      runs: [...current.runs],
      lastRun: Date.now(),
    };

    try {
      const { queries, findings } = await requestScan(provider, search, Object.keys(current.opportunities));
      run.queries = queries;
      run.foundCount = findings.length;
      for (const finding of findings) {
        const id = slugify(finding.company, finding.title);
        if (next.opportunities[id] !== undefined) continue;
        next.opportunities[id] = { ...finding, id, status: "new", firstSeen: Date.now() };
        run.newCount += 1;
      }
      setStatusLine(run.newCount > 0 ? `${run.newCount} new opportunit${run.newCount === 1 ? "y" : "ies"} found` : "Scan complete — nothing new");
    } catch (error) {
      run.error = error instanceof Error ? error.message : "Unknown error";
      setStatusLine("Scan failed — see Scan Log");
    }

    next.runs = [...next.runs.slice(-(MAX_STORED_RUNS - 1)), run];
    setState(next);
    saveState(next);
    setScanning(false);
  }

  function setStatus(id: string, status: OpportunityStatus): void {
    setState((previous) => {
      if (previous === null) return previous;
      const target = previous.opportunities[id];
      if (target === undefined) return previous;
      const next: AppState = { ...previous, opportunities: { ...previous.opportunities, [id]: { ...target, status } } };
      saveState(next);
      return next;
    });
  }

  function handleSaveSettings(provider: ProviderConfig, search: SearchConfig): void {
    setProviderConfig(provider);
    setSearchConfig(search);
    saveProviderConfig(provider);
    saveSearchConfig(search);
    setStatusLine(provider.keys[provider.provider] !== "" ? "Settings saved — ready to scan" : "Saved, but no key for the selected AI");
    setTab("radar");
  }

  const visible = useMemo<Opportunity[]>(() => {
    if (state === null) return [];
    const notHidden = Object.values(state.opportunities).filter((o) => o.status !== "hidden");
    const filtered = notHidden.filter((o) => {
      if (filter === "trading") return o.type === "trading";
      if (filter === "swe") return o.type === "swe";
      if (filter === "saved") return o.status === "saved" || o.status === "applied";
      return true;
    });
    return filtered.sort((a, b) => (a.type === "trading" ? 0 : 1) - (b.type === "trading" ? 0 : 1) || b.firstSeen - a.firstSeen);
  }, [state, filter]);

  if (state === null || providerConfig === null || searchConfig === null) {
    return (
      <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <style>{GLOBAL_CSS}</style>
        <span style={{ fontFamily: fontMono, color: C.dim, fontSize: 12 }}>LOADING…</span>
      </div>
    );
  }

  const tickerItems = [...TRACKED_FIRMS, ...TRACKED_FIRMS];
  const scanButtonStyle: CSSProperties = {
    fontFamily: fontDisplay, fontSize: 16, fontWeight: 700, letterSpacing: 1, padding: "10px 18px",
    borderRadius: 5, border: "none", cursor: scanning ? "wait" : "pointer",
    background: scanning ? C.amberDim : C.amber, color: C.bg, textTransform: "uppercase",
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: fontBody }}>
      <style>{GLOBAL_CSS}</style>

      <header style={{ padding: "18px 16px 10px", borderBottom: `1px solid ${C.line}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <h1 style={{ fontFamily: fontDisplay, fontSize: 30, fontWeight: 700, margin: 0, letterSpacing: 0.5, textTransform: "uppercase" }}>
            Internship<span style={{ color: C.amber }}>Scanner</span>
          </h1>
          <div style={{ display: "flex", gap: 10, alignItems: "baseline" }}>
            <span style={{ fontFamily: fontMono, fontSize: 10, color: C.dim }}>
              {PROVIDER_LABELS[providerConfig.provider].toUpperCase()} · LAST SCAN {timeAgo(state.lastRun).toUpperCase()}
            </span>
            <button onClick={onLock} style={{
              fontFamily: fontMono, fontSize: 10, letterSpacing: 0.5, padding: "3px 9px",
              background: "transparent", color: C.dim, border: `1px solid ${C.line}`,
              borderRadius: 3, cursor: "pointer",
            }}>LOCK</button>
          </div>
        </div>
        <div style={{ fontFamily: fontMono, fontSize: 10.5, color: C.dim, marginTop: 2 }}>INTERNSHIP RADAR · TU DELFT BCS · TRADING FIRST</div>
      </header>

      <div style={{ overflow: "hidden", borderBottom: `1px solid ${C.line}`, background: C.panel }}>
        <div className="ticker-track" style={{ display: "inline-flex", gap: 28, padding: "7px 0", whiteSpace: "nowrap", animation: "tickerScroll 35s linear infinite" }}>
          {tickerItems.map((firm, index) => (
            <span key={index} style={{ fontFamily: fontMono, fontSize: 10.5, color: index % 3 === 0 ? C.amber : C.dim, letterSpacing: 1.5 }}>{firm}</span>
          ))}
        </div>
      </div>

      <div style={{ padding: "12px 16px", display: "flex", gap: 10, alignItems: "center" }}>
        <button onClick={() => void executeScan()} disabled={scanning} style={scanButtonStyle}>
          {scanning ? "Scanning…" : "Run scan now"}
        </button>
        <span style={{ fontFamily: fontMono, fontSize: 11, color: C.dim, lineHeight: 1.4 }}>{statusLine}</span>
      </div>

      <nav style={{ display: "flex", borderBottom: `1px solid ${C.line}`, padding: "0 16px", gap: 22 }}>
        {([["radar", `RADAR (${visible.length})`], ["runs", `SCAN LOG (${state.runs.length})`], ["settings", "SETTINGS"]] as Array<[Tab, string]>).map(([key, label]) => (
          <button key={key} onClick={() => setTab(key)} style={{
            fontFamily: fontMono, fontSize: 11.5, letterSpacing: 1, padding: "10px 0", background: "none",
            border: "none", cursor: "pointer", color: tab === key ? C.amber : C.dim,
            borderBottom: tab === key ? `2px solid ${C.amber}` : "2px solid transparent",
          }}>{label}</button>
        ))}
      </nav>

      <main style={{ padding: 16, maxWidth: 680, margin: "0 auto" }}>
        {tab === "radar" && (
          <>
            <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
              {([["all", "ALL"], ["trading", "TRADING"], ["swe", "SWE"], ["saved", "SAVED"]] as Array<[Filter, string]>).map(([key, label]) => (
                <button key={key} onClick={() => setFilter(key)} style={{
                  fontFamily: fontMono, fontSize: 10.5, letterSpacing: 1, padding: "5px 12px", borderRadius: 99, cursor: "pointer",
                  background: filter === key ? C.panelUp : "transparent", color: filter === key ? C.text : C.dim,
                  border: `1px solid ${filter === key ? C.steel : C.line}`,
                }}>{label}</button>
              ))}
            </div>
            {visible.length === 0 ? (
              <div style={{ fontFamily: fontMono, fontSize: 12, color: C.dim, textAlign: "center", padding: 30, lineHeight: 1.6 }}>
                Nothing on the radar yet.<br />Run a scan to start tracking openings.
              </div>
            ) : (
              visible.map((opp) => <OpportunityCard key={opp.id} opp={opp} onSetStatus={setStatus} />)
            )}
          </>
        )}
        {tab === "runs" && <RunLog runs={state.runs} />}
        {tab === "settings" && (
          <>
            <SettingsTab providerConfig={providerConfig} searchConfig={searchConfig} onSave={handleSaveSettings} />
            <PasswordChangeSection />
          </>
        )}
      </main>

      <footer style={{ padding: "6px 16px 22px", fontFamily: fontMono, fontSize: 9.5, color: C.dim, textAlign: "center" }}>
        AUTO-SCANS ON OPEN IF LAST SCAN &gt; {SCAN_INTERVAL_HOURS}H AGO · VERIFY DEADLINES ON THE FIRM'S SITE
      </footer>
    </div>
  );
}
