# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-role program management web app (Admin / Mentor / Volunteer / Student) with an
iOS-minimalist UI. See [README.md](README.md) for the product flow. Two packages, run and
deployed independently.

**This repo is "SDP", a fork of `ios-bootcamp`.** The UI calls things "SDP" and "Cohort",
but the code still says `bootcamp` everywhere: tables, columns, routes (`/api/bootcamps`),
`?bootcamp=` params, `lib/bootcamp.js`. Keep the `bootcamp` names in code and use
"Cohort"/"SDP" only in text users see. README.md, DEPLOYMENT.md and `deploy/*.conf` still
describe the original Bootcamp deployment (`/bootcamp`, ports 3100/4100). For SDP use
`/sdp`, ports **3200 (web) / 4200 (API)** and PM2 apps `sdp-web` / `sdp-api` (see
`ecosystem.config.js`, `frontend/.env.production`).

## Commands

Backend (`backend/`, Express + MySQL, CommonJS, default port 4000):
```bash
npm install
npm run dev      # node --watch src/server.js — creates DB, runs schema + migrations, seeds admin on boot
npm start        # production
```
`npm run seed` points to `src/seed.js`, which does not exist. Seeding already happens in `db.js` on boot.

Frontend (`frontend/`, Next.js 16 beta Pages Router + React 19, ESM, port 3000):
```bash
npm install
npm run dev
npm run build    # the only compile check — run it after frontend changes
```
There is no test suite and no linter. To smoke-test the API, boot the backend, then
`curl localhost:4000/api/health` and `POST /api/auth/login`. The default admin is
`admin@bootcamp.local` / `Admin@12345` unless overridden in `backend/.env`.
`.claude/launch.json` defines a `web` preview config (frontend dev server).

Production (`ubuntu@15.206.107.186`, `~/ios-sdp`, a git checkout of `origin/main`; iosform and
ios-bootcamp run on the same box, so only ever restart `sdp-*`). Always `git fetch` first, both
locally and on the server, and deploy only what has been pushed. Update with
`git fetch && git reset --hard origin/main`, not `git pull`: `npm install` rewrites the lockfiles on
the ARM box, and `.env` / `*.bak-*` are untracked, so the reset leaves them alone. Back up first
(`~/backups`: tar of `~/ios-sdp` without node_modules, plus `mysqldump --single-transaction ios_sdp`),
then reinstall, run `npm run build` in frontend (the box has 1.8 GB RAM and no swap), and run
`pm2 restart sdp-api sdp-web`.

## Architecture

**Backend** (`backend/src/`):
- `config.js` — every env var and its default (PORT, comma-separated `CORS_ORIGIN`, JWT,
  seeded admin, DB, S3). Local-disk dirs `CHAT_UPLOAD_DIR` / `CERT_UPLOAD_DIR` are read in
  their routers and default to `backend/chat-uploads/` / `backend/cert-uploads/` (gitignored).
- `server.js` — mounts every router under `/api/*`, attaches the chat WebSocket hub
  (`chatHub.js`, path `/api/ws`) to the same HTTP server, and starts `chatCleanup.js`
  (deletes chat files older than 30 days, every 6h). Has a central error handler.
- `util.js` — wrap async handlers in `ah(...)` and throw `HttpError(status, msg)`. The error
  handler turns that into `{ error }` JSON, and the frontend `api.js` reads `data.error`.
- `db.js` — `init()` creates the DB, runs `schema.sql` (idempotent `CREATE TABLE IF NOT EXISTS`),
  then `migrate()` and `seedDefaults()`. Exposes `q(sql, params)` and `getPool()`.
  **Schema changes:** put new tables in `schema.sql`. Add columns to existing tables with
  `ensureColumn()` / `ensureNullable()` in `migrate()`, because MySQL lacks
  `ADD COLUMN IF NOT EXISTS` and older DBs already have the table.
- `middleware/auth.js` — stateless JWT Bearer auth. `authRequired` sets `req.user`;
  `requireRole(...roles)` gates routes. Routers apply their own guards.
- `routes/*` — one router per domain: auth, users, bootcamps, roster, students, teams,
  settings, rubrics, tasks, questions, reports, uploads, chat, certificates.
- `s3.js` — AWS SDK v3 upload helper used by `/api/uploads` (25 MB, memory storage).
  `signedUrlFor()` is there for a future private-bucket setup.

**Frontend** (`frontend/`):
- `pages/_app.js` — provider order: `PrefsProvider` → `ToastProvider` → `AuthProvider` → `BootcampProvider`.
- `lib/api.js` — fetch wrapper against `NEXT_PUBLIC_API_BASE` (default `http://localhost:4000`,
  must **not** include `/api`). Token lives in `localStorage` and is sent as `Authorization: Bearer`.
  Also has `upload`, `uploadTo`, `chatUpload`, `downloadFile` (authenticated blob download)
  and `wsUrl()` (token passed as a query param for WebSockets).
- `lib/auth.js` — `AuthProvider` / `useAuth`. `useRequireRole([...])` is the per-page guard.
  `HOME_FOR_ROLE` maps each role to its landing route.
- `lib/prefs.js` — theme (`data-theme` on `<html>`, dark by default) and font (`--font` CSS var).
- `lib/draft.js` — mentor drafts saved only in localStorage and never sent until Save.
- `components/UI.js` — the whole design system (Button, Card, Modal, `useToast`, Badge, Avatar,
  Segmented, …). `styles/globals.css` holds the iOS design tokens. Reuse these; don't add a UI library.
- `components/Layout.js` — nav shell; `NAV` defines each role's tabs and holds the cohort switcher.
- `pages/{admin,mentor,volunteer,student}/` — role-scoped pages wrapped in `Layout` and guarded
  by `useRequireRole`. `pages/verify/[code].js` is public (certificate QR verification).
- It uses the **Pages Router** (`pages/`, not `app/`), and `basePath` comes from `NEXT_PUBLIC_BASE_PATH`
  at build time. Don't hardcode absolute paths that skip `next/link`/`router`.

## Multi-bootcamp (cohort) scoping (important)

- **Shared/global:** all staff `users` (admin/mentor/volunteer) and the **`roster`** (master
  student directory, loaded from Excel).
- **Per-bootcamp (`bootcamp_id` column):** `students`, `teams`, `tasks`, `rubrics`, `questions`
  (and certificates/reports are filtered by it). Scoped list endpoints **require**
  `?bootcamp=<id>` and creates require `bootcamp_id` in the body. A missing scope returns 400.
- Registration open/close is per-bootcamp (`bootcamps.registration_open`), not the old global `settings` row.
- Frontend: `lib/bootcamp.js` keeps the selected bootcamp (in localStorage). Pages read
  `bootcampId` and wrap paths with `scoped(path, id)`. Students never pick one. Theirs
  comes from `students.bootcamp_id`.
- `seedDefaults()` makes sure one bootcamp ("Cohort 1") exists and backfills rows with a NULL `bootcamp_id`.

## Key domain logic

- **Roster**: `rosterImport.js` fuzzy-matches Excel headers (`Student Id, full_name, EMAIL ID,
  University campus, Phone, TEST NO, Status`) and dedupes on `student_id` (else email).
  `GET /api/roster/search?q=` powers `RosterSearch`. Picking a row fills the form via
  `rosterToForm()`, which is exported from `pages/admin/students.js` and reused by the volunteer page.
- **Approval provisions a login**: `POST /api/students/:id/approve` creates a `student` user
  with a random temp password (returned once) and links `students.user_id`.
- **Auto-teams**: `POST /api/teams/auto {teamSize, reset}` spreads approved *unassigned*
  students round-robin across `ceil(n/size)` teams, inside a transaction.
- **Question audiences** (`questions.js` → `questionApplies`): `all_students`,
  `selected_students` / `teams` (via `question_targets`), or `team_spoc`. If you change the
  targeting rules, update both `questionApplies` and the admin question builder. Questions
  created together share a `batch_id`, which groups them into one submission and one combined CSV.
- **Rubric scores & task feedback** are upserts keyed by `(criteria_id, student_id, mentor_id)` /
  `(task_id, team_id, mentor_id)`. Any mentor may score any student or team (by design).
  `rubric_scores.score` is nullable so a mentor can leave a comment without a score.
- **Team chat**: WebSocket at `/api/ws?token=`. The server picks a student's room from
  `students.team_id`, so a student can't join another team. Admins join with `&team=<id>` as
  silent, read-only observers, and there are deliberately no presence/typing signals. Chat files
  (≤100 MB) are stored on **local disk, not S3**, served through an auth check, and expired after 30 days.
- **Certificates**: admins design templates (a background image on local disk, served same-origin
  and without auth so the canvas isn't tainted, plus JSON field layout). Issuing snapshots values
  into `certificates.values_json` and assigns a serial `IOSDC-<year>-NNNN` and a random
  `verify_code`. Both stay the same when a certificate is re-issued. Rendering happens
  **client-side** in `components/Certificate.js` (canvas + `qrcode`, bulk export via `jspdf`/`jszip`).
  `GET /api/certificates/verify/:code` is public.
- **Reports**: `GET /api/reports?bootcamp=` (admin) returns the raw data. The analytics are
  computed in `pages/admin/reports.js`.

## Gotchas

- **Secrets**: `backend/.env` holds DB + AWS creds and is gitignored (only `frontend/.env.production`,
  which has public build values, is committed). The AWS keys were once shared in plaintext and should be rotated.
- **CORS**: the API only accepts origins listed in `CORS_ORIGIN` (default `http://localhost:3000`).
- **Reverse proxy**: the WebSocket proxy rule must come before the `/<base>/api/` HTTP rule, and Apache
  needs `mod_proxy_wstunnel`. `deploy/nginx-bootcamp.conf` has no WebSocket rule for the API.
