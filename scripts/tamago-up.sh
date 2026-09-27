#!/usr/bin/env bash
# tamago-up.sh: bring Tamago back after the Mac restarts, with the live view.
#
#   scripts/tamago-up.sh
#
# 1. Checks the Storage disk is mounted (AGENTS.md §9) and stops if it isn't.
# 2. Starts Ollama on 127.0.0.1 with its models on Storage, unless it's running.
# 3. Runs the gateway in THIS terminal for the Watch on the home LAN: brain +
#    llama3.2:3b, Apple on-device transcription, the owner's Kokoro voice
#    (af_heart, 0.9x), and the live view (TAMAGO_MONITOR=1): every message
#    heard, every answer, every voice clip, as it happens. Ctrl-C stops it.
#
# Every setting can be overridden from the environment. Nothing is exposed to
# the internet: the gateway is for the trusted home LAN, Ollama stays loopback.
set -euo pipefail

STORAGE="${TAMAGO_STORAGE:-/Volumes/Storage}"
REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
die() { echo "tamago-up: $*" >&2; exit 1; }

[[ -d "$STORAGE/AI" ]] || die "$STORAGE isn't mounted. Plug in the Storage disk and run this again."

export OLLAMA_MODELS="${OLLAMA_MODELS:-$STORAGE/AI/ollama/models}"
export TAMAGO_STATE_DIR="${TAMAGO_STATE_DIR:-$STORAGE/AI/TamagoAI}"
export TMPDIR="${TAMAGO_TMPDIR:-$STORAGE/DevCaches/TamaWatch/tmp}"
mkdir -p "$TMPDIR" "$STORAGE/AI/ollama/logs"

if lsof -nP -iTCP:"${TAMAGO_PORT:-8787}" -sTCP:LISTEN >/dev/null 2>&1; then
  die "something already listens on port ${TAMAGO_PORT:-8787} (is Tamago running in another window?)"
fi

# ---- Ollama (the brain's model), loopback only
if curl -fsS --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1; then
  echo "tamago-up: Ollama is already running."
else
  command -v ollama >/dev/null || die "Ollama isn't installed (brew install ollama)."
  echo "tamago-up: starting Ollama (models in $OLLAMA_MODELS)…"
  # Its own session (setsid), so Ctrl-C on Tamago or closing this window leaves the model server running.
  OLLAMA_HOST=127.0.0.1:11434 perl -MPOSIX -e 'POSIX::setsid(); exec @ARGV or die "$!\n"' ollama serve \
    >>"$STORAGE/AI/ollama/logs/serve.log" 2>&1 < /dev/null &
  for _ in $(seq 1 30); do
    curl -fsS --max-time 1 http://127.0.0.1:11434/api/version >/dev/null 2>&1 && break
    sleep 0.5
  done
  curl -fsS --max-time 2 http://127.0.0.1:11434/api/version >/dev/null 2>&1 \
    || die "Ollama didn't start; see $STORAGE/AI/ollama/logs/serve.log"
fi

# ---- the gateway, in the foreground with the live view
export TAMAGO_HOST="${TAMAGO_HOST:-0.0.0.0}"
export TAMAGO_PROVIDER="${TAMAGO_PROVIDER:-brain}"
export OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:3b}"
export TAMAGO_TTS="${TAMAGO_TTS:-kokoro}"
export TAMAGO_TTS_VOICE="${TAMAGO_TTS_VOICE:-af_heart}"
export TAMAGO_TTS_SPEED="${TAMAGO_TTS_SPEED:-0.9}"
export TAMAGO_TTS_MODEL_DIR="${TAMAGO_TTS_MODEL_DIR:-$STORAGE/AI/tts}"
export TAMAGO_MONITOR="${TAMAGO_MONITOR:-1}"

cd "$REPO/Gateway"
exec node src/cli.js
