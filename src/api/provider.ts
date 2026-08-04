import type { EquipmentId, SystemSnapshot } from '../types.js';

export interface IAquaLinkProvider {
  connect(): Promise<void>;
  getSnapshot(): Promise<SystemSnapshot>;
  setPower(id: EquipmentId, on: boolean): Promise<void>;
  setTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void>;
  setCoolingTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void>;
  setThermostatMode(id: EquipmentId, mode: 'off' | 'heat' | 'cool' | 'auto'): Promise<void>;
  setLightProgram(id: EquipmentId, program: string): Promise<void>;
  disconnect(): Promise<void>;
}
