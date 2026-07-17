# Legacy 2026-07 distributed-lab launcher. It targets the old Tailscale test
# topology and is kept for reproducibility, not as the final product launcher.
# The account token is read at runtime from the local Fabi config; no secret is
# stored in this script.
$ErrorActionPreference = "Stop"

$runtime = Join-Path $env:LOCALAPPDATA "fabi\runtime"
$python = Join-Path $runtime "parallax-venv\Scripts\python.exe"
$source = Join-Path $runtime "parallax-src"
$tokenPath = Join-Path $HOME ".config\fabi\account-token"

$env:FABI_ACCOUNT_TOKEN = (Get-Content $tokenPath -Raw).Trim()
$env:PARALLAX_KEY_PATH = Join-Path $HOME ".config\fabi\identity"
$env:FABI_WORKER_SESSION_ID = [guid]::NewGuid().ToString()
$env:PARALLAX_CUDA_SYSTEM_RESERVE_GB = "1.5"
$env:PARALLAX_INITIAL_PEERS = "/ip4/100.79.54.80/tcp/18080/p2p/12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR,/ip4/100.79.54.80/udp/18080/quic-v1/p2p/12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR"
$env:PYTHONUNBUFFERED = "1"

$stdout = Join-Path $env:LOCALAPPDATA "fabi\worker-windows-task.out.log"
$stderr = Join-Path $env:LOCALAPPDATA "fabi\worker-windows-task.err.log"

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
  --announce-maddrs /ip4/100.105.234.82/tcp/19080 /ip4/100.105.234.82/udp/19080/quic-v1 `
  1>> $stdout 2>> $stderr
