# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A multi-role bootcamp management web app (Admin / Mentor / Volunteer / Student) with an
iOS-minimalist UI. See [README.md](README.md) for the product flow. Two packages, run and
deployed independently.

## Commands

Backend (`backend/`, Express + MySQL, port 4000):
```bash
npm install
npm run dev      # node --watch src/server.js — creates DB + tables + seeds admin on boot
npm start        # production
```
Frontend (`frontend/`, Next.js Pages Router, port 3000):
```bash
npm install
npm run dev
npm run build    # verifies all pages compile
```
There is no test suite yet. To smoke-test the API, boot the backend and `curl`
`localhost:4000/api/health`, then `POST /api/auth/login`.

## Architecture

**Backend** (`backend/src/`):
- `server.js` — Express app; mounts every router under `/api/*`; central error handler
  reads `err.status` (thrown via `HttpError` from `util.js`).
- `db.js` — on `init()` connects without a DB, `CREATE DATABASE IF NOT EXISTS`, runs the
  full `schema.sql` (idempotent, `CREATE TABLE IF NOT EXISTS`), then seeds the default
  admin + `registration_open` setting. Exposes `q(sql, params)` and `getPool()`. **Schema
  changes go in `schema.sql`** — it re-runs every boot, so use additive/idempotent DDL.
- `middleware/auth.js` — JWT (Bearer token). `authRequired` attaches `req.user`;
  `requireRole(...roles)` gates routes. Tokens are stateless — there is no session store.
- `routes/*` — one router per domain (auth, users, students, teams, rubrics, tasks,
  questions, settings, uploads). Routers self-apply role guards.
- `s3.js` — AWS SDK v3 upload helper; `signedUrlFor()` exists for a future private-bucket setup.

**Frontend** (`frontend/`):
- `lib/api.js` — fetch wrapper; token in `localStorage`, sent as `Authorization: Bearer`.
- `lib/auth.js` — `AuthProvider` / `useAuth`; `useRequireRole([...])` is the per-page
  guard that redirects unauthenticated users to `/login` and wrong-role users to their
  home. `HOME_FOR_ROLE` maps role → landing route.
- `components/UI.js` — the entire design system (Button, Card, Modal, Toast via
  `useToast`, Badge, Avatar, Segmented, etc.). `styles/globals.css` holds the iOS design
  tokens (CSS variables). Reuse these; don't introduce a UI library.
- `components/Layout.js` — nav shell; `NAV` object defines each role's tabs.
- `pages/{admin,mentor,volunteer,student}/` — role-scoped pages, each wrapped in `Layout`
  and guarded by `useRequireRole`.

## Multi-bootcamp scoping (important)

The app runs multiple **bootcamps** (cohorts). What is scoped vs shared:
- **Shared/global:** all staff `users` (admin/mentor/volunteer) and the **`roster`** (master
  student directory, populated from Excel).
- **Per-bootcamp (`bootcamp_id` column):** `students`, `teams`, `tasks`, `rubrics`, `questions`.
  Their scoped list endpoints **require** a `?bootcamp=<id>` query param and creates require a
  `bootcamp_id` in the body — a missing scope returns 400.
- Registration open/close is a per-bootcamp flag (`bootcamps.registration_open`), not the old
  global `settings` row.
- Frontend: `lib/bootcamp.js` holds the selected bootcamp (persisted in localStorage); the
  sidebar switcher sets it; pages read `bootcampId` and wrap paths with `scoped(path, id)`.
  Students don't pick a bootcamp — theirs comes from their `students.bootcamp_id`.
- **Schema migrations:** MySQL lacks `ADD COLUMN IF NOT EXISTS`, so new columns are added by
  `ensureColumn()` in `db.js` (checks `information_schema`). `seedDefaults()` guarantees one
  bootcamp exists and backfills orphaned rows. Add future columns the same way.

## Roster (student directory)

- `roster` table = the pre-known students volunteers register. Columns map from the Excel via
  fuzzy header matching in `rosterImport.js` (`Student Id, full_name, EMAIL ID, University
  campus, Phone, TEST NO, Status`). Dedup on `student_id` (else email).
- `GET /api/roster/search?q=` powers the `RosterSearch` autocomplete (name/email/id/phone);
  picking a row auto-fills the registration form via `rosterToForm()` (exported from
  `pages/admin/students.js`, reused by the volunteer page).
- Admin imports Excel at `POST /api/roster/import` (multipart, `exceljs`), or edits rows in the
  Directory page.

## Key domain logic

- **Approval provisions a login**: `POST /api/students/:id/approve` creates a `student`
  user (random temp password, returned once to the admin) and links `students.user_id`.
- **Auto-teams**: `POST /api/teams/auto {teamSize, reset}` round-robin-distributes approved
  *unassigned* students into `ceil(n/size)` balanced teams (transaction in `teams.js`).
- **Question audiences** (`questions.js` → `questionApplies`): `all_students`,
  `selected_students` / `teams` (via `question_targets`), or `team_spoc`. Changing
  targeting rules means updating both `questionApplies` and the admin question builder.
- **Rubric scores & task feedback** are upserts keyed by
  `(criteria_id, student_id, mentor_id)` and `(task_id, team_id, mentor_id)` — any mentor
  may score any student/team regardless of team assignment (by design).

## Gotchas

- **Secrets**: `backend/.env` holds DB + AWS creds and is gitignored. The committed AWS
  keys were shared in plaintext and should be rotated. Never hardcode or commit them.
- **CORS**: the API only accepts origins in `CORS_ORIGIN` (defaults to
  `http://localhost:3000`). Update it when the frontend origin changes.
- Frontend is the **Pages Router** (`pages/`, not `app/`). Keep it consistent.
