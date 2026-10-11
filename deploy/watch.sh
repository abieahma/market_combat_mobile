#!/usr/bin/env bash
# Market Combat auto-deploy.
#
# Runs as a systemd service on the game server. Every INTERVAL seconds it
# asks GitHub for the latest commit on BRANCH. When there is a new commit
# that passed the GitHub checks, it checks it out and runs deploy/release.sh.
# If the release fails, the previous commit is restored and released again.
#
# Settings come from /etc/mcombat/deploy.env (see deploy/README.md).
set -uo pipefail

REPO_DIR="${REPO_DIR:-/opt/mcombat/repo}"
STATE_DIR="${STATE_DIR:-/var/lib/mcombat}"
BRANCH="${BRANCH:-master}"
INTERVAL="${INTERVAL:-20}"
GITHUB_REPO="${GITHUB_REPO:-abieahma/mcombat}"
# 1 = deploy only commits whose GitHub checks all succeeded.
REQUIRE_CI="${REQUIRE_CI:-1}"
# Optional token: raises the GitHub API limit from 60 to 5000 requests/hour.
GITHUB_TOKEN="${GITHUB_TOKEN:-}"

mkdir -p "$STATE_DIR"
LOG_FILE="$STATE_DIR/deploy.log"
DEPLOYED_FILE="$STATE_DIR/deployed_sha"
FAILED_FILE="$STATE_DIR/failed_sha"

log() {
  local line
  line="$(date -u '+%Y-%m-%dT%H:%M:%SZ') $*"
  echo "$line"
  echo "$line" >>"$LOG_FILE"
}

# Only one watcher at a time, even if someone starts the script by hand.
exec 9>"$STATE_DIR/watch.lock"
if ! flock -n 9; then
  echo "another deploy watcher is already running" >&2
  exit 1
fi

cd "$REPO_DIR" || { log "ERROR: no repository at $REPO_DIR"; exit 1; }

remote_sha() {
  git ls-remote --heads origin "refs/heads/$BRANCH" 2>/dev/null | cut -f1
}

# Prints success | pending | failure | unknown for a commit.
ci_status() {
  local sha="$1" auth=() body
  [ -n "$GITHUB_TOKEN" ] && auth=(-H "Authorization: Bearer $GITHUB_TOKEN")
  body="$(curl -fsS --max-time 15 "${auth[@]}" -H 'Accept: application/vnd.github+json' \
    "https://api.github.com/repos/$GITHUB_REPO/commits/$sha/check-runs?per_page=100" 2>/dev/null)" || {
    echo unknown
    return
  }
  echo "$body" | jq -r '
    .check_runs as $runs
    | if ($runs | length) == 0 then "pending"
      elif any($runs[]; .status != "completed") then "pending"
      elif all($runs[]; .conclusion == "success" or .conclusion == "skipped" or .conclusion == "neutral") then "success"
      else "failure" end' 2>/dev/null || echo unknown
}

release() {
  local sha="$1" prev="$2"
  git reset -q --hard "$sha" || return 1
  if [ -x deploy/release.sh ]; then
    PREV_SHA="$prev" NEW_SHA="$sha" deploy/release.sh 2>&1 | while IFS= read -r l; do log "  $l"; done
    return "${PIPESTATUS[0]}"
  fi
  log "  deploy/release.sh not found, nothing to run"
}

deploy() {
  local sha="$1" prev
  prev="$(cat "$DEPLOYED_FILE" 2>/dev/null || true)"
  log "deploying ${sha:0:7} (was ${prev:0:7})"
  if ! git fetch -q origin "$BRANCH"; then
    log "fetch failed, will retry"
    return 1
  fi
  if release "$sha" "$prev"; then
    echo "$sha" >"$DEPLOYED_FILE"
    rm -f "$FAILED_FILE"
    log "deployed ${sha:0:7}: $(git log -1 --format=%s "$sha")"
    # Pick up a new version of this script.
    if [ -n "$prev" ] && ! git diff --quiet "$prev" "$sha" -- deploy/watch.sh; then
      log "watch.sh changed, restarting watcher"
      exec 9>&-
      exec "$REPO_DIR/deploy/watch.sh"
    fi
    return 0
  fi
  echo "$sha" >"$FAILED_FILE"
  log "release of ${sha:0:7} FAILED"
  if [ -n "$prev" ]; then
    log "rolling back to ${prev:0:7}"
    if release "$prev" "$sha"; then
      log "rollback to ${prev:0:7} done"
    else
      log "ROLLBACK FAILED, server needs attention"
    fi
  fi
  return 1
}

log "watcher started: $GITHUB_REPO@$BRANCH every ${INTERVAL}s, require CI: $REQUIRE_CI"
waiting_for=""
while true; do
  sha="$(remote_sha)"
  deployed="$(cat "$DEPLOYED_FILE" 2>/dev/null || true)"
  failed="$(cat "$FAILED_FILE" 2>/dev/null || true)"

  if [ -n "$sha" ] && [ "$sha" != "$deployed" ] && [ "$sha" != "$failed" ]; then
    status=success
    [ "$REQUIRE_CI" = "1" ] && status="$(ci_status "$sha")"
    case "$status" in
      success)
        deploy "$sha"
        waiting_for=""
        ;;
      failure)
        log "checks failed for ${sha:0:7}, not deploying"
        echo "$sha" >"$FAILED_FILE"
        ;;
      *)
        if [ "$waiting_for" != "$sha" ]; then
          log "new commit ${sha:0:7}, waiting for GitHub checks ($status)"
          waiting_for="$sha"
        fi
        ;;
    esac
  elif [ -z "$sha" ]; then
    log "cannot read $BRANCH from GitHub, will retry"
  fi
  sleep "$INTERVAL"
done
