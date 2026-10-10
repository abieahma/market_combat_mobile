#!/usr/bin/env bash
# Daily run inside UserLAnd: starts the Expo dev server and, in the
# background, pulls new commits from GitHub every few seconds, so changes
# pushed from the chat show up in Expo Go by themselves (Fast Refresh).
#
#   ~/mcombat/phone/dev.sh            # check every 5 s
#   SYNC_INTERVAL=10 ~/mcombat/phone/dev.sh
set -uo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$DIR"

export NVM_DIR="$HOME/.nvm"
# shellcheck disable=SC1091
[ -s "$NVM_DIR/nvm.sh" ] && . "$NVM_DIR/nvm.sh"
export NODE_OPTIONS="--require $DIR/phone/fix-network.cjs ${NODE_OPTIONS:-}"
export EXPO_NO_TELEMETRY=1
ulimit -n 4096 2>/dev/null || true

INTERVAL="${SYNC_INTERVAL:-5}"

git pull --ff-only -q || echo "[sync] не удалось подтянуть изменения — проверь интернет или локальные правки (git status)"
[ -d node_modules ] || npm install --no-audit --no-fund

sync_loop() {
  local warned=0
  while true; do
    sleep "$INTERVAL"
    local before after
    before="$(git rev-parse HEAD)"
    if ! git pull --ff-only -q 2>/dev/null; then
      if [ "$warned" -eq 0 ]; then
        echo "[sync] git pull не прошёл (нет сети или есть локальные правки). Повторяю каждые ${INTERVAL} с."
        warned=1
      fi
      continue
    fi
    warned=0
    after="$(git rev-parse HEAD)"
    if [ "$before" != "$after" ]; then
      echo "[sync] обновлено: $(git log -1 --format='%h %s')"
      if git diff --name-only "$before" "$after" | grep -qx 'package.json'; then
        echo "[sync] изменились зависимости — ставлю…"
        npm install --no-audit --no-fund >/dev/null 2>&1 \
          && echo "[sync] зависимости обновлены. Если приложение ругается — перезапусти dev.sh (Ctrl+C и снова)." \
          || echo "[sync] npm install упал — запусти его вручную: cd $DIR && npm install"
      fi
    fi
  done
}

sync_loop &
SYNC_PID=$!
trap 'kill "$SYNC_PID" 2>/dev/null' EXIT INT TERM

cat <<EOF

  ▶ Открой Expo Go → «Enter URL manually» → exp://127.0.0.1:8081
  ▶ Изменения из GitHub подтягиваются каждые ${INTERVAL} с.

EOF

npx expo start --localhost
