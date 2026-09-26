# Agent Rules — Apple Tamago

These rules bind **every** agent working in this repository (Claude Code Cloud,
Claude Opus / Sonnet in Xcode, Codex, and anyone else). `CLAUDE.md` points here.

Apple Tamago (formerly "TamaWatch") is a Tamagotchi-style companion for Apple Watch.
The Watch is the **face**; the owner's Mac mini is the **brain**. Read
`docs/MASTER_BRIEF.md` first, then the latest entry in `docs/HANDOFF_LOG.md`.

## 1. Stay in your lane

- **Do not try to finish the whole product.** Do your assigned stage only
  (see `docs/MASTER_BRIEF.md` §Roles and the role handoffs in
  `docs/handoff/TamaWatch_COMPLETE_HANDOFF.md`). Stop at your stop condition.
- Keep existing working code. Don't rewrite or "clean up" code outside your
  task without evidence that it's broken.
- Make small, bounded changes and small PRs. One concern per PR.
- Architecture decisions live in `docs/DECISIONS.md`. Don't quietly override
  them; propose a change there with a reason.
- Don't change the wire protocol without updating **all** of:
  `docs/PROTOCOL_V1.md`, `Gateway/src/protocol.js`,
  `Apple/Shared/TamagoProtocolV1.swift`, and the fixtures (`cd Gateway && npm run fixtures`).

## 2. Hard prohibitions (no exceptions)

- **Never commit secrets**: tokens, API keys, certificates, provisioning
  profiles, signing identities, personal IPs/hostnames. Config comes from
  environment variables or the Keychain. `.env.example` has placeholders only.
- **Never use private Apple APIs** or undocumented entitlements.
- **Never fake background execution**: no dummy workout sessions, silent audio,
  location updates, or other background modes used to keep the app alive.
- **Never try to bypass the Apple Watch passcode.**
- **Never spoof wrist detection.**
- **Never expose the Mac gateway or Ollama to the public internet.** LAN only
  until a reviewed TLS + auth remote design exists.
- **Never add cloud AI provider credentials.** This project is local-AI-first.
- **Never ship third-party artwork** (including WatchPet/Codex pet sprites)
  unless its license clearly permits redistribution. Use original art.

## 3. Be honest about verification

Label every claim about behavior with exactly one of:

| Label | Meaning |
|---|---|
| `DEVICE_VERIFIED` | A human observed it on the physical Apple Watch / iPhone, and the evidence is recorded in `docs/DEVICE_TEST_LOG.md`. |
| `SIMULATOR_VERIFIED_ONLY` | Built and observed in the Xcode simulator. Not seen on hardware. |
| `UNIT_TESTED_ONLY` | Covered by automated tests that passed. No UI or device observation. |
| `UNVERIFIED` | Written but not tested, including code that was never compiled. |
| `UNVERIFIED_LOCAL_PROVIDER` | Gateway AI adapter not yet run against the real local engine. |

- "I wrote the code" is **not** "the feature works".
- Do not claim Xcode builds, simulator runs, WatchConnectivity, Always-On /
  reduced-luminance behavior, complication updates, or anything on hardware
  unless it actually happened and was recorded.
- **Physical Watch behavior overrides assumptions**, docs, and upstream code.
  If the device disagrees with `docs/DECISIONS.md`, the device wins and the
  decision gets updated.
- Don't create CI that pretends to test Apple targets. CI runs only what it
  genuinely can (currently: the Node gateway).

## 4. Upstream code

- Upstream projects (WatchPet, Q007) are **references**, not dependencies. Don't
  vendor whole repositories.
- Any copied or adapted file must carry a header with the source repo, file,
  commit, license, and a summary of changes, **and** be listed in
  `THIRD_PARTY_NOTICES.md` and `docs/UPSTREAM_REUSE.md`.
- Current Apple SDK behavior beats upstream code. Don't paste stale APIs
  without compiling them.

## 5. Engineering defaults

- Swift: async/await, `@MainActor` for UI state, actors only where shared
  mutable state warrants it, explicit Task cancellation, typed errors, no force
  unwraps in network paths.
- One canonical character state machine. No scattered lifecycle booleans.
- Every async request carries a `requestId`. **A late response for an old
  request must never overwrite the state of a newer one.**
- No hidden high-rate timers, no tight retry loops, and no animation work that
  continues after its view disappears. Battery is a product constraint.
- Keep model/network code separate from animation/rendering code.

## 6. Hand off properly

After any meaningful work, append an entry to `docs/HANDOFF_LOG.md` using the
template at the top of that file: branch, commit, files, upstream reuse, exact
commands run, what passed and failed, verification labels, what's untested,
and **one** bounded next task. Record physical-device observations in
`docs/DEVICE_TEST_LOG.md`.

The human owner makes product decisions, approves signing, performs physical
testing, and approves merges. Ask them only for things that are really theirs
to decide.
