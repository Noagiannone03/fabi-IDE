#!/bin/zsh
# Legacy 2026-07 distributed-lab launcher. It targets the old Tailscale test
# topology and is kept for reproducibility, not as the final product launcher.
# The account token is read at runtime from the local Fabi config; no secret is
# stored in this script.
set -euo pipefail

runtime="$HOME/.local/share/fabi/runtime"
python="$runtime/parallax-venv/bin/python"
source_dir="$runtime/parallax-src"
token_path="$HOME/.config/fabi/account-token"

export FABI_ACCOUNT_TOKEN="$(tr -d '\r\n' < "$token_path")"
export PARALLAX_KEY_PATH="$HOME/.config/fabi/identity"
export FABI_WORKER_SESSION_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
export PARALLAX_INITIAL_PEERS="/ip4/100.79.54.80/tcp/18080/p2p/12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR,/ip4/100.79.54.80/udp/18080/quic-v1/p2p/12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR"
export PYTHONUNBUFFERED=1

cd "$source_dir"
exec "$python" -m parallax.cli join \
  -s 12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR \
  -r \
  --max-batch-size 1 \
  --max-sequence-length 65536 \
  --max-num-tokens-per-batch 65536 \
  --kv-block-size 32 \
  --enable-prefix-cache \
  --tcp-port 19080 \
  --udp-port 19080 \
  --announce-maddrs /ip4/100.82.190.118/tcp/19080 /ip4/100.82.190.118/udp/19080/quic-v1
