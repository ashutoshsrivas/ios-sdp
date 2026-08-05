# Deploying to https://iosdc.geu.ac.in/bootcamp

The app runs as two Node processes behind the existing **Apache** that already serves
`iosdc.geu.ac.in`, mounted at the **`/bootcamp`** sub-path. Ports 3100/4100 are used because
the existing `iosform` app already occupies 3000/4000.

```
Browser ──► Apache (443, iosdc.geu.ac.in)   [also serves /apply/cohort2026 → iosform]
             ├─ /bootcamp/api/*  ──► 127.0.0.1:4100  (Express API)
             └─ /bootcamp/*      ──► 127.0.0.1:3100  (Next.js, basePath=/bootcamp)
                                         └─ MySQL (localhost) + AWS S3
```

- Frontend build is configured by `frontend/.env.production`
  (`NEXT_PUBLIC_BASE_PATH=/bootcamp`, `NEXT_PUBLIC_API_BASE=https://iosdc.geu.ac.in/bootcamp`).
- The API auto-creates its MySQL database + tables and seeds the admin on first boot.
- **Team chat** uses a WebSocket at `/bootcamp/api/ws` (needs Apache `mod_proxy_wstunnel`,
  enabled with `sudo a2enmod proxy_wstunnel`). Chat file uploads are stored on **local disk**
  at `CHAT_UPLOAD_DIR` (set it in `backend/.env`, e.g. `/home/ubuntu/bootcamp-chat-uploads`)
  — NOT S3 — so they stay team-private and can be auto-deleted after 30 days.

---

## 0. Prerequisites on the server (one-time)

```bash
node -v            # need 18+ (20 LTS recommended)
mysql --version    # MySQL 8 running locally
nginx -v
pm2 -v || sudo npm i -g pm2
```

Create the MySQL user/db the app will use (it creates the schema itself, just needs access):

```sql
CREATE DATABASE IF NOT EXISTS ios_bootcamp CHARACTER SET utf8mb4;
CREATE USER IF NOT EXISTS 'bootcamp'@'localhost' IDENTIFIED BY 'CHOOSE_A_STRONG_PASSWORD';
GRANT ALL PRIVILEGES ON ios_bootcamp.* TO 'bootcamp'@'localhost';
FLUSH PRIVILEGES;
```

## 1. Get the code

```bash
cd /home/ubuntu
git clone https://github.com/ashutoshsrivas/ios-bootcamp.git   # first time
# later updates:  cd ios-bootcamp && git pull
cd ios-bootcamp
```

## 2. Backend env (`backend/.env`) — NOT in git, create it on the server

```ini
PORT=4100
CORS_ORIGIN=https://iosdc.geu.ac.in
JWT_SECRET=<paste a long random string:  openssl rand -hex 32>
JWT_EXPIRES=7d

ADMIN_NAME=Super Admin
ADMIN_EMAIL=admin@iosdc.geu.ac.in
ADMIN_PASSWORD=<a strong first-login password>

DB_HOST=127.0.0.1
DB_PORT=3306
DB_USER=bootcamp
DB_PASSWORD=<the password you set in step 0>
DB_NAME=ios_bootcamp

# ⚠️ ROTATE these first — the old keys were exposed. Use an IAM user scoped to the bucket.
AWS_REGION=ap-south-1
AWS_ACCESS_KEY_ID=<new key>
AWS_SECRET_ACCESS_KEY=<new secret>
S3_BUCKET=rpms.geu.ac.in
S3_PREFIX=uploads/ios-bootcamp/
S3_PUBLIC_BASE=https://s3.ap-south-1.amazonaws.com/rpms.geu.ac.in
S3_ACL=public-read
```

## 3. Install & build

```bash
cd backend  && npm ci --omit=dev            && cd ..
cd frontend && npm ci && npm run build       && cd ..     # reads .env.production → basePath /bootcamp
```

## 4. Start with PM2

```bash
pm2 start ecosystem.config.js
pm2 save
pm2 startup            # run the command it prints (systemd), so it survives reboots
pm2 status
```

Quick local check before touching Apache:

```bash
curl -s localhost:4100/api/health          # {"ok":true,...}
curl -s localhost:3100/bootcamp | head      # Next.js HTML
```

## 5. Apache

Add the `ProxyPass` lines from [`deploy/apache-bootcamp.conf`](deploy/apache-bootcamp.conf)
**inside** the existing `<VirtualHost *:443>` block for `iosdc.geu.ac.in`
(`/etc/apache2/sites-enabled/iosdc-le-ssl.conf`) — the API rule must come first. Then:

```bash
sudo apache2ctl configtest     # must say "Syntax OK"
sudo systemctl reload apache2
```

(The vhost already has `ProxyPreserveHost On` and `SSLProxyEngine On`, and `mod_proxy`
/`mod_proxy_http` are enabled. Because the build uses basePath `/bootcamp`, our assets live
at `/bootcamp/_next` and don't collide with iosform's `/_next` proxy rule.)

Open **https://iosdc.geu.ac.in/bootcamp** and sign in with the admin email/password from step 2.
**Change the admin password immediately** (top-right → Settings).

---

## Updating later

Use a **hard reset to the remote**, not `git pull` — `npm install` rewrites the committed
`package-lock.json` files on this (ARM) box, which leaves the tree dirty and makes `git pull`
abort. `.env` is gitignored so the reset never touches it.

```bash
cd /home/ubuntu/ios-bootcamp
git fetch origin && git reset --hard origin/main   # discards regenerated lockfiles
cd backend  && npm install --omit=dev && cd ..
cd frontend && npm install && npm run build && cd ..
pm2 restart bootcamp-api bootcamp-web
```

Verify HEAD moved (`git rev-parse --short HEAD`) and the build picked up your change before
declaring success — don't rely on an HTTP 200 alone.

## Notes / gotchas

- **Same-origin:** the browser calls `iosdc.geu.ac.in/bootcamp/api/...` from the page at
  `iosdc.geu.ac.in/bootcamp`, so CORS isn't strictly exercised — but `CORS_ORIGIN` is set anyway.
- **Auth** is a JWT in `localStorage` (no cookies), so the sub-path and proxy need no special
  cookie/session handling.
- **Uploads** go straight to S3; `client_max_body_size 30m` in nginx covers the 25 MB app limit.
- If you prefer **systemd** over PM2, run `node src/server.js` (backend) and
  `./node_modules/.bin/next start -p 3000` (frontend) as two services with `WorkingDirectory` set
  to each package and `EnvironmentFile` pointing at the env.
- Ports 3000/4000 only need to be reachable from localhost (nginx proxies them); no need to open
  them in the security group.
