import assert from 'node:assert/strict';
import { test } from 'vitest';
import { API_BASE_URL, ApiError, api, apiRequest, getCsrfTokenFromCookie } from '../../src/services/api';
import { json, setupTransport } from '../support/transport';

const transport = setupTransport();

test('GET always includes credentials and preserves supplied headers and query encoding', async () => {
  await apiRequest('projects', {
    headers: new Headers({ 'X-Request-ID': 'trace-1' }),
    query: { search: 'Polski tytul & / + ?', limit: 20, offset: 0, omitted: undefined, absent: null },
  });
  const request = transport.calls[0];
  assert.equal(request.credentials, 'include');
  assert.equal(request.mode, 'cors');
  assert.equal(request.redirect, 'error');
  assert.equal(request.method, 'GET');
  assert.equal(request.headers.get('Accept'), 'application/json');
  assert.equal(request.headers.get('X-Request-ID'), 'trace-1');
  assert.equal(request.headers.has('Content-Type'), false);
  assert.equal(request.headers.has('X-CSRFToken'), false);
  const query = new URL(request.url).searchParams;
  assert.equal(query.get('search'), 'Polski tytul & / + ?');
  assert.equal(query.get('offset'), '0');
  assert.equal(query.has('omitted'), false);
  assert.equal(query.has('absent'), false);
});

test('runtime options cannot disable credentials or enable redirects', async () => {
  await apiRequest('projects', { credentials: 'omit', mode: 'no-cors', redirect: 'follow' });
  assert.equal(transport.calls[0].credentials, 'include');
  assert.equal(transport.calls[0].mode, 'cors');
  assert.equal(transport.calls[0].redirect, 'error');
});

test('empty 204/205 and HEAD responses do not trigger JSON parsing', async () => {
  for (const status of [204, 205]) {
    transport.handler = async () => new Response(null, { status });
    assert.equal(await api.projects.delete(1), undefined);
    assert.equal(transport.calls.at(-1).body, undefined);
  }
  transport.handler = async () => new Response(null, { status: 200 });
  assert.equal(await apiRequest('projects', { method: 'HEAD' }), undefined);
});

test('Django and Ninja validation bodies survive in ApiError', async () => {
  const data = { detail: 'Validation failed.', fields: { title: ['Required.'] } };
  transport.handler = async () => json(data, 422);
  await assert.rejects(api.projects.create({ title: '' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.equal(error.message, data.detail);
    assert.deepEqual(error.fieldErrors, data.fields);
    assert.deepEqual(error.data, data);
    return true;
  });
  const ninja = { detail: [{ type: 'missing', loc: ['body', 'payload', 'name'], msg: 'Field required' }] };
  transport.handler = async () => json(ninja, 422);
  await assert.rejects(apiRequest('characters/1'), error => {
    assert.equal(error.message, 'Field required');
    assert.deepEqual(error.data, ninja);
    return true;
  });
});

test('authentication/conflict errors are not retried or converted to fake success', async () => {
  for (const status of [401, 403, 409, 500]) {
    const before = transport.calls.length;
    transport.handler = async () => json({ detail: 'Request rejected.' }, status);
    await assert.rejects(api.projects.update(1, { title: 'Changed' }), { status });
    assert.equal(transport.calls.length, before + 1);
  }
});

test('non-JSON errors and invalid JSON success responses fail predictably', async () => {
  transport.handler = async () => new Response('<html>Unavailable</html>', { status: 502 });
  await assert.rejects(api.account.get(), error => {
    assert.equal(error.status, 502);
    assert.equal(error.data, '<html>Unavailable</html>');
    return true;
  });
  for (const body of ['not-json', '']) {
    transport.handler = async () => new Response(body, { status: 200 });
    await assert.rejects(api.account.get(), error => error instanceof ApiError && /invalid JSON/.test(error.message));
  }
});

test('native fetch/network failures and AbortSignal remain observable', async () => {
  const networkError = new TypeError('Failed to fetch');
  transport.handler = async () => { throw networkError; };
  await assert.rejects(api.account.get(), error => error === networkError);
  const controller = new AbortController();
  controller.abort();
  const before = transport.calls.length;
  await assert.rejects(api.account.get({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(transport.calls.length, before);
  transport.handler = async () => json({ id: 1 });
  const active = new AbortController();
  await api.account.get({ signal: active.signal });
  assert.equal(transport.calls.at(-1).signal, active.signal);
});

test('unsafe or invalid resource IDs are rejected before making any request', async () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => api.projects.get(value), RangeError);
  }
  assert.equal(transport.calls.length, 0);
});

