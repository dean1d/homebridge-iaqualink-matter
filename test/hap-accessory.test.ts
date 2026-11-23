import { Accessory, Characteristic, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { HapEquipmentAccessory } from '../src/accessories/hap-accessory.js';
import type { IAquaLinkPlatform } from '../src/platform.js';
import type { EquipmentState } from '../src/types.js';

describe('HAP thermostat temperature boundaries', () => {
  it.each([
    ['pool-heater', 'thermostat'],
    ['spa-heater', 'thermostat'],
    ['pool-heater', 'heat-cool-thermostat'],
    ['heat-pump', 'heat-cool-thermostat'],
  ] as const)('accepts 40°C for %s (%s) without warnings', async (id, kind) => {
    const accessory = Object.assign(new Accessory('Thermostat', uuid.generate(`${id}:${kind}`)), { context: {} });
    // Start with a cached thermostat's valid threshold rather than HAP's
    // default of 0°C, which is outside the controller's cooling range.
    accessory.addService(Service.Thermostat)
      .setCharacteristic(Characteristic.HeatingThresholdTemperature, 24);
    accessory.context = { thermostatUiVersion: 4 };
    const platform = {
      Characteristic,
      Service,
      currentWaterTemperature: () => 25,
    } as unknown as IAquaLinkPlatform;
    const state: EquipmentState = {
      id, kind, name: 'Thermostat', available: true,
      currentTemperatureC: 25, targetTemperatureC: 40, coolingTargetTemperatureC: 40,
    };
    const hap = new HapEquipmentAccessory(platform, accessory as unknown as PlatformAccessory, state);
    const service = accessory.getService(Service.Thermostat)!;
    const warning = vi.fn();
    service.on('characteristic-warning', warning);

    hap.update(state);
    const targets = [service.getCharacteristic(Characteristic.TargetTemperature)];
    if (kind === 'heat-cool-thermostat' && id !== 'heat-pump') {
      targets.push(service.getCharacteristic(Characteristic.HeatingThresholdTemperature));
      targets.push(service.getCharacteristic(Characteristic.CoolingThresholdTemperature));
    }
    for (const target of targets) {
      expect(target.value).toBe(40);
      expect(await target.handleGetRequest()).toBe(40);
      // Exercise the full advertised range, including both boundaries.
      for (let tenth = Math.round(target.props.minValue! * 10); tenth <= 400; tenth++) {
        target.updateValue(tenth / 10);
        expect(Number(target.value)).toBeCloseTo(tenth / 10, 10);
      }
    }
    expect(warning).not.toHaveBeenCalled();
  });
});
