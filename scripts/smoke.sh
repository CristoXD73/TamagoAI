#!/usr/bin/env bash
# Manual smoke test against a running gateway.
#   TAMAGO_URL   default http://127.0.0.1:8787
#   TAMAGO_TOKEN bearer token (omit if the gateway runs with TAMAGO_ALLOW_NO_AUTH=1)
set -euo pipefail
URL="${TAMAGO_URL:-http://127.0.0.1:8787}"
AUTH=()
if [[ -n "${TAMAGO_TOKEN:-}" ]]; then AUTH=(-H "Authorization: Bearer ${TAMAGO_TOKEN}"); fi

uuid() { python3 -c 'import uuid; print(uuid.uuid4())' 2>/dev/null || uuidgen | tr 'A-Z' 'a-z'; }

echo "== GET /v1/health";   curl -sS "$URL/v1/health"; echo
echo "== GET /v1/protocol"; curl -sS "$URL/v1/protocol" | head -c 200; echo " ..."
for text in "ping" "state happy" "tool jellyfin" "state error"; do
  echo "== POST /v1/request: $text"
  curl -sS -w "  [HTTP %{http_code}]\n" "${AUTH[@]}" -H 'content-type: application/json' \
    -d "{\"protocolVersion\":1,\"requestId\":\"$(uuid)\",\"inputType\":\"text\",\"text\":\"$text\"}" \
    "$URL/v1/request"
done
