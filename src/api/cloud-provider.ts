import { createHmac } from 'node:crypto';
import type { Logger } from 'homebridge';
import type { EquipmentId, EquipmentState, SystemSnapshot } from '../types.js';
import type { IAquaLinkProvider } from './provider.js';

const API_KEY = 'EOOEMOW4YR6QNB07';
const API_SIGNING_KEY = 'cj7iYKjiKxOqiLcN65PffA';
const LOGIN_URL = 'https://prod.zodiac-io.com/users/v1/login';
const REFRESH_URL = 'https://prod.zodiac-io.com/users/v1/refresh';
const SYSTEMS_URL = 'https://r-api.iaqualink.net/v2/devices.json';
const LEGACY_SYSTEMS_URL = 'https://r-api.iaqualink.net/devices.json';
const SESSION_URL = 'https://p-api.iaqualink.net/v2/mobile/session.json';
const LIGHT_PROGRAMS = [
  'Alpine White', 'Sky Blue', 'Cobalt Blue', 'Caribbean Blue', 'Spring Green',
  'Emerald Green', 'Emerald Rose', 'Magenta', 'Violet', 'Slow Color Splash',
  'Fast Color Splash', 'America The Beautiful', 'Fat Tuesday', 'Disco Tech',
];

type JsonObject = Record<string, unknown>;
type Fetch = typeof globalThis.fetch;

export interface CloudProviderOptions {
  fetch?: Fetch;
  enableCloudControl?: boolean;
  requestTimeoutMs?: number;
  maxRetries?: number;
  retryBaseDelayMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
}

export class CloudAuthenticationError extends Error {
  constructor(message = 'iAquaLink authentication failed. Check the configured email and password.') {
    super(message);
    this.name = 'CloudAuthenticationError';
  }
}

export class CloudRequestError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'CloudRequestError';
  }
}

/** Read-only cloud discovery adapter. Sensitive remote values are retained only in memory. */
export class CloudIAquaLinkProvider implements IAquaLinkProvider {
  private readonly fetch: Fetch;
  private readonly enableCloudControl: boolean;
  private readonly requestTimeoutMs: number;
  private readonly maxRetries: number;
  private readonly retryBaseDelayMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly now: () => number;
  private sessionId = '';
  private idToken = '';
  private authenticationToken = '';
  private refreshToken = '';
  private userId = '';
  private country = 'us';
  private systemSerial = '';
  private systemType = '';
  private connected = false;
  private temperatureScale = 'F';
  private heatPumpPresent = false;

  constructor(
    private readonly log: Logger,
    private readonly username: string,
    private readonly password: string,
    options: CloudProviderOptions = {},
  ) {
    this.fetch = options.fetch ?? globalThis.fetch;
    this.enableCloudControl = options.enableCloudControl ?? false;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 10_000;
    this.maxRetries = options.maxRetries ?? 2;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? 250;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
    this.now = options.now ?? Date.now;
  }

  async connect(): Promise<void> {
    await this.login();
    await this.discoverSystem();
    this.connected = true;
    this.log.info('Connected to iAquaLink cloud; one supported system is ready for sanitized discovery.');
  }

  async getSnapshot(): Promise<SystemSnapshot> {
    if (!this.connected) await this.connect();
    const homeResponse = await this.sessionCommand('get_home', {
      attached_test: 'true',
      country: this.country,
    });
    const home = flattenObjectArray(homeResponse.home_screen);
    const status = stringValue(home.status).toLowerCase();
    if (status && status !== 'online') throw new CloudRequestError('The iAquaLink system is not online.');
    const devicesResponse = await this.sessionCommand('get_devices');
    const equipment = mapEquipment(home, devicesResponse);
    if (stringValue(homeResponse.onetouch) === 'true') {
      addOneTouchEquipment(equipment, await this.sessionCommand('get_onetouch'));
    }
    this.temperatureScale = stringValue(home.temp_scale) || 'F';
    this.heatPumpPresent = equipment.some((item) => item.id === 'heat-pump');
    return {
      systemName: 'iAquaLink System',
      controllerType: controllerName(home, this.systemType),
      updatedAt: new Date(this.now()).toISOString(),
      equipment,
    };
  }

  async setPower(id: EquipmentId, on: boolean): Promise<void> {
    this.assertControlEnabled();
    const item = await this.currentEquipment(id);
    if (item.on === on) return;
    const command = stringValue(item.metadata?.command);
    if (id === 'heat-pump') {
      await this.sessionCommand('enable_disable_hpm', { on_off_action: on ? 'on' : 'off' });
      return;
    }
    if (item.kind === 'light') {
      if (stringValue(item.metadata?.subtype)) {
        await this.setLightMode(item, on ? 1 : 0);
      } else if (command) {
        await this.sessionCommand(command);
      } else {
        throw new CloudRequestError(`No verified iAquaLink power command is available for ${id}.`);
      }
      return;
    }
    if (!command) throw new CloudRequestError(`No verified iAquaLink power command is available for ${id}.`);
    await this.sessionCommand(command);
  }
  async setTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void> {
    this.assertControlEnabled();
    // Older cached thermostat handlers may still call the generic target path.
    // A Heat Pump / Chiller target always means the pool chill setpoint.
    if (id === 'heat-pump') {
      await this.setCoolingTargetTemperature(id, temperatureC);
      return;
    }
    const value = this.temperatureForApi(temperatureC, 34, 104);
    const snapshot = await this.getSnapshot();
    const current = snapshot.equipment.find((item) => item.id === id)?.targetTemperatureC;
    if (current !== undefined && Math.abs(current - temperatureC) < 0.05) return;
    if (this.heatPumpPresent) {
      const parameter = id === 'spa-heater' ? 'spaheatsetpointtemp' : 'poolheatsetpointtemp';
      if (id === 'spa-heater') {
        await this.sessionCommand('setpoint_hpm_temp', { [parameter]: value });
        return;
      }
      await this.sessionCommand('setpoint_hpm_temp', { [parameter]: value });
      const chillTemperatureC = snapshot.equipment.find(
        (item) => item.id === 'heat-pump',
      )?.coolingTargetTemperatureC;
      const adjustedChillC = temperatureC + 5 / 1.8;
      if (chillTemperatureC !== undefined
        && Math.abs(temperatureC - chillTemperatureC) < 5 / 1.8
        && adjustedChillC <= 40) {
        await this.sessionCommand('setpoint_hpm_temp', {
          poolchillsetpointtemp: this.temperatureForApi(adjustedChillC, 39, 104),
        });
      }
      return;
    }
    const pool = snapshot.equipment.find((item) => item.id === 'pool-heater')?.targetTemperatureC;
    const spa = snapshot.equipment.find((item) => item.id === 'spa-heater')?.targetTemperatureC;
    const requestedPool = id === 'pool-heater' ? temperatureC : pool;
    const requestedSpa = id === 'spa-heater' ? temperatureC : spa;
    const parameters: Record<string, string> = {};
    if (requestedSpa !== undefined) {
      parameters.temp1 = this.temperatureForApi(requestedSpa, 34, 104);
      if (requestedPool !== undefined) parameters.temp2 = this.temperatureForApi(requestedPool, 34, 104);
    } else if (requestedPool !== undefined) {
      parameters.temp1 = this.temperatureForApi(requestedPool, 34, 104);
    }
    await this.sessionCommand('set_temps', parameters);
  }
  async setCoolingTargetTemperature(id: EquipmentId, temperatureC: number): Promise<void> {
    this.assertControlEnabled();
    if (id !== 'heat-pump') {
      throw new CloudRequestError(`Cooling is not supported for ${id}.`);
    }
    await this.sessionCommand('setpoint_hpm_temp', {
      poolchillsetpointtemp: this.temperatureForApi(temperatureC, 39, 104),
    });
    const snapshot = await this.getSnapshot();
    const heatTemperatureC = snapshot.equipment.find(
      (item) => item.id === 'pool-heater',
    )?.targetTemperatureC;
    const adjustedHeatC = temperatureC - 5 / 1.8;
    if (heatTemperatureC !== undefined
      && Math.abs(heatTemperatureC - temperatureC) < 5 / 1.8
      && adjustedHeatC >= (34 - 32) / 1.8) {
      await this.sessionCommand('setpoint_hpm_temp', {
        poolheatsetpointtemp: this.temperatureForApi(adjustedHeatC, 34, 104),
      });
    }
  }
  async setThermostatMode(id: EquipmentId, mode: 'off' | 'heat' | 'cool' | 'auto'): Promise<void> {
    this.assertControlEnabled();
    if (id !== 'heat-pump') {
      if (id === 'pool-heater' && this.heatPumpPresent) {
        if (mode !== 'off' && mode !== 'heat') {
          throw new CloudRequestError(`${mode} mode is not supported for ${id}.`);
        }
        await this.setPower(id, mode !== 'off');
        return;
      }
      if (mode !== 'off' && mode !== 'heat') throw new CloudRequestError(`${mode} mode is not supported for ${id}.`);
      await this.setPower(id, mode === 'heat');
      return;
    }
    const item = await this.currentEquipment(id);
    if (item.kind === 'thermostat') {
      if (mode !== 'off' && mode !== 'heat') throw new CloudRequestError(`${mode} mode is not supported for ${id}.`);
      await this.setPower(id, mode === 'heat');
      return;
    }
    if (mode !== 'off' && mode !== 'cool') {
      throw new CloudRequestError(`${mode} mode is not supported for ${id}.`);
    }
    if (mode === 'off') {
      await this.setPower(id, false);
      return;
    }
    await this.sessionCommand('switch_hpm_mode', { hpm_mode: 'chill' });
    await this.setPower(id, true);
  }
  async setLightProgram(id: EquipmentId, program: string): Promise<void> {
    this.assertControlEnabled();
    const item = await this.currentEquipment(id);
    if (item.kind !== 'light') throw new CloudRequestError(`${id} is not a light.`);
    const programId = lightProgramId(program, stringValue(item.metadata?.subtype));
    await this.setLightMode(item, programId);
  }
  async disconnect(): Promise<void> { this.clearSession(); }

  private async login(): Promise<void> {
    const data = await this.requestJson(LOGIN_URL, 'authentication', {
      method: 'POST',
      headers: baseHeaders(),
      body: JSON.stringify({ api_key: API_KEY, email: this.username, password: this.password }),
    }, false);
    if (!isJsonObject(data)) throw new CloudAuthenticationError('iAquaLink returned an invalid authentication session.');
    this.applyAuthentication(data);
  }

  private async refreshAuthentication(): Promise<void> {
    if (!this.refreshToken) return this.login();
    try {
      const data = await this.requestJson(REFRESH_URL, 'session renewal', {
        method: 'POST',
        headers: baseHeaders(),
        body: JSON.stringify({ email: this.username, refresh_token: this.refreshToken }),
      }, false);
      if (!isJsonObject(data)) throw new CloudAuthenticationError('iAquaLink returned an invalid authentication session.');
      this.applyAuthentication(data, this.refreshToken);
    } catch (error) {
      if (!(error instanceof CloudAuthenticationError)) throw error;
      await this.login();
    }
  }

  private applyAuthentication(data: JsonObject, refreshFallback = ''): void {
    const oauth = objectValue(data.userPoolOAuth);
    const sessionId = stringValue(data.session_id);
    const authenticationToken = stringValue(data.authentication_token);
    const userId = stringValue(data.id);
    const idToken = stringValue(oauth.IdToken);
    const refreshToken = stringValue(oauth.RefreshToken) || refreshFallback;
    if (!sessionId || !authenticationToken || !userId || !idToken || !refreshToken) {
      this.clearSession();
      throw new CloudAuthenticationError('iAquaLink returned an incomplete authentication session.');
    }
    this.sessionId = sessionId;
    this.idToken = idToken;
    this.authenticationToken = authenticationToken;
    this.refreshToken = refreshToken;
    this.userId = userId;
    this.country = (stringValue(data.country) || 'us').toLowerCase();
  }

  private async discoverSystem(): Promise<void> {
    const timestamp = String(Math.floor(this.now() / 1000));
    const signature = createHmac('sha1', API_SIGNING_KEY).update(`${this.userId},${timestamp}`).digest('hex');
    const url = new URL(SYSTEMS_URL);
    url.search = new URLSearchParams({ user_id: this.userId, signature, timestamp }).toString();
    let data: unknown;
    try {
      data = await this.authenticatedJson(url, 'system discovery', { headers: this.authHeaders() });
    } catch (error) {
      if (!(error instanceof CloudRequestError) || error.status !== 400) throw error;
      this.log.debug('Signed iAquaLink discovery returned HTTP 400; retrying with the compatible device-list endpoint.');
      const legacyUrl = new URL(LEGACY_SYSTEMS_URL);
      legacyUrl.search = new URLSearchParams({
        api_key: API_KEY,
        authentication_token: this.authenticationToken,
        user_id: this.userId,
      }).toString();
      data = await this.authenticatedJson(legacyUrl, 'compatible system discovery', { headers: baseHeaders() });
    }
    if (!Array.isArray(data)) throw new CloudRequestError('iAquaLink system discovery returned an invalid result.');
    const supported = data.filter(isJsonObject).filter((system) => stringValue(system.device_type) === 'iaqua');
    if (supported.length === 0) throw new CloudRequestError('No supported iAquaLink controller was found on this account.');
    if (supported.length > 1) this.log.warn('Multiple supported iAquaLink systems were found; this preview uses the first system only.');
    this.systemSerial = stringValue(supported[0].serial_number);
    this.systemType = stringValue(supported[0].device_type);
    if (!this.systemSerial) throw new CloudRequestError('The discovered iAquaLink controller did not include a usable identifier.');
  }

  private async sessionCommand(command: string, parameters: Record<string, string> = {}): Promise<JsonObject> {
    const url = new URL(SESSION_URL);
    url.search = new URLSearchParams({
      ...parameters, actionID: 'command', command, serial: this.systemSerial, sessionID: this.sessionId,
    }).toString();
    const result = await this.authenticatedJson(url, `system ${command}`, { headers: this.authHeaders() });
    if (!isJsonObject(result)) throw new CloudRequestError(`iAquaLink system ${command} returned an invalid result.`);
    return result;
  }

  private async authenticatedJson(url: URL, operation: string, init: RequestInit): Promise<unknown> {
    try {
      return await this.requestJson(url, operation, init, true);
    } catch (error) {
      if (!(error instanceof CloudAuthenticationError)) throw error;
      await this.refreshAuthentication();
      const replayUrl = new URL(url);
      if (replayUrl.searchParams.has('sessionID')) replayUrl.searchParams.set('sessionID', this.sessionId);
      return this.requestJson(replayUrl, operation, { ...init, headers: this.authHeaders() }, true);
    }
  }

  private async requestJson(url: string | URL, operation: string, init: RequestInit, authBearing: boolean): Promise<unknown> {
    for (let attempt = 0; ; attempt += 1) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
      try {
        const response = await this.fetch(url, { ...init, signal: controller.signal });
        if (response.status === 401 || (response.status === 404 && authBearing)) throw new CloudAuthenticationError();
        if (response.status >= 500 && response.status <= 599 && attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        if (!response.ok) throw new CloudRequestError(
          `iAquaLink ${operation} failed with HTTP ${response.status}.`,
          response.status,
        );
        try {
          return await response.json();
        } catch {
          throw new CloudRequestError(`iAquaLink ${operation} returned invalid JSON.`);
        }
      } catch (error) {
        if (error instanceof CloudAuthenticationError || error instanceof CloudRequestError) throw error;
        if (isAbortError(error)) throw new CloudRequestError(`iAquaLink ${operation} timed out.`);
        if (attempt < this.maxRetries) {
          await this.backoff(attempt);
          continue;
        }
        throw new CloudRequestError(`iAquaLink ${operation} failed because the cloud service was unreachable.`);
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  private async backoff(attempt: number): Promise<void> {
    await this.sleep(this.retryBaseDelayMs * (2 ** attempt));
  }
  private assertControlEnabled(): void {
    if (!this.enableCloudControl) throw new Error('Cloud control is disabled. Enable it in the plugin settings before testing writes.');
  }
  private async currentEquipment(id: EquipmentId): Promise<EquipmentState> {
    const snapshot = await this.getSnapshot();
    const item = snapshot.equipment.find((candidate) => candidate.id === id);
    if (!item) throw new CloudRequestError(`Equipment ${id} is not available.`);
    if (item.metadata?.readOnly) throw new CloudRequestError(`${id} is read-only because no verified write command is available.`);
    return item;
  }
  private async setLightMode(item: EquipmentState, mode: number): Promise<void> {
    const aux = stringValue(item.metadata?.aux);
    const subtype = stringValue(item.metadata?.subtype);
    if (!aux || !subtype) throw new CloudRequestError(`Light command metadata is unavailable for ${item.id}.`);
    await this.sessionCommand('set_light', { aux, subtype, light: String(mode) });
  }
  private temperatureForApi(temperatureCelsius: number, minimumF: number, maximumF: number): string {
    const value = this.temperatureScale.toUpperCase() === 'C'
      ? Math.round(temperatureCelsius)
      : Math.round((temperatureCelsius * 9 / 5) + 32);
    const minimum = this.temperatureScale.toUpperCase() === 'C' ? Math.round((minimumF - 32) * 5 / 9) : minimumF;
    const maximum = this.temperatureScale.toUpperCase() === 'C' ? Math.round((maximumF - 32) * 5 / 9) : maximumF;
    if (value < minimum || value > maximum) {
      throw new CloudRequestError(`Target temperature must be between ${minimum} and ${maximum}°${this.temperatureScale.toUpperCase()}.`);
    }
    return String(value);
  }
  private authHeaders(): Record<string, string> {
    return { ...baseHeaders(), api_key: API_KEY, Authorization: `Bearer ${this.idToken}` };
  }
  private clearSession(): void {
    this.sessionId = ''; this.idToken = ''; this.authenticationToken = ''; this.refreshToken = ''; this.userId = '';
    this.systemSerial = ''; this.connected = false;
  }
}

function baseHeaders(): Record<string, string> {
  return { 'content-type': 'application/json', 'user-agent': 'okhttp/3.14.7' };
}
function isAbortError(error: unknown): boolean { return error instanceof Error && error.name === 'AbortError'; }
function isJsonObject(value: unknown): value is JsonObject {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function objectValue(value: unknown): JsonObject { return isJsonObject(value) ? value : {}; }
function stringValue(value: unknown): string {
  if (typeof value === 'string') return value;
  return typeof value === 'number' ? String(value) : '';
}
function flattenObjectArray(value: unknown): JsonObject {
  return Array.isArray(value) ? Object.assign({}, ...value.filter(isJsonObject)) : {};
}
function stateIsOn(value: unknown): boolean {
  return ['1', '3', 'true', 'on', 'enabled'].includes(stringValue(value).toLowerCase());
}
function temperatureC(value: unknown, scale: string): number | undefined {
  if (value === undefined || value === null || (typeof value === 'string' && value.trim() === '')) {
    return undefined;
  }
  const number = Number(value);
  if (!Number.isFinite(number)) return undefined;
  const converted = scale.toUpperCase() === 'C' ? number : (number - 32) * (5 / 9);
  return Math.round(converted * 10) / 10;
}
function controllerName(home: JsonObject, fallback: string): string {
  const systemType = stringValue(home.system_type);
  const controllerType = systemType && systemType !== '0' ? systemType : fallback === 'iaqua' ? 'iAquaLink' : fallback;
  return `Jandy ${controllerType || 'iAquaLink'} Controller`;
}

function mapEquipment(home: JsonObject, devicesResponse: JsonObject): EquipmentState[] {
  const equipment: EquipmentState[] = [];
  const scale = stringValue(home.temp_scale) || 'F';
  addTemperature(equipment, 'air-temperature', 'Air Temperature', home.air_temp, scale);
  addTemperature(equipment, 'pool-temperature', 'Pool Temperature', home.pool_temp, scale);
  addTemperature(equipment, 'spa-temperature', 'Spa Temperature', home.spa_temp, scale);
  addThermostat(equipment, 'pool-heater', 'Pool Heater', home.pool_heater, home.pool_set_point, scale);
  addThermostat(equipment, 'spa-heater', 'Spa Heater', home.spa_heater, home.spa_set_point, scale);
  addSwitch(equipment, 'filter-pump', 'Filter Pump', home.pool_pump, 'set_pool_pump');
  addSwitch(equipment, 'spa-mode', 'Spa Mode', home.spa_pump, 'set_spa_pump');
  addHeatPump(equipment, home, scale);
  addSaltWaterStatus(equipment, home);
  addAuxEquipment(equipment, devicesResponse);
  return equipment;
}
function addTemperature(
  equipment: EquipmentState[], id: EquipmentId, name: string, raw: unknown, scale: string,
): void {
  // The controller reports zero when a water-temperature probe has no current reading.
  if ((id === 'pool-temperature' || id === 'spa-temperature') && Number(raw) === 0) {
    equipment.push({ id, name, kind: 'temperature', available: false });
    return;
  }
  const value = temperatureC(raw, scale);
  if (value !== undefined) equipment.push({ id, name, kind: 'temperature', available: true, currentTemperatureC: value });
}
function addThermostat(
  equipment: EquipmentState[], id: EquipmentId, name: string, rawState: unknown, rawTarget: unknown, scale: string,
): void {
  const target = temperatureC(rawTarget, scale);
  if (target === undefined && rawState === undefined) return;
  const on = stateIsOn(rawState);
  equipment.push({
    id, name, kind: 'thermostat', available: true, on,
    ...(target !== undefined ? { targetTemperatureC: target } : {}),
    mode: on ? 'heat' : 'off', currentAction: on ? 'heating' : 'off',
    metadata: { command: id === 'spa-heater' ? 'set_spa_heater' : 'set_pool_heater' },
  });
}
function addSwitch(
  equipment: EquipmentState[], id: EquipmentId, name: string, rawState: unknown, command?: string,
): void {
  if (rawState !== undefined && rawState !== '') {
    equipment.push({
      id, name, kind: 'switch', available: true, on: stateIsOn(rawState),
      ...(command ? { metadata: { command } } : {}),
    });
  }
}
function addHeatPump(equipment: EquipmentState[], home: JsonObject, scale: string): void {
  const info = objectValue(home.heatpump_info);
  const present = info.isheatpumpPresent ?? info.isHPMPresent;
  if (!present || stringValue(present).toLowerCase() === 'false') return;
  const status = info.heatpumpstatus ?? info.HPMstatus;
  const mode = stringValue(info.heatpumpmode ?? info.HPMmode).toLowerCase();
  const on = stateIsOn(status);
  const currentAction = !on ? 'off' : mode.includes('chill') ? 'cooling' : 'heating';
  const heatingTarget = temperatureC(info.poolheatSetPointTemp ?? home.pool_set_point, scale);
  const coolingTarget = temperatureC(info.poolchillsetpointtemp ?? home.pool_chill_set_point, scale);
  const chillFlag = info.isChillAvailable
    ?? info.ischillavailable
    ?? info.isChillerAvailable
    ?? info.ischilleravailable;
  const chillAvailable = stateIsOn(chillFlag)
    || coolingTarget !== undefined
    || mode.includes('chill');
  equipment.push({
    id: 'heat-pump',
    name: chillAvailable ? 'Heat Pump / Chiller' : 'Pool Heater',
    kind: chillAvailable ? 'heat-cool-thermostat' : 'thermostat',
    available: true,
    on,
    mode: on ? (chillAvailable ? 'cool' : 'heat') : 'off',
    currentAction: chillAvailable && on ? 'cooling' : currentAction,
    ...(heatingTarget !== undefined ? { targetTemperatureC: heatingTarget } : {}),
    ...(chillAvailable && coolingTarget !== undefined ? { coolingTargetTemperatureC: coolingTarget } : {}),
    metadata: { coolingOnly: chillAvailable },
  });
}
function addSaltWaterStatus(equipment: EquipmentState[], home: JsonObject): void {
  const status = home.swg_status ?? home.aquapure_status ?? home.salt_status;
  if (status === undefined) return;
  equipment.push({
    id: 'swg', name: 'Salt Water Chlorinator', kind: 'switch', available: true,
    on: stateIsOn(home.swg ?? home.aquapure), metadata: { status: stringValue(status) || 'Available', readOnly: true },
  });
}
function addAuxEquipment(equipment: EquipmentState[], response: JsonObject): void {
  const screen = response.devices_screen;
  if (!Array.isArray(screen)) return;
  for (const row of screen.slice(3).filter(isJsonObject)) {
    const [auxName, rawAttributes] = Object.entries(row)[0] ?? [];
    if (!auxName || !Array.isArray(rawAttributes)) continue;
    const attributes = flattenObjectArray(rawAttributes);
    const label = stringValue(attributes.label) || auxName.replaceAll('_', ' ');
    const normalized = label.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
    const id = auxEquipmentId(normalized);
    if (!id || equipment.some((item) => item.id === id)) continue;
    const light = stringValue(attributes.type) === '2' || normalized.includes('light');
    equipment.push({
      id, name: equipmentName(id), kind: light ? 'light' : 'switch', available: true,
      on: stateIsOn(attributes.state),
      metadata: {
        command: `set_aux_${auxName.replace(/^aux_/, '')}`,
        aux: auxName.replace(/^aux_/, ''),
        type: stringValue(attributes.type),
        subtype: stringValue(attributes.subtype),
      },
      ...(light ? { lightPrograms: LIGHT_PROGRAMS } : {}),
    });
  }
}
function auxEquipmentId(label: string): EquipmentId | undefined {
  if (label.includes('pool') && label.includes('light')) return 'pool-light';
  if (label.includes('spa') && label.includes('light')) return 'spa-light';
  if (label.includes('blower')) return 'air-blower';
  if (label.includes('sheer') || label.includes('waterfall')) return 'sheer-descent';
  if (label.includes('high') && label.includes('speed')) return 'high-speed';
  return undefined;
}
function equipmentName(id: EquipmentId): string {
  const names: Partial<Record<EquipmentId, string>> = {
    'pool-light': 'Pool Light', 'spa-light': 'Spa Light', 'air-blower': 'Air Blower',
    'sheer-descent': 'Sheer Descent', 'high-speed': 'High Speed',
  };
  return names[id] ?? id;
}
function addOneTouchEquipment(equipment: EquipmentState[], response: JsonObject): void {
  const oneTouch = flattenObjectArray(response.onetouch_screen);
  for (const [name, raw] of Object.entries(oneTouch)) {
    if (!name.startsWith('onetouch_') || !Array.isArray(raw)) continue;
    const attributes = flattenObjectArray(raw);
    const id = auxEquipmentId(stringValue(attributes.label).toLowerCase());
    if (!id || equipment.some((item) => item.id === id)) continue;
    equipment.push({
      id, name: equipmentName(id), kind: 'switch', available: true, on: stateIsOn(attributes.state),
      metadata: { command: `set_${name}` },
    });
  }
}

function lightProgramId(program: string, subtype: string): number {
  const common: Record<string, number> = {
    'Alpine White': 1, 'Sky Blue': 2, 'Cobalt Blue': 3, 'Caribbean Blue': 4,
    'Spring Green': 5, 'Emerald Green': 6, 'Emerald Rose': 7, Magenta: 8,
  };
  if (program in common) return common[program];
  const mapping: Record<string, number> = subtype === '1'
    ? { 'Garnet Red': 9, Violet: 10, 'Color Splash': 11 }
    : {
        Violet: 9, 'Slow Splash': 10, 'Slow Color Splash': 10,
        'Fast Splash': 11, 'Fast Color Splash': 11,
        'USA!': 12, 'America The Beautiful': 12, 'Fat Tuesday': 13, 'Disco Tech': 14,
      };
  const id = mapping[program];
  if (id === undefined) {
    throw new CloudRequestError(`Light program "${program}" is not supported for subtype ${subtype || 'unknown'}.`);
  }
  return id;
}
