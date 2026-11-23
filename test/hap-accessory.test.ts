import { Accessory, Characteristic, HapStatusError, HAPStatus, Service, uuid } from '@homebridge/hap-nodejs';
import type { PlatformAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { HapEquipmentAccessory } from '../src/accessories/hap-accessory.js';
import type { IAquaLinkPlatform } from '../src/platform.js';
import type { EquipmentState } from '../src/types.js';

describe('HAP monitoring accessories', () => {
  it('publishes ICL zone power and brightness with their names and rejects writes', async () => {
    const accessory = Object.assign(new Accessory('Pool Lights', uuid.generate('icl-test')), { context: {} });
    const platform = {
      Characteristic, Service, api: { hap: { HapStatusError, HAPStatus } },
      setPower: vi.fn(), setLightProgram: vi.fn(),
    } as unknown as IAquaLinkPlatform;
    const state: EquipmentState = {
      id: 'icl-zone-pool', name: 'Pool Lights', kind: 'light', available: true,
      on: false, brightness: 45, metadata: { readOnly: true, icl: true },
    };
    const hap = new HapEquipmentAccessory(platform, accessory as unknown as PlatformAccessory, state);
    hap.update(state);
    const service = accessory.getService(Service.Lightbulb)!;
    expect(service.displayName).toBe('Pool Lights');
    expect(service.getCharacteristic(Characteristic.ConfiguredName).value).toBe('Pool Lights');
    const power = service.getCharacteristic(Characteristic.On);
    const brightness = service.getCharacteristic(Characteristic.Brightness);
    expect(await power.handleGetRequest()).toBe(false);
    expect(await brightness.handleGetRequest()).toBe(45);
    expect(power.props.perms).not.toContain('pw');
    expect(brightness.props.perms).not.toContain('pw');
    await expect(power.handleSetRequest(true)).rejects.toBeDefined();
    await expect(brightness.handleSetRequest(90)).rejects.toBeDefined();
    expect(platform.setPower).not.toHaveBeenCalled();
    expect(platform.setLightProgram).not.toHaveBeenCalled();
    expect(accessory.services.filter((item) => item.UUID === Service.Switch.UUID)).toHaveLength(0);
    hap.update({ ...state, on: true, brightness: 40 });
    expect(await power.handleGetRequest()).toBe(true);
    expect(await brightness.handleGetRequest()).toBe(40);
    expect(brightness.value).toBe(40);
  });

  it('publishes OneTouch scene state as a read-only switch', async () => {
    const accessory = Object.assign(new Accessory('Clean Mode', uuid.generate('scene-test')), { context: {} });
    const platform = {
      Characteristic, Service, api: { hap: { HapStatusError, HAPStatus } }, setPower: vi.fn(),
    } as unknown as IAquaLinkPlatform;
    const state: EquipmentState = {
      id: 'onetouch-3', name: 'Clean Mode', kind: 'switch', available: true,
      on: false, metadata: { readOnly: true, oneTouch: true },
    };
    const hap = new HapEquipmentAccessory(platform, accessory as unknown as PlatformAccessory, state);
    hap.update({ ...state, on: true });
    const power = accessory.getService(Service.Switch)!.getCharacteristic(Characteristic.On);
    expect(await power.handleGetRequest()).toBe(true);
    expect(power.props.perms).not.toContain('pw');
    await expect(power.handleSetRequest(false)).rejects.toBeDefined();
    expect(platform.setPower).not.toHaveBeenCalled();
  });
});

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
