import { Worker } from 'node:worker_threads';
import { expect, test } from 'vitest';

test('the block model loads and runs in a worker with no DOM', async () => {
  const worker = new Worker(new URL('./model-worker.ts', import.meta.url));
  try {
    const message = await new Promise((resolve, reject) => {
      worker.once('message', resolve);
      worker.once('error', reject);
    });
    // doc, title, the twelve block types, text, hardBreak and mention.
    expect(message).toEqual({ hasDom: false, title: 'In a worker', text: 'hello', nodeTypes: 17 });
  } finally {
    await worker.terminate();
  }
});
