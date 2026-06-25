import { describe, expect, it, vi } from "vitest";

const httpsMocks = vi.hoisted(() => {
  type Listener = (value: Error | string | undefined) => void;

  interface FakeEmitter {
    readonly emit: (event: string, value: Error | string | undefined) => void;
    readonly on: (event: string, listener: Listener) => FakeEmitter;
    readonly once: (event: string, listener: Listener) => FakeEmitter;
    readonly removeAllListeners: () => FakeEmitter;
  }

  interface FakeRequest extends FakeEmitter {
    readonly setTimeout: (ms: number, callback: () => void) => FakeRequest;
    readonly destroy: () => FakeRequest;
    destroyed: boolean;
  }

  interface FakeResponse extends FakeEmitter {
    readonly setEncoding: (encoding: BufferEncoding) => void;
  }

  const createEmitter = (): FakeEmitter => {
    const listeners = new Map<string, Listener[]>();
    const emitter: FakeEmitter = {
      emit(event, value) {
        const current = listeners.get(event) ?? [];
        current.forEach((listener) => listener(value));
      },
      on(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return emitter;
      },
      once(event, listener) {
        listeners.set(event, [...(listeners.get(event) ?? []), listener]);
        return emitter;
      },
      removeAllListeners() {
        listeners.clear();
        return emitter;
      },
    };
    return emitter;
  };

  const createRequest = (): FakeRequest => {
    const emitter = createEmitter();
    const request: FakeRequest = {
      ...emitter,
      destroyed: false,
      setTimeout() {
        return request;
      },
      destroy() {
        request.destroyed = true;
        return request;
      },
    };
    return request;
  };

  const createResponse = (): FakeResponse => {
    return {
      ...createEmitter(),
      setEncoding() {
        return undefined;
      },
    };
  };

  return {
    requests: [] as FakeRequest[],
    responses: [] as FakeResponse[],
    createRequest,
    createResponse,
  };
});

vi.mock("node:https", () => ({
  get: vi.fn(
    (
      _url: string,
      _options: { readonly timeout: number },
      callback: (response: ReturnType<typeof httpsMocks.createResponse>) => void,
    ) => {
      const request = httpsMocks.createRequest();
      const response = httpsMocks.createResponse();
      httpsMocks.requests.push(request);
      httpsMocks.responses.push(response);
      callback(response);
      return request;
    },
  ),
}));

import { probeRemoteHost } from "../remote-probe";

describe("probeRemoteHost", () => {
  it("aborts oversized /whoami responses before buffering the full body", async () => {
    const resultPromise = probeRemoteHost({ tailnetName: "large.ts.net" });
    const request = httpsMocks.requests[0];
    const response = httpsMocks.responses[0];

    try {
      response.emit("data", "x".repeat(65_537));
      await Promise.resolve();

      expect(request.destroyed).toBe(true);
    } finally {
      response.emit("end", undefined);
      await resultPromise;
    }

    await expect(resultPromise).resolves.toEqual({
      reachable: false,
      hostId: null,
      version: null,
    });
  });
});
