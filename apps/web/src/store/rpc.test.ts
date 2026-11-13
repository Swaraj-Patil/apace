import { afterEach, describe, expect, test } from 'vitest';
import { connect, RemoteError, type Server, serve, transfer } from './rpc.ts';

interface Api {
  add(a: number, b: number): Promise<number>;
  fail(name: string, message: string): Promise<void>;
  measure(buffer: ArrayBuffer): Promise<number>;
  allocate(size: number): Promise<ArrayBuffer>;
  announce(count: number): Promise<string>;
  later(ms: number, value: number): Promise<number>;
}

interface Events {
  tick: number;
}

const ports: MessagePort[] = [];
afterEach(() => {
  for (const port of ports.splice(0)) port.close();
});

function setUp() {
  const channel = new MessageChannel();
  ports.push(channel.port1, channel.port2);
  const server: Server<Events> = serve<Api, Events>(channel.port1, {
    add: (a, b) => a + b,
    fail: (name, message) => {
      const error = new Error(message);
      error.name = name;
      throw error;
    },
    measure: (buffer) => buffer.byteLength,
    allocate: (size) => {
      const buffer = new ArrayBuffer(size);
      return transfer(buffer, [buffer]);
    },
    announce: (count) => {
      for (let tick = 0; tick < count; tick++) server.emit('tick', tick);
      return 'done';
    },
    later: (ms, value) => new Promise((resolve) => setTimeout(() => resolve(value), ms)),
  });
  return connect<Api, Events>(channel.port2);
}

describe('rpc', () => {
  test('calls return their results', async () => {
    const client = setUp();
    expect(await client.call('add', [2, 3])).toBe(5);
  });

  test('errors cross with their name, message and stack', async () => {
    const client = setUp();
    const error = await client.call('fail', ['QuotaExceededError', 'disk full']).catch((e) => e);
    expect(error).toBeInstanceOf(RemoteError);
    expect(error.name).toBe('QuotaExceededError');
    expect(error.message).toBe('disk full');
    expect(error.stack).toContain('disk full');
  });

  test('an unknown method is an error, not a hang', async () => {
    const client = setUp();
    const call = (client as unknown as { call(method: string, args: unknown[]): Promise<unknown> })
      .call;
    await expect(call('missing', [])).rejects.toThrow('Unknown method: missing');
  });

  test('transfer lists move buffers in both directions', async () => {
    const client = setUp();
    const outgoing = new ArrayBuffer(64);
    expect(await client.call('measure', [outgoing], [outgoing])).toBe(64);
    expect(outgoing.byteLength).toBe(0);
    const incoming = await client.call('allocate', [32]);
    expect(incoming).toBeInstanceOf(ArrayBuffer);
    expect(incoming.byteLength).toBe(32);
  });

  test('events arrive in order, before the result sent after them', async () => {
    const client = setUp();
    const seen: string[] = [];
    client.on('tick', (tick) => seen.push(`tick ${tick}`));
    const result = await client.call('announce', [3]);
    seen.push(result);
    expect(seen).toEqual(['tick 0', 'tick 1', 'tick 2', 'done']);
  });

  test('1,000 concurrent calls each get their own result', async () => {
    const client = setUp();
    const values = Array.from({ length: 1000 }, (_, index) => index);
    const results = await Promise.all(
      values.map((value) => client.call('later', [value % 7, value])),
    );
    expect(results).toEqual(values);
  });

  test('closing the client rejects calls still in flight', async () => {
    const client = setUp();
    const inFlight = client.call('later', [50, 1]);
    client.close('The store shut down');
    await expect(inFlight).rejects.toThrow('The store shut down');
    await expect(client.call('add', [1, 1])).rejects.toThrow('The store shut down');
  });
});
