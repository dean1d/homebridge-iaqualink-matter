import { devices } from 'homebridge';
import type { API, Logger, MatterAccessory } from 'homebridge';
import type { EquipmentState } from '../types.js';
import { PLUGIN_NAME, PLATFORM_NAME } from '../settings.js';

interface MatterCommands {
  setPower(id: EquipmentState['id'], on: boolean): Promise<void>;
  setTargetTemperature(id: EquipmentState['id'], temperatureC: number): Promise<void>;
  setCoolingTargetTemperature(id: EquipmentState['id'], temperatureC: number): Promise<void>;
  setThermostatMode(id: EquipmentState['id'], mode: 'off' | 'heat' | 'cool' | 'auto'): Promise<void>;
}

type OwnedMatterAccessory = MatterAccessory & {
  _associatedPlugin?: string;
  _associatedPlatform?: string;
};

export function associateMatterAccessory(accessory: MatterAccessory): MatterAccessory {
  // Homebridge 2.2.1 does not persist the registration arguments into its
  // Matter cache, so supply the internal ownership fields it serializes.
  const ownedAccessory = accessory as OwnedMatterAccessory;
  ownedAccessory._associatedPlugin = PLUGIN_NAME;
  ownedAccessory._associatedPlatform = PLATFORM_NAME;
  return accessory;
}

export class MatterPublisher {
  private registration?: Promise<void>;
  private readonly states = new Map<EquipmentState['id'], EquipmentState>();

  constructor(
    private readonly api: API,
    private readonly log: Logger,
    private readonly commands: MatterCommands,
  ) {}

  publish(equipment: EquipmentState[]): void {
    if (!this.api.isMatterEnabled() || !this.api.matter) {
      this.log.debug('Matter is not enabled for this bridge.');
      return;
    }
    for (const item of equipment) this.states.set(item.id, item);

    const accessories: MatterAccessory[] = equipment.flatMap((item) => {
      const deviceType = this.deviceType(item);
      if (!deviceType) return [];
      return [associateMatterAccessory({
        UUID: this.matterUuid(item.id),
        displayName: item.name,
        deviceType,
        manufacturer: 'Jandy',
        model: item.kind,
        serialNumber: item.id,
        context: { equipmentId: item.id },
        clusters: this.clusters(item),
        handlers: this.handlers(item),
      })];
    });

    const legacyAccessories = accessories.flatMap((accessory) => [
      {
        ...accessory,
        UUID: this.api.hap.uuid.generate(`iaqualink:${accessory.context.equipmentId}`),
      },
      {
        ...accessory,
        UUID: this.api.hap.uuid.generate(`iaqualink:matter:v2:${accessory.context.equipmentId}`),
      },
      {
        ...accessory,
        UUID: this.api.hap.uuid.generate(`iaqualink:matter:v3:${accessory.context.equipmentId}`),
      },
      {
        ...accessory,
        UUID: this.api.hap.uuid.generate(`iaqualink:matter:v4:${accessory.context.equipmentId}`),
      },
      {
        ...accessory,
        UUID: this.api.hap.uuid.generate(`iaqualink:matter:v5:${accessory.context.equipmentId}`),
      },
      {
        ...accessory,
        UUID: this.api.hap.uuid.generate(`iaqualink:matter:v6:${accessory.context.equipmentId}`),
      },
    ]);
    this.registration = this.api.matter.unregisterPlatformAccessories(
      PLUGIN_NAME,
      PLATFORM_NAME,
      legacyAccessories,
    ).catch((error) => {
      this.log.debug(`Legacy Matter endpoint cleanup skipped: ${error instanceof Error ? error.message : String(error)}`);
    }).then(async () => {
      let registered = 0;
      for (const accessory of accessories) {
        try {
          await this.api.matter!.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
          registered++;
        } catch (error) {
          this.log.warn(
            `Matter accessory registration failed for ${accessory.displayName}: ${error instanceof Error ? error.message : String(error)}`,
          );
        }
      }
      this.log.info(`Registered ${registered} of ${accessories.length} Matter accessories.`);
    })
      .catch((error) => {
        this.log.warn(`Matter accessory registration failed: ${error instanceof Error ? error.message : String(error)}`);
      });
  }

  async update(equipment: EquipmentState[]): Promise<void> {
    if (!this.api.matter || !this.registration) return;
    await this.registration;
    for (const item of equipment) {
      this.states.set(item.id, item);
      const uuid = this.matterUuid(item.id);
      try {
        await this.api.matter.updateAccessoryState(uuid, 'bridgedDeviceBasicInformation', {
          reachable: item.available,
        });
        if (item.kind === 'temperature') {
          await this.api.matter.updateAccessoryState(uuid, 'temperatureMeasurement', {
            measuredValue: item.available && item.currentTemperatureC !== undefined
              ? Math.round(item.currentTemperatureC * 100)
              : null,
          });
        } else if (item.kind === 'switch' || item.kind === 'light') {
          await this.api.matter.updateAccessoryState(uuid, 'onOff', { onOff: item.on ?? false });
        } else {
          await this.api.matter.updateAccessoryState(uuid, 'thermostat', this.thermostatState(item));
        }
      } catch (error) {
        this.log.debug(`Matter state update skipped for ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private deviceType(item: EquipmentState) {
    const types = this.api.matter!.deviceTypes;
    if (item.kind === 'temperature') return types.TemperatureSensor;
    if (item.kind === 'light') return types.OnOffLight;
    if (item.kind === 'thermostat') {
      return devices.ThermostatDevice.with(
        devices.ThermostatRequirements.ThermostatServer.with('Heating', 'Occupancy'),
      );
    }
    if (item.kind === 'heat-cool-thermostat') {
      return devices.ThermostatDevice.with(
        devices.ThermostatRequirements.ThermostatServer.with('Cooling', 'Occupancy'),
      );
    }
    if (item.kind === 'switch') return types.OnOffSwitch;
    return undefined;
  }

  private clusters(item: EquipmentState): NonNullable<MatterAccessory['clusters']> {
    if (item.kind === 'temperature') return {
      temperatureMeasurement: {
        measuredValue: item.available && item.currentTemperatureC !== undefined
          ? Math.round(item.currentTemperatureC * 100)
          : null,
      },
    };
    if (item.kind === 'light') return { onOff: { onOff: item.on ?? false } };
    if (item.kind === 'switch') return { onOff: { onOff: item.on ?? false } };
    return { thermostat: this.thermostatState(item) };
  }

  private thermostatState(item: EquipmentState) {
    const heatCool = item.kind === 'heat-cool-thermostat';
    const minimumHeatSetpoint = 111;
    const minimumCoolSetpoint = 389;
    const maximumSetpoint = 4000;
    const systemMode = item.mode === 'heat' ? 4 : item.mode === 'cool' ? 3 : 0;
    const temperatureId = item.id === 'spa-heater' ? 'spa-temperature' : 'pool-temperature';
    const localTemperatureC = item.currentTemperatureC
      ?? this.states.get(temperatureId)?.currentTemperatureC;
    if (heatCool) {
      return {
        localTemperature: localTemperatureC === undefined ? null : Math.round(localTemperatureC * 100),
        // Homebridge's writable thermostat behavior inherits the Matter
        // Presets feature, even for a cooling-only device. Supply its required
        // metadata without exposing an active preset.
        presetTypes: [{
          presetScenario: 1,
          numberOfPresets: 1,
          presetTypeFeatures: { automatic: false, supportsNames: false },
        }],
        numberOfPresets: 1,
        activePresetHandle: null,
        presets: [],
        // Matter enum: CoolingOnly=0.
        controlSequenceOfOperation: 0,
        systemMode,
        absMinCoolSetpointLimit: minimumCoolSetpoint,
        absMaxCoolSetpointLimit: maximumSetpoint,
        minCoolSetpointLimit: minimumCoolSetpoint,
        maxCoolSetpointLimit: maximumSetpoint,
        ...(item.coolingTargetTemperatureC === undefined ? {} : {
          occupiedCoolingSetpoint: Math.round(item.coolingTargetTemperatureC * 100),
        }),
      };
    }
    // iAquaLink calls the lower threshold "chill" and the upper threshold
    // "heat"; Matter names those same boundaries heating and cooling.
    let heatingSetpoint = item.targetTemperatureC === undefined
      ? undefined
      : Math.round(item.targetTemperatureC * 100);
    let coolingSetpoint = item.targetTemperatureC === undefined
      ? undefined
      : Math.round(item.targetTemperatureC * 100);
    if (heatCool && heatingSetpoint !== undefined) {
      coolingSetpoint ??= heatingSetpoint + 278;
      if (coolingSetpoint - heatingSetpoint < 278) {
        coolingSetpoint = Math.min(maximumSetpoint, heatingSetpoint + 278);
        if (coolingSetpoint - heatingSetpoint < 278) {
          heatingSetpoint = coolingSetpoint - 278;
        }
      }
    }
    return {
      localTemperature: localTemperatureC === undefined ? null : Math.round(localTemperatureC * 100),
      // Homebridge's writable heating thermostat also inherits Presets.
      presetTypes: [{
        presetScenario: 1,
        numberOfPresets: 1,
        presetTypeFeatures: { automatic: false, supportsNames: false },
      }],
      numberOfPresets: 1,
      activePresetHandle: null,
      presets: [],
      ...(heatCool ? {
        // Homebridge 2.2.1's writable thermostat behavior inherits the Matter
        // Presets feature. Supply mandatory metadata without active presets.
        presetTypes: [{
          presetScenario: 1,
          numberOfPresets: 1,
          presetTypeFeatures: { automatic: false, supportsNames: false },
        }],
        numberOfPresets: 1,
        activePresetHandle: null,
        presets: [],
      } : {}),
      // Matter enum: CoolingOnly=0, HeatingOnly=2.
      controlSequenceOfOperation: heatCool ? 0 : 2,
      systemMode,
      absMinHeatSetpointLimit: minimumHeatSetpoint,
      absMaxHeatSetpointLimit: maximumSetpoint,
      minHeatSetpointLimit: minimumHeatSetpoint,
      maxHeatSetpointLimit: maximumSetpoint,
      ...(heatCool ? {
        absMinCoolSetpointLimit: minimumCoolSetpoint,
        absMaxCoolSetpointLimit: maximumSetpoint,
        minCoolSetpointLimit: minimumCoolSetpoint,
        maxCoolSetpointLimit: maximumSetpoint,
        // Matter only supports tenths of a degree Celsius here. Five degrees
        // Fahrenheit is 2.777...°C, so advertise 2.7°C; command writes still
        // enforce the controller's full 5°F separation.
        minSetpointDeadBand: 27,
      } : {}),
      ...(heatingSetpoint === undefined ? {} : {
        occupiedHeatingSetpoint: heatingSetpoint,
        ...(heatCool ? {
          occupiedCoolingSetpoint: coolingSetpoint,
        } : {}),
      }),
    };
  }

  private handlers(item: EquipmentState): MatterAccessory['handlers'] {
    if (item.kind === 'switch' || item.kind === 'light') {
      return {
        onOff: {
          on: () => this.commands.setPower(item.id, true),
          off: () => this.commands.setPower(item.id, false),
          toggle: () => this.commands.setPower(item.id, !(this.states.get(item.id)?.on ?? false)),
        },
      };
    }
    if (item.kind === 'heat-cool-thermostat') {
      return {
        thermostat: {
          systemModeChange: (args) => {
            const mode = args?.systemMode === 3 ? 'cool' : 'off';
            return this.commands.setThermostatMode(item.id, mode);
          },
          occupiedCoolingSetpointChange: (args) => this.commands.setCoolingTargetTemperature(
            item.id,
            (args?.occupiedCoolingSetpoint ?? 0) / 100,
          ),
        },
      };
    }
    if (item.kind === 'thermostat') {
      return {
        thermostat: {
          systemModeChange: (args) => this.commands.setThermostatMode(
            item.id,
            args?.systemMode === 4 ? 'heat' : 'off',
          ),
          occupiedHeatingSetpointChange: (args) => this.commands.setTargetTemperature(
            item.id,
            (args?.occupiedHeatingSetpoint ?? 0) / 100,
          ),
        },
      };
    }
    return {};
  }

  private matterUuid(id: EquipmentState['id']): string {
    return this.api.hap.uuid.generate(`iaqualink:matter:v7:${id}`);
  }
}
