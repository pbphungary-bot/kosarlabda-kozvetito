#!/usr/bin/env bash
# Starts the Playwright MCP server for Claude Code (see .mcp.json). In the cloud sandbox the browser is pre-installed
# (/opt/pw-browsers) and there is no display; on a normal computer Playwright MCP picks its own browser and opens a window.
set -e
args=()
if [ -z "${DISPLAY:-}" ] && [ "$(uname)" = "Linux" ]; then args+=(--headless --no-sandbox); fi
chrome=$(ls -d /opt/pw-browsers/chromium-*/chrome-linux64/chrome 2>/dev/null | sort | tail -1 || true)
if [ -n "$chrome" ]; then args+=(--executable-path "$chrome"); fi
exec npx -y @playwright/mcp@0.0.86 "${args[@]}" "$@"
