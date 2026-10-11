#!/usr/bin/env bash
# One-time setup of the auto-deploy service on the game server (Debian or
# Ubuntu, run as root):
#
#   curl -fsSL https://raw.githubusercontent.com/abieahma/mcombat/master/deploy/install.sh | sudo bash
set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/abieahma/mcombat.git}"
BRANCH="${BRANCH:-master}"
BASE=/opt/mcombat

if [ "$(id -u)" -ne 0 ]; then
  echo "run as root (sudo)" >&2
  exit 1
fi

echo "▶ packages: git, curl, jq"
apt-get update -y
apt-get install -y git curl jq ca-certificates

if ! command -v docker >/dev/null 2>&1; then
  echo "▶ Docker is not installed. The service will run, but releases that need"
  echo "  containers will fail until Docker is installed: https://docs.docker.com/engine/install/"
fi

echo "▶ repository in $BASE/repo"
mkdir -p "$BASE"
if [ -d "$BASE/repo/.git" ]; then
  git -C "$BASE/repo" fetch -q origin "$BRANCH"
  git -C "$BASE/repo" checkout -q -B "$BRANCH" "origin/$BRANCH"
else
  git clone -q --branch "$BRANCH" "$REPO_URL" "$BASE/repo"
fi
chmod +x "$BASE/repo/deploy/"*.sh

echo "▶ settings in /etc/mcombat/deploy.env"
mkdir -p /etc/mcombat
if [ ! -f /etc/mcombat/deploy.env ]; then
  cat >/etc/mcombat/deploy.env <<EOF
# Market Combat auto-deploy settings
BRANCH=$BRANCH
INTERVAL=20
GITHUB_REPO=abieahma/mcombat
REQUIRE_CI=1
# GITHUB_TOKEN=   # optional, read-only token for a higher GitHub API limit
EOF
fi

echo "▶ systemd service mcombat-deploy"
cp "$BASE/repo/deploy/mcombat-deploy.service" /etc/systemd/system/mcombat-deploy.service
systemctl daemon-reload
systemctl enable --now mcombat-deploy

echo
echo "Done. Status: systemctl status mcombat-deploy"
echo "Live log:    journalctl -u mcombat-deploy -f"
echo "History:     /var/lib/mcombat/deploy.log"
