#!/usr/bin/env bash
# Control the two July-2026 lab workers through the VPS jump host.
#
# Usage:
#   tools/lab-worker-control.sh status all
#   tools/lab-worker-control.sh restart mac
#   tools/lab-worker-control.sh stop windows
#   tools/lab-worker-control.sh restart all iroh
#
# This is intentionally a lab helper, not the product launcher. It is strict
# about only killing processes that run from the Fabi runtime roots on the
# remote machines, so unrelated Parallax/dev processes are left alone.
set -euo pipefail

action="${1:-status}"
target="${2:-all}"
network_mode="${3:-${FABI_LAB_NETWORK_MODE:-iroh}}"

vps_host="${FABI_LAB_VPS_SSH:-vps}"
mac_ssh="${FABI_LAB_MAC_SSH:-gmbh@100.82.190.118}"
win_ssh="${FABI_LAB_WINDOWS_SSH:-gmbhl@100.105.234.82}"
win_model_cache="${FABI_LAB_WINDOWS_MODEL_ARTIFACT_CACHE:-}"
win_hf_home="${FABI_LAB_WINDOWS_HF_HOME:-}"

usage() {
  cat >&2 <<'EOF'
Usage: tools/lab-worker-control.sh <status|start|stop|restart> <mac|windows|all> [tailscale|public|iroh]

Environment overrides:
  FABI_LAB_VPS_SSH       default: vps
  FABI_LAB_MAC_SSH       default: gmbh@100.82.190.118
  FABI_LAB_WINDOWS_SSH   default: gmbhl@100.105.234.82
  FABI_LAB_NETWORK_MODE  default: iroh
  FABI_LAB_ENGINE_SHA    optional committed engine candidate under runtime-candidates
  FABI_LAB_WINDOWS_MODEL_ARTIFACT_CACHE
                         optional absolute cache root for a Windows storage qualification
  FABI_LAB_WINDOWS_HF_HOME
                         optional absolute HF cache root for a Windows network-download qualification
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

case "$network_mode" in
  tailscale|public|iroh) ;;
  *) usage; exit 2 ;;
esac

run_mac() {
  local mac_action="$1"
  ssh "$vps_host" "ssh $mac_ssh 'bash -s'" -- "$mac_action" "$network_mode" "${FABI_LAB_ENGINE_SHA:-}" <<'SH'
set -euo pipefail
action="$1"
network_mode="$2"
engine_sha="${3:-}"
runtime="$HOME/.local/share/fabi/runtime"
registry_root="$HOME/.local/share/fabi/trust/model-registry-root-7ef69b40b4ba41fc8da5742f54303b388fe3192585a8f45b452079861ac3f0ce.json"
screen_name="fabi-worker-$network_mode"
if [ "$network_mode" = "iroh" ]; then
  launcher="$HOME/.local/share/fabi/mac-worker-iroh.sh"
  log="$HOME/.local/share/fabi/worker-mac-iroh.nohup.log"
elif [ "$network_mode" = "public" ]; then
  launcher="$HOME/.local/share/fabi/mac-worker-public-nat.sh"
  log="$HOME/.local/share/fabi/mac-worker-public-nat.nohup.log"
else
  launcher="$HOME/.local/share/fabi/mac-worker-e2e.sh"
  log="$HOME/.local/share/fabi/mac-worker-e2e.nohup.log"
fi

runtime_pids() {
  # `awk -v runtime=...` itself contains the runtime path in its argv.  Match
  # only executable command lines rooted in the runtime directory so the
  # lifecycle probe never observes (or terminates) its own inspector.
  ps -axo pid=,command= | awk -v runtime="$runtime/" '
    index($0, runtime) && $0 !~ /awk -v runtime/ { print $1 }
  '
}

stop_worker() {
  if command -v screen >/dev/null 2>&1; then
    screen -S "$screen_name" -X quit >/dev/null 2>&1 || true
  fi
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
  if screen -ls 2>/dev/null | grep -Fq ".$screen_name"; then
    echo "already_running mac screen=$screen_name"
    return 0
  fi
  if [ -n "$(runtime_pids | head -1)" ]; then
    echo "already_running mac runtime_processes_present"
    return 0
  fi
  if [ -n "$engine_sha" ]; then
    source_dir="$HOME/.local/share/fabi/runtime-candidates/$engine_sha/parallax-src"
  else
    source_dir="$runtime/parallax-src"
  fi
  if [ ! -d "$source_dir/src/parallax" ]; then
    echo "missing_parallax_source $source_dir"
    exit 1
  fi
  if [ ! -r "$registry_root" ]; then
    echo "missing_qualified_registry_root $registry_root"
    exit 1
  fi
  if [ "$network_mode" = "public" ] || [ "$network_mode" = "iroh" ]; then
    if ! command -v screen >/dev/null 2>&1; then
      echo "missing_screen_for_persistent_macos_public_worker"
      exit 1
    fi
    # macOS 15+ Local Network privacy associates multicast access with the
    # responsible process. In this lab a detached ssh/nohup child loses that
    # context, while screen keeps a durable user session for the worker.
    FABI_PARALLAX_SOURCE="$source_dir" \
    FABI_MODEL_REGISTRY_ROOT="$registry_root" \
    FABI_SWARM_V3_COORDINATION_MODE="client" \
      nohup screen -DmS "$screen_name" \
      /bin/zsh -c 'exec "$1" >"$2" 2>&1' _ "$launcher" "$log" \
      </dev/null >/dev/null 2>&1 &
    echo "started mac screen=$screen_name"
  else
    FABI_PARALLAX_SOURCE="$source_dir" \
    FABI_MODEL_REGISTRY_ROOT="$registry_root" \
      nohup "$launcher" > "$log" 2>&1 &
    echo "started mac pid=$!"
  fi
}

status_worker() {
  echo "host=$(hostname)"
  echo "runtime=$runtime"
  echo "network_mode=$network_mode"
  echo "engine_sha=${engine_sha:-installed-runtime}"
  echo "screen:"
  screen -ls 2>/dev/null | grep -F "$screen_name" || true
  echo "processes:"
  ps -axo pid=,rss=,command= | awk -v runtime="$runtime/" '
    index($0, runtime) && $0 !~ /awk -v runtime/ { print }
  ' || true
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
  local encoded
  local win_model_cache_b64
  local win_hf_home_b64
  win_model_cache_b64="$(printf '%s' "$win_model_cache" | base64 | tr -d '\r\n')"
  win_hf_home_b64="$(printf '%s' "$win_hf_home" | base64 | tr -d '\r\n')"
  encoded="$(
    iconv -f UTF-8 -t UTF-16LE <<PS | base64 | tr -d '\r\n'
\$ErrorActionPreference = "Stop"
\$ProgressPreference = "SilentlyContinue"
\$Action = "$win_action"
\$NetworkMode = "$network_mode"
\$EngineSha = "${FABI_LAB_ENGINE_SHA:-}"
\$ModelArtifactCache = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String("$win_model_cache_b64")
)
\$RequestedHfHome = [Text.Encoding]::UTF8.GetString(
  [Convert]::FromBase64String("$win_hf_home_b64")
)
\$Runtime = Join-Path \$env:LOCALAPPDATA "fabi\\runtime"
\$RegistryRoot = Join-Path \$env:LOCALAPPDATA "fabi\\trust\\model-registry-root-7ef69b40b4ba41fc8da5742f54303b388fe3192585a8f45b452079861ac3f0ce.json"
\$TaskName = if (\$NetworkMode -eq "iroh") {
  "FabiWorkerIroh"
} elseif (\$NetworkMode -eq "public") {
  "FabiWorkerPublicNat"
} else {
  "FabiWorkerE2E"
}
\$CandidatePointer = Join-Path \$env:LOCALAPPDATA "fabi\\runtime-candidate-current.txt"
if (\$NetworkMode -eq "iroh") {
  \$Launcher = Join-Path \$env:LOCALAPPDATA "fabi\\windows-worker-iroh.ps1"
  \$OutLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-iroh.out.log"
  \$ErrLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-iroh.err.log"
} elseif (\$NetworkMode -eq "public") {
  \$Launcher = Join-Path \$env:LOCALAPPDATA "fabi\\windows-worker-public-nat.ps1"
  \$OutLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-public-nat.out.log"
  \$ErrLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-public-nat.err.log"
} else {
  \$OutLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-task.out.log"
  \$ErrLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-task.err.log"
}

function Get-FabiRuntimeProcess {
  Get-CimInstance Win32_Process | Where-Object {
    \$_.CommandLine -and \$_.CommandLine.Contains(\$Runtime)
  }
}

function Stop-FabiWorker {
  # The transport profiles are mutually exclusive because they share the
  # worker identity, ports and GPU. Stop every managed profile before the
  # selected one is started so an old Task Scheduler parent cannot survive a
  # mode switch and relaunch a duplicate worker.
  @("FabiWorkerE2E", "FabiWorkerPublicNat", "FabiWorkerIroh") | ForEach-Object {
    Stop-ScheduledTask -TaskName \$_ -ErrorAction SilentlyContinue
  }
  Get-FabiRuntimeProcess | ForEach-Object {
    Stop-Process -Id \$_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

function Start-FabiWorker {
  if (\$NetworkMode -eq "public" -or \$NetworkMode -eq "iroh") {
    if (-not (Test-Path \$Launcher)) { throw "Missing \$NetworkMode launcher: \$Launcher" }
    if (\$EngineSha) {
      \$ParallaxSource = Join-Path \$env:LOCALAPPDATA "fabi\\runtime-candidates\\\$EngineSha\\parallax-src"
      if (-not (Test-Path (Join-Path \$ParallaxSource "src\\parallax"))) {
        throw "Missing candidate source: \$ParallaxSource"
      }
      Set-Content -Path \$CandidatePointer -Value \$ParallaxSource -NoNewline
    } else {
      \$ParallaxSource = Join-Path \$Runtime "parallax-src"
      Remove-Item \$CandidatePointer -Force -ErrorAction SilentlyContinue
    }
    if (-not (Test-Path (Join-Path \$ParallaxSource "src\\parallax"))) {
      throw "Missing installed Parallax source: \$ParallaxSource"
    }
    if (-not (Test-Path -LiteralPath \$RegistryRoot -PathType Leaf)) {
      throw "Missing qualified registry root: \$RegistryRoot"
    }
    # Windows OpenSSH kills descendants when its session job closes. Use the
    # native Task Scheduler as the durable lifecycle boundary for this lab.
    \$quotedSource = \$ParallaxSource.Replace("'", "''")
    \$quotedRoot = \$RegistryRoot.Replace("'", "''")
    \$quotedLauncher = \$Launcher.Replace("'", "''")
    \$UserHome = [Environment]::GetFolderPath('UserProfile')
    \$quotedHome = \$UserHome.Replace("'", "''")
    \$quotedLocalAppData = \$env:LOCALAPPDATA.Replace("'", "''")
    \$quotedAppData = \$env:APPDATA.Replace("'", "''")
    \$quotedAccountToken = (Join-Path \$UserHome ".config\\fabi\\account-token").Replace("'", "''")
    \$HfHome = if (\$RequestedHfHome) {
      \$RequestedHfHome
    } else {
      Join-Path \$UserHome ".cache\\huggingface"
    }
    \$quotedHfHome = \$HfHome.Replace("'", "''")
    \$quotedModelArtifactCache = \$ModelArtifactCache.Replace("'", "''")
    \$BootstrapLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-task-bootstrap.log"
    Remove-Item -LiteralPath \$BootstrapLog -Force -ErrorAction SilentlyContinue
    \$quotedBootstrapLog = \$BootstrapLog.Replace("'", "''")
    # Conserver littéralement les références PowerShell env jusqu'à l'exécution de
    # la tâche. Une chaîne PowerShell double les développerait ici et
    # enregistrerait une commande invalide commençant par un signe égal.
    \$taskCommand = (
      '\$env:USERPROFILE = ''{0}''; \$env:HOME = ''{0}''; ' +
      '\$env:LOCALAPPDATA = ''{1}''; \$env:APPDATA = ''{2}''; ' +
      '\$env:FABI_ACCOUNT_TOKEN_FILE = ''{3}''; \$env:HF_HOME = ''{4}''; ' +
      '\$env:FABI_PARALLAX_SOURCE = ''{5}''; ' +
      '\$env:FABI_MODEL_REGISTRY_ROOT = ''{6}''; ' +
      \$(if (\$quotedModelArtifactCache) {
        '\$env:FABI_MODEL_ARTIFACT_CACHE = ''{7}''; '
      } else { '' }) +
      '\$env:FABI_SWARM_V3_COORDINATION_MODE = ''client''; ' +
      'try {{ & ''{8}''; exit \$LASTEXITCODE }} catch {{ ' +
      '(\$_ | Format-List * -Force | Out-String) | Set-Content -LiteralPath ''{9}'' -Encoding UTF8; exit 1 }}'
    ) -f \$quotedHome, \$quotedLocalAppData, \$quotedAppData, \$quotedAccountToken, \$quotedHfHome, \$quotedSource, \$quotedRoot, \$quotedModelArtifactCache, \$quotedLauncher, \$quotedBootstrapLog
    \$encodedTaskCommand = [Convert]::ToBase64String([Text.Encoding]::Unicode.GetBytes(\$taskCommand))
    \$TaskAction = New-ScheduledTaskAction -Execute "powershell.exe" -Argument (
      "-NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -EncodedCommand " + \$encodedTaskCommand
    )
    # Le PC de labo peut être déconnecté pendant une qualification distante.
    # InteractiveToken refuse alors silencieusement le lancement faute de
    # session desktop. SYSTEM est le contexte de service Windows prévu pour un
    # processus headless ; les chemins utilisateur nécessaires sont épinglés
    # explicitement ci-dessus au lieu de dépendre du profil systemprofile.
    \$TaskPrincipal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount -RunLevel Highest
    # Long-lived inference must not inherit Task Scheduler desktop defaults
    # (stop on battery/idle transition and a finite execution limit).
    \$TaskSettings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -DontStopOnIdleEnd -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew
    Register-ScheduledTask -TaskName \$TaskName -Action \$TaskAction -Principal \$TaskPrincipal -Settings \$TaskSettings -Force | Out-Null
    Start-ScheduledTask -TaskName \$TaskName
    Write-Output "started windows task=\$TaskName"
  } else {
    Start-ScheduledTask -TaskName \$TaskName
    Write-Output "started windows task=\$TaskName"
  }
}

function Show-FabiStatus {
  Write-Output ("host=" + \$env:COMPUTERNAME)
  Write-Output ("runtime=" + \$Runtime)
  Write-Output ("network_mode=" + \$NetworkMode)
  if (\$EngineSha) {
    Write-Output ("engine_sha=" + \$EngineSha)
  } else {
    Write-Output "engine_sha=installed-runtime"
  }
  Write-Output "task:"
  Get-ScheduledTask -TaskName \$TaskName -ErrorAction SilentlyContinue |
    Select-Object TaskName,State | Format-Table -AutoSize | Out-String | Write-Output
  Get-ScheduledTaskInfo -TaskName \$TaskName -ErrorAction SilentlyContinue |
    Select-Object LastRunTime,LastTaskResult,NumberOfMissedRuns |
    Format-List | Out-String | Write-Output
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
  Write-Output "bootstrap_log:"
  \$BootstrapLog = Join-Path \$env:LOCALAPPDATA "fabi\\worker-windows-task-bootstrap.log"
  if (Test-Path \$BootstrapLog) { Get-Content \$BootstrapLog -Tail 80 }
}

switch (\$Action) {
  "stop" { Stop-FabiWorker }
  "start" { Start-FabiWorker }
  "restart" { Stop-FabiWorker; Start-FabiWorker }
  "status" { Show-FabiStatus }
  default { throw "Unsupported action \$Action" }
}
PS
  )"
  ssh "$vps_host" "ssh $win_ssh 'powershell -NoLogo -NoProfile -NonInteractive -EncodedCommand $encoded'"
}

if [ "$target" = "mac" ] || [ "$target" = "all" ]; then
  run_mac "$action"
fi

if [ "$target" = "windows" ] || [ "$target" = "all" ]; then
  run_windows "$action"
fi
