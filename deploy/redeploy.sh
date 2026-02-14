#!/usr/bin/env bash
set -euo pipefail

APP_DIR="/opt/sync_save"
COMPOSE_FILE="docker-compose.prod.yml"
LOG_PREFIX="[redeploy]"

cd "$APP_DIR"

if [[ ! -f ".env" ]]; then
  echo "$LOG_PREFIX missing .env in $APP_DIR"
  exit 1
fi

if [[ -z "${DEPLOY_SHA:-}" ]]; then
  echo "$LOG_PREFIX DEPLOY_SHA is required"
  exit 1
fi

PREV_TAG_FILE=".last_successful_tag"
PREV_TAG="$(cat "$PREV_TAG_FILE" 2>/dev/null || true)"
export IMAGE_TAG="sha-${DEPLOY_SHA}"

echo "$LOG_PREFIX pulling images with IMAGE_TAG=$IMAGE_TAG"
docker compose -f "$COMPOSE_FILE" pull

echo "$LOG_PREFIX applying containers"
docker compose -f "$COMPOSE_FILE" up -d --remove-orphans

echo "$LOG_PREFIX waiting for health"
sleep 8

if docker compose -f "$COMPOSE_FILE" exec -T api curl -fsS http://localhost:3000/health >/dev/null; then
  echo "$IMAGE_TAG" > "$PREV_TAG_FILE"
  docker image prune -f >/dev/null || true
  echo "$LOG_PREFIX deploy success: $IMAGE_TAG"
  exit 0
fi

echo "$LOG_PREFIX healthcheck failed"
if [[ -n "$PREV_TAG" ]]; then
  echo "$LOG_PREFIX rolling back to $PREV_TAG"
  export IMAGE_TAG="$PREV_TAG"
  docker compose -f "$COMPOSE_FILE" pull
  docker compose -f "$COMPOSE_FILE" up -d --remove-orphans
  exit 1
fi

echo "$LOG_PREFIX no rollback tag found"
exit 1
