#!/bin/zsh
# Public-network lab launcher: no private overlay initial peers and no explicit announce
# addresses. It exercises Parallax/Lattica's official relay + DCUtR path.
set -euo pipefail

runtime="$HOME/.local/share/fabi/runtime"
python="$runtime/parallax-venv/bin/python"
source_dir="${FABI_PARALLAX_SOURCE:-$runtime/parallax-src}"
token_path="$HOME/.config/fabi/account-token"

export FABI_ACCOUNT_TOKEN="$(tr -d '\r\n' < "$token_path")"
export PARALLAX_KEY_PATH="$HOME/.config/fabi/identity"
export FABI_WORKER_SESSION_ID="$(uuidgen | tr '[:upper:]' '[:lower:]')"
export PARALLAX_PROCESS_LOG_DIR="$HOME/.local/share/fabi/process-logs"
mkdir -p "$PARALLAX_PROCESS_LOG_DIR"
export PYTHONUNBUFFERED=1
# Official vLLM cold-start window. The engine wrapper forwards this value into
# Rust --args-json; 600 seconds was too short for a first multi-GB model fetch
# over the lab connection.
export VLLM_ENGINE_READY_TIMEOUT_S="${VLLM_ENGINE_READY_TIMEOUT_S:-3600}"
# Candidate checkouts are not installed into the runtime virtualenv. Merely
# changing cwd still imports the packaged copy, so make the selected revision
# the first Python import location.
export PYTHONPATH="$source_dir/src${PYTHONPATH:+:$PYTHONPATH}"
unset PARALLAX_INITIAL_PEERS
unset PARALLAX_ANNOUNCE_MADDRS
unset PARALLAX_ENABLE_MDNS

cd "$source_dir"
exec "$python" -m parallax.cli join \
  -s 12D3KooWKLCTHRAhMEafQfaGZTAEx8kJjeMqpXDDeyhBGVotuSfR \
  -r \
  --max-batch-size 1 \
  --max-sequence-length 65536 \
  --max-num-tokens-per-batch 65536 \
  --kv-block-size 32 \
  --tcp-port 19080 \
  --udp-port 19080 \
  --log-level DEBUG
