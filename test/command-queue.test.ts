import { describe, expect, it } from 'vitest';
import { CommandQueue } from '../src/util/command-queue.js';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

describe('CommandQueue', () => {
  it('never overlaps two operations enqueued concurrently', async () => {
    const queue = new CommandQueue();
    let running = 0;
    let maxConcurrent = 0;
    const order: number[] = [];

    const operation = (id: number, delayMs: number) => async () => {
      running += 1;
      maxConcurrent = Math.max(maxConcurrent, running);
      await sleep(delayMs);
      order.push(id);
      running -= 1;
    };

    // Enqueue three operations back-to-back without awaiting any of them
    // first, the way three rapid retried commands (each its own call chain)
    // would each independently enqueue a refresh.
    const results = [
      queue.enqueue(operation(1, 30)),
      queue.enqueue(operation(2, 10)),
      queue.enqueue(operation(3, 20)),
    ];
    await Promise.all(results);

    expect(maxConcurrent).toBe(1);
    expect(order).toEqual([1, 2, 3]);
  });

  it('keeps later operations serialized even when an earlier one rejects', async () => {
    const queue = new CommandQueue();
    const order: string[] = [];

    const first = queue.enqueue(async () => {
      order.push('first-start');
      throw new Error('boom');
    });
    const second = queue.enqueue(async () => {
      order.push('second');
    });

    await expect(first).rejects.toThrow('boom');
    await second;

    expect(order).toEqual(['first-start', 'second']);
  });
});
