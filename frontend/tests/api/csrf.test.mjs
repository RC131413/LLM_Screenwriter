import assert from 'node:assert/strict';
import { test } from 'vitest';
import { API_BASE_URL, ApiError, api, apiRequest, getCsrfTokenFromCookie } from '../../src/services/api';
import { json, setupTransport } from '../support/transport';

const transport = setupTransport();

test('reads only the exact CSRF cookie and decodes it safely', () => {
  transport.cookie = 'other=value; notcsrftoken=wrong; csrftoken=right%2Dtoken; sessionid=secret';
  assert.equal(getCsrfTokenFromCookie(), 'right-token');
  for (const value of ['', 'csrftoken=', 'csrftoken=%invalid', 'notcsrftoken=wrong']) {
    transport.cookie = value;
    assert.equal(getCsrfTokenFromCookie(), null);
  }
  delete globalThis.document;
  assert.equal(getCsrfTokenFromCookie(), null);
});

test('unsafe methods use the current cookie, replacing a stale caller header', async () => {
  for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
    transport.cookie = `csrftoken=${method}-token`;
    await apiRequest('projects/1', { method, body: { title: 'Film', age: null }, headers: { 'X-CSRFToken': 'stale' } });
    const request = transport.calls.at(-1);
    assert.equal(request.headers.get('X-CSRFToken'), `${method}-token`);
    assert.equal(request.headers.get('Content-Type'), 'application/json');
    assert.deepEqual(JSON.parse(request.body), { title: 'Film', age: null });
    assert.equal(request.credentials, 'include');
  }
  assert.equal(transport.calls.length, 4);
});

test('first write bootstraps CSRF with credentials and then reads the cookie', async () => {
  transport.cookie = '';
  transport.handler = async url => {
    if (url.endsWith('/auth/csrf')) {
      transport.cookie = 'csrftoken=new-cookie';
      return json({ csrf_token: 'masked-body-token' });
    }
    return json({ id: 1 });
  };
  await api.projects.create({ title: 'Opening' });
  assert.deepEqual(transport.calls.map(call => call.url), [API_BASE_URL + 'auth/csrf', API_BASE_URL + 'projects']);
  assert.equal(transport.calls[0].cache, 'no-store');
  assert.equal(transport.calls[0].credentials, 'include');
  assert.equal(transport.calls[1].headers.get('X-CSRFToken'), 'new-cookie');
});

test('unreadable cookies use a fresh bootstrap token for each write', async () => {
  delete globalThis.document;
  let sequence = 0;
  transport.handler = async url => url.endsWith('/auth/csrf')
    ? json({ csrf_token: `masked-${++sequence}` }) : json({ id: 1 });
  await api.auth.login({ identifier: 'writer', password: 'test' });
  await api.projects.create({ title: 'Opening' });
  assert.equal(transport.calls[1].headers.get('X-CSRFToken'), 'masked-1');
  assert.equal(transport.calls[3].headers.get('X-CSRFToken'), 'masked-2');
});

test('simultaneous first writes share bootstrap and do not race cookie creation', async () => {
  transport.cookie = '';
  let release;
  transport.handler = async url => url.endsWith('/auth/csrf')
    ? new Promise(resolve => { release = resolve; }) : json({ id: 1 });
  const first = api.projects.create({ title: 'One' });
  const second = api.projects.create({ title: 'Two' });
  assert.equal(transport.calls.length, 1);
  transport.cookie = 'csrftoken=shared-cookie';
  release(json({ csrf_token: 'masked-shared' }));
  await Promise.all([first, second]);
  assert.equal(transport.calls.length, 3);
  assert.equal(transport.calls[1].headers.get('X-CSRFToken'), 'shared-cookie');
  assert.equal(transport.calls[2].headers.get('X-CSRFToken'), 'shared-cookie');
});

test('login rotation is observed by the next write without storing a token', async () => {
  transport.handler = async url => {
    if (url.endsWith('/auth/login')) transport.cookie = 'csrftoken=rotated-after-login';
    return json({ id: 1 });
  };
  await api.auth.login({ identifier: 'writer', password: 'test' });
  await api.projects.update(1, { synopsis: 'Changed' });
  assert.equal(transport.calls[0].headers.get('X-CSRFToken'), 'initial-token');
  assert.equal(transport.calls[1].headers.get('X-CSRFToken'), 'rotated-after-login');
});

test('bootstrap errors block writes and the next request may bootstrap again', async () => {
  transport.cookie = '';
  transport.handler = async () => json({ detail: 'Offline' }, 503);
  await assert.rejects(api.projects.create({ title: 'Do not send' }), { status: 503 });
  assert.equal(transport.calls.length, 1);
  transport.handler = async url => url.endsWith('/auth/csrf') ? json({ csrf_token: 'recovered' }) : json({ id: 1 });
  await api.projects.create({ title: 'Recovered' });
  assert.equal(transport.calls.at(-1).headers.get('X-CSRFToken'), 'recovered');
});

test('a malformed bootstrap response cannot produce a tokenless write', async () => {
  transport.cookie = '';
  transport.handler = async () => json({ csrf_token: '' });
  await assert.rejects(api.projects.create({ title: 'No token' }), error => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.status, 200);
    assert.match(error.message, /CSRF/);
    return true;
  });
  assert.equal(transport.calls.length, 1);
});

test('cancelling a caller waiting on shared CSRF does not cancel another write', async () => {
  transport.cookie = '';
  let release;
  transport.handler = async url => url.endsWith('/auth/csrf')
    ? new Promise(resolve => { release = resolve; }) : json({ id: 1 });
  const controller = new AbortController();
  const first = api.projects.create({ title: 'Cancelled' }, { signal: controller.signal });
  const second = api.projects.create({ title: 'Survives' });
  controller.abort();
  await assert.rejects(first, { name: 'AbortError' });
  release(json({ csrf_token: 'shared' }));
  await second;
  assert.equal(transport.calls.length, 2);
  assert.equal(JSON.parse(transport.calls[1].body).title, 'Survives');
});

test('API calls cannot leak CSRF tokens to another server or outside /api', async () => {
  for (const path of ['https://evil.example.com/collect', '../admin/', '/../../outside', 'http://127.0.0.1:8001/api/']) {
    await assert.rejects(apiRequest(path, { method: 'POST' }), TypeError);
  }
  assert.equal(transport.calls.length, 0);
});

