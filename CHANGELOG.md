# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.0.8-beta.8] - 2026-10-18

### Fixed

- Push the just-commanded value to HAP and Matter immediately when a command succeeds, instead of only on the next refresh. Testing 1.0.8-beta.7 showed a controller's retry cadence was unchanged by how quickly the write handler's promise resolved, meaning it was never waiting on that - it was waiting to see the characteristic itself change, which previously only happened once the next cloud poll completed. The immediate update uses state already in memory, not a network call, so it carries none of the race risk the 1.0.8-beta.4 attempt had.

## [1.0.8-beta.7] - 2026-10-18

### Fixed

- Stop making a HAP/Matter write handler wait on the post-command refresh before it can acknowledge the command, on top of waiting for the command itself. The refresh stays serialized through the same queue as commands (so 1.0.8-beta.6's fix against overlapping, racing refreshes still holds) but is no longer awaited by the caller, cutting the write handler's acknowledgment time roughly in half. The command's own cloud round-trip is latency this can't remove, so this may only reduce, not eliminate, a controller resending a write it thinks went unacknowledged.

## [1.0.8-beta.6] - 2026-10-18

### Fixed

- Serialize every refresh - both the one after a command and the periodic poll - through the same queue already used for commands, so they can never run concurrently. Confirmed by testing that an unrelated thermostat's mode only ever flickered while something else was actively being commanded, never at idle: a burst of retried commands (e.g. a controller resending a write) could previously fire multiple overlapping `getSnapshot()` calls against the same cloud session at once, and a race between them could republish inconsistent state for equipment nobody touched, making a controller "correct" a device it was never asked to change.

## [1.0.8-beta.5] - 2026-10-18

### Fixed

- Revert the 1.0.8-beta.4 change that ran the post-command refresh in the background instead of awaiting it. That change was intended to stop HomeKit from resending commands, but it did not fix that (the resends continued), and it made a separate, pre-existing issue worse: with no await, repeated commands could trigger overlapping, unserialized refreshes that race each other re-publishing every device's state, not only the one just commanded - compounding the cross-device state flicker already discussed in 1.0.8-beta.2, up to the point of an unrelated thermostat's mode visibly cycling. Awaiting the refresh restores the back-pressure that kept retries from piling up concurrently.

## [1.0.8-beta.4] - 2026-10-18

### Fixed

- Stop HomeKit from repeatedly resending the same on/off and light-program command. The command handler awaited a full extra cloud round-trip (re-fetching the whole equipment snapshot) before resolving, on top of the round-trip for the command itself - slow enough that HomeKit (and potentially other controllers) treated the accessory as unresponsive and resent the write every few seconds. That refresh already runs in the background everywhere else in this plugin (the periodic poll timer does the same); the command handler now does too, so it can acknowledge as soon as the command itself succeeds.

### Added

- Log whether a given command is a "Set" (write) or "Read" (poll) command. Read commands log at debug level to avoid spam, since they fire on every poll; Set commands remain at info level.

## [1.0.8-beta.3] - 2026-10-18

### Added

- Tag command log lines with `HAP - ` or `Matter - ` so it's clear which protocol sent a given command, including the underlying `iAquaLink command: ...` cloud call several layers down from where it was triggered. Only applied when Matter is enabled, since that's the only protocol a user opts into (HAP has no equivalent plugin-visible setting and is on by default) - a single-protocol setup's logs are unchanged.

## [1.0.8-beta.2] - 2026-10-18

### Fixed

- Extend the pending on/off state from 1.0.8-beta.1 to `setThermostatMode` (Pool Heater, Spa Heater, Heat Pump / Chiller), which had the same gap: no pending state meant a mode-change command's immediate post-command refresh could read iAquaLink's not-yet-updated cloud state and report the thermostat as still off/in its old mode. Because that refresh republishes every equipment item's state, not only the one just commanded, an unrelated device with its own command in flight around the same time (e.g. a light) could trigger this for the thermostat and vice versa, making two unrelated devices appear to flicker together.

## [1.0.8-beta.1] - 2026-10-18

### Fixed

- Stop Matter/HomeKit controllers from repeatedly resending on/off and light-program commands. After a successful `setPower`/`setLightProgram` command, the plugin immediately re-read the cloud snapshot to refresh HomeKit/Matter state, but iAquaLink's cloud can take a poll or two to reflect the change, so it was reporting the device as still off right after turning it on. Controllers read that as a failed command and retried every few seconds. The just-commanded on/off state is now held as pending (the same technique already used for thermostat setpoints) until the cloud snapshot catches up.

## [1.0.8-beta.0] - 2026-10-18

### Fixed

- Expose every assigned aux circuit, not only those whose iAquaLink label matches a built-in name (Pool Light, Spa Light, Air Blower, Sheer Descent/Waterfall, High Speed). Aux devices with other labels, such as "Jet Pump", were silently dropped; they now appear as switches (or lights, for light-type circuits) named after their iAquaLink label, keyed by the stable internal slot id rather than the user-editable label. Circuits still carrying a default label ("Aux 4", "Extra Aux") are treated as unassigned and skipped; that detection is restricted to a short numeric/alphanumeric slot code so a custom label that keeps the "Aux" prefix (e.g. "Aux Heater") isn't mistaken for a placeholder and dropped the same way. Existing devices keep their current identities. (#1)

## [1.0.7] - 2026-10-02

### Fixed

- Stop letting a single incomplete poll decide the Heat Pump / Chiller's permanent Matter device shape. That device's Heating-only vs. Heating+Cooling composition is derived from the cloud API's heat-pump snapshot, but it's only ever submitted to Homebridge's Matter cache once, on the first poll after a (re)connect. When that first poll after a reboot happened to lack chill-capability evidence (an explicit flag, a cooling setpoint, or a chill mode reading) - which can happen transiently right after reconnecting - the heat pump got composed as heating-only, mismatching Homebridge's cached shape from the previous run and triggering the same endpoint-rebuild-as-new behavior fixed for other thermostats in 1.0.6, but only on some reboots. The chiller capability is now persisted in the cached accessory once observed and treated as sticky, so an ambiguous poll right after a reboot no longer downgrades it.

## [1.0.6] - 2026-08-31

### Fixed

- Drop the unused Matter `Occupancy` thermostat feature from Pool Heater, Spa Heater, and Heat Pump / Chiller. 1.0.5 still rebuilt these three endpoints on every restart because Homebridge's Matter cache restores a bare "Heating"/"Cooling" thermostat, while this plugin composed "Heating,Occupancy"/"Cooling,Occupancy" - a real feature mismatch that Homebridge's own accessory manager correctly treated as a structural change requiring a rebuild, making the devices reappear as new to Alexa/Google Home/Apple Home (and lose their room/automation assignments) on every Homebridge restart or host reboot. Occupancy was never used: `occupiedHeatingSetpoint`/`occupiedCoolingSetpoint` belong to the base Heating/Cooling feature attributes, not to Occupancy. All other equipment (switches, lights, sensors) was unaffected and already reattached cleanly.

## [1.0.5] - 2026-08-20

### Fixed

- Reattach current handlers to Homebridge-restored Matter accessory definitions so child-bridge restarts retain existing endpoint identities instead of making controller-visible devices appear new.
- Stop substituting Homebridge's cache-restored Matter device type (a bare `{name, code}` stub with no composed cluster features) for the freshly-composed one on every restart. That substitution, introduced in 1.0.5-beta.0, silently dropped thermostat Heating/Cooling/Occupancy feature composition (breaking commands) and caused Homebridge's own accessory manager to detect a structural mismatch and rebuild the endpoint anyway (causing devices to reappear as new in Alexa on every child-bridge restart).

## [1.0.4] - 2026-08-19

### Fixed

- Submit one complete Matter topology in the original discovery order without racing asynchronous legacy cleanup against registration, while retaining safe command-routing logs.

## [1.0.3] - 2026-08-17

### Fixed

- Preserve the historical Matter endpoint order while registering atomically, and log Matter-to-iAquaLink command routing for troubleshooting.

## [1.0.2] - 2026-08-16

### Fixed

- Register the complete Matter topology atomically and in stable equipment-ID order, preventing Alexa from treating temporarily absent equipment as removed and recreated devices and losing group or routine assignments.

## [1.0.1] - 2026-08-12

### Added

- Weekly and total npm download badges in the README.

### Changed

- Publish controllable on/off equipment as Matter plug-in units for compatibility with Alexa and other Matter controllers.
- Validate releases against Homebridge 2.3.1.

### Fixed

- Preserve Matter accessory plugin and platform ownership so devices remain associated with iAquaLink after Homebridge restarts.
- Register Matter accessories independently so one unsupported endpoint cannot prevent later devices from appearing.
- Publish Pool Heater and Spa Heater as heating-only Matter thermostats and Heat Pump / Chiller as a cooling-only thermostat.
- Remove obsolete Matter thermostat preset attributes rejected by Homebridge 2.3.1.
- Include the affected device name in Matter registration failure logs.

## [1.0.1-beta.7] - 2026-08-12

### Fixed

- Remove thermostat preset attributes that Homebridge 2.3.1 rejects when the Matter Presets feature is not enabled.

## [1.0.1-beta.6] - 2026-08-12

### Changed

- Revert the experimental Matter On/Off Light Switch mapping because controllers such as Alexa treat it as an input device rather than a controllable load.

## [1.0.1-beta.4] - 2026-08-12

### Changed

- Experimentally publish on/off equipment as Matter On/Off Light Switch devices instead of plug-in units.

## [1.0.1-beta.3] - 2026-08-12

### Fixed

- Declare heating-only and cooling-only Matter thermostat features through Homebridge's supported thermostat requirements API.

## [1.0.1-beta.2] - 2026-08-12

### Fixed

- Continue registering Matter accessories after an individual device fails, and identify the failing device in the log.

## [1.0.1-beta.1] - 2026-08-12

### Fixed

- Use Homebridge's supported precomposed Matter thermostat device type instead of accessing an unavailable nested behavior during startup.

## [1.0.1-beta.0] - 2026-08-12

### Fixed

- Preserve Matter accessory plugin and platform ownership in the Homebridge 2.2.1 cache so bridged devices are not removed as orphaned after a restart.

## [1.0.0] - 2026-08-08

### Added

- Verified by Homebridge badge in the README.
- npm funding metadata for Buy Me a Coffee, Cash App, and Venmo donation links in the Homebridge UI.

## [0.1.3] - 2026-08-04

### Fixed

- Corrected the Homebridge configuration schema to declare required fields with an object-level JSON Schema `required` array.

## [0.1.2] - 2026-08-04

### Added

- Jandy logo branding in the Homebridge configuration screen and README.
- Documentation for automatic setpoint confirmation while iAquaLink cloud polls catch up.

### Changed

- Renamed the project to `homebridge-iAqualink-Matter`; the npm and Homebridge plugin identifier is `homebridge-iaqualink-matter`.
- Cloud control now defaults to enabled. Set `enableCloudControl` to `false` for monitoring-only operation.
- Homebridge bridge configuration is now the single source of truth for HAP and Matter publication.
- Renamed the light-program option to **Expose Light Colors and Shows as Switches** and clarified that it affects HomeKit only.

### Removed

- Redundant plugin-level HAP and Matter enable switches; configure protocols on the Homebridge main or child bridge instead.
- The unused **Optimistic Updates** setting; stale-poll protection remains automatic.
- The nonfunctional **Restore Last Light Program** setting. Pool and spa lights use their configured default programs when switched on.

## [0.1.1] - 2026-08-04

### Fixed

- System discovery now falls back to the compatible iAquaLink device-list endpoint when signed discovery returns HTTP 400.

## [0.1.0] - 2026-08-03

### Added

- Homebridge 2 dynamic platform for Jandy iAquaLink controllers.
- iAquaLink cloud authentication, session renewal, controller discovery, and polling.
- HomeKit/HAP and Matter publication that can be enabled independently.
- Air, pool, and spa temperature sensors.
- Pool and spa heating thermostats plus a cooling-only Heat Pump / Chiller thermostat.
- Pool pump, spa mode, mapped auxiliary, blower, high-speed, and water-feature switches.
- Pool and spa light controls with Jandy colors and shows exposed as one-second momentary switches.
- Configurable default light programs for Matter on/off lights.
- Opt-in cloud writes protected by `enableCloudControl`.
- Serialized command queue and temporary optimistic setpoint state while cloud changes propagate.
- Sanitized diagnostic snapshots and credential-redaction tests.
- Read-only salt-water chlorinator status.

### Changed

- Thermostat current temperatures follow their corresponding pool or spa water sensor.
- Pool Heater and Heat Pump / Chiller use separate heating-only and cooling-only Matter capabilities.
- Setpoint companion adjustments are sent as separate cloud commands for controller compatibility.

### Fixed

- Matter thermostat conformance metadata, control sequences, setpoint ranges, and cached endpoint migrations.
- Missing water-temperature handling in HomeKit and Matter.
- Stale cloud polling temporarily reverting newly selected setpoints.
- Light service naming and primary-service selection in grouped HomeKit views.
- Jandy light-program switches remaining active longer than one second.

### Security

- Authentication failures, diagnostics, and logs avoid credentials, account identifiers, raw cloud responses, and session data.

[Unreleased]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.8...HEAD
[1.0.8-beta.8]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.7...v1.0.8-beta.8
[1.0.8-beta.7]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.6...v1.0.8-beta.7
[1.0.8-beta.6]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.5...v1.0.8-beta.6
[1.0.8-beta.5]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.4...v1.0.8-beta.5
[1.0.8-beta.4]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.3...v1.0.8-beta.4
[1.0.8-beta.3]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.2...v1.0.8-beta.3
[1.0.8-beta.2]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.1...v1.0.8-beta.2
[1.0.8-beta.1]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.8-beta.0...v1.0.8-beta.1
[1.0.8-beta.0]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.7...v1.0.8-beta.0
[1.0.7]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.6...v1.0.7
[1.0.6]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.5...v1.0.6
[1.0.5]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.4...v1.0.5
[1.0.4]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.3...v1.0.4
[1.0.3]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.3...v1.0.0
[0.1.3]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dean1d/homebridge-iAqualink-Matter/releases/tag/v0.1.0
