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
- Future privileged tools (e.g. restarting services) need their own
  authorization design. The mock `tool` command only *simulates* this.
