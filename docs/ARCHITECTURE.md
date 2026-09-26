# Architecture

Status (2026-09-26): the gateway, the Watch app's character/state machine, the
Watch's direct HTTP transport, pairing and `tamagoai.local` discovery exist and
are tested (D-114–D-116). The iPhone relay/configuration companion in the
diagram is still **planned, not built**. Nothing has run on a physical Watch.
`DECISIONS.md` is authoritative.

## System

```text
┌──────────── Apple Watch ────────────┐          ┌──────── Mac mini (home LAN) ────────┐
│ CharacterView ◀── CharacterStateMachine │          │ Gateway (Node, Gateway/)            │
│      ▲                 ▲             │          │  GET  /v1/health                    │
│ SpriteAnimationClock   │ responses   │  HTTP    │  GET  /v1/protocol                  │
│                  InteractionController├─────────▶│  POST /v1/request ─▶ AIProvider     │
│  voice in ─┘   TTS out   haptics     │ protocol │        (auth, validation, timeout,  │
│  TamagoConnection → GatewayClient    │   v1     │         dedupe, structured errors)  │
│  (direct HTTP: tamagoai.local)       │          │  POST /v1/pair (pairing code)       │
│  [PhoneRelayTransport: planned] ─┐   │          │   ├ MockProvider (tests) / Ollama   │
│ Complication (WidgetKit snapshot)        │      │                  ▼                  │
└──────────────────────────────────────────┘      │            local tools (later)      │
                     WatchConnectivity ▼          └─────────────────────────────────────┘
               ┌──── iPhone companion ────┐                ▲
               │ config UI, Keychain token │── HTTP v1 ────┘
               │ RelayService              │
               └───────────────────────────┘
```

## Boundaries

| Concern | Lives in | Never in |
|---|---|---|
| Provider formats (Ollama, …) | `Gateway/src/providers/*` | Watch, iPhone |
| Enum vocabulary | `protocol.js` ⇄ `TamagoProtocolV1.swift` ⇄ `PROTOCOL_V1.md` | ad-hoc strings |
| Rendering timing | `SpriteAnimationClock` (pure) | network code |
| Stale-response protection | Watch state machine (`requestId` match) + gateway dedupe | UI views |
| Secrets | gateway env var; Keychain on devices | Git, UserDefaults, logs |

## Gateway internals (implemented, `UNIT_TESTED_ONLY`)

- `src/protocol.js`: enums, request validation, response builders, envelope validator.
- `src/server.js`: `node:http` server. Bearer auth (constant-time), 16 KiB body
  limit, JSON parse, version check, provider call with `AbortController`
  timeout, requestId dedupe (256 entries / 10 min), metadata-only logs,
  `X-Request-Id` header.
- `src/providers/`: `mock.js` (deterministic), `ollama.js`
  (`UNVERIFIED_LOCAL_PROVIDER`), `provider.js` (contract + `ProviderError`).
- `src/config.js` + `src/cli.js`: env config. Without `TAMAGO_TOKEN`, uses the
  persistent identity token (`src/identity.js`: `gatewayId` + random 256-bit
  token in `~/Library/Application Support/TamagoAI/gateway.json`, 0600/0700).
  `TAMAGO_ALLOW_NO_AUTH=1` is loopback-only and has no identity or pairing.
  Warns when binding all interfaces.
- `src/pairing.js`: the 6-digit, 10-minute, single-use, 5-attempt pairing window
  behind `POST /v1/pair` (PROTOCOL_V1 §14).
- `src/advertise.js`: publishes `_tamagoai._tcp` and `tamagoai.local` via
  `/usr/bin/dns-sd -P` on a LAN bind; re-publishes if the Mac's IP changes.
- Zero npm dependencies. Node ≥22.

## Security posture (V1)

- LAN only. Bind `127.0.0.1` for the simulator and the LAN interface for a
  physical Watch. **No port forwarding, no tunnels.**
- Token auth on the request endpoint. HTTP (not TLS) on the LAN in V1 is an accepted,
  documented risk. TLS plus a reviewed remote design is required before cellular.
- watchOS App Transport Security will need an exception or local-networking
  configuration for plain HTTP to a LAN host. **Opus must decide this against the
  watchOS 27 SDK.** Don't guess.
  - **Resolved (D-115):** `Apple/WatchApp/Info.plist` already declares
    `NSAppTransportSecurity` → `NSAllowsLocalNetworking: true`, which exempts
    RFC 1918/loopback/`.local` addresses from ATS's TLS requirement — this is
    the correct, documented Apple mechanism for exactly this case, not a
    workaround. Confirmed empirically this session: plain `http://127.0.0.1`
    requests from `GatewayClient` succeeded from the watchOS 27 simulator with
    no further Info.plist change. A physical Watch talking to a real LAN
    address (not loopback) is still **UNVERIFIED** — loopback and LAN both
    fall under `NSAllowsLocalNetworking`, but only loopback has actually been
    exercised.
- Future privileged tools (e.g. restarting services) need their own
  authorization design. The mock `tool` command only *simulates* this.
- **Pairing (D-116):** a Watch gets the token only by entering the code the
  gateway shows its owner; the token is then kept in the Watch Keychain (D-109).
  Unpaired LAN devices get 401 on `/v1/request` (verified live). What this does
  **not** protect against is listed in D-116: plain-HTTP sniffing and
  impersonation of `tamagoai.local`, and there's no rotation or per-device revocation.
- **Replay protection:** the gateway's requestId dedupe (`server.js`, 256
  entries / 10 min) already means a replayed request is answered once, not
  re-run against the provider — but nothing currently rejects a replayed
  request outright (dedupe still returns 200, just the cached result), and
  there is no timestamp/nonce freshness check. Acceptable for a
  loopback/trusted-LAN, single-user tool; would need revisiting before any
  design that isn't "one owner's Mac, one owner's Watch."
- **Discovery by unrelated devices:** the LAN-mode gateway *does* advertise
  itself now (D-116), so anything on the network can find it. Discovery alone
  can't reach `/v1/request` (token required). `/v1/health` and `/v1/protocol`
  stay unauthenticated by design, since the Watch probes them. They disclose
  gateway version, provider name and the public `gatewayId`. Loopback dev mode
  doesn't advertise.
