#!/usr/bin/env bash
set -euo pipefail

: "${SYNC_SAVE_PATH:=/opt/sync_save}"
: "${GIT_REPO:=https://github.com/quenya/sync_save.git}"

mkdir -p "$SYNC_SAVE_PATH"

if [[ ! -d "$SYNC_SAVE_PATH/.git" ]]; then
  git clone "$GIT_REPO" "$SYNC_SAVE_PATH"
else
  cd "$SYNC_SAVE_PATH"
  git pull --ff-only origin main
fi

cd "$SYNC_SAVE_PATH"

if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "Copied .env.example to .env. Edit this file before restart."
fi

cd "$SYNC_SAVE_PATH"
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d --remove-orphans

echo "Setup complete. Check status with: docker compose -f docker-compose.prod.yml ps"
