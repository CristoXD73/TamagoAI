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
