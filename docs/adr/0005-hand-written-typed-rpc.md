# 0005. Hand-written typed RPC

Status: Accepted, 2026-11-12

## Context

The main thread and the store worker exchange calls, results, errors, status events and large buffers. The requirements:

- Types must hold on both sides.
- Buffers should move without being copied.
- Errors have to stay debuggable.
- A status event must never overtake a result sent before it, or arrive behind one sent after it.

## Decision

`apps/web/src/store/rpc.ts` handles this in under 200 lines, with no dependencies:

- `serve(endpoint, handlers)` and `connect(endpoint)` work over anything with `postMessage`: a Worker, a worker's global scope or a MessagePort.
- A call carries an id, the method name, its arguments and an optional transfer list. The answer comes back under the same id.
- A handler can wrap its result in `transfer(value, buffers)` to move the buffers instead of copying them.
- Errors cross with their name, message and stack, and are rethrown as `RemoteError`.
- The server emits typed events on the same channel, so events and results arrive in the order they were sent.
- Closing the client rejects every call still waiting for an answer.
- The interface is one shared pair of types, `StoreApi` and `StoreEvents`, checked against both sides.

## What we gave up

Compared with a library such as Comlink:

- No proxies or callbacks across the boundary. Every interaction is an explicit call or event.
- Method names are strings at runtime, though typed at compile time.
- No cancellation or timeouts. A crashed worker surfaces through its `error` event and the client's shutdown.

## How it's verified

`apps/web/src/store/rpc.test.ts` runs over a real MessageChannel and covers:

- results, errors and unknown methods;
- transfers in both directions;
- event ordering;
- 1,000 concurrent calls;
- closing with calls in flight.
