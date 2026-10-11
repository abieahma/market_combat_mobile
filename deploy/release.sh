#!/usr/bin/env bash
# Release steps for one commit. Run by deploy/watch.sh from the repository
# root after the commit is checked out. Exit code 0 = release is healthy.
#
# Kept in the repository, so the steps change together with the code.
set -euo pipefail

COMPOSE_FILE="server/compose.yaml"
HEALTH_URL="${HEALTH_URL:-http://127.0.0.1:8080/healthz}"

if [ ! -f "$COMPOSE_FILE" ]; then
  echo "no $COMPOSE_FILE yet, nothing to release"
  exit 0
fi

echo "building and starting containers"
docker compose -f "$COMPOSE_FILE" up -d --build --remove-orphans

echo "waiting for $HEALTH_URL"
for _ in $(seq 1 30); do
  if curl -fsS --max-time 3 "$HEALTH_URL" >/dev/null 2>&1; then
    echo "healthy"
    exit 0
  fi
  sleep 2
done

echo "health check failed"
docker compose -f "$COMPOSE_FILE" logs --tail 50 || true
exit 1
