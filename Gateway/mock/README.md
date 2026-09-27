# Mock provider commands

The mock provider (`src/providers/mock.js`) is deterministic: same input, same output.
Send these as the `text` field of a `POST /v1/request`.

| Input (case-insensitive) | Result |
|---|---|
| `ping` | `ok`, text `pong`, state `idle`, haptic `click` |
| `state idle` / `happy` / `success` / `confused` | `ok`, `characterState` set to that value |
| `state error` | `error`, code `provider_error` (HTTP 502) |
| `state <anything else>` | `ok`, state `confused` |
| `tool <name>` | `ok`, state `success`, simulated tool run (e.g. `tool jellyfin`) |
| `nonverbal` | `ok`, empty `text`/`speechText`, state `happy`, haptic `click` (nonverbal reaction, PROTOCOL_V1 §5.1) |
| `follow up` | `ok`, `followUpExpected: true` |
| `slow <ms>` | waits `<ms>`, then `done`; exceeds the timeout to get `timeout` (HTTP 504) |
| `unavailable` | `error`, code `provider_unavailable` (HTTP 503) |
| `throw` | `error`, code `provider_error`; the raw exception message is NOT leaked |
| anything else | `ok`, echo `You said: <text>` |

Quick manual check:

```sh
cd Gateway
TAMAGO_ALLOW_NO_AUTH=1 npm start          # loopback only
../scripts/smoke.sh                        # in another terminal
```
