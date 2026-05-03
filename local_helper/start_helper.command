#!/usr/bin/env bash
# Double-click this file (Finder) to start the Comet IPTV helper.
# It runs in the background until you close the Terminal window or hit Ctrl-C.
#
# To make it auto-start on login: System Settings → General → Login Items →
# add this file. Or use the LaunchAgent installer at install_launchagent.command.
HERE="$(cd "$(dirname "$0")" && pwd)"
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

if ! command -v ffmpeg >/dev/null 2>&1; then
  if command -v brew >/dev/null 2>&1; then
    echo "ffmpeg not found. Installing via Homebrew (one-time)…"
    brew install ffmpeg || { read -p "Press return to close…" _; exit 1; }
  else
    echo "ffmpeg not found and Homebrew isn't installed."
    echo "Install Homebrew (https://brew.sh) then re-run this script."
    read -p "Press return to close…" _
    exit 1
  fi
fi

echo "Starting Comet IPTV helper. Leave this window open while watching."
echo "Press Ctrl-C to stop."
echo ""
exec /usr/bin/env python3 "$HERE/helper.py"
