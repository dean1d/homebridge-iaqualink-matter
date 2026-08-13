import type { API, Logger, MatterAccessory } from 'homebridge';
import { describe, expect, it, vi } from 'vitest';
import { associateMatterAccessory, MatterPublisher } from '../src/matter/matter-publisher.js';
import type { EquipmentState } from '../src/types.js';

describe('associateMatterAccessory', () => {
  it('sets the ownership fields serialized by Homebridge 2.2.1', () => {
    const accessory = {} as MatterAccessory & {
      _associatedPlugin?: string;
      _associatedPlatform?: string;
    };

    expect(associateMatterAccessory(accessory)).toBe(accessory);
    expect(accessory._associatedPlugin).toBe('homebridge-iaqualink-matter');
    expect(accessory._associatedPlatform).toBe('iAquaLink');
  });

  it('continues after an individual accessory registration fails', async () => {
    const registerPlatformAccessories = vi.fn(async (
      _plugin: string,
      _platform: string,
      accessories: MatterAccessory[],
    ) => {
      if (accessories[0]?.displayName === 'Pool Heater') throw new Error('invalid thermostat');
    });
    const api = {
      isMatterEnabled: () => true,
      hap: { uuid: { generate: (value: string) => value } },
      matter: {
        deviceTypes: {
          TemperatureSensor: {},
          Thermostat: {},
          OnOffSwitch: {},
        },
        registerPlatformAccessories,
        unregisterPlatformAccessories: vi.fn().mockResolvedValue(undefined),
      },
    } as unknown as API;
    const log = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
    } as unknown as Logger;
    const commands = {
      setPower: vi.fn().mockResolvedValue(undefined),
      setTargetTemperature: vi.fn().mockResolvedValue(undefined),
      setCoolingTargetTemperature: vi.fn().mockResolvedValue(undefined),
      setThermostatMode: vi.fn().mockResolvedValue(undefined),
    };
    const equipment: EquipmentState[] = [
      { id: 'pool-temperature', name: 'Pool Temperature', kind: 'temperature', available: true },
      { id: 'pool-heater', name: 'Pool Heater', kind: 'thermostat', available: true },
      { id: 'filter-pump', name: 'Filter Pump', kind: 'switch', available: true },
    ];

    new MatterPublisher(api, log, commands).publish(equipment);

    await vi.waitFor(() => expect(registerPlatformAccessories).toHaveBeenCalledTimes(3));
    expect(registerPlatformAccessories.mock.calls.map((call) => call[2][0]?.displayName))
      .toEqual(['Pool Temperature', 'Pool Heater', 'Filter Pump']);
    expect(log.warn).toHaveBeenCalledWith(expect.stringContaining('Pool Heater'));
    expect(log.info).toHaveBeenCalledWith('Registered 2 of 3 Matter accessories.');
  });
});
