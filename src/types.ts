import type { PlatformConfig } from 'homebridge';

export interface IAquaLinkConfig extends PlatformConfig {
  username: string;
  password: string;
  hapEnabled?: boolean;
  matterEnabled?: boolean;
  enableCloudControl?: boolean;
  pollIntervalSeconds?: number;
  diagnosticMode?: boolean;
  optimisticUpdates?: boolean;
  restoreLastLightProgram?: boolean;
  exposeLightShows?: boolean;
  poolLightProgram?: string;
  spaLightProgram?: string;
  useMockApi?: boolean;
}

export type DeviceKind =
  | 'temperature'
  | 'switch'
  | 'thermostat'
  | 'heat-cool-thermostat'
  | 'light';

export type EquipmentId =
  | 'air-temperature'
  | 'pool-temperature'
  | 'spa-temperature'
  | 'pool-heater'
  | 'spa-heater'
  | 'heat-pump'
  | 'filter-pump'
  | 'spa-mode'
  | 'air-blower'
  | 'sheer-descent'
  | 'high-speed'
  | 'pool-light'
  | 'spa-light'
  | 'swg';

export interface EquipmentState {
  id: EquipmentId;
  name: string;
  kind: DeviceKind;
  available: boolean;
  on?: boolean;
  currentTemperatureC?: number;
  targetTemperatureC?: number;
  coolingTargetTemperatureC?: number;
  mode?: 'off' | 'heat' | 'cool' | 'auto';
  currentAction?: 'off' | 'idle' | 'heating' | 'cooling';
  lightProgram?: string;
  lightPrograms?: string[];
  metadata?: Record<string, unknown>;
}

export interface SystemSnapshot {
  systemName: string;
  controllerType: string;
  updatedAt: string;
  equipment: EquipmentState[];
}
