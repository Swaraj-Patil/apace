// A small typed RPC over postMessage. A call carries an id and an optional transfer list, and
// its result or error comes back under the same id. The server can also emit events. One
// channel delivers in order, so events and results arrive in the order they were sent.

/** What Worker, a worker's global scope and MessagePort have in common. */
export interface Endpoint {
  postMessage(message: unknown, transfer: Transferable[]): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  removeEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
  start?(): void;
}

type Args<F> = F extends (...args: infer A) => unknown ? A : never;
type Result<F> = F extends (...args: never[]) => Promise<infer R> ? R : never;
type MethodName<Api> = {
  [K in keyof Api]: Api[K] extends (...args: never[]) => Promise<unknown> ? K : never;
}[keyof Api] &
  string;

const TRANSFER: unique symbol = Symbol('transfer');

/** A result or payload whose buffers move to the other side instead of being copied. */
export interface Transfer<T> {
  readonly [TRANSFER]: true;
  readonly value: T;
  readonly transferables: readonly Transferable[];
}

export function transfer<T>(value: T, transferables: readonly Transferable[]): Transfer<T> {
  return { [TRANSFER]: true, value, transferables };
}

function isTransfer(value: unknown): value is Transfer<unknown> {
  return typeof value === 'object' && value !== null && TRANSFER in value;
}

export type Handlers<Api> = {
  [K in MethodName<Api>]: (
    ...args: Args<Api[K]>
  ) =>
    | Result<Api[K]>
    | Transfer<Result<Api[K]>>
    | Promise<Result<Api[K]> | Transfer<Result<Api[K]>>>;
};

interface SerializedError {
  readonly name: string;
  readonly message: string;
  readonly stack?: string | undefined;
}

type Message =
  | {
      readonly kind: 'call';
      readonly id: number;
      readonly method: string;
      readonly args: unknown[];
    }
  | { readonly kind: 'result'; readonly id: number; readonly value: unknown }
  | { readonly kind: 'error'; readonly id: number; readonly error: SerializedError }
  | { readonly kind: 'event'; readonly name: string; readonly payload: unknown };

/** An error thrown on the other side, rebuilt with its name, message and stack. */
export class RemoteError extends Error {
  constructor(error: SerializedError) {
    super(error.message);
    this.name = error.name;
    if (error.stack !== undefined) this.stack = error.stack;
  }
}

function serialize(error: unknown): SerializedError {
  if (error instanceof Error)
    return { name: error.name, message: error.message, stack: error.stack };
  return { name: 'Error', message: String(error) };
}

function post(endpoint: Endpoint, message: Message, transferables: readonly Transferable[] = []) {
  endpoint.postMessage(message, [...transferables]);
}

export interface Server<Events> {
  emit<E extends keyof Events & string>(
    name: E,
    payload: Events[E],
    transferables?: readonly Transferable[],
  ): void;
  close(): void;
}

export function serve<Api, Events>(endpoint: Endpoint, handlers: Handlers<Api>): Server<Events> {
  const table = handlers as unknown as Record<
    string,
    ((...args: unknown[]) => unknown) | undefined
  >;
  const listener = async (event: MessageEvent) => {
    const message = event.data as Message;
    if (message?.kind !== 'call') return;
    try {
      const handler = table[message.method];
      if (handler === undefined) throw new Error(`Unknown method: ${message.method}`);
      const result = await handler(...message.args);
      if (isTransfer(result)) {
        post(
          endpoint,
          { kind: 'result', id: message.id, value: result.value },
          result.transferables,
        );
      } else {
        post(endpoint, { kind: 'result', id: message.id, value: result });
      }
    } catch (error) {
      post(endpoint, { kind: 'error', id: message.id, error: serialize(error) });
    }
  };
  endpoint.addEventListener('message', listener);
  endpoint.start?.();
  return {
    emit(name, payload, transferables) {
      post(endpoint, { kind: 'event', name, payload }, transferables);
    },
    close() {
      endpoint.removeEventListener('message', listener);
    },
  };
}

export interface Client<Api, Events> {
  call<K extends MethodName<Api>>(
    method: K,
    args: Args<Api[K]>,
    transferables?: readonly Transferable[],
  ): Promise<Result<Api[K]>>;
  on<E extends keyof Events & string>(name: E, listener: (payload: Events[E]) => void): () => void;
  /** Stops listening and rejects every call still waiting for an answer. */
  close(reason?: string): void;
}

export function connect<Api, Events>(endpoint: Endpoint): Client<Api, Events> {
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  const listeners = new Map<string, Set<(payload: never) => void>>();
  let nextId = 1;
  let closed: Error | undefined;

  const listener = (event: MessageEvent) => {
    const message = event.data as Message;
    if (message?.kind === 'event') {
      for (const notify of listeners.get(message.name) ?? []) notify(message.payload as never);
      return;
    }
    if (message?.kind !== 'result' && message?.kind !== 'error') return;
    const call = pending.get(message.id);
    if (call === undefined) return;
    pending.delete(message.id);
    if (message.kind === 'result') call.resolve(message.value);
    else call.reject(new RemoteError(message.error));
  };
  endpoint.addEventListener('message', listener);
  endpoint.start?.();

  return {
    call(method, args, transferables) {
      if (closed !== undefined) return Promise.reject(closed);
      const id = nextId++;
      return new Promise((resolve, reject) => {
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject });
        post(endpoint, { kind: 'call', id, method, args }, transferables);
      });
    },
    on(name, notify) {
      let set = listeners.get(name);
      if (set === undefined) {
        set = new Set();
        listeners.set(name, set);
      }
      set.add(notify);
      return () => {
        set.delete(notify);
      };
    },
    close(reason = 'The connection closed') {
      closed = new Error(reason);
      endpoint.removeEventListener('message', listener);
      for (const call of pending.values()) call.reject(closed);
      pending.clear();
    },
  };
}
