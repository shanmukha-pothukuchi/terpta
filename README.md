# TerpTA

TerpTA is a TA-scheduling app for UMD courses. Coordinators define staffing periods, duty types, and shifts (weekly recurring, one-off, or async duties); TAs submit availability and hour preferences; a solver proposes assignments that respect availability, class conflicts, and hour targets. It also handles hour logging, shift-swap requests, and change tracking, with sign-in restricted to `umd.edu` / `terpmail.umd.edu` accounts.

## Stack

- **Frontend:** React + Vite + TypeScript
- **Backend:** [Convex](https://convex.dev) (database, functions, scheduler)
- **Auth:** WorkOS AuthKit (Google SSO, UMD domains only)
- **Hosting:** GitHub Pages (frontend) + Convex Cloud (backend), deployed via GitHub Actions
- **Course data:** [umd.io](https://umd.io) (cached in the `umdCache` table)

## Local development

```sh
npm install

# Terminal 1: local, login-free Convex deployment
CONVEX_AGENT_MODE=anonymous npx convex dev

# Terminal 2: frontend
npm run dev

# Optional: seed sample data
npx convex run seed:run
```

On Windows PowerShell, set the env var with `$env:CONVEX_AGENT_MODE = 'anonymous'` before running `npx convex dev`.

## Environment variables

| Variable | Where | Description |
|---|---|---|
| `VITE_CONVEX_URL` | frontend (.env.local) | Convex deployment URL; written by `npx convex dev` |
| `VITE_WORKOS_CLIENT_ID` | frontend | WorkOS AuthKit client id |
| `VITE_WORKOS_REDIRECT_URI` | frontend | OAuth callback URL (`http://localhost:5173/callback` locally) |
| `WORKOS_CLIENT_ID` | Convex server env | WorkOS client id, for token verification |
| `WORKOS_API_KEY` | Convex server env | WorkOS secret API key |
| `WORKOS_WEBHOOK_SECRET` | Convex server env | Verifies WorkOS webhook signatures |
| `SMTP_USER` / `SMTP_PASS` | Convex server env (optional) | Sends email over SMTP. For Gmail, `SMTP_PASS` is an [app password](https://myaccount.google.com/apppasswords), not the account password |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_FROM` | Convex server env (optional) | Defaults: `smtp.gmail.com`, `465`, `TerpTA <SMTP_USER>` |
| `RESEND_API_KEY` | Convex server env (optional) | Email via Resend, used only when `SMTP_*` is unset |
| `EXPORT_TOKEN_SECRET` | Convex server env | Signs tokenized calendar/CSV export links |

Set server-side vars with `npx convex env set NAME value` (or the Convex dashboard).

Email picks the first configured transport: SMTP, then Resend, then a console
log in `npx convex logs` when neither is set — so nothing depends on a paid
service to run. SMTP lives in `convex/smtp.ts`, which uses the Convex Node
runtime (`"use node"`) because SMTP needs raw TCP/TLS sockets.

## Deployment

Pushing to `main` runs `.github/workflows/deploy.yml`:

1. `npm ci` and `npm test`
2. `npx convex deploy --cmd 'npm run build'` — deploys Convex functions and builds the frontend against the production deployment
3. Uploads `dist/` and publishes to GitHub Pages

Required repo **secrets**: `CONVEX_DEPLOY_KEY` (from the Convex dashboard, production deploy key), `VITE_WORKOS_CLIENT_ID`.
Recommended repo **variable**: `VITE_WORKOS_REDIRECT_URI` (e.g. `https://shanmukha-pothukuchi.github.io/terpta/callback`); otherwise edit the fallback in the workflow.

## WorkOS dashboard checklist

- [ ] Redirect URIs: `https://shanmukha-pothukuchi.github.io/terpta/callback` and `http://localhost:5173/callback`
- [ ] CORS origins: `https://shanmukha-pothukuchi.github.io` and `http://localhost:5173`
- [ ] Google OAuth enabled
- [ ] Password authentication disabled
- [ ] Allowed email domains: `umd.edu`, `terpmail.umd.edu`

## Known gaps

_TBD — track outstanding issues and unfinished features here._
