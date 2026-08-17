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

  it('registers a complete, deterministic Matter topology in one call', async () => {
    const onOffOutlet = {};
    const registerPlatformAccessories = vi.fn().mockResolvedValue(undefined);
    const api = {
      isMatterEnabled: () => true,
      hap: { uuid: { generate: (value: string) => value } },
      matter: {
        deviceTypes: {
          TemperatureSensor: {},
          Thermostat: {},
          OnOffOutlet: onOffOutlet,
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

    await vi.waitFor(() => expect(registerPlatformAccessories).toHaveBeenCalledTimes(1));
    const [plugin, platform, accessories] = registerPlatformAccessories.mock.calls[0]!;
    expect(plugin).toBe('homebridge-iaqualink-matter');
    expect(platform).toBe('iAquaLink');
    expect(accessories).toHaveLength(3);
    expect(accessories.map((accessory: MatterAccessory) => accessory.context.equipmentId))
      .toEqual(['filter-pump', 'pool-heater', 'pool-temperature']);
    expect(accessories.map((accessory: MatterAccessory) => accessory.UUID)).toEqual([
      'iaqualink:matter:v7:filter-pump',
      'iaqualink:matter:v7:pool-heater',
      'iaqualink:matter:v7:pool-temperature',
    ]);

    const filterPump = accessories[0] as MatterAccessory & {
      _associatedPlugin?: string;
      _associatedPlatform?: string;
    };
    expect(filterPump.deviceType).toBe(onOffOutlet);
    expect(filterPump._associatedPlugin).toBe('homebridge-iaqualink-matter');
    expect(filterPump._associatedPlatform).toBe('iAquaLink');
    expect(accessories.every((accessory: MatterAccessory & {
      _associatedPlugin?: string;
      _associatedPlatform?: string;
    }) => accessory._associatedPlugin === 'homebridge-iaqualink-matter'
      && accessory._associatedPlatform === 'iAquaLink')).toBe(true);
    expect(log.info).toHaveBeenCalledWith('Registered 3 Matter accessories.');
  });
});
