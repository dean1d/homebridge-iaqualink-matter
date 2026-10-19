import { AsyncLocalStorage } from 'node:async_hooks';

export type CommandOrigin = 'HAP' | 'Matter';

const storage = new AsyncLocalStorage<CommandOrigin>();

/**
 * Tags every log line logged anywhere in `fn`'s async call chain - including
 * deep inside the cloud provider, far from where the command was triggered -
 * with `origin`. Only tags when `enabled`, so a single-protocol setup keeps
 * the same untagged logs as before; both HAP and Matter gate on whether
 * Matter is enabled, since that's the only protocol a user opts into and HAP
 * has no equivalent plugin-visible flag.
 */
export function runWithCommandOrigin<T>(origin: CommandOrigin, enabled: boolean, fn: () => T): T {
  return enabled ? storage.run(origin, fn) : fn();
}

export function commandLogPrefix(): string {
  const origin = storage.getStore();
  return origin ? `${origin} - ` : '';
}
