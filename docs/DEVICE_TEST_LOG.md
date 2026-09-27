# Device Test Log

**Only a human with the physical device writes `DEVICE_VERIFIED` here.** Agents
may prepare the checklist and fill it in only from the human's reported
observations, quoting them.

Device under test (update if it changes):

| Field | Value |
|---|---|
| Watch | Apple Watch SE 3, 40 mm, GPS, 64 GB |
| watchOS | 27.0 (at project start; record the exact build per session) |
| iPhone | _fill in_ |
| Always-On available on this model/settings? | **UNKNOWN; observe and record** |
| Return to Clock setting | _fill in_ |

## Entry template

```text
### YYYY-MM-DD: <what was tested>
Build/commit:        <hash>
watchOS / iOS build: <exact>
Tester:              <name>
Settings:            wrist detection, Always-On, Return to Clock, Wi-Fi/iPhone nearby
Steps:               1. ... 2. ...
Observed:            <exact behavior, timings, screenshots/video paths>
Expected:            <from DECISIONS/ACCEPTANCE_TESTS>
Result:              DEVICE_VERIFIED | FAILED | PARTIAL
Follow-up:           <issue or next step>
```

## Entries

_None yet. No build has run on a physical device (as of Phase 1, 2026-09-26)._

## 2026-09-27 01:10–01:16 EDT — first physical Watch run (TestFlight build 0.1.0 (2))

Observed by the owner, relayed to Claude Code. Apple Watch SE 3 40 mm (GPS), watchOS 27.0 (24R364); iPhone 16 Pro Max, iOS 27.0.
Mac gateway: LAN mode, `TAMAGO_PROVIDER=brain` with `llama3.2:3b`, advertising `tamagoai.local` → 192.168.0.74.

| Step | Result |
|---|---|
| Install via TestFlight (iPhone), Watch app | Installed; octopus icon correct in TestFlight |
| App launch on the Watch | Creature shows and floats (placeholder art) |
| Pairing sheet on first launch | Shown |
| Pair with code, iPhone Bluetooth on | **Failed**: "Couldn't find your Mac on this network." No request in the gateway log |
| Pair with code, iPhone Bluetooth off (Settings) | **Failed**: same message, no request in the gateway log |
| iPhone Safari → `http://tamagoai.local:8787/v1/health` and `http://192.168.0.74:8787/v1/health` | Both OK |

Conclusion so far: the LAN and mDNS work for Wi-Fi clients; the Watch app's request never reaches the Mac.
Next: build 3 shows the exact failure reason and allows typing the Mac's address.
