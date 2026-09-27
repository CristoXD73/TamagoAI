#!/usr/bin/env bash
# setup.sh: installs Tamago's local voice engine on the owner's Mac (D-121).
#
# VERIFICATION: UNVERIFIED. Written in the cloud, where GitHub release downloads
# are blocked, so it has never downloaded anything. Asset names follow the
# sherpa-onnx release conventions cited in docs/VOICE_RESEARCH.md [3][4][6];
# if a URL 404s, the script stops and says which one.
#
# What it installs, into $TAMAGO_TTS_MODEL_DIR (default /Volumes/Storage/AI/tts,
# AGENTS.md §9; never inside the repo):
#   sherpa-onnx/                          sherpa-onnx prebuilt macOS runtime (Apache-2.0)
#   models/kokoro-multi-lang-v1_0/        Kokoro-82M v1.0 (Apache-2.0 weights)      [primary]
#   models/kitten-nano-en-v0_1-fp16/      KittenTTS nano (Apache-2.0)               [--kitten]
#   checksums.sha256                      trust-on-first-use SHA-256 of every download
#
# Local only: nothing is sent anywhere; no accounts, no API keys. Each download's
# URL, size and license is printed, and you're asked before it starts.
#
# Usage:
#   tools/tts/setup.sh                 runtime + Kokoro (asks before each download)
#   tools/tts/setup.sh --kitten        also the lighter KittenTTS fallback
#   tools/tts/setup.sh --yes           don't ask (still prints everything)
#   tools/tts/setup.sh --selftest      only check an existing install and time one clip
# Pin a runtime version with TAMAGO_SHERPA_VERSION=1.x.y (default: latest release, recorded in checksums.sha256).

set -euo pipefail

ROOT="${TAMAGO_TTS_MODEL_DIR:-/Volumes/Storage/AI/tts}"
HERE="$(cd "$(dirname "$0")" && pwd)"
HELPER="$HERE/tamago-tts"
RELEASES="https://github.com/k2-fsa/sherpa-onnx/releases/download"
WANT_KITTEN=0 ASSUME_YES=0 SELFTEST_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --kitten) WANT_KITTEN=1 ;;
    --yes) ASSUME_YES=1 ;;
    --selftest) SELFTEST_ONLY=1 ;;
    -h|--help) sed -n '2,26p' "$0"; exit 0 ;;
    *) echo "setup.sh: unknown option $arg" >&2; exit 2 ;;
  esac
done

die() { echo "setup.sh: $*" >&2; exit 1; }

[[ "$(uname -s)" == "Darwin" ]] || die "this installs the macOS engine; run it on the Mac."

# AGENTS.md §9: large files live on the Storage disk. Refuse rather than fill the internal disk.
if [[ -z "${TAMAGO_TTS_MODEL_DIR:-}" && ! -d /Volumes/Storage ]]; then
  die "/Volumes/Storage is not mounted. Mount it, or set TAMAGO_TTS_MODEL_DIR to another external location."
fi
parent="$(dirname "$ROOT")"
[[ -d "$parent" ]] || mkdir -p "$parent" || die "can't create $parent"
mkdir -p "$ROOT/models"
LOCK="$ROOT/checksums.sha256"
touch "$LOCK"

confirm() {
  (( ASSUME_YES )) && return 0
  local reply
  read -r -p "$1 [y/N] " reply
  [[ "$reply" == [yY] || "$reply" == [yY][eE][sS] ]]
}

human_size() {
  local url="$1" bytes
  bytes="$(curl -fsSIL "$url" | awk 'tolower($1)=="content-length:" {v=$2} END {gsub("\r","",v); print v}')" || true
  if [[ "$bytes" =~ ^[0-9]+$ && "$bytes" -gt 0 ]]; then
    awk -v b="$bytes" 'BEGIN { printf "%.1f MB", b/1048576 }'
  else
    echo "unknown size"
  fi
}

# download <name> <url> <license> <dest-dir-for-extraction>
download() {
  local name="$1" url="$2" license="$3" dest="$4"
  local file="$ROOT/.downloads/$(basename "$url")"
  mkdir -p "$ROOT/.downloads"
  echo
  echo "── $name"
  echo "   URL:     $url"
  echo "   Size:    $(human_size "$url")"
  echo "   License: $license"
  echo "   Into:    $dest"
  confirm "   Download it?" || { echo "   skipped."; return 1; }
  curl -fL --retry 3 --progress-bar -o "$file.part" "$url" || die "download failed: $url"
  mv "$file.part" "$file"
  local sum recorded
  sum="$(shasum -a 256 "$file" | awk '{print $1}')"
  recorded="$(awk -v f="$(basename "$url")" '$2==f {print $1}' "$LOCK")"
  if [[ -n "$recorded" && "$recorded" != "$sum" ]]; then
    rm -f "$file"
    die "checksum mismatch for $(basename "$url") (recorded $recorded, got $sum). Not installing."
  fi
  if [[ -z "$recorded" ]]; then
    echo "$sum  $(basename "$url")" >> "$LOCK"
    echo "   SHA-256: $sum (recorded, first use)"
  else
    echo "   SHA-256: $sum (matches record)"
  fi
  mkdir -p "$dest"
  tar -xjf "$file" -C "$dest"
  rm -f "$file"
  return 0
}

selftest() {
  echo
  echo "── Self-test"
  local engine voice
  for engine in kokoro kitten; do
    case "$engine" in kokoro) voice=af_heart ;; kitten) voice=expr-voice-4-f ;; esac
    if ! TAMAGO_TTS_MODEL_DIR="$ROOT" "$HELPER" --engine "$engine" --voice "$voice" --check 2>/dev/null; then
      echo "   $engine: not installed"
      continue
    fi
    local tmp start end bytes
    tmp="$(mktemp -d)"
    printf 'Hi. I am here.' > "$tmp/t.txt"
    start="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
    if TAMAGO_TTS_MODEL_DIR="$ROOT" "$HELPER" --engine "$engine" --voice "$voice" --speed 1 --text-file "$tmp/t.txt" --out "$tmp/t.m4a"; then
      end="$(perl -MTime::HiRes=time -e 'printf "%.3f", time')"
      bytes="$(wc -c < "$tmp/t.m4a" | tr -d ' ')"
      echo "   $engine ($voice): OK, $bytes bytes in $(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.2f", b-a}') s (cold start)"
    else
      echo "   $engine ($voice): FAILED (see the message above)"
    fi
    rm -rf "$tmp"
  done
}

if (( SELFTEST_ONLY )); then selftest; exit 0; fi

echo "Tamago voice setup → $ROOT"
echo "Local only. Everything below comes from the sherpa-onnx GitHub releases."

# ---- runtime
if [[ -x "$ROOT/sherpa-onnx/bin/sherpa-onnx-offline-tts" ]]; then
  echo
  echo "── sherpa-onnx runtime: already installed ($(cat "$ROOT/sherpa-onnx/VERSION" 2>/dev/null || echo "version unknown"))"
else
  version="${TAMAGO_SHERPA_VERSION:-}"
  if [[ -z "$version" ]]; then
    version="$(curl -fsSL https://api.github.com/repos/k2-fsa/sherpa-onnx/releases/latest | sed -n 's/.*"tag_name": *"v\{0,1\}\([^"]*\)".*/\1/p' | head -1)"
    [[ -n "$version" ]] || die "couldn't look up the latest sherpa-onnx release; set TAMAGO_SHERPA_VERSION=1.x.y"
  fi
  asset="sherpa-onnx-v${version}-osx-universal2-shared"
  staging="$ROOT/.staging"
  rm -rf "$staging"
  if download "sherpa-onnx v$version (runtime, macOS universal2)" "$RELEASES/v${version}/${asset}.tar.bz2" \
      "Apache-2.0 (bundles espeak-ng data, GPL-3.0; used locally, not redistributed: docs/VOICE_RESEARCH.md §4)" "$staging"; then
    rm -rf "$ROOT/sherpa-onnx"
    mv "$staging/$asset" "$ROOT/sherpa-onnx"
    rm -rf "$staging"
    echo "$version" > "$ROOT/sherpa-onnx/VERSION"
    xattr -dr com.apple.quarantine "$ROOT/sherpa-onnx" 2>/dev/null || true
    [[ -x "$ROOT/sherpa-onnx/bin/sherpa-onnx-offline-tts" ]] || die "runtime unpacked but bin/sherpa-onnx-offline-tts is missing; check the archive layout."
  else
    die "the runtime is required."
  fi
fi

# ---- models
install_model() {
  local dir="$1" title="$2" license="$3"
  if [[ -d "$ROOT/models/$dir" ]]; then
    echo
    echo "── $title: already installed"
    return 0
  fi
  download "$title" "$RELEASES/tts-models/${dir}.tar.bz2" "$license" "$ROOT/models" || true
}
install_model kokoro-multi-lang-v1_0 "Kokoro-82M v1.0 (primary voice model)" "Apache-2.0 (weights and code)"
if (( WANT_KITTEN )); then install_model kitten-nano-en-v0_1-fp16 "KittenTTS nano (lighter fallback)" "Apache-2.0"; fi

rm -rf "$ROOT/.downloads"
selftest

cat <<EOF

Done. To use it:
  export TAMAGO_TTS=kokoro TAMAGO_TTS_MODEL_DIR="$ROOT"
  npm start                               # the Watch now gets the Mac's voice (PROTOCOL_V1 §16)
  node scripts/voice-samples.js           # clips for every candidate voice + a listening page
Checksums recorded in $LOCK.
EOF
