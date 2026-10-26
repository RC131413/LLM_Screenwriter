import { afterEach, beforeEach } from 'vitest';

export const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

export function setupTransport() {
  const originalFetch = globalThis.fetch;
  const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
  const transport = {
    cookie: '',
    calls: [] as (RequestInit & { url: string; headers: Headers })[],
    handler: async (_url: string, _init: RequestInit): Promise<Response> => json({}),
  };
  beforeEach(() => {
    transport.cookie = 'csrftoken=initial-token';
    transport.calls = [];
    transport.handler = async url => url.endsWith('/auth/csrf') ? json({ csrf_token: 'bootstrap-token' }) : json({ id: 1 });
    Object.defineProperty(globalThis, 'document', {
      configurable: true, value: { get cookie() { return transport.cookie; } },
    });
    globalThis.fetch = async (input, init = {}) => {
      const url = String(input);
      transport.calls.push({ ...init, url, headers: new Headers(init.headers) });
      return transport.handler(url, init);
    };
  });
  afterEach(() => {
    globalThis.fetch = originalFetch;
    if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
    else Reflect.deleteProperty(globalThis, 'document');
  });
  return transport;
}
