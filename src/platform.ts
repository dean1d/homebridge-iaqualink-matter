import type { API, Characteristic, DynamicPlatformPlugin, Logger, MatterAccessory, PlatformAccessory, Service } from 'homebridge';
import { CloudIAquaLinkProvider } from './api/cloud-provider.js';
import { MockIAquaLinkProvider } from './api/mock-provider.js';
import type { IAquaLinkProvider } from './api/provider.js';
import { HapEquipmentAccessory } from './accessories/hap-accessory.js';
import { MatterPublisher } from './matter/matter-publisher.js';
import { redact } from './diagnostics/redact.js';
import { PLUGIN_NAME, PLATFORM_NAME } from './settings.js';
import type { EquipmentId, EquipmentState, IAquaLinkConfig, SystemSnapshot } from './types.js';
import { CommandQueue } from './util/command-queue.js';

export class IAquaLinkPlatform implements DynamicPlatformPlugin {
  readonly Service: typeof Service;
  readonly Characteristic: typeof Characteristic;
  private readonly cachedAccessories: PlatformAccessory[] = [];
  private readonly handlers = new Map<EquipmentId, HapEquipmentAccessory>();
  private readonly queue = new CommandQueue();
  private readonly pendingStates = new Map<EquipmentId, {
    values: Partial<EquipmentState>;
    expiresAt: number;
  }>();
  private readonly provider: IAquaLinkProvider;
  private readonly matterPublisher: MatterPublisher;
  private snapshot?: SystemSnapshot;
  private timer?: NodeJS.Timeout;

  constructor(readonly log: Logger, readonly config: IAquaLinkConfig, readonly api: API) {
    this.Service = api.hap.Service;
    this.Characteristic = api.hap.Characteristic;
    this.provider = config.useMockApi
      ? new MockIAquaLinkProvider()
      : new CloudIAquaLinkProvider(log, config.username, config.password, {
          enableCloudControl: config.enableCloudControl !== false,
        });
    this.matterPublisher = new MatterPublisher(api, log, {
      setPower: (id, on) => this.setPower(id, on),
      setTargetTemperature: (id, temperatureC) => this.setTargetTemperature(id, temperatureC),
      setCoolingTargetTemperature: (id, temperatureC) => this.setCoolingTargetTemperature(id, temperatureC),
      setThermostatMode: (id, mode) => this.setThermostatMode(id, mode),
    });
    api.on('didFinishLaunching', () => void this.launch());
    api.on('shutdown', () => void this.shutdown());
  }

  configureAccessory(accessory: PlatformAccessory): void {
    this.cachedAccessories.push(accessory);
  }

  configureMatterAccessory(accessory: MatterAccessory): void {
    this.matterPublisher.configureMatterAccessory(accessory);
  }

  async setPower(id: EquipmentId, on: boolean): Promise<void> {
    const preferredProgram = id === 'pool-light'
      ? this.config.poolLightProgram
      : id === 'spa-light'
        ? this.config.spaLightProgram
        : undefined;
    if (on && preferredProgram) {
      await this.runCommand(id, () => this.provider.setLightProgram(id, preferredProgram));
      return;
    }
    await this.runCommand(id, () => this.provider.setPower(id, on));
  }
  async setTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void> {
    if (id === 'heat-pump') {
      await this.setCoolingTargetTemperature(id, temperatureC);
      return;
    }
    await this.runCommand(id, () => this.provider.setTargetTemperature(id, temperatureC), () => {
      this.rememberPending(id, { targetTemperatureC: temperatureC });
      if (id === 'pool-heater') {
        const chill = this.snapshot?.equipment.find(
          (item) => item.id === 'heat-pump',
        )?.coolingTargetTemperatureC;
        const adjustedChill = temperatureC + 5 / 1.8;
        if (chill !== undefined && Math.abs(temperatureC - chill) < 5 / 1.8 && adjustedChill <= 40) {
          this.rememberPending('heat-pump', { coolingTargetTemperatureC: adjustedChill });
        }
      }
    });
  }
  async setCoolingTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void> {
    await this.runCommand(id, () => this.provider.setCoolingTargetTemperature(id, temperatureC), () => {
      this.rememberPending('heat-pump', { coolingTargetTemperatureC: temperatureC });
      const heat = this.snapshot?.equipment.find(
        (item) => item.id === 'pool-heater',
      )?.targetTemperatureC;
      const adjustedHeat = temperatureC - 5 / 1.8;
      if (heat !== undefined
        && Math.abs(heat - temperatureC) < 5 / 1.8
        && adjustedHeat >= (34 - 32) / 1.8) {
        this.rememberPending('pool-heater', { targetTemperatureC: adjustedHeat });
      }
    });
  }
  async setThermostatMode(id: EquipmentId, mode: 'off' | 'heat' | 'cool' | 'auto'): Promise<void> {
    await this.runCommand(id, () => this.provider.setThermostatMode(id, mode));
  }
  async setLightProgram(id: EquipmentId, program: string): Promise<void> {
    await this.runCommand(id, () => this.provider.setLightProgram(id, program));
  }

  currentWaterTemperature(id: EquipmentId): number | undefined {
    const temperatureId = id === 'spa-heater' ? 'spa-temperature' : 'pool-temperature';
    return this.snapshot?.equipment.find((item) => item.id === temperatureId)?.currentTemperatureC;
  }

  private async runCommand(
    id: EquipmentId,
    command: () => Promise<void>,
    onSuccess?: () => void,
  ): Promise<void> {
    try {
      await this.queue.enqueue(command);
      onSuccess?.();
    } catch (error) {
      this.log.warn(`Command for ${id} was not applied: ${error instanceof Error ? error.message : String(error)}`);
    }
    await this.refresh();
  }

  private async launch(): Promise<void> {
    try {
      await this.provider.connect();
      await this.refresh(true);
      const interval = Math.max(15, this.config.pollIntervalSeconds ?? 30) * 1000;
      this.timer = setInterval(() => void this.refresh(), interval);
    } catch (error) {
      this.log.error(`Unable to start iAquaLink: ${String(error)}`);
    }
  }

  private async refresh(initial = false): Promise<void> {
    try {
      const receivedSnapshot = await this.provider.getSnapshot();
      const poolTemperature = receivedSnapshot.equipment.find(
        (item) => item.id === 'pool-temperature',
      )?.currentTemperatureC;
      const spaTemperature = receivedSnapshot.equipment.find(
        (item) => item.id === 'spa-temperature',
      )?.currentTemperatureC;
      const equipment = receivedSnapshot.equipment.map((item) => {
        const pending = this.pendingStates.get(item.id);
        let currentItem = item;
        if (pending) {
          const matches = Object.entries(pending.values).every(([key, value]) => {
            const actual = item[key as keyof EquipmentState];
            return typeof actual === 'number' && typeof value === 'number'
              ? Math.abs(actual - value) < 0.06
              : actual === value;
          });
          if (matches || pending.expiresAt <= Date.now()) {
            this.pendingStates.delete(item.id);
          } else {
            currentItem = { ...item, ...pending.values };
          }
        }
        if (currentItem.id === 'pool-heater' || currentItem.id === 'heat-pump') {
          return { ...currentItem, currentTemperatureC: poolTemperature };
        }
        if (currentItem.id === 'spa-heater') {
          return { ...currentItem, currentTemperatureC: spaTemperature };
        }
        return currentItem;
      });
      const snapshot = { ...receivedSnapshot, equipment };
      this.snapshot = snapshot;
      if (this.config.diagnosticMode) this.log.debug(`Sanitized snapshot: ${JSON.stringify(redact(snapshot))}`);
      if (initial) this.discover(snapshot.equipment);
      for (const item of snapshot.equipment) this.handlers.get(item.id)?.update(item);
      if (!initial) void this.matterPublisher.update(snapshot.equipment);
    } catch (error) {
      this.log.warn(`Refresh failed: ${String(error)}`);
    }
  }

  private rememberPending(id: EquipmentId, values: Partial<EquipmentState>): void {
    const existing = this.pendingStates.get(id)?.values ?? {};
    this.pendingStates.set(id, {
      values: { ...existing, ...values },
      // iAquaLink can return its pre-command state for one or more polls.
      expiresAt: Date.now() + Math.max(60_000, (this.config.pollIntervalSeconds ?? 30) * 2_000),
    });
  }

  private discover(equipment: EquipmentState[]): void {
    for (const item of equipment) {
      const uuid = this.api.hap.uuid.generate(`iaqualink:${item.id}`);
      let accessory = this.cachedAccessories.find((candidate) => candidate.UUID === uuid);
      if (!accessory) {
        accessory = new this.api.platformAccessory(item.name, uuid);
        accessory.context.equipmentId = item.id;
        this.api.registerPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, [accessory]);
      }
      this.handlers.set(item.id, new HapEquipmentAccessory(this, accessory, item));
    }
    const valid = new Set(equipment.map((item) => this.api.hap.uuid.generate(`iaqualink:${item.id}`)));
    const stale = this.cachedAccessories.filter((accessory) => !valid.has(accessory.UUID));
    if (stale.length) this.api.unregisterPlatformAccessories(PLUGIN_NAME, PLATFORM_NAME, stale);
    this.matterPublisher.publish(equipment);
    void this.matterPublisher.update(equipment);
  }

  private async shutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.provider.disconnect();
  }
}
