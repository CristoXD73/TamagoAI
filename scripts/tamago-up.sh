#!/usr/bin/env bash
# tamago-up.sh: bring Tamago back after the Mac restarts, with the live view.
#
#   scripts/tamago-up.sh
#
# 1. Checks the Storage disk is mounted (AGENTS.md §9) and stops if it isn't.
# 2. Starts Ollama on 127.0.0.1 with its models on Storage, unless it's running.
# 3. Runs the gateway in THIS terminal for the Watch on the home LAN: brain +
#    Gemma 4 12B or Qwen 3.5 9B (see below), Apple on-device transcription, the owner's Kokoro voice
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
# The brain's model (R1, D-125). Gemma 4 12B understands best, but needs ~7.6 GB: with Xcode or the
# simulators open, this 16 GB Mac swaps, so the lighter Qwen 3.5 9B (~5.5 GB) takes over. Set OLLAMA_MODEL to force one.
if [[ -z "${OLLAMA_MODEL:-}" ]]; then
  if pgrep -xq Xcode || pgrep -xq Simulator || xcrun simctl list devices booted 2>/dev/null | grep -q Booted; then
    OLLAMA_MODEL=qwen3.5:9b
    echo "tamago-up: Xcode or the Simulator is open, so the brain uses $OLLAMA_MODEL (lighter)."
  else
    OLLAMA_MODEL=gemma4:12b-it-qat
    echo "tamago-up: the brain uses $OLLAMA_MODEL."
  fi
fi
export OLLAMA_MODEL
export TAMAGO_TTS="${TAMAGO_TTS:-kokoro}"
export TAMAGO_TTS_VOICE="${TAMAGO_TTS_VOICE:-af_heart}"
export TAMAGO_TTS_SPEED="${TAMAGO_TTS_SPEED:-0.9}"
export TAMAGO_TTS_MODEL_DIR="${TAMAGO_TTS_MODEL_DIR:-$STORAGE/AI/tts}"
export TAMAGO_MONITOR="${TAMAGO_MONITOR:-1}"
# Hands commands can take a few model turns (D-128): allow 45 s instead of 20.
export TAMAGO_TIMEOUT_MS="${TAMAGO_TIMEOUT_MS:-45000}"

cd "$REPO/Gateway"
exec node src/cli.js
