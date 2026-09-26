# Apple Tamago: Master Brief

> Condensed from the original handoff pack (`handoff/TamaWatch_COMPLETE_HANDOFF.md`,
> where the project is called "TamaWatch"). If this file and the pack disagree
> on product intent, the pack wins. If either disagrees with the physical
> Watch, the Watch wins.

## Goal

A premium Tamagotchi-style AI companion for Apple Watch. It should feel like a
small living character, **not a tiny chat app**. The character is the interface;
text is secondary.

- **Watch = face:** rendering, state machine, touch, Digital Crown, mic, TTS,
  haptics, complication, transport selection, cached config.
- **Mac mini = brain:** local AI, optional STT/TTS, tools/actions, auth,
  logging, provider selection, timeouts. It may later integrate systems such as ÖccultKVM.
- The Watch never contains the primary LLM, provider credentials, model
  selection, or agent loops.

## Hardware

- Test Watch: **Apple Watch SE 3, 40 mm, GPS (no cellular), 64 GB, watchOS 27.0.**
  Always-On / reduced-luminance behavior must be **observed** on this exact device, not assumed.
- Possible later: a dedicated second Watch (maybe GPS + Cellular) carried
  strapless like a pocket charm.
- Apple-silicon Mac mini with Xcode, a paired iPhone, and an Apple Developer account.

## Interaction loop

```text
idle → (tap) listening → acknowledging → thinking → [Mac: AI + optional tools]
     → speaking (TTS) → reaction (happy/success/confused/error) + haptic → idle
```

## Presence surfaces (only what watchOS legitimately allows)

1. **Full active app:** smooth animation and full interaction.
2. **Frontmost but inactive / reduced luminance:** settle into a low-power
   pose; no high-FPS assumptions; resume on return.
3. **WidgetKit complication:** glanceable state snapshot and one-tap launch.
   No fake continuous animation.

No private APIs, no fake background modes, no passcode bypass, no wrist spoofing.

## Connectivity

```text
Watch ─ TransportRouter ─┬─ DirectTransport (Wi-Fi → Mac gateway)     V1
                         ├─ PhoneRelayTransport (WatchConnectivity)   V1
                         └─ RemoteTransport (cellular, TLS)           later
```

## Roles and order

| Phase | Actor | Deliverable |
|---|---|---|
| 1 | **Claude Code Cloud** | repo, docs, protocol v1, mock gateway, fixtures, upstream analysis. **Done; see HANDOFF_LOG.** |
| 2 | Human | `docs/LOCAL_ENVIRONMENT.md` (Xcode/Swift/OS versions, device visibility) |
| 3 | Claude Opus (Xcode) | `docs/DECISIONS.md`: targets, renderer, state machine, lifecycle, complication, voice, TTS, transport, WC, security |
| 4 | Claude Sonnet (Xcode) | Stage A: animated character + debug states on the **physical** Watch |
| 5 | Codex | BUILD_REVIEW |
| 6–7 | Sonnet | complication; voice loop with fake answer (no network) |
| 8 | Cloud | gateway hardening aligned to real Swift models |
| 9–10 | Sonnet | direct transport, then iPhone companion + relay |
| 11 | Codex | TRANSPORT_AUDIT |
| 12–14 | Opus reserve / Sonnet polish / cellular readiness | |

## First milestone that matters

On the real Watch: launch → animated character fills the screen → state
switching → acceptable active/inactive behavior → complication → voice →
one request to the Mac → one structured answer → character reacts and speaks
→ repeatable without getting stuck.

## Not V1

App Store, final art, many providers, cellular deployment, cloud hosting,
camera/health, a big memory system, dozens of tools, custom watch faces,
on-Watch agent frameworks.
