# Apple Tamago Protocol v1

The contract between the Watch (or the iPhone relay) and the Mac gateway.
It is deliberately **small**. The Watch never sees Ollama, OpenAI, or any other
provider format. It only sees the messages below.

Sources of truth that must agree:

| Artifact | Role |
|---|---|
| this document | human spec |
| `Gateway/src/protocol.js` | gateway enums + validation (tested) |
| `Apple/Shared/TamagoProtocolV1.swift` | Swift Codable models (**not compiled yet**) |
| `Tests/Fixtures/protocol-v1/` | canonical examples; gateway ones are generated from the live mock and drift-checked in CI |

## 1. Transport

- HTTP/1.1 + JSON (UTF-8). Plain HTTP on the trusted home LAN for V1.
  **TLS is required before any off-LAN/cellular exposure** (not in V1).
- Base URL is configured on the client, e.g. `http://mac-mini.local:8787`.
- Auth: `Authorization: Bearer <token>` on `POST /v1/request`. The token comes
  from the gateway's `TAMAGO_TOKEN` environment variable and is stored in the
  Keychain on Apple devices. `GET` endpoints need no auth and reveal nothing
  sensitive.
- Every JSON response to a request that had a readable `requestId` also carries
  an `X-Request-Id` header with the same value.

| Method | Path | Auth | Purpose |
|---|---|---|---|
| `GET` | `/v1/health` | no | liveness |
| `GET` | `/v1/protocol` | no | version negotiation + enum discovery |
| `POST` | `/v1/request` | yes | one user utterance → one answer |

## 2. `GET /v1/health`

```json
{ "status": "ok", "protocolVersion": 1, "gatewayVersion": "0.1.0", "uptimeSeconds": 42 }
```

## 3. `GET /v1/protocol`

See `Tests/Fixtures/protocol-v1/responses/protocol-info.json`. Clients need
only `supportedProtocolVersions` (must contain `1`) and `authRequired`. Other
fields (`gatewayVersion`, `provider`, enum lists, `limits`) are for diagnostics.
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
| `text` | string | Short display text (≤1000 chars; gateway truncates). Empty only for `accepted`. |
| `speechText` | string | What TTS should say. Defaults to `text`. |
| `characterState` | enum | See §6 |
| `haptic` | enum | See §7 |
| `followUpExpected` | boolean | `true` → Watch may go straight back to `listening` after speaking |
| `error` | object | Present **iff** `status == "error"`: `{ code, message, retryable }` |

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

Audio upload, streaming or partial responses, polling for `accepted` results,
conversation history or memory, multiple providers chosen by the client, a tool
catalog, server push, cellular or remote access.
