import { describe, expect, it } from 'vitest';
import { commandLogPrefix, runWithCommandOrigin } from '../src/util/command-origin.js';

describe('command-origin', () => {
  it('has no prefix when not tagged', () => {
    expect(commandLogPrefix()).toBe('');
  });

  it('tags a log line read synchronously inside the tagged call', async () => {
    const seen: string[] = [];
    await runWithCommandOrigin('HAP', true, async () => {
      seen.push(commandLogPrefix());
    });
    expect(seen).toEqual(['HAP - ']);
  });

  it('does not tag when disabled', async () => {
    const seen: string[] = [];
    await runWithCommandOrigin('Matter', false, async () => {
      seen.push(commandLogPrefix());
    });
    expect(seen).toEqual(['']);
  });

  it('survives a CommandQueue-style chained promise, even queued behind an untagged operation', async () => {
    // Mirrors util/command-queue.ts: `.then()` registered on an existing tail
    // promise, possibly from an earlier, differently-tagged (or untagged) call.
    let tail: Promise<unknown> = Promise.resolve();
    const seen: string[] = [];
    const enqueue = (operation: () => Promise<void>) => {
      const result = tail.then(operation, operation);
      tail = result.then(() => undefined, () => undefined);
      return result;
    };

    await enqueue(async () => { seen.push(commandLogPrefix()); });
    await runWithCommandOrigin('Matter', true, () => enqueue(async () => {
      seen.push(commandLogPrefix());
    }));
    await enqueue(async () => { seen.push(commandLogPrefix()); });

    expect(seen).toEqual(['', 'Matter - ', '']);
  });

  it('does not leak one call origin into a later, differently-tagged call', async () => {
    const seen: string[] = [];
    await runWithCommandOrigin('HAP', true, async () => { seen.push(commandLogPrefix()); });
    await runWithCommandOrigin('Matter', true, async () => { seen.push(commandLogPrefix()); });
    expect(seen).toEqual(['HAP - ', 'Matter - ']);
  });
});
