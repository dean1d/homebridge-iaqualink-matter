# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[Unreleased]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.3...HEAD
[1.0.3]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.2...v1.0.3
[1.0.2]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.3...v1.0.0
[0.1.3]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.2...v0.1.3
[0.1.2]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/dean1d/homebridge-iAqualink-Matter/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/dean1d/homebridge-iAqualink-Matter/releases/tag/v0.1.0
