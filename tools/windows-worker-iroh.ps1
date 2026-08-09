$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

# Headless lab launcher mirroring the packaged IDE contract. The runtime
# MANIFEST is authoritative for the executor; never carry a backend flag from
# an older release into a newly installed runtime.
$state = Join-Path $env:LOCALAPPDATA "fabi"
$runtime = Join-Path $state "runtime"
$manifestPath = Join-Path $state "MANIFEST"
$python = Join-Path $runtime "parallax-venv\Scripts\python.exe"
$sourcePointer = Join-Path $state "runtime-candidate-current.txt"
$schedulerPointer = Join-Path $state "scheduler-endpoint.txt"
$source = if ($env:FABI_PARALLAX_SOURCE) {
  $env:FABI_PARALLAX_SOURCE
} elseif (Test-Path -LiteralPath $sourcePointer -PathType Leaf) {
  (Get-Content -LiteralPath $sourcePointer -Raw).Trim()
} else {
  Join-Path $runtime "parallax-src"
}
$schedulerEndpoint = if ($env:FABI_SCHEDULER_ENDPOINT) {
  $env:FABI_SCHEDULER_ENDPOINT
} else {
  (Get-Content -LiteralPath $schedulerPointer -Raw).Trim()
}
$accountTokenFile = if ($env:FABI_ACCOUNT_TOKEN_FILE) {
  $env:FABI_ACCOUNT_TOKEN_FILE
} else {
  Join-Path $HOME ".config\fabi\account-token"
}
$registryRoot = if ($env:FABI_MODEL_REGISTRY_ROOT) {
  $env:FABI_MODEL_REGISTRY_ROOT
} else {
  Join-Path $state "trust\model-registry-root-7ef69b40b4ba41fc8da5742f54303b388fe3192585a8f45b452079861ac3f0ce.json"
}
$catalogBootstraps = if ($env:FABI_CATALOG_DHT_BOOTSTRAPS) {
  $env:FABI_CATALOG_DHT_BOOTSTRAPS
} else {
  @(
    "/ip4/37.59.98.16/tcp/19191/p2p/12D3KooWB1VciohMDGP6qC5m1tDRbCMfjQ14LWx12FsWyJtnWEsn"
    "/ip4/37.59.98.16/tcp/19192/p2p/12D3KooWMQrc1rWXwaeQcshtANiw9FyyGWmfqAnVsStGRqsJ54Yi"
  ) | ConvertTo-Json -Compress
}

function Read-RuntimeManifest {
  param([Parameter(Mandatory = $true)][string]$Path)

  if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
    throw "runtime manifest is not readable: $Path"
  }
  $values = @{}
  foreach ($line in Get-Content -LiteralPath $Path) {
    if ($line -match '^([^=]+)=(.*)$') {
      $values[$matches[1].Trim()] = $matches[2].Trim()
    }
  }
  return $values
}

$manifest = Read-RuntimeManifest -Path $manifestPath
if ($manifest.execution_engine -ne "skippy") {
  throw "unsupported installed execution engine: $($manifest.execution_engine)"
}
$executionDevice = $manifest.execution_device
if ($executionDevice -notin @("cuda", "vulkan")) {
  throw "unsupported Windows Skippy execution device: $executionDevice"
}
if (-not (Test-Path -LiteralPath $python -PathType Leaf)) { throw "worker Python not found: $python" }
if (-not (Test-Path -LiteralPath (Join-Path $source "pyproject.toml") -PathType Leaf)) { throw "invalid Parallax source: $source" }
if ($schedulerEndpoint -notmatch "^[0-9a-f]{64}$") { throw "invalid Iroh scheduler endpoint" }
if (-not (Test-Path -LiteralPath $accountTokenFile -PathType Leaf)) { throw "account token file is not readable" }
if (-not (Test-Path -LiteralPath $registryRoot -PathType Leaf)) { throw "pinned model-registry root is not readable" }

$networkState = Join-Path $state "network"
$processLogs = Join-Path $state "process-logs"
$outLog = Join-Path $state "worker-windows-iroh.out.log"
$errLog = Join-Path $state "worker-windows-iroh.err.log"
New-Item -ItemType Directory -Force -Path $networkState, $processLogs | Out-Null

$env:FABI_ACCOUNT_TOKEN = (Get-Content -LiteralPath $accountTokenFile -Raw).Trim()
$env:FABI_NETWORK_TRANSPORT = "iroh"
$env:FABI_RELAY_URL = if ($env:FABI_RELAY_URL) { $env:FABI_RELAY_URL } else { "https://server.undefinedstudio.fr:4443" }
$env:FABI_RELAY_ENROLLMENT_URL = if ($env:FABI_RELAY_ENROLLMENT_URL) { $env:FABI_RELAY_ENROLLMENT_URL } else { "https://server.undefinedstudio.fr/fabi-registry/v1/network/enroll" }
Remove-Item Env:\FABI_RELAY_TOKEN -ErrorAction SilentlyContinue
Remove-Item Env:\FABI_RELAY_TOKEN_FILE -ErrorAction SilentlyContinue
$env:FABI_NETWORK_IDENTITY_PATH = if ($env:FABI_NETWORK_IDENTITY_PATH) { $env:FABI_NETWORK_IDENTITY_PATH } else { Join-Path $networkState "worker.key" }
$modelState = Join-Path $state "swarm-v3\qwen3-0-6b-v3"
$env:FABI_SWARM_V3_STATE_DIR = if ($env:FABI_SWARM_V3_STATE_DIR) { $env:FABI_SWARM_V3_STATE_DIR } else { Join-Path $modelState "registry" }
$env:FABI_SWARM_V3_FENCE_DB = if ($env:FABI_SWARM_V3_FENCE_DB) { $env:FABI_SWARM_V3_FENCE_DB } else { Join-Path $modelState "fencing.sqlite3" }
$env:FABI_SWARM_V3_MODE = if ($env:FABI_SWARM_V3_MODE) { $env:FABI_SWARM_V3_MODE } else { "active" }
$env:FABI_SWARM_V3_PLACEMENT = if ($env:FABI_SWARM_V3_PLACEMENT) { $env:FABI_SWARM_V3_PLACEMENT } else { "autonomous" }
$env:FABI_SWARM_V3_COORDINATION_MODE = "client"
$env:FABI_MODEL_REGISTRY_ROOT = $registryRoot
$env:FABI_MODEL_REGISTRY_METADATA_URL = if ($env:FABI_MODEL_REGISTRY_METADATA_URL) { $env:FABI_MODEL_REGISTRY_METADATA_URL } else { "https://server.undefinedstudio.fr/fabi-swarm-registry-v3/metadata/" }
$env:FABI_MODEL_REGISTRY_TARGETS_URL = if ($env:FABI_MODEL_REGISTRY_TARGETS_URL) { $env:FABI_MODEL_REGISTRY_TARGETS_URL } else { "https://server.undefinedstudio.fr/fabi-swarm-registry-v3/targets/" }
$env:FABI_CATALOG_DHT_MODE = "client"
$env:FABI_CATALOG_DHT_BOOTSTRAPS = $catalogBootstraps
$env:FABI_CATALOG_DHT_IDENTITY_PATH = if ($env:FABI_CATALOG_DHT_IDENTITY_PATH) { $env:FABI_CATALOG_DHT_IDENTITY_PATH } else { Join-Path $networkState "worker-catalog.key" }
$env:FABI_CATALOG_DHT_LISTEN_ADDRESS = "/ip4/127.0.0.1/tcp/0"
$env:FABI_FORCE_RELAY = "0"
$env:FABI_INITIAL_ALLOCATION_TIMEOUT_SECONDS = "0"
$env:FABI_WORKER_SESSION_ID = [guid]::NewGuid().ToString()
$env:PARALLAX_KEY_PATH = Join-Path $state "identity"
$env:PARALLAX_PROCESS_LOG_DIR = $processLogs
Remove-Item Env:\PARALLAX_CUDA_SYSTEM_RESERVE_GB -ErrorAction SilentlyContinue
$env:PYTHONPATH = (Join-Path $source "src")
$env:PYTHONUNBUFFERED = "1"
$env:RUST_LOG = if ($env:RUST_LOG) { $env:RUST_LOG } else { "info" }
New-Item -ItemType Directory -Force -Path $env:FABI_SWARM_V3_STATE_DIR, (Split-Path -Parent $env:FABI_SWARM_V3_FENCE_DB) | Out-Null

# Match fabi-worker-tuning.ts for a 16 GiB CUDA card. The initialized Skippy
# backend remains authoritative for the live VRAM/KV capacity it advertises.
$joinArgs = @(
  "join", "-s", $schedulerEndpoint, "-r",
  "--max-batch-size", "1",
  "--max-sequence-length", "32768",
  "--max-num-tokens-per-batch", "8192",
  "--kv-block-size", "32",
  "--gpu-backend", "skippy",
  "--execution-device", $executionDevice,
  "--tcp-port", "19080",
  "--udp-port", "19080",
  "--log-level", "DEBUG"
)

Set-Location $source
& $python -m parallax.cli @joinArgs 1>> $outLog 2>> $errLog
exit $LASTEXITCODE
