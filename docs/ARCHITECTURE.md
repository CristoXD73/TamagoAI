# Architecture

Status: Phase 1. Only the **gateway** exists and is tested. Everything on the
Apple side is a plan for the Xcode agents; Opus confirms or changes it in
`DECISIONS.md`.

## System

```text
┌──────────── Apple Watch ────────────┐          ┌──────── Mac mini (home LAN) ────────┐
│ CharacterView ◀── CharacterStateMachine │          │ Gateway (Node, Gateway/)            │
│      ▲                 ▲             │          │  GET  /v1/health                    │
│ SpriteAnimationClock   │ responses   │  HTTP    │  GET  /v1/protocol                  │
│                  InteractionController├─────────▶│  POST /v1/request ─▶ AIProvider     │
│  voice in ─┘   TTS out   haptics     │ protocol │        (auth, validation, timeout,  │
│                  TransportRouter     │   v1     │         dedupe, structured errors)  │
│                   ├ DirectTransport ─┘          │            ├ MockProvider (tests)   │
│                   └ PhoneRelayTransport ─┐      │            └ OllamaProvider (unverified)
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
- `src/config.js` + `src/cli.js`: env config. Refuses to start without a token
  unless `TAMAGO_ALLOW_NO_AUTH=1` on loopback. Warns when binding all interfaces.
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
- **Replay protection:** the gateway's requestId dedupe (`server.js`, 256
  entries / 10 min) already means a replayed request is answered once, not
  re-run against the provider — but nothing currently rejects a replayed
  request outright (dedupe still returns 200, just the cached result), and
  there is no timestamp/nonce freshness check. Acceptable for a
  loopback/trusted-LAN, single-user tool; would need revisiting before any
  design that isn't "one owner's Mac, one owner's Watch."
- **Accidental discovery by unrelated devices:** not a concern for loopback
  (the current, only-verified path). If a future LAN deployment adds
  discovery (task's Bonjour/mDNS ask, not built this pass — see D-115), the
  service should advertise/respond in a way that doesn't invite other devices
  on the same network to find and probe it; bearer-token auth already means
  discovery alone can't reach `/v1/request`, but `/v1/health` and
  `/v1/protocol` are currently unauthenticated by design (D-115 leans on this
  for the reachability monitor) and disclose gateway version/provider —
  low-sensitivity, but worth remembering if the trust boundary ever changes.
