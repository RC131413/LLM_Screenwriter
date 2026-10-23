import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

import { API_BASE_URL, ApiError, api, apiRequest, getCsrfTokenFromCookie } from '../src/services/api.ts';

let cookie;
let calls;
let handler;
const originalFetch = globalThis.fetch;
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const json = (data, status = 200) => new Response(JSON.stringify(data), {
  status, headers: { 'Content-Type': 'application/json' },
});

beforeEach(() => {
  cookie = 'csrftoken=initial-token';
  calls = [];
  handler = async url => url.endsWith('/auth/csrf') ? json({ csrf_token: 'bootstrap-token' }) : json({ id: 1 });
  Object.defineProperty(globalThis, 'document', {
    configurable: true, value: { get cookie() { return cookie; } },
  });
  globalThis.fetch = async (url, init) => {
    calls.push({ url, ...init });
    return handler(url, init);
  };
});

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalDocument) Object.defineProperty(globalThis, 'document', originalDocument);
  else delete globalThis.document;
});

test('reads only the exact CSRF cookie and decodes it safely', () => {
  cookie = 'other=value; notcsrftoken=wrong; csrftoken=right%2Dtoken; sessionid=secret';
  assert.equal(getCsrfTokenFromCookie(), 'right-token');
  for (const value of ['', 'csrftoken=', 'csrftoken=%invalid', 'notcsrftoken=wrong']) {
    cookie = value;
    assert.equal(getCsrfTokenFromCookie(), null);
  }
  delete globalThis.document;
  assert.equal(getCsrfTokenFromCookie(), null);
});

test('GET always includes credentials and preserves supplied headers and query encoding', async () => {
  await apiRequest('projects', {
    headers: new Headers({ 'X-Request-ID': 'trace-1' }),
    query: { search: 'Polski tytul & / + ?', limit: 20, offset: 0, omitted: undefined, absent: null },
  });
  const request = calls[0];
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

test('unsafe methods use the current cookie, replacing a stale caller header', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    cookie = `csrftoken=${method}-token`;
    await apiRequest('projects/1', { method, body: { title: 'Film', age: null }, headers: { 'X-CSRFToken': 'stale' } });
    const request = calls.at(-1);
    assert.equal(request.headers.get('X-CSRFToken'), `${method}-token`);
    assert.equal(request.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(request.body), { title: 'Film', age: null });
    assert.equal(request.credentials, 'include');
  }
  assert.equal(calls.length, 4);
});

test('runtime options cannot disable credentials or enable redirects', async () => {
  await apiRequest('projects', { credentials: 'omit', mode: 'no-cors', redirect: 'follow' });
  assert.equal(calls[0].credentials, 'include');
  assert.equal(calls[0].mode, 'cors');
  assert.equal(calls[0].redirect, 'error');
});

test('first write bootstraps CSRF with credentials and then reads the cookie', async () => {
  cookie = '';
  handler = async url => {
    if (url.endsWith('/auth/csrf')) {
      cookie = 'csrftoken=new-cookie';
      return json({ csrf_token: 'masked-body-token' });
    }
    return json({ id: 1 });
  };
  await api.projects.create({ title: 'Opening' });
  assert.deepEqual(calls.map(call => call.url), [API_BASE_URL + 'auth/csrf', API_BASE_URL + 'projects']);
  assert.equal(calls[0].cache, 'no-store');
  assert.equal(calls[0].credentials, 'include');
  assert.equal(calls[1].headers.get('X-CSRFToken'), 'new-cookie');
});

test('unreadable cookies use a fresh bootstrap token for each write', async () => {
  delete globalThis.document;
  let sequence = 0;
  handler = async url => url.endsWith('/auth/csrf')
    ? json({ csrf_token: `masked-${++sequence}` }) : json({ id: 1 });
  await api.auth.login({ identifier: 'writer', password: 'test' });
  await api.projects.create({ title: 'Opening' });
  assert.equal(calls[1].headers.get('X-CSRFToken'), 'masked-1');
  assert.equal(calls[3].headers.get('X-CSRFToken'), 'masked-2');
});

test('simultaneous first writes share bootstrap and do not race cookie creation', async () => {
  cookie = '';
  let release;
  handler = async url => url.endsWith('/auth/csrf')
    ? new Promise(resolve => { release = resolve; }) : json({ id: 1 });
  const first = api.projects.create({ title: 'One' });
  const second = api.projects.create({ title: 'Two' });
  assert.equal(calls.length, 1);
  cookie = 'csrftoken=shared-cookie';
  release(json({ csrf_token: 'masked-shared' }));
  await Promise.all([first, second]);
  assert.equal(calls.length, 3);
  assert.equal(calls[1].headers.get('X-CSRFToken'), 'shared-cookie');
  assert.equal(calls[2].headers.get('X-CSRFToken'), 'shared-cookie');
});

test('login rotation is observed by the next write without storing a token', async () => {
  handler = async url => {
    if (url.endsWith('/auth/login')) cookie = 'csrftoken=rotated-after-login';
    return json({ id: 1 });
  };
  await api.auth.login({ identifier: 'writer', password: 'test' });
  await api.projects.update(1, { synopsis: 'Changed' });
  assert.equal(calls[0].headers.get('X-CSRFToken'), 'initial-token');
  assert.equal(calls[1].headers.get('X-CSRFToken'), 'rotated-after-login');
});

test('bootstrap errors block writes and the next request may bootstrap again', async () => {
  cookie = '';
  handler = async () => json({ detail: 'Offline' }, 503);
  await assert.rejects(api.projects.create({ title: 'Do not send' }), { status: 503 });
  assert.equal(calls.length, 1);
  handler = async url => url.endsWith('/auth/csrf') ? json({ csrf_token: 'recovered' }) : json({ id: 1 });
  await api.projects.create({ title: 'Recovered' });
  assert.equal(calls.at(-1).headers.get('X-CSRFToken'), 'recovered');
});

test('a malformed bootstrap response cannot produce a tokenless write', async () => {
  cookie = '';
  handler = async () => json({ csrf_token: '' });
  await assert.rejects(api.projects.create({ title: 'No token' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.match(error.message, /CSRF/);
    return true;
  });
  assert.equal(calls.length, 1);
});

test('empty 204/205 and HEAD responses do not trigger JSON parsing', async () => {
  for (const status of [204, 205]) {
    handler = async () => new Response(null, { status });
    assert.equal(await api.projects.delete(1), undefined);
    assert.equal(calls.at(-1).body, undefined);
  }
  handler = async () => new Response(null, { status: 200 });
  assert.equal(await apiRequest('projects', { method: 'HEAD' }), undefined);
});

test('Django and Ninja validation bodies survive in ApiError', async () => {
  const data = { detail: 'Validation failed.', fields: { title: ['Required.'] } };
  handler = async () => json(data, 422);
  await assert.rejects(api.projects.create({ title: '' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 422);
    assert.equal(error.message, data.detail);
    assert.deepEqual(error.fieldErrors, data.fields);
    assert.deepEqual(error.data, data);
    return true;
  });
  const ninja = { detail: [{ type: 'missing', loc: ['body', 'payload', 'name'], msg: 'Field required' }] };
  handler = async () => json(ninja, 422);
  await assert.rejects(apiRequest('characters/1'), error => {
    assert.equal(error.message, 'Field required');
    assert.deepEqual(error.data, ninja);
    return true;
  });
});

test('authentication/conflict errors are not retried or converted to fake success', async () => {
  for (const status of [401, 403, 409, 500]) {
    const before = calls.length;
    handler = async () => json({ detail: 'Request rejected.' }, status);
    await assert.rejects(api.projects.update(1, { title: 'Changed' }), { status });
    assert.equal(calls.length, before + 1);
  }
});

test('non-JSON errors and invalid JSON success responses fail predictably', async () => {
  handler = async () => new Response('<html>Unavailable</html>', { status: 502 });
  await assert.rejects(api.account.get(), error => {
    assert.equal(error.status, 502);
    assert.equal(error.data, '<html>Unavailable</html>');
    return true;
  });
  for (const body of ['not-json', '']) {
    handler = async () => new Response(body, { status: 200 });
    await assert.rejects(api.account.get(), error => error instanceof ApiError && /invalid JSON/.test(error.message));
  }
});

test('native fetch/network failures and AbortSignal remain observable', async () => {
  const networkError = new TypeError('Failed to fetch');
  handler = async () => { throw networkError; };
  await assert.rejects(api.account.get(), error => error === networkError);
  const controller = new AbortController();
  controller.abort();
  const before = calls.length;
  await assert.rejects(api.account.get({ signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls.length, before);
  handler = async () => json({ id: 1 });
  const active = new AbortController();
  await api.account.get({ signal: active.signal });
  assert.equal(calls.at(-1).signal, active.signal);
});

test('cancelling a caller waiting on shared CSRF does not cancel another write', async () => {
  cookie = '';
  let release;
  handler = async url => url.endsWith('/auth/csrf')
    ? new Promise(resolve => { release = resolve; }) : json({ id: 1 });
  const controller = new AbortController();
  const first = api.projects.create({ title: 'Cancelled' }, { signal: controller.signal });
  const second = api.projects.create({ title: 'Survives' });
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  release(json({ csrf_token: 'shared' }));
  await second;
  assert.equal(calls.length, 2);
  assert.equal(JSON.parse(calls[1].body).title, 'Survives');
});

test('API calls cannot leak CSRF tokens to another server or outside /api', async () => {
  for (const path of ['https://evil.example.com/collect', '../admin/', '/../../outside', 'http://127.0.0.1:8001/api/']) {
    await assert.rejects(apiRequest(path, { method: 'POST' }), TypeError);
  }
  assert.equal(calls.length, 0);
});

test('unsafe or invalid resource IDs are rejected before making any request', async () => {
  for (const value of [0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => api.projects.get(value), RangeError);
  }
  assert.equal(calls.length, 0);
});

export const endpointCases = [
  ['GET', 'auth/csrf', () => api.auth.csrf()],
  ['POST', 'auth/login', () => api.auth.login({ identifier: 'writer', password: 'test' })],
  ['POST', 'auth/register', () => api.auth.register({ username: 'writer', email: 'writer@example.com', password: 'test', password_confirm: 'test' })],
  ['POST', 'auth/logout', () => api.auth.logout()],
  ['GET', 'users/me', () => api.account.get()],
  ['PATCH', 'users/me', () => api.account.update({ username: 'new' })],
  ['POST', 'users/me/password', () => api.account.changePassword({ old_password: 'old', new_password: 'new', new_password_confirm: 'new' })],
  ['GET', 'users/me/profile', () => api.account.getProfile()],
  ['PATCH', 'users/me/profile', () => api.account.updateProfile({ display_name: 'Writer' })],
  ['GET', 'users/me/preferences', () => api.account.getPreferences()],
  ['PUT', 'users/me/preferences', () => api.account.savePreferences({})],
  ['GET', 'users/me/statistics', () => api.account.getStatistics()],
  ['GET', 'projects', () => api.projects.list()],
  ['POST', 'projects', () => api.projects.create({ title: 'Film' })],
  ['GET', 'projects/1', () => api.projects.get(1)],
  ['PATCH', 'projects/1', () => api.projects.update(1, { title: 'Film 2' })],
  ['DELETE', 'projects/1', () => api.projects.delete(1)],
  ['POST', 'projects/1/actions/favorite', () => api.projects.action(1, 'favorite')],
  ['GET', 'projects/1/workspace', () => api.projects.workspace(1)],
  ['GET', 'projects/1/acts', () => api.acts.list(1)],
  ['POST', 'projects/1/acts', () => api.acts.create(1, { act_number: 1 })],
  ['GET', 'acts/2', () => api.acts.get(2)],
  ['PATCH', 'acts/2', () => api.acts.update(2, { title: 'Act title' })],
  ['DELETE', 'acts/2', () => api.acts.delete(2)],
  ['GET', 'projects/1/characters', () => api.characters.list(1)],
  ['POST', 'projects/1/characters', () => api.characters.create(1, { name: 'ANNA' })],
  ['GET', 'characters/4', () => api.characters.get(4)],
  ['PATCH', 'characters/4', () => api.characters.update(4, { age: null })],
  ['DELETE', 'characters/4', () => api.characters.delete(4)],
  ['GET', 'projects/1/scenes', () => api.scenes.list(1)],
  ['POST', 'projects/1/scenes', () => api.scenes.create(1, { act_id: 2, scene_number: 1 })],
  ['GET', 'scenes/3', () => api.scenes.get(3)],
  ['PATCH', 'scenes/3', () => api.scenes.update(3, { act_id: 2 })],
  ['DELETE', 'scenes/3', () => api.scenes.delete(3)],
  ['GET', 'scenes/3/cast', () => api.cast.list(3)],
  ['POST', 'scenes/3/cast', () => api.cast.create(3, { character_id: 4 })],
  ['GET', 'cast/5', () => api.cast.get(5)],
  ['PATCH', 'cast/5', () => api.cast.update(5, { notes: 'Phone call' })],
  ['DELETE', 'cast/5', () => api.cast.delete(5)],
  ['GET', 'scenes/3/prompts', () => api.prompts.list(3)],
  ['POST', 'scenes/3/prompts', () => api.prompts.create(3, { user_prompt: 'A quiet scene' })],
  ['GET', 'prompts/6', () => api.prompts.get(6)],
  ['GET', 'prompts/6/run', () => api.prompts.getRun(6)],
  ['GET', 'scenes/3/runs', () => api.runs.list(3)],
  ['GET', 'runs/7', () => api.runs.get(7)],
  ['GET', 'runs/7/agents', () => api.agentExecutions.list(7)],
  ['GET', 'agent-executions/8', () => api.agentExecutions.get(8)],
  ['GET', 'scenes/3/variants', () => api.variants.listForScene(3)],
  ['GET', 'runs/7/variants', () => api.variants.listForRun(7)],
  ['GET', 'variants/9', () => api.variants.get(9)],
  ['POST', 'variants/9/select', () => api.variants.select(9, { apply_to_scene: true })],
];

test('all 51 endpoint wrappers use the backend HTTP method and route', async t => {
  assert.equal(endpointCases.length, 51);
  handler = async (url, init) => init.method === 'DELETE'
    ? new Response(null, { status: 204 })
    : json(url.endsWith('/auth/csrf') ? { csrf_token: 'masked' } : { id: 1 });
  for (const [method, path, call] of endpointCases) {
    await t.test(`${method} ${path}`, async () => {
      const before = calls.length;
      await call();
      assert.equal(calls.length, before + 1);
      assert.equal(calls.at(-1).url, API_BASE_URL + path);
      assert.equal(calls.at(-1).method, method);
      assert.equal(calls.at(-1).credentials, 'include');
      if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
        assert.equal(calls.at(-1).headers.get('X-CSRFToken'), 'initial-token');
      }
    });
  }
});

test('list helpers forward pagination, collections, searches and scene filters', async () => {
  await api.projects.list({ collection: 'trash', search: 'Film & seria', limit: 5, offset: 10 });
  let query = new URL(calls.at(-1).url).searchParams;
  assert.equal(query.get('collection'), 'trash');
  assert.equal(query.get('search'), 'Film & seria');
  assert.equal(query.get('limit'), '5');
  assert.equal(query.get('offset'), '10');
  await api.scenes.list(1, { act_id: 2, limit: 3, offset: 0 });
  query = new URL(calls.at(-1).url).searchParams;
  assert.equal(query.get('act_id'), '2');
  assert.equal(query.get('offset'), '0');
  for (const call of [api.acts.list, api.characters.list, api.cast.list, api.prompts.list,
                       api.runs.list, api.agentExecutions.list, api.variants.listForScene, api.variants.listForRun]) {
    await call(1, { limit: 7, offset: 14 });
    assert.equal(new URL(calls.at(-1).url).search, '?limit=7&offset=14');
  }
});
