import type { EquipmentId, EquipmentState, SystemSnapshot } from '../types.js';
import type { IAquaLinkProvider } from './provider.js';

const programs = [
  'Alpine White', 'Sky Blue', 'Cobalt Blue', 'Caribbean Blue', 'Spring Green',
  'Emerald Green', 'Emerald Rose', 'Magenta', 'Violet', 'Slow Color Splash',
  'Fast Color Splash', 'America The Beautiful', 'Fat Tuesday', 'Disco Tech',
];

export class MockIAquaLinkProvider implements IAquaLinkProvider {
  private equipment: EquipmentState[] = [
    { id: 'air-temperature', name: 'Air Temperature', kind: 'temperature', available: true, currentTemperatureC: 33.9 },
    { id: 'pool-temperature', name: 'Pool Temperature', kind: 'temperature', available: true, currentTemperatureC: 29.4 },
    { id: 'spa-temperature', name: 'Spa Temperature', kind: 'temperature', available: true, currentTemperatureC: 30.0 },
    { id: 'pool-heater', name: 'Pool Heater', kind: 'thermostat', available: true, on: false, targetTemperatureC: 23.9, mode: 'off', currentAction: 'off' },
    { id: 'spa-heater', name: 'Spa Heater', kind: 'thermostat', available: true, on: false, targetTemperatureC: 38.9, mode: 'off', currentAction: 'off' },
    { id: 'heat-pump', name: 'Heat Pump / Chiller', kind: 'heat-cool-thermostat', available: true, on: false, targetTemperatureC: 23.9, coolingTargetTemperatureC: 30.0, mode: 'off', currentAction: 'off' },
    { id: 'filter-pump', name: 'Filter Pump', kind: 'switch', available: true, on: false },
    { id: 'spa-mode', name: 'Spa Mode', kind: 'switch', available: true, on: false },
    { id: 'air-blower', name: 'Air Blower', kind: 'switch', available: true, on: false },
    { id: 'sheer-descent', name: 'Sheer Descent', kind: 'switch', available: true, on: true },
    { id: 'high-speed', name: 'High Speed', kind: 'switch', available: true, on: false },
    { id: 'pool-light', name: 'Pool Light', kind: 'light', available: true, on: false, lightProgram: 'Caribbean Blue', lightPrograms: programs },
    { id: 'spa-light', name: 'Spa Light', kind: 'light', available: true, on: false, lightProgram: 'Caribbean Blue', lightPrograms: programs },
    { id: 'swg', name: 'Salt Water Chlorinator', kind: 'switch', available: true, on: false, metadata: { status: 'Standby' } },
  ];

  async connect(): Promise<void> {}
  async disconnect(): Promise<void> {}

  async getSnapshot(): Promise<SystemSnapshot> {
    return { systemName: 'Pool', controllerType: 'RS4 Combo', updatedAt: new Date().toISOString(), equipment: structuredClone(this.equipment) };
  }

  async setPower(id: EquipmentId, on: boolean): Promise<void> {
    const item = this.require(id);
    item.on = on;
    if ('mode' in item && !on) item.mode = 'off';
  }

  async setTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void> {
    this.require(id).targetTemperatureC = temperatureC;
  }

  async setCoolingTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void> {
    this.require(id).coolingTargetTemperatureC = temperatureC;
  }

  async setThermostatMode(id: EquipmentId, mode: 'off' | 'heat' | 'cool' | 'auto'): Promise<void> {
    const item = this.require(id);
    item.mode = mode;
    item.on = mode !== 'off';
  }

  async setLightProgram(id: EquipmentId, program: string): Promise<void> {
    const item = this.require(id);
    if (!item.lightPrograms?.includes(program)) throw new Error(`Unsupported light program: ${program}`);
    item.lightProgram = program;
    item.on = true;
  }

  private require(id: EquipmentId): EquipmentState {
    const item = this.equipment.find((candidate) => candidate.id === id);
    if (!item) throw new Error(`Unknown equipment: ${id}`);
    return item;
  }
}
