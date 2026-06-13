# OpenDesk — Internship Radar

A configurable daily web scan for trading & SWE internships and programs, built
for a TU Delft BCS student. Trading prioritized, worldwide scope. Installs on
Android as a home-screen app.

## What's configurable (all in-app, under Settings)

- **AI provider**: pick Gemini, Claude, or ChatGPT. Paste that provider's API
  key once — it's saved on your device only.
- **Model**: editable per provider (sensible defaults pre-filled).
- **Search setup**: your background, target roles/interests, program types
  (summer / off-cycle / insight day / trading academy / graduate / thesis),
  locations, target firms, recency window, result count, and a free-text
  priority note. The searching AI tailors its queries to all of this.

## Which provider should I use?

| Provider | Where to get a key | Cost |
|---|---|---|
| **Gemini** | aistudio.google.com | Often **free** with a student Google account |
| **Claude** | console.anthropic.com | API credit, ~€0.05/scan (separate from Claude.ai) |
| **ChatGPT** | platform.openai.com | API credit, ~€0.03/scan (separate from ChatGPT Plus) |

Note: a Claude.ai / ChatGPT Plus / Gemini app subscription does **not** give API
access — each needs an API key, which is a separate developer credential.

## How it works

- **Frontend**: React + TypeScript PWA. Auto-scans when opened if a key is set
  and the last scan was 20+ hours ago (open it each morning = one scan/day).
- **Backend**: one Vercel serverless function (`api/scan.ts`) that proxies to
  whichever provider you chose. Anthropic and OpenAI block direct browser calls
  (CORS), so the call must go through this function. Your key is sent over HTTPS
  to your own deployment and is never logged.
- **Storage**: results, statuses, scan log, keys, and search config all live in
  your browser's localStorage on your phone.

## Setup (~15 min, one time)

### 1. Get an API key for your chosen provider
See the table above. For Gemini: sign in at aistudio.google.com with your
`@student.tudelft.nl` account, click **Get API key**, copy it.

### 2. Put this project on GitHub
Create a private repo at github.com, then from this folder:
```bash
git init && git add . && git commit -m "OpenDesk"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/opendesk.git
git push -u origin main
```

### 3. Deploy on Vercel
1. Sign in at vercel.com with GitHub → **Add New → Project** → import the repo.
2. Vercel auto-detects Vite — accept defaults and **Deploy**.
3. You get a URL like `https://opendesk-yourname.vercel.app`.

You do **not** need to set any environment variable — keys are entered in-app.

### 4. Install on Android
1. Open the Vercel URL in **Chrome** on your phone.
2. Chrome menu (⋮) → **Add to Home screen** → **Install**.
3. Open it from your app drawer. It runs full-screen like a native app.

### 5. First run
The app opens on the **Settings** tab until a key is set. Pick a provider, paste
the key, adjust the search setup, tap **Save settings**. Then tap **Run scan
now** (or just reopen the app daily).

## Daily use

Open the app once a day. If 20+ hours have passed it scans automatically. The
**Scan Log** tab shows which provider/model ran and the exact searches it made.
Tag findings Saved / Applied / Hide. Always verify deadlines on the firm's own
careers page.

## Local development

```bash
npm install
npx vercel dev   # serves frontend + /api/scan locally (needs `npm i -g vercel`)
```
`npm run dev` serves only the frontend; the `/api/scan` route needs `vercel dev`
or a deployed environment.

## Security note

API keys are stored in your phone's localStorage and sent to your own Vercel
backend over HTTPS per scan. For a single-user personal app this is a reasonable
tradeoff. Don't deploy this to a public URL you share with others while your keys
are in it, and rotate a key if you ever suspect it leaked.

## Tuning

Everything tunable lives in the Settings tab now. To change defaults or the
prompt structure itself, edit `DEFAULT_SEARCH_CONFIG` in `src/types.ts` or
`buildPrompt()` in `api/scan.ts`, then `git push` (Vercel redeploys on push).
