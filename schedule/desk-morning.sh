#!/usr/bin/env bash
# The morning desk for macOS and Linux (launchd or cron).
# 1. Runs the desk's fresh read headless with Claude Code (claude -p), read-only outside the desk folder.
# 2. If that fails or times out, falls back to the no-model refresh (refresh.js), so the page still renders.
# 3. Opens the page (macOS: open; Linux: xdg-open, which needs a desktop session).
#
#   bash schedule/desk-morning.sh /path/to/your-project            # read, then open the page
#   bash schedule/desk-morning.sh /path/to/your-project --no-show  # read only
#
# Another agent CLI: replace the claude call with your harness's headless mode (for example `codex exec`), with its own read-only settings.
set -u
PROJECT="${1:?usage: desk-morning.sh /path/to/your-project [--no-show]}"
SHOW=1; [ "${2:-}" = "--no-show" ] && SHOW=0
DESK_DIR="${DESK_DIR:-desk}"
LIMIT_MIN="${LIMIT_MIN:-45}"
DESK="$PROJECT/$DESK_DIR"
LOG="$DESK/morning.log"
HERE="$(cd "$(dirname "$0")" && pwd)"
log() { echo "$(date '+%Y-%m-%d %H:%M') $*" >> "$LOG"; }

cd "$PROJECT" || exit 1
log "morning run started"
ok=0
if command -v claude >/dev/null 2>&1; then
  PROMPT="Started by the scheduled job at $(date '+%Y-%m-%d %H:%M').
$(cat "$HERE/morning-prompt.md" 2>/dev/null || echo 'Do the desk fresh read, unattended, read-only outside the desk folder. Send nothing.')"
  # Add your own read-only MCP tools to this list (tracker, calendar).
  ALLOWED=(Read Glob Grep Agent Task TodoWrite "Edit($DESK_DIR/**)" "Write($DESK_DIR/**)" \
    "Bash(node $DESK_DIR/refresh.js:*)" "Bash(node $DESK_DIR/render.js:*)" \
    "Bash(gh pr view:*)" "Bash(gh pr list:*)" "Bash(gh issue list:*)" "Bash(git log:*)" "Bash(git status:*)" "Bash(date:*)")
  TO=""; command -v timeout >/dev/null 2>&1 && TO="timeout $((LIMIT_MIN * 60))"
  if echo "$PROMPT" | $TO claude -p --permission-mode dontAsk --output-format text --allowedTools "${ALLOWED[@]}" >> "$LOG" 2>&1; then
    ok=1; log "fresh read finished"
  else
    log "fresh read failed or timed out"
  fi
else
  log "claude not found; falling back to refresh.js"
fi

if [ "$ok" -ne 1 ]; then
  log "running refresh.js so the page still renders"
  node "$DESK/refresh.js" --data "$DESK" >/dev/null 2>&1
fi

if [ "$SHOW" -eq 1 ] && [ -f "$DESK/index.html" ]; then
  if command -v open >/dev/null 2>&1; then open "$DESK/index.html"; elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$DESK/index.html" >/dev/null 2>&1; fi
  log "page on screen"
fi
log "morning run done"
