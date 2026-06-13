// Client-side auth utilities. All sensitive operations happen server-side (/api/auth).
// The client only stores a signed session token in localStorage (30-day expiry).

const SESSION_KEY = "internshipscanner-session-v1";

async function post(body: Record<string, unknown>): Promise<Response> {
  return fetch("/api/auth", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = await res.json() as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

export async function isPasswordConfigured(): Promise<boolean> {
  try {
    const res = await post({ action: "status" });
    const data = await res.json() as { configured: boolean };
    return data.configured;
  } catch {
    return false;
  }
}

export function getStoredToken(): string | null {
  return localStorage.getItem(SESSION_KEY);
}

export function saveToken(token: string): void {
  localStorage.setItem(SESSION_KEY, token);
}

export function clearToken(): void {
  localStorage.removeItem(SESSION_KEY);
}

export async function checkStoredToken(): Promise<boolean> {
  const token = getStoredToken();
  if (!token) return false;
  try {
    const res = await post({ action: "check", token });
    const data = await res.json() as { valid: boolean };
    return data.valid;
  } catch {
    return false;
  }
}

export async function setupPassword(password: string): Promise<string> {
  const res = await post({ action: "setup", password });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = await res.json() as { token: string };
  return data.token;
}

export async function verifyPassword(password: string): Promise<string | null> {
  const res = await post({ action: "verify", password });
  if (!res.ok) return null;
  const data = await res.json() as { token: string };
  return data.token;
}

export async function changePassword(oldPassword: string, newPassword: string): Promise<string> {
  const res = await post({ action: "change", oldPassword, newPassword });
  if (!res.ok) throw new Error(await errorMessage(res));
  const data = await res.json() as { token: string };
  return data.token;
}
