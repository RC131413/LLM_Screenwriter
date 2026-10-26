import { vi } from 'vitest';

export interface HttpCall {
  method: string;
  path: string;
  url: URL;
  body: unknown;
  headers: Headers;
  init: RequestInit;
}

export const jsonResponse = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

// Intercept only the HTTP boundary, leaving the production API client and hooks intact.
export function interceptHttp(handle: (call: HttpCall) => Response | Promise<Response> | undefined) {
  const calls: HttpCall[] = [];
  document.cookie = 'csrftoken=test-csrf; Path=/';
  const fetch = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> => {
    const url = new URL(String(input));
    if (url.origin !== 'http://127.0.0.1:8000' || !url.pathname.startsWith('/api/')) {
      throw new Error(`Unexpected API URL: ${url}`);
    }
    const call: HttpCall = {
      method: init.method ?? 'GET', path: url.pathname.slice(4), url,
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      headers: new Headers(init.headers), init,
    };
    calls.push(call);
    if (call.path === '/auth/csrf') return jsonResponse({ csrf_token: 'test-csrf' });
    const response = handle(call);
    if (response === undefined) throw new Error(`Unhandled request: ${call.method} ${url.pathname}${url.search}`);
    return response;
  });
  vi.stubGlobal('fetch', fetch);
  return { calls, fetch };
}
