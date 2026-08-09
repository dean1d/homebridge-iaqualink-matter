# homebridge-iAqualink-Matter

<p align="center">
  <img src="assets/Jandy.png" alt="Jandy iAquaLink logo" width="180" />
</p>

[![verified-by-homebridge](https://img.shields.io/badge/homebridge-verified-blueviolet?color=%23491F59&style=for-the-badge&logoColor=%23FFFFFF&logo=homebridge)](https://github.com/homebridge/homebridge/wiki/Verified-Plugins)
[![npm downloads per week](https://img.shields.io/npm/dw/homebridge-iaqualink-matter)](https://www.npmjs.com/package/homebridge-iaqualink-matter)
[![npm total downloads](https://img.shields.io/npm/dt/homebridge-iaqualink-matter)](https://www.npmjs.com/package/homebridge-iaqualink-matter)

> This independent community plugin is not affiliated with or endorsed by Jandy or Fluidra.

Homebridge 2 platform plugin for Jandy iAquaLink pool and spa controllers. It discovers supported equipment from the iAquaLink cloud and publishes it to HomeKit/HAP and Matter.

> This is an early release tested with an RS4 Combo system. iAquaLink systems vary by controller and installed equipment, so enable cloud control carefully and test one command at a time.

## Features

- Air, pool, and spa temperature sensors
- Pool and spa heater thermostats
- Heat Pump / Chiller cooling thermostat
- Filter pump, spa mode, high-speed, blower, and mapped auxiliary switches
- Pool and spa light power controls
- Jandy color and light-show programs as one-second momentary switches
- Separate HomeKit/HAP and Matter publication
- Serialized cloud commands, polling, retries, and temporary setpoint confirmation while iAquaLink updates
- Sanitized diagnostic snapshots that exclude credentials and account identifiers
- Read-only salt-water chlorinator status when reported by the controller

## Requirements

- Homebridge 2.0 or later
- Node.js 22.12 or 24
- A supported Jandy iAquaLink controller
- An iAquaLink account with access to the controller

## Installation

Search for **homebridge-iAqualink-Matter** in the Homebridge UI, or install it from a terminal:

```bash
npm install -g homebridge-iaqualink-matter
```

Configure the plugin through Homebridge UI and restart Homebridge.

## Configuration

The recommended configuration method is the Homebridge UI. A minimal manual configuration is:

```json
{
  "platforms": [
    {
      "platform": "iAquaLink",
      "name": "iAquaLink",
      "username": "your-account@example.com",
      "password": "your-password",
      "enableCloudControl": true,
      "pollIntervalSeconds": 30
    }
  ]
}
```

| Setting | Default | Description |
| --- | --- | --- |
| `username` | — | Email address used by the iAquaLink account. |
| `password` | — | iAquaLink account password. |
| `enableCloudControl` | `true` | Permit commands that change real pool equipment. Disable for monitoring only. |
| `pollIntervalSeconds` | `30` | Cloud polling interval from 15 to 300 seconds. |
| `exposeLightShows` | `true` | Expose each discovered Jandy light color and show as a momentary HomeKit switch. Disable for a simpler HomeKit layout. |
| `poolLightProgram` | `Caribbean Blue` | Program selected when the Matter pool light is turned on.  Matter does not currently support multiple switches under one device, so you must sellect a default light color if you are using Matter to turn the light on and off. |
| `spaLightProgram` | `Caribbean Blue` | Program selected when the Matter spa light is turned on. Matter does not currently support multiple switches under one device, so you must sellect a default light color if you are using Matter to turn the light on and off. |
| `diagnosticMode` | `false` | Log sanitized equipment snapshots for troubleshooting. |
| `useMockApi` | `false` | Use synthetic equipment during development; never enable for normal operation. |

## Cloud control

Cloud writes are enabled by default, allowing the plugin to control discovered pumps, heaters, the heat pump/chiller, mapped auxiliaries, and Jandy lights. Set `enableCloudControl` to `false` for monitoring only.

Test commands individually after enabling control. The plugin uses undocumented cloud endpoints that may behave differently across controller models. The salt-water chlorinator remains read-only because no verified write command is available.

After the cloud accepts a temperature change, iAquaLink may still return the previous setpoint for one or more polls. The plugin temporarily retains the accepted setpoint for at least 60 seconds (or two polling intervals) so HomeKit and Matter do not jump back to stale values. This command-confirmation behavior is automatic and does not need a separate setting.

## Thermostats

- **Pool Heater** is published as an Off/Heat thermostat and uses the pool-temperature sensor.
- **Spa Heater** is published as an Off/Heat thermostat and uses the spa-temperature sensor.
- **Heat Pump / Chiller** is published as an Off/Cool thermostat and uses the pool-temperature sensor.
- If the corresponding water sensor has no reading, HomeKit receives `0°C` because its thermostat characteristic requires a number; Matter receives an unavailable value.

When Pool Heater and Heat Pump / Chiller setpoints are too close, the plugin maintains the controller-required separation with a second, serialized setpoint command.

## Lights

The primary **Light** control mirrors the iAquaLink on/off state. When `exposeLightShows` is enabled, each discovered Jandy color or show appears as a momentary HomeKit switch. Pressing a program switch sends that selection and returns the switch to Off after one second. Disable the option to keep only the primary light control.

Matter does not provide the same list of vendor-specific light programs. Use `poolLightProgram` and `spaLightProgram` to choose the program used when a Matter light is turned on.

## HomeKit and Matter

Homebridge bridge settings determine which protocols are active. HAP accessories are available whenever HAP is enabled for the main or child bridge. Matter accessories are published only when Matter is enabled for that bridge; no additional plugin checkbox is required.

If both protocols are enabled and both pairings are commissioned into the same controller, duplicate controls may appear. A typical setup uses HAP for Apple Home and the Matter pairing for Alexa, Google Home, or another Matter controller. Disabling an unused protocol at the Homebridge child-bridge level also avoids its publication overhead.

Matter support requires a Matter-capable Homebridge 2 installation. Heating-only and cooling-only thermostat capabilities are declared separately so compatible Matter controllers can show only the applicable modes.

## Safe diagnostics

Enable `diagnosticMode`, restart the plugin, and look for `Sanitized snapshot:` in the Homebridge log. Before sharing a log, verify that it does not contain your email address, pool or system name, serial number, password, session data, cookies, authorization headers, Homebridge PIN, or Matter setup code.

Never share raw iAquaLink HTTP responses or proxy captures. Disable diagnostic mode after troubleshooting.

## Development

```bash
npm install
npm run check
npm link
npm run watch
```

Use `useMockApi: true` to develop without contacting real equipment. `npm run check` runs ESLint, TypeScript compilation, and all Vitest tests.

## Support

Please use [GitHub Issues](https://github.com/dean1d/homebridge-iAqualink-Matter/issues) for reproducible bugs and feature requests. Include your Homebridge and Node.js versions, controller type, relevant fixed-text errors, and a sanitized diagnostic snapshot when available.  I am only able to test the equipment that I have, please let me know if there is anything that is having issues on your end.

## Credits
https://www.home-assistant.io/integrations/iaqualink/ by [flz](https://github.com/flz)

## Disclaimer

- This project is not affiliated with, endorsed by, or supported by Jandy, Zodiac, Fluidra, Apple, or the iAquaLink service.
- The cloud interface is undocumented and may change without notice.
- Pool equipment can involve electricity, gas, chemicals, pumps, and heaters. Use this plugin entirely at your own risk and retain the manufacturer's safety controls.

## Support & Donations

This plugin is free and open source. If it saved you some time or frustration and you'd like to say thanks, any support is greatly appreciated!

<a href="https://buymeacoffee.com/dean1d" target="_blank">
  <img src="https://img.shields.io/badge/Buy%20Me%20a%20Coffee-dean1d-FFDD00?style=for-the-badge&logo=buy-me-a-coffee&logoColor=black" alt="Buy Me a Coffee" />
</a>

<a href="https://cash.app/$dkoenigBOA" target="_blank">
  <img src="https://img.shields.io/badge/Cash%20App-%24dkoenigBOA-00C244?style=for-the-badge&logo=cash-app&logoColor=white" alt="Cash App" />
</a>

<a href="http://venmo.com/u/Dean1d" target="_blank">
  <img src="https://img.shields.io/badge/Venmo-Dean1d-3D95CE?style=for-the-badge&logo=venmo&logoColor=white" alt="Venmo" />
</a>

## License

[Apache-2.0](LICENSE)
