#!/usr/bin/env bash
# Deploy SDP to production (ubuntu@15.206.107.186, ~/ios-sdp).
#
# Follows the procedure in CLAUDE.md: back up first, deploy only what has been
# pushed, `git fetch && git reset --hard origin/main` rather than `git pull`
# (npm install rewrites the lockfiles on the ARM box, and .env is untracked so
# the reset leaves it alone), then rebuild and restart ONLY the sdp-* apps —
# iosform and ios-bootcamp share this machine.
set -euo pipefail

KEY="${IOSDC_KEY:-/Users/ashutosh/Desktop/development/iosdc/iosdc.pem}"
HOST="${IOSDC_HOST:-ubuntu@15.206.107.186}"
BASE="https://iosdc.geu.ac.in"

echo "==> [0/6] Refuse to deploy anything that is not pushed"
LOCAL="$(git rev-parse HEAD)"
git fetch origin main --quiet
if [ "$LOCAL" != "$(git rev-parse origin/main)" ]; then
  echo "!! HEAD is not origin/main — push first." >&2
  exit 1
fi
echo "    deploying $LOCAL"

echo "==> [1/6] Back up the database and the tree"
ssh -i "$KEY" "$HOST" 'cd ~/ios-sdp/backend && set -a && . ./.env && set +a
  mkdir -p ~/backups
  mysqldump -h"${DB_HOST:-127.0.0.1}" -u"$DB_USER" -p"$DB_PASSWORD" \
    --single-transaction --routines "$DB_NAME" > ~/backups/ios_sdp-predeploy-$(date +%F-%H%M).sql
  tar czf ~/backups/ios-sdp-predeploy-$(date +%F-%H%M).tar.gz \
    --exclude=node_modules --exclude=.next -C /home/ubuntu ios-sdp
  ls -lht ~/backups | head -3'

echo "==> [2/6] Rescue any commit made directly on the box"
# This has happened twice: work committed on the server and pushed nowhere.
# A reset --hard would destroy it, so stop rather than silently discard.
ssh -i "$KEY" "$HOST" 'cd ~/ios-sdp
  git fetch origin main --quiet
  UNPUSHED=$(git log --oneline origin/main..HEAD)
  if [ -n "$UNPUSHED" ]; then
    echo "!! The server has commits that are not on origin:"; echo "$UNPUSHED"
    echo "!! Fetch them locally before deploying:"
    echo "   git fetch ssh://'"$HOST"'/home/ubuntu/ios-sdp main:refs/remotes/server/main"
    exit 1
  fi
  # npm install rewrites the lockfiles on the ARM box every time, so that churn
  # is expected and gets discarded by the reset. Anything else is real work
  # someone did on the server and must not be thrown away silently.
  OTHER=$(git status --porcelain | grep -v "package-lock.json$" || true)
  if [ -n "$OTHER" ]; then
    echo "!! Uncommitted changes on the server:"; echo "$OTHER"; exit 1
  fi
  echo "    server clean (lockfile churn ignored)"'

echo "==> [3/6] Reset to origin/main"
ssh -i "$KEY" "$HOST" 'cd ~/ios-sdp
  git reset --hard origin/main
  git log --oneline -2
  echo "    .env intact: $(test -f backend/.env && echo yes || echo NO)"'

echo "==> [4/6] Install dependencies"
ssh -i "$KEY" "$HOST" 'cd ~/ios-sdp/backend && npm install --omit=dev 2>&1 | tail -2
  cd ~/ios-sdp/frontend && npm install 2>&1 | tail -2'

echo "==> [5/6] Build and restart only sdp-*"
# 1.8 GB RAM and no swap: cap the heap so a build can't OOM-kill the neighbours.
ssh -i "$KEY" "$HOST" 'cd ~/ios-sdp/frontend && NODE_OPTIONS=--max-old-space-size=1024 npm run build 2>&1 | tail -4
  pm2 restart sdp-api sdp-web
  sleep 4
  pm2 list | grep -E "sdp-api|sdp-web"'

echo "==> [6/6] Verify"
for p in /sdp /sdp/api/health /sdp/api/public/nav /bootcamp /; do
  printf '  %s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE$p")" "$p"
done
echo "  --- must stay 401 (admin-only) ---"
for p in /sdp/api/highlights /sdp/api/cohort-apps /sdp/api/students /sdp/api/uploads/limit; do
  printf '  %s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' --max-time 15 "$BASE$p")" "$p"
done
echo "==> Done."
