#!/bin/sh
# 六耳 AI资讯情报站 · 定时抓取安装脚本
#
# 用法：
#   ./install-schedule.sh                 # 安装，每天 07:00 抓取
#   ./install-schedule.sh --time 06:30    # 自定义时间
#   ./install-schedule.sh --ai            # 抓完顺便 AI 打分（需 API key）
#   ./install-schedule.sh --status        # 查看状态
#   ./install-schedule.sh --uninstall     # 卸载
#   ./install-schedule.sh --run-now       # 立刻跑一次（测试用）
#
# macOS 用 launchd，Linux 用 cron。日志写到 ~/Library/Logs/（macOS）
# 或 ~/.liuer-intel-station/（Linux），不放 Documents 以免被 TCC 拦。

set -e

LABEL="com.liuer.intel-station.fetch"
PLUGIN_DIR=$(cd "$(dirname "$0")" && pwd)
DATA_DIR="${LIUER_DATA_DIR:-$HOME/.liuer-intel-station}"
DB="$DATA_DIR/intel.db"
TIME="07:00"
WITH_AI=0
ACTION="install"

while [ $# -gt 0 ]; do
  case "$1" in
    --time)      TIME="$2"; shift 2 ;;
    --ai)        WITH_AI=1; shift ;;
    --status)    ACTION="status"; shift ;;
    --uninstall) ACTION="uninstall"; shift ;;
    --run-now)   ACTION="run"; shift ;;
    -h|--help)   sed -n '2,18p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 1 ;;
  esac
done

HOUR=$(echo "$TIME" | cut -d: -f1 | sed 's/^0*//'); [ -z "$HOUR" ] && HOUR=0
MINUTE=$(echo "$TIME" | cut -d: -f2 | sed 's/^0*//'); [ -z "$MINUTE" ] && MINUTE=0
HOUR=$((HOUR + 0)); MINUTE=$((MINUTE + 0))

# ── 找 Python ──
find_python() {
  for c in python3 python /usr/bin/python3 /opt/homebrew/bin/python3 /usr/local/bin/python3; do
    if command -v "$c" >/dev/null 2>&1; then
      if "$c" -c 'import sys; sys.exit(0 if sys.version_info >= (3,9) else 1)' 2>/dev/null; then
        command -v "$c"; return 0
      fi
    fi
  done
  return 1
}

PY=$(find_python) || { echo "✗ 找不到 Python 3.9+，请先安装" >&2; exit 1; }

# ── 组装要执行的命令 ──
build_cmd() {
  cmd="cd \"$PLUGIN_DIR\" && \"$PY\" engines/fetch_feeds.py \"$DATA_DIR\" \"$DB\" && \"$PY\" engines/apply_filters.py \"$DATA_DIR\" \"$DB\""
  if [ "$WITH_AI" -eq 1 ]; then
    cmd="$cmd && \"$PY\" engines/ai_score.py \"$DATA_DIR\" \"$DB\" \"\$(cat \"$DATA_DIR/.deepseek_key\" 2>/dev/null)\" --limit 50 || true"
  fi
  printf '%s' "$cmd"
}

RUN_CMD=$(build_cmd)
LOG_DIR="$HOME/Library/Logs"
[ -d "$LOG_DIR" ] || LOG_DIR="$DATA_DIR"
LOG_FILE="$LOG_DIR/liuer-intel-station.log"

OS=$(uname -s)
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"

# ── 动作 ──
do_status() {
  echo "插件目录：$PLUGIN_DIR"
  echo "数据目录：$DATA_DIR"
  echo "Python  ：$PY"
  echo "日志    ：$LOG_FILE"
  echo "定时    ：${TIME}（每天）"
  echo
  if [ "$OS" = "Darwin" ]; then
    if [ -f "$PLIST" ]; then
      echo "状态    ：已安装（launchd）"
      launchctl list 2>/dev/null | grep "$LABEL" || echo "  （当前未加载）"
    else
      echo "状态    ：未安装"
    fi
  else
    if crontab -l 2>/dev/null | grep -q "$LABEL"; then
      echo "状态    ：已安装（cron）"
      crontab -l | grep "$LABEL"
    else
      echo "状态    ：未安装"
    fi
  fi
  if [ -f "$LOG_FILE" ]; then
    echo
    echo "最近日志："
    tail -5 "$LOG_FILE"
  fi
}

do_uninstall() {
  if [ "$OS" = "Darwin" ]; then
    launchctl unload "$PLIST" 2>/dev/null || true
    rm -f "$PLIST"
    echo "✓ 已卸载（launchd）"
  else
    crontab -l 2>/dev/null | grep -v "$LABEL" | crontab - || true
    echo "✓ 已卸载（cron）"
  fi
}

do_run() {
  echo "▶ 立刻执行一次…"
  sh -c "$RUN_CMD" 2>&1 | tail -5
  echo "✓ 完成"
}

do_install() {
  mkdir -p "$DATA_DIR"

  if [ "$OS" = "Darwin" ]; then
    mkdir -p "$HOME/Library/LaunchAgents"
    # 先卸旧的，避免重复
    launchctl unload "$PLIST" 2>/dev/null || true

    cat > "$PLIST" <<PLISTEOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>/bin/sh</string>
    <string>-c</string>
    <string>$RUN_CMD</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Hour</key><integer>$HOUR</integer>
    <key>Minute</key><integer>$MINUTE</integer>
  </dict>
  <key>RunAtLoad</key>
  <false/>
  <key>StandardOutPath</key>
  <string>$LOG_FILE</string>
  <key>StandardErrorPath</key>
  <string>$LOG_FILE</string>
</dict>
</plist>
PLISTEOF

    launchctl load "$PLIST"
    echo "✓ 已安装（launchd），每天 $TIME 自动抓取"
    echo "  配置文件：$PLIST"
  else
    LINE="$MINUTE $HOUR * * * $RUN_CMD >> \"$LOG_FILE\" 2>&1 # $LABEL"
    ( crontab -l 2>/dev/null | grep -v "$LABEL"; echo "$LINE" ) | crontab -
    echo "✓ 已安装（cron），每天 $TIME 自动抓取"
  fi

  echo "  日志：$LOG_FILE"
  if [ "$WITH_AI" -eq 1 ]; then
    echo
    echo "⚠ 已启用 AI 打分，需要把 DeepSeek API key 写进：$DATA_DIR/.deepseek_key"
    echo "  echo 'sk-xxxx' > \"$DATA_DIR/.deepseek_key\" && chmod 600 \"$DATA_DIR/.deepseek_key\""
  fi
  echo
  echo "测试：$0 --run-now"
  echo "查看：$0 --status"
  echo "卸载：$0 --uninstall"
}

case "$ACTION" in
  status)    do_status ;;
  uninstall) do_uninstall ;;
  run)       do_run ;;
  install)   do_install ;;
esac
