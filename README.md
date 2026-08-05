# iOS Bootcamp

A minimalist, iOS-styled web app for running a student bootcamp end to end:
register students, approve them, auto-build teams, run assessments, assign tasks,
and collect answers to custom questions.

## Roles

| Role | Can do |
|------|--------|
| **Admin** | Everything: create any user, approve/reject registrations, open/close registration, auto-build & edit teams (drag students, set SPOC, assign mentors), author rubrics, tasks and questions, view all responses. |
| **Volunteer** | Register students (pending admin approval) and track their status. |
| **Mentor** | View all teams, score any student against any rubric, give per-team task feedback. |
| **Student** | Log in (account created on approval) and answer the questions assigned to them. |

## Stack

- **backend/** — Express + MySQL (`mysql2`) + JWT auth (`bcryptjs`) + AWS S3 uploads. Port `4000`.
- **frontend/** — Next.js (Pages Router) + React. Port `3000`. Talks to the API over HTTP.

## Prerequisites

- Node 18+
- A MySQL server reachable with the credentials in `backend/.env` (the app creates the
  database and tables itself on first start).

## Run it

```bash
# 1. Backend
cd backend
npm install
# edit .env — set DB_* and AWS_* (see the security note below)
npm run dev            # http://localhost:4000  (creates DB + seeds admin on first boot)

# 2. Frontend (new terminal)
cd frontend
npm install
npm run dev            # http://localhost:3000
```

On first boot the backend prints the seeded admin login (default
`admin@bootcamp.local` / `Admin@12345`, configurable in `.env`). **Change it after
first sign-in.**

### Typical flow
1. Sign in as admin → **Users** → create volunteers and mentors.
2. Volunteers sign in → **Register Students**.
3. Admin → **Registrations** → approve (each approval provisions a student login and
   shows a one-time password).
4. Admin → **Dashboard** → close registration → **Teams** → *Auto-create Teams* (pick a
   team size), then drag students, set each team's SPOC, and assign mentors.
5. Admin authors **Rubrics**, **Tasks** and **Questions**; mentors score/feedback;
   students answer.

## ⚠️ Security — rotate the AWS keys

The AWS keys currently in `backend/.env` were shared in plaintext and should be treated
as compromised. **Rotate them in AWS IAM** and prefer a scoped IAM user limited to the
`rpms.geu.ac.in` bucket under `uploads/ios-bootcamp/`. `.env` is gitignored; never commit it.

`S3_ACL=public-read` makes every uploaded file publicly readable by URL. For student
documents, consider a private bucket + presigned URLs (`signedUrlFor` in
`backend/src/s3.js` is ready for this).
