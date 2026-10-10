#!/usr/bin/env bash
# One-time setup inside UserLAnd (Ubuntu/Debian) on the phone:
# installs git and Node.js 22, clones the project and installs dependencies.
#
#   curl -fsSL https://raw.githubusercontent.com/abieahma/mcombat/main/phone/setup.sh | bash
#
# Override with env vars: REPO=<git url>  DIR=<folder>
set -euo pipefail

REPO="${REPO:-https://github.com/abieahma/mcombat.git}"
DIR="${DIR:-$HOME/mcombat}"
NODE_MAJOR=22

say() { printf '\n\033[1;34m▶ %s\033[0m\n' "$*"; }

SUDO=""
if [ "$(id -u)" -ne 0 ]; then SUDO="sudo"; fi

say "Ставлю git и curl"
$SUDO apt-get update -y
$SUDO apt-get install -y git curl ca-certificates

say "Ставлю Node.js $NODE_MAJOR (через nvm)"
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install "$NODE_MAJOR"
nvm alias default "$NODE_MAJOR" >/dev/null
node -v

say "Забираю проект в $DIR"
if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
else
  git clone "$REPO" "$DIR"
fi

say "Ставлю зависимости (несколько минут)"
cd "$DIR"
NODE_OPTIONS="--require $DIR/phone/fix-network.cjs" npm install --no-audit --no-fund
chmod +x phone/*.sh

say "Готово. Запуск: $DIR/phone/dev.sh"
