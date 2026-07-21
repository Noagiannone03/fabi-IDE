# Public-network lab launcher: no private overlay initial peers and no explicit announce
# addresses. It exercises Parallax/Lattica's official relay + DCUtR path.
$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$runtime = Join-Path $env:LOCALAPPDATA "fabi\runtime"
$python = Join-Path $runtime "parallax-venv\Scripts\python.exe"
$candidatePointer = Join-Path $env:LOCALAPPDATA "fabi\runtime-candidate-current.txt"
$source = if ($env:FABI_PARALLAX_SOURCE) {
  $env:FABI_PARALLAX_SOURCE
} elseif (Test-Path $candidatePointer) {
  (Get-Content $candidatePointer -Raw).Trim()
} else {
  Join-Path $runtime "parallax-src"
}
$tokenPath = Join-Path $HOME ".config\fabi\account-token"
$outLog = Join-Path $env:LOCALAPPDATA "fabi\worker-windows-public-nat.out.log"
$errLog = Join-Path $env:LOCALAPPDATA "fabi\worker-windows-public-nat.err.log"

$env:FABI_ACCOUNT_TOKEN = (Get-Content $tokenPath -Raw).Trim()
$env:PARALLAX_KEY_PATH = Join-Path $HOME ".config\fabi\identity"
$env:FABI_WORKER_SESSION_ID = [guid]::NewGuid().ToString()
$env:PARALLAX_PROCESS_LOG_DIR = Join-Path $env:LOCALAPPDATA "fabi\process-logs"
New-Item -ItemType Directory -Path $env:PARALLAX_PROCESS_LOG_DIR -Force | Out-Null
$env:PARALLAX_CUDA_SYSTEM_RESERVE_GB = "1.5"
$env:PYTHONUNBUFFERED = "1"
if (-not $env:VLLM_ENGINE_READY_TIMEOUT_S) {
  $env:VLLM_ENGINE_READY_TIMEOUT_S = "3600"
}
# Candidate checkouts are not installed into the runtime virtualenv. Merely
# changing location still imports the packaged copy, so make the selected
# revision the first Python import location.
$candidatePythonPath = Join-Path $source "src"
if ($env:PYTHONPATH) {
  $env:PYTHONPATH = "$candidatePythonPath;$env:PYTHONPATH"
} else {
  $env:PYTHONPATH = $candidatePythonPath
}
Remove-Item Env:\PARALLAX_INITIAL_PEERS -ErrorAction SilentlyContinue
Remove-Item Env:\PARALLAX_ANNOUNCE_MADDRS -ErrorAction SilentlyContinue
Remove-Item Env:\PARALLAX_ENABLE_MDNS -ErrorAction SilentlyContinue

Set-Location $source
& $python -m parallax.cli join `
  -s 12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR `
  -r `
  --max-batch-size 1 `
  --max-sequence-length 65536 `
  --max-num-tokens-per-batch 65536 `
  --kv-block-size 16 `
  --gpu-backend vllm `
  --tcp-port 19080 `
  --udp-port 19080 `
  --log-level DEBUG `
  1>> $outLog 2>> $errLog
