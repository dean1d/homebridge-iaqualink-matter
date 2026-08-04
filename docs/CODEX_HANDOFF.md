# Codex handoff

## Objective

Build a production-quality Homebridge 2 plugin named `homebridge-iAqualink-Matter` for one iAquaLink account/system initially. The test system is a Jandy RS4 Combo.

## Confirmed equipment

Air temperature; pool temperature; spa temperature; pool heater; spa heater; heat pump/chiller; filter pump; spa mode; air blower; sheer descent; high speed; pool light; spa light; salt-water chlorinator status.

## Confirmed light programs

Alpine White, Sky Blue, Cobalt Blue, Caribbean Blue, Spring Green, Emerald Green, Emerald Rose, Magenta, Violet, Slow Color Splash, Fast Color Splash, America The Beautiful, Fat Tuesday, Disco Tech.

The app warns that changing a light program can take up to two minutes and disables interaction while cycling. Commands must therefore be serialized and light changes debounced/coalesced.

## Heat/chill rule

The controller requires pool heat and chill setpoints to remain at least 5°F apart. Enforce this before sending changes and return a user-readable error.

## Accessory model

- Pool thermostat: pool temperature, pool heating setpoint, heat/off.
- Spa thermostat: spa temperature, spa heating setpoint, heat/off.
- Heat Pump / Chiller thermostat: pool temperature, heat/cool/off (auto only if proven by API), heating and cooling setpoints.
- Temperature sensors: air, pool, spa.
- Switches: filter pump, spa mode, blower, sheer descent, high speed.
- Lights: pool and spa lights as on/off + approximated hue/saturation. Shows are optional momentary switches.
- SWG: read-only status initially; do not invent control commands.

## Milestone 1 — real cloud discovery

1. Study the current Home Assistant `homeassistant/components/iaqualink` integration and `iaqualink-py` behavior.
2. Document the endpoints, authentication lifecycle, cookies/tokens, request headers, polling sequence, device type mapping, and command semantics in `docs/API_RESEARCH.md`.
3. Implement the real adapter in `src/api/cloud-provider.ts` using Node's built-in `fetch` unless a small, well-maintained dependency is justified.
4. Never log credentials, authorization headers, cookies, tokens, account IDs, serial numbers, or unredacted payloads.
5. Add fixtures made only from sanitized responses.
6. Add tests for login failure, session expiry/re-authentication, discovery, timeout, HTTP 5xx retry/backoff, and redaction.
7. Preserve the provider interface so HAP and Matter code remain transport-independent.
8. Run `npm run check` and fix all failures.

## Matter notes

Use `api.isMatterEnabled()`, optional `api.matter`, `registerPlatformAccessories`, and `updateAccessoryState`. Verify exact device type names against the installed Homebridge 2 typings rather than guessing. HAP and Matter may both be enabled, but users should be warned about duplicates if both are commissioned into Apple Home.

## Definition of done for v0.1 discovery preview

- Login and discover one RS4 Combo without controlling it.
- Produce sanitized equipment inventory and capabilities.
- No secret values in logs or diagnostics.
- All tests and TypeScript checks pass.
- README includes exact development and diagnostic steps.
