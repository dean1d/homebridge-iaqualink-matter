import type { PlatformAccessory, Service } from 'homebridge';
import type { IAquaLinkPlatform } from '../platform.js';
import type { EquipmentState } from '../types.js';

export class HapEquipmentAccessory {
  private readonly service: Service;
  private readonly programServices: Service[] = [];
  private state: EquipmentState;

  constructor(
    private readonly platform: IAquaLinkPlatform,
    private readonly accessory: PlatformAccessory,
    initialState: EquipmentState,
  ) {
    this.state = initialState;
    this.accessory.getService(this.platform.Service.AccessoryInformation)!
      .setCharacteristic(this.platform.Characteristic.Manufacturer, 'Jandy')
      .setCharacteristic(this.platform.Characteristic.Model, initialState.kind)
      .setCharacteristic(this.platform.Characteristic.SerialNumber, initialState.id);

    this.service = this.createService(initialState);
    this.configure(initialState);
  }

  update(state: EquipmentState): void {
    this.state = state;
    const C = this.platform.Characteristic;
    if (state.kind === 'temperature') {
      this.service.updateCharacteristic(C.StatusActive, state.available);
      this.service.updateCharacteristic(C.StatusFault, state.available ? C.StatusFault.NO_FAULT : C.StatusFault.GENERAL_FAULT);
      if (state.currentTemperatureC === undefined) {
        this.service.updateCharacteristic(C.CurrentTemperature, new Error('The controller has no current temperature reading.'));
      } else {
        this.service.updateCharacteristic(C.CurrentTemperature, state.currentTemperatureC);
      }
    }
    if (state.kind === 'switch') this.service.updateCharacteristic(C.On, state.on ?? false);
    if (state.kind === 'light') {
      this.service.updateCharacteristic(C.On, state.on ?? false);
      for (const programService of this.programServices) {
        programService.updateCharacteristic(C.On, false);
      }
    }
    if (state.kind === 'thermostat' || state.kind === 'heat-cool-thermostat') {
      const currentTemperature = state.currentTemperatureC ?? this.platform.currentWaterTemperature(state.id);
      if (currentTemperature === undefined) {
        // HomeKit requires Thermostat.CurrentTemperature to be numeric and
        // logs a handler error if an unavailable value is returned.
        this.service.updateCharacteristic(C.CurrentTemperature, 0);
      } else {
        this.service.updateCharacteristic(C.CurrentTemperature, currentTemperature);
      }
      if (state.targetTemperatureC !== undefined) {
        this.service.updateCharacteristic(
          C.TargetTemperature,
          state.id === 'heat-pump' && state.coolingTargetTemperatureC !== undefined
            ? state.coolingTargetTemperatureC
            : state.targetTemperatureC,
        );
        if (state.kind === 'heat-cool-thermostat' && state.id !== 'heat-pump') {
          this.service.updateCharacteristic(C.CoolingThresholdTemperature, state.targetTemperatureC);
        }
      }
      if (state.kind === 'heat-cool-thermostat' && state.id !== 'heat-pump'
        && state.coolingTargetTemperatureC !== undefined) {
        this.service.updateCharacteristic(C.HeatingThresholdTemperature, state.coolingTargetTemperatureC);
      }
    }
  }

  private createService(state: EquipmentState): Service {
    const S = this.platform.Service;
    if (state.kind === 'temperature') return this.accessory.getService(S.TemperatureSensor) ?? this.accessory.addService(S.TemperatureSensor);
    if (state.kind === 'light') {
      const existing = this.accessory.getService(S.Lightbulb);
      if (existing && this.accessory.context.lightUiVersion !== 2) {
        this.accessory.removeService(existing);
      }
      this.accessory.context.lightUiVersion = 2;
      return this.accessory.getService(S.Lightbulb) ?? this.accessory.addService(S.Lightbulb, 'Light');
    }
    if (state.kind === 'thermostat' || state.kind === 'heat-cool-thermostat') {
      const existing = this.accessory.getService(S.Thermostat);
      if (existing && this.accessory.context.thermostatUiVersion !== 4) {
        this.accessory.removeService(existing);
      }
      this.accessory.context.thermostatUiVersion = 4;
      return this.accessory.getService(S.Thermostat) ?? this.accessory.addService(S.Thermostat);
    }
    return this.accessory.getService(S.Switch) ?? this.accessory.addService(S.Switch);
  }

  private configure(state: EquipmentState): void {
    const C = this.platform.Characteristic;
    if (state.kind === 'temperature') {
      this.service.setCharacteristic(C.StatusActive, state.available);
      this.service.setCharacteristic(C.StatusFault, state.available ? C.StatusFault.NO_FAULT : C.StatusFault.GENERAL_FAULT);
      return;
    }
    if (state.kind === 'switch') {
      this.service.getCharacteristic(C.On)
        .onGet(() => this.state.on ?? false)
        .onSet((value) => this.platform.setPower(state.id, Boolean(value)));
      return;
    }
    if (state.kind === 'light') {
      this.service.displayName = 'Light';
      this.service.setPrimaryService(true);
      this.service.setCharacteristic(C.Name, 'Light');
      this.service.setCharacteristic(C.ConfiguredName, 'Light');
      this.service.getCharacteristic(C.On).onGet(() => this.state.on ?? false).onSet((value) => this.platform.setPower(state.id, Boolean(value)));
      this.service.removeCharacteristic(this.service.getCharacteristic(C.Hue));
      this.service.removeCharacteristic(this.service.getCharacteristic(C.Saturation));
      this.service.removeCharacteristic(this.service.getCharacteristic(C.Brightness));
      if (this.platform.config.exposeLightShows !== false) this.configureLightPrograms(state);
      return;
    }
    this.configureThermostat(state);
  }

  private configureThermostat(state: EquipmentState): void {
    const C = this.platform.Characteristic;
    const minimumTargetC = state.id === 'heat-pump' ? 3.9 : 1.1;
    if (state.currentTemperatureC !== undefined) {
      this.service.setCharacteristic(C.CurrentTemperature, state.currentTemperatureC);
    } else {
      this.service.updateCharacteristic(C.CurrentTemperature, 0);
    }
    this.service.getCharacteristic(C.CurrentTemperature)
      .onGet(() => {
        const currentTemperature = this.state.currentTemperatureC
          ?? this.platform.currentWaterTemperature(state.id);
        return currentTemperature ?? 0;
      });
    this.service.getCharacteristic(C.TargetTemperature)
      .setProps({ minValue: minimumTargetC, maxValue: 40, minStep: 0.1 })
      .onGet(() => state.id === 'heat-pump'
        ? this.state.coolingTargetTemperatureC ?? 24
        : this.state.targetTemperatureC ?? 24)
      .onSet((value) => state.id === 'heat-pump'
        ? this.platform.setCoolingTargetTemperature(state.id, Number(value))
        : this.platform.setTargetTemperature(state.id, Number(value)));
    if (state.kind === 'heat-cool-thermostat' && state.id !== 'heat-pump') {
      this.service.getCharacteristic(C.HeatingThresholdTemperature)
        .setProps({ minValue: 3.9, maxValue: 40, minStep: 0.1 })
        .onGet(() => this.state.coolingTargetTemperatureC ?? 24)
        .onSet((value) => this.platform.setCoolingTargetTemperature(state.id, Number(value)));
      this.service.getCharacteristic(C.CoolingThresholdTemperature)
        .setProps({ minValue: 1.1, maxValue: 40, minStep: 0.1 })
        .onGet(() => this.state.targetTemperatureC ?? 30)
        .onSet((value) => this.platform.setTargetTemperature(state.id, Number(value)));
    }
    this.service.getCharacteristic(C.CurrentHeatingCoolingState).onGet(() => {
      if (this.state.currentAction === 'heating') return C.CurrentHeatingCoolingState.HEAT;
      if (this.state.currentAction === 'cooling') return C.CurrentHeatingCoolingState.COOL;
      return C.CurrentHeatingCoolingState.OFF;
    });
    const allowedModes = state.kind === 'heat-cool-thermostat'
      ? [C.TargetHeatingCoolingState.OFF, C.TargetHeatingCoolingState.COOL]
      : [C.TargetHeatingCoolingState.OFF, C.TargetHeatingCoolingState.HEAT];
    this.service.getCharacteristic(C.TargetHeatingCoolingState)
      .setProps({ validValues: allowedModes })
      .onGet(() => this.targetMode()).onSet((value) => {
      const mode = Number(value) === C.TargetHeatingCoolingState.HEAT ? 'heat' : Number(value) === C.TargetHeatingCoolingState.COOL ? 'cool' : Number(value) === C.TargetHeatingCoolingState.AUTO ? 'auto' : 'off';
      return this.platform.setThermostatMode(state.id, mode);
    });
  }

  private targetMode(): number {
    const C = this.platform.Characteristic;
    if (this.state.mode === 'heat') return C.TargetHeatingCoolingState.HEAT;
    if (this.state.mode === 'cool') return C.TargetHeatingCoolingState.COOL;
    if (this.state.mode === 'auto') return C.TargetHeatingCoolingState.AUTO;
    return C.TargetHeatingCoolingState.OFF;
  }

  private configureLightPrograms(state: EquipmentState): void {
    const S = this.platform.Service;
    const C = this.platform.Characteristic;
    for (const program of state.lightPrograms ?? []) {
      const subtype = `program:${program}`;
      const service = this.accessory.getServiceById(S.Switch, subtype)
        ?? this.accessory.addService(S.Switch, program, subtype);
      service.setCharacteristic(C.Name, program);
      service.setCharacteristic(C.ConfiguredName, program);
      service.getCharacteristic(C.On)
        .onGet(() => false)
        .onSet(async (value) => {
          if (!value) return;
          setTimeout(() => service.updateCharacteristic(C.On, false), 1000);
          await this.platform.setLightProgram(state.id, program);
        });
      this.programServices.push(service);
    }
  }
}
