import assert from 'node:assert/strict';
import { test } from 'vitest';
import { ApiError, projectsApi } from '../../src/services/api';
import { json, setupTransport } from '../support/transport';

const transport = setupTransport();

test('screenplay downloads preserve binary content, credentials, filename and format', async () => {
  const bytes = new Uint8Array([37, 80, 68, 70, 0, 255]);
  transport.handler = async () => new Response(bytes, { headers: {
    'Content-Type': 'application/pdf', 'Content-Disposition': "attachment; filename*=utf-8''Za%C5%BC%C3%B3%C5%82%C4%87.pdf",
  } });
  const download = await projectsApi.export(7, 'pdf');
  assert.deepEqual(new Uint8Array(await download.blob.arrayBuffer()), bytes);
  assert.equal(download.filename, 'Zażółć.pdf');
  const request = transport.calls[0];
  assert.equal(request.url, `${window.location.origin}/api/projects/7/export?format=pdf`);
  assert.equal(request.credentials, 'include');
  assert.equal(request.method, 'GET');
  assert.equal(request.body, undefined);
  assert.equal(request.headers.has('X-CSRFToken'), false);
});

test('FDX and Fountain download as text without trying to parse JSON', async () => {
  for (const format of ['fdx', 'fountain']) {
    transport.handler = async () => new Response('Żółw & < >', { headers: { 'Content-Disposition': `attachment; filename="film.${format}"` } });
    const download = await projectsApi.export(1, format);
    assert.equal(await download.blob.text(), 'Żółw & < >');
    assert.equal(download.filename, `film.${format}`);
  }
});

test('download errors use the same API error handling, not a fake downloadable file', async () => {
  transport.handler = async () => json({ detail: 'Project not found.' }, 404);
  await assert.rejects(projectsApi.export(1, 'pdf'), error => error instanceof ApiError && error.status === 404);
  transport.handler = async () => new Response('Server unavailable', { status: 503 });
  await assert.rejects(projectsApi.export(1, 'fdx'), error => error instanceof ApiError && error.status === 503);
});

test('aborted downloads do not send requests', async () => {
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(projectsApi.export(1, 'pdf', { signal: controller.signal }), { name: 'AbortError' });
  assert.equal(transport.calls.length, 0);
});
