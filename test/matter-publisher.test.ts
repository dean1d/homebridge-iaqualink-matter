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
          OnOffLight: {},
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
      { id: 'spa-mode', name: 'Spa Mode', kind: 'switch', available: true },
      { id: 'spa-light', name: 'Spa Light', kind: 'light', available: true },
      { id: 'pool-heater', name: 'Pool Heater', kind: 'thermostat', available: true },
      { id: 'filter-pump', name: 'Filter Pump', kind: 'switch', available: true },
      { id: 'pool-temperature', name: 'Pool Temperature', kind: 'temperature', available: true },
    ];

    new MatterPublisher(api, log, commands).publish(equipment);

    await vi.waitFor(() => expect(registerPlatformAccessories).toHaveBeenCalledTimes(1));
    const [plugin, platform, accessories] = registerPlatformAccessories.mock.calls[0]!;
    expect(plugin).toBe('homebridge-iaqualink-matter');
    expect(platform).toBe('iAquaLink');
    expect(accessories).toHaveLength(5);
    expect(accessories.map((accessory: MatterAccessory) => accessory.context.equipmentId))
      .toEqual(['pool-temperature', 'pool-heater', 'filter-pump', 'spa-mode', 'spa-light']);
    expect(accessories.map((accessory: MatterAccessory) => accessory.UUID)).toEqual([
      'iaqualink:matter:v7:pool-temperature',
      'iaqualink:matter:v7:pool-heater',
      'iaqualink:matter:v7:filter-pump',
      'iaqualink:matter:v7:spa-mode',
      'iaqualink:matter:v7:spa-light',
    ]);

    const filterPump = accessories[2] as MatterAccessory & {
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
    const handlers = Object.fromEntries(accessories.map((accessory: MatterAccessory) => [
      accessory.context.equipmentId,
      accessory.handlers,
    ])) as Record<string, any>;
    await handlers['filter-pump'].onOff.off();
    await handlers['spa-mode'].onOff.on();
    await handlers['spa-light'].onOff.on();
    await handlers['pool-heater'].thermostat.systemModeChange({ systemMode: 4 });
    expect(commands.setPower).toHaveBeenNthCalledWith(1, 'filter-pump', false);
    expect(commands.setPower).toHaveBeenNthCalledWith(2, 'spa-mode', true);
    expect(commands.setPower).toHaveBeenNthCalledWith(3, 'spa-light', true);
    expect(commands.setThermostatMode).toHaveBeenCalledWith('pool-heater', 'heat');
    expect(log.info).toHaveBeenCalledWith('Matter command for spa-mode: power on');
    expect(log.info).toHaveBeenCalledWith('Registered 5 Matter accessories.');
  });
});
