# Apple Tamago Protocol v1

The contract between the Watch (or the iPhone relay) and the Mac gateway.
It is deliberately **small**. The Watch never sees Ollama, OpenAI, or any other
provider format. It only sees the messages below.

Sources of truth that must agree:

| Artifact | Role |
|---|---|
| this document | human spec |
| `Gateway/src/protocol.js` | gateway enums + validation (tested) |
| `Apple/Shared/TamagoProtocolV1.swift` | Swift Codable models (`UNIT_TESTED_ONLY`: decodes every fixture, see `Apple/Shared/Tests/`) |
| `Tests/Fixtures/protocol-v1/` | canonical examples; gateway ones are generated from the live mock and drift-checked in CI |

## 1. Transport

- HTTP/1.1 + JSON (UTF-8). Plain HTTP on the trusted home LAN for V1.
  **TLS is required before any off-LAN/cellular exposure** (not in V1).
- Base URL: `http://tamagoai.local:8787` by default. A LAN-bound gateway
  publishes that mDNS name itself (§14, D-116); a client may be configured with
  another base URL for development.
- Auth: `Authorization: Bearer <token>` on `POST /v1/request`. The token is the
  gateway's persistent identity token (or `TAMAGO_TOKEN` if set), obtained by a
  client through pairing (§14), and stored in the Keychain on Apple devices.
  `GET` endpoints need no auth and reveal nothing sensitive (`gatewayId` is
  public).
- Every JSON response to a request that had a readable `requestId` also carries
  an `X-Request-Id` header with the same value.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/health` | no | liveness |
| `GET` | `/v1/protocol` | no | version negotiation + enum discovery |
| `POST` | `/v1/request` | yes | one user utterance → one answer |
| `POST` | `/v1/pair` | no (pairing code) | exchange a one-time code for the token (§14) |
| `POST` | `/v1/audio` | yes | hold-to-talk: recorded audio, transcribed on the Mac, answered like `/v1/request` (§15) |

## 2. `GET /v1/health`

```json
{ "status": "ok", "protocolVersion": 1, "gatewayVersion": "0.1.0", "uptimeSeconds": 42, "gatewayId": "ea42e280-…" }
```

`gatewayId` is optional (absent on a loopback no-auth dev gateway). A paired
client compares it with the id it paired with, to notice a *different* gateway
answering the same name. This is a correctness check, not authentication.

## 3. `GET /v1/protocol`

See `Tests/Fixtures/protocol-v1/responses/protocol-info.json`. Clients need
only `supportedProtocolVersions` (must contain `1`) and `authRequired`. Other
fields (`gatewayVersion`, `provider`, `gatewayId`, enum lists, `limits`) are for diagnostics.
The client should call this once when the gateway configuration changes, not
before every request.

## 4. Request: `POST /v1/request`

```json
{
  "protocolVersion": 1,
  "requestId": "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c",
  "inputType": "text",
  "text": "Turn Jellyfin back on.",
  "client": { "device": "watch", "route": "direct", "appVersion": "0.1.0" }
}
```

| Field | Type | Required | Rules |
|---|---|---|---|
| `protocolVersion` | integer | yes | must be `1` |
| `requestId` | string | yes | UUID (any version, case-insensitive). The gateway echoes it lowercased. **New ID for every logical request, including user retries.** |
| `inputType` | string | yes | `"text"` only in V1. Voice is transcribed on-device before sending. |
| `text` | string | yes | trimmed; 1–2000 characters |
| `client` | object | no | diagnostics only: `device` (`watch` \| `phone`), `route` (`direct` \| `relay`), `appVersion`. All strings, all optional. |

Body limit: 16 KiB. Unknown top-level fields are **ignored** (forward compatibility).

Validation order: JSON parse → `protocolVersion` → `requestId` → the rest. A
v2 client therefore always gets `unsupported_protocol`, never a field error.

## 5. Response envelope

The same envelope is used for success **and** errors, so the Watch UI always
has something to show, say, and play.

```json
{
  "protocolVersion": 1,
  "requestId": "3f2b8c1e-9a4d-4e7b-8c2a-1d5e6f7a8b9c",
  "status": "ok",
  "text": "Jellyfin is back online.",
  "speechText": "Done. Jellyfin is back online.",
  "characterState": "success",
  "haptic": "success",
  "followUpExpected": false
}
```

| Field | Type | Notes |
|---|---|---|
| `protocolVersion` | integer | `1` |
| `requestId` | string \| null | Echo of the request. `null` **only** on errors raised before a UUID could be read (malformed JSON, auth failure). |
| `status` | enum | `ok` \| `accepted` \| `error` |
| `text` | string | Short display text (≤1000 chars; gateway truncates). Empty only for `accepted` or a nonverbal reaction (§5.1). |
| `speechText` | string | What TTS should say. Defaults to `text`. Empty = say nothing (§5.1). |
| `characterState` | enum | See §6 |
| `haptic` | enum | See §7 |
| `followUpExpected` | boolean | `true` → Watch may go straight back to `listening` after speaking |
| `error` | object | Present **iff** `status == "error"`: `{ code, message, retryable }` |

### 5.1 Nonverbal reactions (clarification, 2026-09-27, D-117)

An `ok` response **may** carry `text: ""` and `speechText: ""`. That means Tamago answers with no
words, only `characterState` + `haptic` (e.g. "Thanks." → a pleased settle and a click). Clients MUST
NOT speak an empty `speechText`. This is backward compatible: the existing Watch client already
skips TTS for an empty `speechText` (`CharacterStateMachine.handle`) and doesn't display `text`.
Fixture: `responses/ok-nonverbal.json`. The mock provider produces one for the input `nonverbal`.

`status` meanings:

- `ok`: final answer.
- `error`: final failure. `error.code` says why (§8).
- `accepted`: **not final.** The request was handed off and work is in
  progress, so keep showing `thinking`. A V1 gateway never sends this over
  HTTP. It exists for the iPhone relay (e.g. a WatchConnectivity reply that
  acknowledges receipt) and for client-local state. See
  `client/thinking-accepted.json`.

`error.message` is for logs and diagnostics. **Never branch on it**; branch on `error.code`.

## 6. Character states

| Value | Driven by | Meaning |
|---|---|---|
| `sleeping` | Watch | deep idle / low-power pose |
| `idle` | Watch **or gateway** | breathing, ready |
| `listening` | Watch | capturing voice |
| `acknowledging` | Watch | "heard you" beat after capture |
| `thinking` | Watch | request in flight |
| `toolRunning` | Watch (future: gateway progress) | a local tool/action is executing |
| `speaking` | Watch | TTS playing |
| `happy` | **gateway** | pleasant/social reaction |
| `success` | **gateway** | a task or tool action completed |
| `confused` | **gateway** / Watch | didn't understand, needs retry |
| `error` | **gateway** / Watch | something failed |
| `disconnected` | Watch | no route to the gateway |

- **Reaction states** a gateway may send: `idle`, `happy`, `success`, `confused`, `error`.
  The gateway rejects provider output with any other state (→ `provider_error`),
  so a misbehaving model can't push `listening` to the Watch.
- Suggested client flow: `thinking` → `speaking` (while TTS plays) →
  `characterState` from the response (brief) → `idle`. The exact transitions
  belong in `docs/DECISIONS.md` (Opus).
- **Unknown values** from a newer gateway: clients MUST decode them as `idle`.

## 7. Haptics

`none` | `click` | `success` | `failure` | `notification` | `retry`

These map directly onto `WKHapticType` (`.click`, `.success`, `.failure`,
`.notification`, `.retry`). `none` plays nothing. Unknown values → `none`.
All error envelopes use `failure`.

## 8. Error codes

| `error.code` | HTTP | retryable | `characterState` | When |
|---|---|---|---|---|
| `invalid_request` | 400 | no | `confused` | malformed JSON or schema violation |
| `unsupported_protocol` | 400 | no | `confused` | `protocolVersion` ≠ 1 |
| `auth_failed` | 401 | no | `error` | missing/wrong bearer token (body is not parsed) |
| `not_found` | 404 | no | `confused` | unknown path |
| `method_not_allowed` | 405 | no | `confused` | wrong HTTP method |
| `payload_too_large` | 413 | no | `confused` | body > 16 KiB |
| `internal_error` | 500 | yes | `error` | gateway bug |
| `provider_error` | 502 | yes | `error` | AI provider failed or returned out-of-contract output |
| `provider_unavailable` | 503 | yes | `error` | local AI engine not running/reachable |
| `timeout` | 504 | yes | `confused` | provider exceeded the gateway timeout (default 20 s) |
| `gateway_unavailable` | — | yes | `disconnected` | **client-synthesized**: couldn't connect to the gateway |
| `disconnected` | — | yes | `disconnected` | **client-synthesized**: no route at all (no Wi-Fi, phone unreachable) |

Clients should also map unexpected transport failures (non-JSON body, TLS
error, unknown HTTP status) to `gateway_unavailable` or `internal_error`
locally, so the UI pipeline only ever handles this envelope. Unknown
`error.code` values should be treated as a generic error (Swift: `.unknown`).

`retryable: true` means a *user-initiated* retry, with a **new** `requestId`,
may succeed. It never means "retry automatically in a loop."

## 9. Request IDs, duplicates, stale responses

- The client generates `requestId`. The gateway echoes it (lowercased).
- **Duplicates:** the gateway remembers the last 256 request IDs for 10
  minutes. A repeat of a known ID returns the **same** response without
  calling the provider again, even while the first is still in flight. This
  makes a direct-vs-relay race harmless. Consequence: retrying with the same
  ID returns the cached (possibly failed) result. Use a new ID to retry.
- **Stale responses (client rule):** the Watch tracks the current request ID
  and **drops any response whose `requestId` doesn't match it**
  (`TamagoResponse.answers(_:)` in Swift). A late answer to request A must never
  overwrite the state of request B.
- Cancellation: V1 has no cancel endpoint. The client cancels its own task and
  ignores the eventual response under the stale rule above.

## 10. Timeouts

- Gateway: provider timeout `TAMAGO_TIMEOUT_MS` (default 20000). Past it the
  gateway answers `timeout` (504) and aborts the provider.
- Client: set the request timeout slightly above the gateway's (e.g. 25 s) so
  the structured 504 usually arrives first. A client-side timeout maps to
  `client/timeout.json`.

## 11. Privacy

The gateway logs request metadata only (request ID, status, error code,
duration). It never logs the user's text or the model's answer. Provider
exception messages are not forwarded to the client (they may contain paths or
hostnames).

## 12. Versioning

- Additive, optional fields may be added within v1. Clients ignore unknown fields.
- New enum values may be added within v1 only where §6–§8 define a fallback.
- Anything else (renames, new required fields, semantics changes) → protocol v2,
  advertised via `supportedProtocolVersions`.

## 13. Explicitly not in v1

Streaming audio or partial responses (a single recorded clip was added later as §15, D-120), polling for `accepted` results,
conversation history or memory, multiple providers chosen by the client, a tool
catalog, server push, cellular or remote access.

## 14. Pairing and discovery (added in D-116; backward compatible)

**Discovery.** A gateway bound to a LAN interface publishes a `_tamagoai._tcp`
Bonjour service (TXT `id=<gatewayId>`, `proto=1`) and the mDNS hostname
`tamagoai.local` → its LAN IPv4. A Watch reaches it with ordinary HTTP to
`http://tamagoai.local:8787`. It doesn't browse Bonjour, which is blocked for
ordinary watchOS apps (Apple TN3135).

**Pairing.** On startup the gateway shows its owner a 6-digit code. The window
is valid 10 minutes, single use, and closes after 5 wrong codes.

```http
POST /v1/pair
{ "pairingCode": "394879", "deviceName": "Apple Watch SE 3 (40mm)" }
```

| Outcome | HTTP | Body |
|---|---|---|
| paired | 200 | `{ "protocolVersion": 1, "gatewayId": "…", "gatewayName": "Mac-mini", "token": "…" }` |
| wrong code | 401 | `{ "protocolVersion": 1, "error": { "code": "pairing_failed", "message": "…" } }` |
| window closed (used, expired, too many failures) | 410 | `error.code = "pairing_closed"` |
| gateway doesn't pair (loopback no-auth dev mode) | 404 | `error.code = "pairing_unavailable"` |

Whitespace in the code is ignored. The gateway never logs the code or the
token. These bodies are pairing-only and are **not** §5 response envelopes.
Security properties and known gaps are in D-116: plain HTTP means the token is
readable on the LAN, and nothing authenticates the gateway to the Watch.

## 15. Audio input (added in D-120; backward compatible)

Hold-to-talk. The Watch records while the owner holds the creature and sends the clip; the Mac transcribes it
**on-device** (Apple SpeechAnalyzer, `Gateway/tools/transcribe`) and then treats the transcript exactly like a
`/v1/request` text request (same provider, dedupe, timeout, envelope).

```
POST /v1/audio
authorization: Bearer <token>
content-type: audio/mp4            (16 kHz mono AAC from the Watch; audio/wav and audio/aiff also accepted)
x-tamago-request-id: <UUID>        (required; the dedupe key, as in §3)
x-tamago-protocol-version: 1       (optional; anything else → unsupported_protocol)
<body: the audio bytes, ≤ LIMITS.maxAudioBytes = 1 MiB>
```

- **Response:** the normal §5 envelope, plus `transcript` (what the Mac heard). Clients that don't know the
  field ignore it (unknown top-level fields are allowed, §5).
- **Nothing heard:** `ok`, nonverbal (§5.1), `characterState: confused`, `haptic: notification`, `transcript: ""`.
- **Errors:** `auth_failed` (401), `invalid_request` (missing/invalid request ID, non-audio content type, empty
  body), `payload_too_large` (413), `provider_unavailable` (503, no transcriber on this Mac: run
  `npm run build:transcriber`), `provider_error` (the audio couldn't be transcribed).
- **Privacy:** the audio exists only in a private temp directory while it's transcribed, then is deleted; neither
  audio nor transcript is logged (the log line has request ID, byte count and timings only).
- **Discovery:** `GET /v1/protocol` lists `inputTypes: ["text", "audio"]` when voice input is available.
