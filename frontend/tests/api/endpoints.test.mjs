import assert from 'node:assert/strict';
import { test } from 'vitest';
import { API_BASE_URL, ApiError, api, apiRequest, getCsrfTokenFromCookie } from '../../src/services/api';
import { json, setupTransport } from '../support/transport';

const transport = setupTransport();

const endpointCases = [
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

test('covers all 51 generated operations', () => assert.equal(endpointCases.length, 51));
for (const [method, path, call] of endpointCases) {
  test(method + ' ' + path, async () => {
    transport.handler = async (url, init) => init.method === 'DELETE'
      ? new Response(null, { status: 204 })
      : json(url.endsWith('/auth/csrf') ? { csrf_token: 'masked' } : { id: 1 });
    await call();
    assert.equal(transport.calls.length, 1);
    const request = transport.calls[0];
    assert.equal(request.url, API_BASE_URL + path);
    assert.equal(request.method, method);
    assert.equal(request.credentials, 'include');
    if (method !== 'GET') assert.equal(request.headers.get('X-CSRFToken'), 'initial-token');
  });
}

test('list helpers forward pagination, collections, searches and scene filters', async () => {
  await api.projects.list({ collection: 'trash', search: 'Film & seria', limit: 5, offset: 10 });
  let query = new URL(transport.calls.at(-1).url).searchParams;
  assert.equal(query.get('collection'), 'trash');
  assert.equal(query.get('search'), 'Film & seria');
  assert.equal(query.get('limit'), '5');
  assert.equal(query.get('offset'), '10');
  await api.scenes.list(1, { act_id: 2, limit: 3, offset: 0 });
  query = new URL(transport.calls.at(-1).url).searchParams;
  assert.equal(query.get('act_id'), '2');
  assert.equal(query.get('offset'), '0');
  for (const call of [api.acts.list, api.characters.list, api.cast.list, api.prompts.list,
                       api.runs.list, api.agentExecutions.list, api.variants.listForScene, api.variants.listForRun]) {
    await call(1, { limit: 7, offset: 14 });
    assert.equal(new URL(transport.calls.at(-1).url).search, '?limit=7&offset=14');
  }
});

