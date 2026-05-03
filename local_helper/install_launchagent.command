#!/usr/bin/env bash
# Installs the helper as a macOS LaunchAgent so it auto-starts at login.
# Double-click this file once to set it up. Reverse with `uninstall_launchagent.command`.
set -e

HERE="$(cd "$(dirname "$0")" && pwd)"
LABEL="ai.comet-iptv.helper"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
STDOUT="$HOME/Library/Logs/comet-iptv-helper.out.log"
STDERR="$HOME/Library/Logs/comet-iptv-helper.err.log"

# Make sure ffmpeg + python are available
export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
if ! command -v ffmpeg >/dev/null 2>&1; then
  echo "ffmpeg not in PATH; installing via brew…"
  brew install ffmpeg
fi

mkdir -p "$(dirname "$PLIST")" "$(dirname "$STDOUT")"

cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>           <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/env</string>
    <string>python3</string>
    <string>$HERE/helper.py</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key>
    <string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin</string>
  </dict>
  <key>RunAtLoad</key>       <true/>
  <key>KeepAlive</key>       <true/>
  <key>StandardOutPath</key> <string>$STDOUT</string>
  <key>StandardErrorPath</key><string>$STDERR</string>
</dict>
</plist>
EOF

# Reload
launchctl unload "$PLIST" 2>/dev/null || true
launchctl load "$PLIST"

echo "✓ Installed at $PLIST"
echo "✓ Helper is now running and will auto-start at login."
echo ""
echo "Verify:  curl http://127.0.0.1:9123/health"
echo "Logs:    $STDOUT"
echo "Stop:    launchctl unload $PLIST"
read -p "Press return to close…" _
