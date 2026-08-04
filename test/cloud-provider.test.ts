import type { Logger } from 'homebridge';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';
import {
  CloudAuthenticationError,
  CloudIAquaLinkProvider,
  CloudRequestError,
} from '../src/api/cloud-provider.js';

const fixture = (name: string): unknown => JSON.parse(readFileSync(
  fileURLToPath(new URL(`fixtures/${name}.json`, import.meta.url)),
  'utf8',
));
const login = fixture('login');
const systems = fixture('systems');
const home = fixture('home');
const devices = fixture('devices');

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function logger(): Logger {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  } as unknown as Logger;
}

function provider(fetchMock: ReturnType<typeof vi.fn>, overrides = {}) {
  return new CloudIAquaLinkProvider(logger(), 'owner@example.invalid', 'fixture-password', {
    fetch: fetchMock as typeof fetch,
    sleep: vi.fn(async () => undefined),
    now: () => 1_750_000_000_000,
    ...overrides,
  });
}

describe('CloudIAquaLinkProvider', () => {
  it('reports login failure without response details', async () => {
    const fetchMock = vi.fn(async () => response({ password: 'leaked-secret' }, 401));
    await expect(provider(fetchMock).connect()).rejects.toBeInstanceOf(CloudAuthenticationError);
    await expect(provider(fetchMock).connect()).rejects.not.toThrow(/leaked-secret|owner@/);
  });

  it('discovers and maps a sanitized RS4 Combo inventory', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems))
      .mockResolvedValueOnce(response(home))
      .mockResolvedValueOnce(response(devices));
    const cloud = provider(fetchMock);
    await cloud.connect();
    const snapshot = await cloud.getSnapshot();
    expect(snapshot.systemName).toBe('iAquaLink System');
    expect(snapshot.controllerType).toBe('Jandy RS4 Combo Controller');
    expect(snapshot.equipment.map((item) => item.id)).toEqual(expect.arrayContaining([
      'air-temperature', 'pool-temperature', 'spa-temperature', 'pool-heater', 'spa-heater',
      'heat-pump', 'filter-pump', 'spa-mode', 'air-blower', 'sheer-descent', 'high-speed',
      'pool-light', 'spa-light', 'swg',
    ]));
    expect(snapshot.equipment.find((item) => item.id === 'air-temperature')?.currentTemperatureC).toBe(33.9);
    expect(snapshot.equipment.find((item) => item.id === 'pool-temperature')?.currentTemperatureC).toBe(29.4);
    expect(snapshot.equipment.find((item) => item.id === 'spa-heater')?.targetTemperatureC).toBe(38.9);
    expect(snapshot.equipment.find((item) => item.id === 'heat-pump')).toMatchObject({
      name: 'Heat Pump / Chiller',
      mode: 'cool',
    });
    expect(snapshot.equipment.find((item) => item.id === 'pool-heater')).toMatchObject({
      kind: 'thermostat',
      mode: 'off',
    });
    expect(JSON.stringify(snapshot)).not.toContain('FIXTURE-SERIAL');
  });

  it('omits unavailable zero-valued water temperatures and ignores controller type zero', async () => {
    const unavailableHome = structuredClone(home) as { home_screen: Array<Record<string, unknown>> };
    unavailableHome.home_screen = unavailableHome.home_screen.map((item) => (
      'spa_temp' in item ? { spa_temp: '0' } : 'system_type' in item ? { system_type: '0' } : item
    ));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems))
      .mockResolvedValueOnce(response(unavailableHome))
      .mockResolvedValueOnce(response(devices));
    const cloud = provider(fetchMock);
    await cloud.connect();
    const snapshot = await cloud.getSnapshot();
    expect(snapshot.controllerType).toBe('Jandy iAquaLink Controller');
    const unavailableSpa = snapshot.equipment.find((item) => item.id === 'spa-temperature');
    expect(unavailableSpa).toMatchObject({ available: false });
    expect(unavailableSpa).not.toHaveProperty('currentTemperatureC');
  });

  it('does not convert blank controller setpoints into negative temperatures', async () => {
    const blankSetpointHome = structuredClone(home) as { home_screen: Array<Record<string, unknown>> };
    blankSetpointHome.home_screen = blankSetpointHome.home_screen.map((item) => (
      'pool_set_point' in item ? { pool_set_point: '' } : item
    ));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems))
      .mockResolvedValueOnce(response(blankSetpointHome))
      .mockResolvedValueOnce(response(devices));
    const cloud = provider(fetchMock);
    await cloud.connect();
    const snapshot = await cloud.getSnapshot();
    const poolHeater = snapshot.equipment.find((item) => item.id === 'pool-heater');
    expect(poolHeater).not.toHaveProperty('targetTemperatureC');
  });

  it('renews an expired session and replays discovery once', async () => {
    const refreshed = {
      ...login as object,
      session_id: 'renewed-session',
      userPoolOAuth: { IdToken: 'renewed-id-token' },
    };
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response({}, 401))
      .mockResolvedValueOnce(response(refreshed))
      .mockResolvedValueOnce(response(systems));
    await provider(fetchMock).connect();
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(String(fetchMock.mock.calls[2][0])).toContain('/refresh');
  });

  it('falls back to compatible system discovery when signed discovery returns HTTP 400', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response({}, 400))
      .mockResolvedValueOnce(response(systems));
    await provider(fetchMock).connect();
    const fallbackUrl = new URL(String(fetchMock.mock.calls[2][0]));
    expect(fallbackUrl.pathname).toBe('/devices.json');
    expect(fallbackUrl.searchParams.get('api_key')).toBeTruthy();
    expect(fallbackUrl.searchParams.get('authentication_token')).toBe('fixture-authentication-token');
    expect(fallbackUrl.searchParams.get('user_id')).toBe('100');
  });

  it('times out with a sanitized error', async () => {
    const fetchMock = vi.fn((_url: URL | string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
    }));
    await expect(provider(fetchMock, { requestTimeoutMs: 1, maxRetries: 0 }).connect())
      .rejects.toEqual(new CloudRequestError('iAquaLink authentication timed out.'));
  });

  it('retries HTTP 5xx using exponential backoff', async () => {
    const sleep = vi.fn(async () => undefined);
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response({}, 503))
      .mockResolvedValueOnce(response({}, 502))
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems));
    await provider(fetchMock, { sleep, retryBaseDelayMs: 10 }).connect();
    expect(sleep).toHaveBeenNthCalledWith(1, 10);
    expect(sleep).toHaveBeenNthCalledWith(2, 20);
  });

  it('keeps the real provider read-only for the discovery preview', async () => {
    await expect(provider(vi.fn()).setPower('filter-pump', true))
      .rejects.toThrow('Cloud control is disabled');
  });

  it('sends a state-aware pool pump toggle when cloud control is enabled', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems))
      .mockResolvedValueOnce(response(home))
      .mockResolvedValueOnce(response(devices))
      .mockResolvedValueOnce(response(home));
    const cloud = provider(fetchMock, { enableCloudControl: true });
    await cloud.connect();
    await cloud.setPower('filter-pump', false);
    expect(String(fetchMock.mock.calls[4][0])).toContain('command=set_pool_pump');
  });

  it('sends verified aux and light command parameters', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems))
      .mockResolvedValueOnce(response(home))
      .mockResolvedValueOnce(response(devices))
      .mockResolvedValueOnce(response(devices))
      .mockResolvedValueOnce(response(home))
      .mockResolvedValueOnce(response(devices))
      .mockResolvedValueOnce(response(devices));
    const cloud = provider(fetchMock, { enableCloudControl: true });
    await cloud.connect();
    await cloud.setPower('air-blower', true);
    expect(String(fetchMock.mock.calls[4][0])).toContain('command=set_aux_1');
    await cloud.setLightProgram('pool-light', 'Caribbean Blue');
    const lightUrl = new URL(String(fetchMock.mock.calls[7][0]));
    expect(lightUrl.searchParams.get('command')).toBe('set_light');
    expect(Object.fromEntries(lightUrl.searchParams)).toMatchObject({
      aux: '4',
      subtype: '1',
      light: '4',
    });
  });

  it('routes heat-pump setpoints through the HPM command in controller units', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(response(login))
      .mockResolvedValueOnce(response(systems))
      .mockResolvedValueOnce(response(home))
      .mockResolvedValueOnce(response(devices))
      .mockResolvedValueOnce(response({}));
    const cloud = provider(fetchMock, { enableCloudControl: true });
    await cloud.connect();
    await cloud.setTargetTemperature('spa-heater', 40);
    const commandUrl = new URL(String(fetchMock.mock.calls[4][0]));
    expect(commandUrl.searchParams.get('command')).toBe('setpoint_hpm_temp');
    expect(commandUrl.searchParams.get('spaheatsetpointtemp')).toBe('104');
  });
});
