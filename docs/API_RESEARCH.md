# iAquaLink cloud API research

Research date: 2026-07-26. This is an implementation note for an unofficial,
undocumented cloud API. It records protocol shape but deliberately contains no
real account identifiers, system serials, credentials, tokens, cookies, or raw
private responses.

## Sources and scope

- Home Assistant's current
  [`iaqualink` integration](https://github.com/home-assistant/core/tree/dev/homeassistant/components/iaqualink)
  uses `iaqualink==0.7.0`, identifies itself as cloud polling, and polls `iaqua`
  systems every 15 seconds.
- Current
  [`iaqualink-py`](https://github.com/flz/iaqualink-py/tree/master/src/iaqualink)
  is the behavioral reference. The relevant paths are `client.py`,
  `systems/iaqua/system.py`, `systems/iaqua/device.py`, and
  `utils/crypto.py`.
- Milestone 1 supports one legacy `iaqua` system (the RS4 Combo test system),
  discovery, and polling. It does not send controls.

This API is private and can change without notice. The constants below are
public application identifiers embedded in the upstream open-source client;
they are not user credentials.

## Endpoints and headers

| Purpose | Method and endpoint | Authentication |
| --- | --- | --- |
| Login | `POST https://prod.zodiac-io.com/users/v1/login` | JSON body: public `api_key`, email, password |
| Refresh | `POST https://prod.zodiac-io.com/users/v1/refresh` | JSON body: email and refresh token; no API key |
| Account systems | `GET https://r-api.iaqualink.net/v2/devices.json` | Public `api_key` header, bearer ID token, signed query |
| iAqua session | `GET https://p-api.iaqualink.net/v2/mobile/session.json` | Public `api_key` header, bearer ID token, system/session query |

All requests use `Content-Type: application/json` and the reference Android
client user agent `okhttp/3.14.7`. Authenticated requests add `api_key` and
`Authorization: Bearer …`.

System discovery has `user_id`, Unix `timestamp`, and `signature` query
parameters. The signature is lowercase HMAC-SHA1 over
`"<user_id>,<timestamp>"`, using the public application signing key.

Session calls use query parameters `actionID=command`, `command`, system
`serial`, and `sessionID`, plus command-specific parameters. These URLs are
sensitive because they contain the system and session identifiers and must
never be logged.

## Authentication lifecycle

1. Login returns a session ID, an authentication token, a user/account ID,
   Cognito-style ID and refresh tokens, and country. All are private and kept
   in memory only.
2. Signed system discovery returns systems. Only `device_type == "iaqua"` is
   supported for this preview. Unsupported systems are ignored.
3. A `401` on an auth-bearing request triggers refresh. A `401` from refresh
   triggers a full login. The original request is rebuilt and replayed once so
   the renewed session ID and bearer token are used.
4. Current `iaqualink-py` also treats a discovery `404` as an expired/invalid
   session; this adapter follows that behavior.
5. Disconnect clears in-memory authentication and system identifiers.

No response cookies are used by the current reference lifecycle. Tokens act as
the session credentials. The adapter does not persist either cookies or tokens.

## Discovery and polling sequence

After login:

1. Fetch signed account systems and select the first supported `iaqua` system.
2. Call `get_home` with `attached_test=true` and the login country.
3. Parse system status first. Stop the poll if the controller is not online.
4. Call `get_devices`.
5. If the home response advertises `onetouch == "true"`, call `get_onetouch`.

The home response supplies temperatures, setpoints, heater/pump state, unit
scale, controller type, and paired heat-pump information. The devices response
supplies auxiliary labels/types/states and lights. OneTouch supplies optional
scene switches. Node's built-in `fetch` is sufficient; requests have a
10-second timeout and retry transient transport/5xx failures with bounded
exponential backoff.

## Device mapping for the RS4 Combo preview

| Remote source | Provider equipment |
| --- | --- |
| `air_temp`, `pool_temp`, `spa_temp` | Three temperature sensors; Fahrenheit values are converted to Celsius |
| `pool_heater` + `pool_set_point` | Pool thermostat |
| `spa_heater` + `spa_set_point` | Spa thermostat |
| `pool_pump` | Filter-pump switch |
| `spa_pump` | Spa-mode switch |
| `heatpump_info` | Heat Pump / Chiller thermostat and its available mode/setpoints |
| Aux label containing pool/spa + light | Pool/spa light |
| Aux label containing blower, sheer/waterfall, or high speed | Matching switch |
| `swg_status`, `aquapure_status`, or `salt_status` | Read-only SWG inventory/status |

Aux mappings intentionally require recognizable labels. Unknown auxiliaries are
not guessed into the fixed accessory model. The inventory exposes stable local
equipment IDs only; remote account IDs and system serials never enter
accessories, snapshots, diagnostics, or logs.

## Command semantics researched but not enabled

The provider interface remains command-capable so HAP and Matter do not depend
on transport. For Milestone 1 every real-cloud write returns a clear read-only
preview error.

The reference client shows these future semantics:

- Home switches use commands such as `set_pool_pump`, `set_spa_pump`,
  `set_pool_heater`, and `set_spa_heater`; many are toggles, so callers must
  compare current state before sending.
- Auxiliaries toggle with `set_aux_<number>`. OneTouch scenes toggle with
  `set_onetouch_<number>`.
- Pool and spa setpoints are sent together with `set_temps`.
- Paired heat pump operations use `enable_disable_hpm`, `switch_hpm_mode`, and
  `setpoint_hpm_temp`. Heat/chill separation must be validated before writes.
- Legacy lights use `set_light`; IntelliCenter lights use separate ICL
  commands. Program cycling can take up to two minutes, so future light writes
  must remain serialized and coalesced.

No SWG write has been established, so none may be invented.

## Privacy and diagnostics

The adapter never logs request URLs, request headers/bodies, response bodies,
credentials, account IDs, serials, session IDs, signatures, or tokens. Errors
contain only a fixed operation label and status category/code. Fixtures use
obvious synthetic values and preserve only the fields needed to verify parsing.

Diagnostic snapshots contain the generic name `iAquaLink System`, a controller
type/capability inventory, stable local equipment IDs, and normalized state.
The shared redactor additionally removes sensitive keys, email addresses,
bearer values, and JWT-shaped strings before diagnostic output.
