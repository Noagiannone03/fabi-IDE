#!/usr/bin/env bash
# Control the two July-2026 lab workers through the VPS jump host.
#
# Usage:
#   tools/lab-worker-control.sh status all
#   tools/lab-worker-control.sh restart mac
#   tools/lab-worker-control.sh stop windows
#
# This is intentionally a lab helper, not the product launcher. It is strict
# about only killing processes that run from the Fabi runtime roots on the
# remote machines, so unrelated Parallax/dev processes are left alone.
set -euo pipefail

action="${1:-status}"
target="${2:-all}"

vps_host="${FABI_LAB_VPS_SSH:-vps}"
mac_ssh="${FABI_LAB_MAC_SSH:-gmbh@100.82.190.118}"
win_ssh="${FABI_LAB_WINDOWS_SSH:-gmbhl@100.105.234.82}"

usage() {
  cat >&2 <<'EOF'
Usage: tools/lab-worker-control.sh <status|start|stop|restart> <mac|windows|all>

Environment overrides:
  FABI_LAB_VPS_SSH       default: vps
  FABI_LAB_MAC_SSH       default: gmbh@100.82.190.118
  FABI_LAB_WINDOWS_SSH   default: gmbhl@100.105.234.82
EOF
}

case "$action" in
  status|start|stop|restart) ;;
  *) usage; exit 2 ;;
esac

case "$target" in
  mac|windows|all) ;;
  *) usage; exit 2 ;;
esac

run_mac() {
  local mac_action="$1"
  ssh "$vps_host" "ssh $mac_ssh 'bash -s'" -- "$mac_action" <<'SH'
set -euo pipefail
action="$1"
runtime="$HOME/.local/share/fabi/runtime"
launcher="$HOME/.local/share/fabi/mac-worker-e2e.sh"
log="$HOME/.local/share/fabi/mac-worker-e2e.nohup.log"

runtime_pids() {
  ps -axo pid=,command= | awk -v runtime="$runtime" 'index($0, runtime) { print $1 }'
}

stop_worker() {
  pids="$(runtime_pids | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
  if [ -n "$pids" ]; then
    kill -TERM $pids 2>/dev/null || true
    sleep 3
    pids="$(runtime_pids | tr '\n' ' ' | sed 's/[[:space:]]*$//')"
    if [ -n "$pids" ]; then
      kill -KILL $pids 2>/dev/null || true
    fi
  fi
}

start_worker() {
  if [ ! -x "$launcher" ]; then
    echo "missing_or_not_executable $launcher"
    exit 1
  fi
  nohup "$launcher" > "$log" 2>&1 &
  echo "started mac pid=$!"
}

status_worker() {
  echo "host=$(hostname)"
  echo "runtime=$runtime"
  echo "processes:"
  ps -axo pid=,rss=,command= | awk -v runtime="$runtime" 'index($0, runtime) { print }' || true
  echo "ports:"
  lsof -nP -iTCP:19080 -iUDP:19080 2>/dev/null || true
  echo "memory:"
  memory_pressure 2>/dev/null | sed -n '1,20p' || vm_stat | sed -n '1,20p'
  echo "last_log:"
  tail -40 "$log" 2>/dev/null || true
}

case "$action" in
  stop) stop_worker ;;
  start) start_worker ;;
  restart) stop_worker; start_worker ;;
  status) status_worker ;;
esac
SH
}

run_windows() {
  local win_action="$1"
  ssh "$vps_host" "ssh $win_ssh 'powershell -NoProfile -ExecutionPolicy Bypass -File -'" <<PS
\$ErrorActionPreference = "Stop"
\$Action = "$win_action"
\$Runtime = Join-Path \$env:LOCALAPPDATA "fabi\\runtime"
\$TaskName = "FabiWorkerE2E"
\$OutLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-task.out.log"
\$ErrLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-task.err.log"

function Get-FabiRuntimeProcess {
  Get-CimInstance Win32_Process | Where-Object {
    \$_.CommandLine -and \$_.CommandLine.Contains(\$Runtime)
  }
}

function Stop-FabiWorker {
  Stop-ScheduledTask -TaskName \$TaskName -ErrorAction SilentlyContinue
  Get-FabiRuntimeProcess | ForEach-Object {
    Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-FabiWorker {
  Start-ScheduledTask -TaskName \$TaskName
  Write-Output "started windows task=\$TaskName"
}

function Show-FabiStatus {
  Write-Output ("host=" + \$env:COMPUTERNAME)
  Write-Output ("runtime=" + \$Runtime)
  Write-Output "task:"
  Get-ScheduledTask -TaskName \$TaskName -ErrorAction SilentlyContinue |
    Select-Object TaskName,State | Format-Table -AutoSize | Out-String | Write-Output
  Write-Output "processes:"
  Get-FabiRuntimeProcess |
    Select-Object ProcessId,Name,CommandLine | Format-List | Out-String | Write-Output
  Write-Output "ports:"
  Get-NetTCPConnection -LocalPort 19080 -ErrorAction SilentlyContinue |
    Select-Object LocalAddress,LocalPort,State,OwningProcess | Format-Table -AutoSize | Out-String | Write-Output
  Write-Output "gpu:"
  nvidia-smi --query-gpu=name,memory.used,memory.free,utilization.gpu --format=csv,noheader,nounits 2>\$null
  Write-Output "last_stdout:"
  if (Test-Path \$OutLog) { Get-Content \$OutLog -Tail 40 }
  Write-Output "last_stderr:"
  if (Test-Path \$ErrLog) { Get-Content \$ErrLog -Tail 40 }
}

switch (\$Action) {
  "stop" { Stop-FabiWorker }
  "start" { Start-FabiWorker }
  "restart" { Stop-FabiWorker; Start-FabiWorker }
  "status" { Show-FabiStatus }
  default { throw "Unsupported action \$Action" }
}
PS
}

if [ "$target" = "mac" ] || [ "$target" = "all" ]; then
  run_mac "$action"
fi

if [ "$target" = "windows" ] || [ "$target" = "all" ]; then
  run_windows "$action"
fi
