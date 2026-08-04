# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

### Changed

### Fixed

### Security

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

[Unreleased]: https://github.com/dean1d/homebridge-iaqualink/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/dean1d/homebridge-iaqualink/releases/tag/v0.1.0
