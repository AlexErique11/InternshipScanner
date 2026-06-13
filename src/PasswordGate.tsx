import { useState, useEffect, useRef, CSSProperties } from "react";
import {
  isPasswordConfigured,
  checkStoredToken,
  saveToken,
  setupPassword,
  verifyPassword,
} from "./auth";

const C = {
  bg: "#0C111B", panel: "#141C2B", line: "#243450",
  amber: "#E8A33D", amberDim: "#8A6526", text: "#E8EDF4",
  dim: "#8C97A9", red: "#D06A5E",
} as const;

const fontDisplay = "'Barlow Condensed', sans-serif";
const fontMono = "'IBM Plex Mono', monospace";

const GATE_CSS = `
@import url('https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@600;700&family=IBM+Plex+Mono:wght@400;500&display=swap');
input[data-gate] { font-family: ${fontMono}; }
input[data-gate]::placeholder { color: ${C.dim}; }
`;

const LOCKOUT_STEPS: Array<[minFailures: number, seconds: number]> = [
  [9, 3600], [6, 300], [3, 30],
];

function lockoutSeconds(failures: number): number {
  for (const [min, secs] of LOCKOUT_STEPS) if (failures >= min) return secs;
  return 0;
}

function fmt(secs: number): string {
  if (secs >= 3600) return `${Math.ceil(secs / 3600)}h`;
  if (secs >= 60) return `${Math.ceil(secs / 60)}m ${secs % 60}s`;
  return `${secs}s`;
}

type Phase = "loading" | "setup" | "unlock";

interface Props { onUnlock: () => void; }

export default function PasswordGate({ onUnlock }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [password, setPass] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState(0);
  const [lockedUntil, setLockedUntil] = useState<number | null>(null);
  const [countdown, setCountdown] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // On mount: try stored token first, then ask server for status
  useEffect(() => {
    let cancelled = false;
    async function init() {
      const valid = await checkStoredToken();
      if (cancelled) return;
      if (valid) { onUnlock(); return; }
      const configured = await isPasswordConfigured();
      if (!cancelled) setPhase(configured ? "unlock" : "setup");
    }
    void init();
    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (phase !== "loading") inputRef.current?.focus();
  }, [phase]);

  useEffect(() => {
    if (lockedUntil === null) return;
    let timer: ReturnType<typeof setTimeout>;
    const tick = () => {
      const remaining = Math.ceil((lockedUntil - Date.now()) / 1000);
      if (remaining <= 0) {
        setLockedUntil(null); setCountdown(0); setError("");
      } else {
        setCountdown(remaining);
        timer = setTimeout(tick, 1000);
      }
    };
    timer = setTimeout(tick, 0);
    return () => clearTimeout(timer);
  }, [lockedUntil]);

  const isLocked = lockedUntil !== null && Date.now() < lockedUntil;

  async function handleSetup() {
    if (password.length < 8) { setError("Password must be at least 8 characters."); return; }
    if (password !== confirm) { setError("Passwords don't match."); return; }
    setBusy(true); setError("");
    try {
      const token = await setupPassword(password);
      saveToken(token);
      onUnlock();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed.");
      setBusy(false);
    }
  }

  async function handleUnlock() {
    if (isLocked || busy) return;
    setBusy(true); setError("");
    const token = await verifyPassword(password);
    setBusy(false);
    if (token !== null) {
      saveToken(token);
      onUnlock();
      return;
    }
    const next = failures + 1;
    setFailures(next);
    setPass("");
    const secs = lockoutSeconds(next);
    if (secs > 0) {
      setLockedUntil(Date.now() + secs * 1000);
      setError(`Too many failed attempts — locked for ${fmt(secs)}.`);
    } else {
      setError("Incorrect password.");
      inputRef.current?.focus();
    }
  }

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "Enter") void (phase === "setup" ? handleSetup() : handleUnlock());
  }

  const inputStyle: CSSProperties = {
    width: "100%", boxSizing: "border-box", background: C.bg, color: C.text,
    border: `1px solid ${C.line}`, borderRadius: 4, padding: "11px 12px",
    fontSize: 14, marginBottom: 10, outline: "none",
  };
  const btnStyle: CSSProperties = {
    width: "100%", fontFamily: fontDisplay, fontSize: 16, fontWeight: 700,
    letterSpacing: 1, padding: 12, borderRadius: 5, border: "none",
    cursor: busy || isLocked || phase === "loading" ? "not-allowed" : "pointer",
    background: busy || isLocked || phase === "loading" ? C.amberDim : C.amber,
    color: C.bg, textTransform: "uppercase", marginTop: 4,
  };

  return (
    <div style={{ minHeight: "100vh", background: C.bg, display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <style>{GATE_CSS}</style>
      <div style={{ width: "100%", maxWidth: 340, background: C.panel, border: `1px solid ${C.line}`, borderRadius: 8, padding: "28px 24px" }}>

        <div style={{ marginBottom: 24, textAlign: "center" }}>
          <div style={{ fontFamily: fontDisplay, fontSize: 26, fontWeight: 700, letterSpacing: 0.5, textTransform: "uppercase", color: C.text }}>
            Internship<span style={{ color: C.amber }}>Scanner</span>
          </div>
          <div style={{ fontFamily: fontMono, fontSize: 9.5, color: C.dim, marginTop: 5, letterSpacing: 1.2, textTransform: "uppercase" }}>
            {phase === "loading" && "Checking session…"}
            {phase === "setup" && "Set a password to protect this app"}
            {phase === "unlock" && "Enter password to unlock"}
          </div>
        </div>

        {phase === "loading" && (
          <div style={{ fontFamily: fontMono, fontSize: 11, color: C.dim, textAlign: "center", padding: "12px 0" }}>
            Loading…
          </div>
        )}

        {phase === "setup" && (
          <>
            <input data-gate ref={inputRef} type="password" autoComplete="new-password"
              placeholder="New password (8+ characters)" value={password}
              onChange={(e) => { setPass(e.target.value); setError(""); }}
              onKeyDown={onKey} style={inputStyle} />
            <input data-gate type="password" autoComplete="new-password"
              placeholder="Confirm password" value={confirm}
              onChange={(e) => { setConfirm(e.target.value); setError(""); }}
              onKeyDown={onKey} style={inputStyle} />
          </>
        )}

        {phase === "unlock" && (
          <input data-gate ref={inputRef} type="password" autoComplete="current-password"
            placeholder="Password" value={password} disabled={isLocked}
            onChange={(e) => { setPass(e.target.value); setError(""); }}
            onKeyDown={onKey} style={inputStyle} />
        )}

        {isLocked && (
          <div style={{ fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 10, textAlign: "center" }}>
            Locked — {fmt(countdown)} remaining
          </div>
        )}

        {error !== "" && !isLocked && (
          <div style={{ fontFamily: fontMono, fontSize: 11, color: C.red, marginBottom: 10 }}>{error}</div>
        )}

        {phase !== "loading" && (
          <button disabled={busy || isLocked} onClick={() => void (phase === "setup" ? handleSetup() : handleUnlock())} style={btnStyle}>
            {busy ? "Verifying…" : phase === "setup" ? "Set password" : "Unlock"}
          </button>
        )}
      </div>
    </div>
  );
}
