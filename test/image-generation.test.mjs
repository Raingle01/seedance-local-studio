import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { validateImageGeneration } from '../server/app.mjs';
import { DEFAULT_IMAGE_MODEL, MODELS, IMAGE_SIZES } from '../public/models.js';
import { fixture, png, request, waitForState } from './helpers.mjs';

const input = (extra = {}) => ({ requestId: randomUUID(), model: DEFAULT_IMAGE_MODEL, prompt: '柔和的光线，安静的山谷', ...extra });
const uploaded = async (f, bytes = png()) => {
  const response = await fetch(`${f.base}/api/uploads`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: bytes });
  assert.equal(response.status, 201);
  return response.json();
};

test('Seedream validates image-only parameters, ratios, alpha output and reference limits', () => {
  const assets = Array.from({ length: 11 }, (_, i) => ({ id: String(i), size: 1000, width: 100, height: 100 }));
  assert.equal(validateImageGeneration(input(), []).parameters.resolution, '2K');
  assert.equal(validateImageGeneration(input({ assetIds: ['0'] }), assets).assets.length, 1);
  assert.throws(() => validateImageGeneration(input({ prompt: '', assetIds: ['0'] }), assets), /提示词/);
  assert.throws(() => validateImageGeneration(input({ assetIds: assets.map(a => a.id) }), assets), /10/);
  assert.throws(() => validateImageGeneration(input({ assetIds: ['missing'] }), assets), /不存在/);
  assert.throws(() => validateImageGeneration(input({ parameters: { resolution: '4K' } }), assets), /分辨率/);
  assert.throws(() => validateImageGeneration(input({ parameters: { ratio: 'adaptive' } }), assets), /比例/);
  assert.throws(() => validateImageGeneration(input({ parameters: { output_format: 'jpeg', background: 'transparent' } }), assets), /PNG/);
  assert.throws(() => validateImageGeneration(input({ parameters: { watermark: 'false' } }), assets), /布尔/);
  assert.throws(() => validateImageGeneration(input({ assetIds: ['small'] }), [{ id: 'small', size: 10, width: 14, height: 100 }]), /宽高/);
  for (const sizes of Object.values(IMAGE_SIZES)) for (const value of Object.values(sizes)) {
    const [w, h] = value.split('x').map(Number);
    assert.ok(w * h >= 921600 && w * h <= 4624220 && w / h >= 1 / 16 && w / h <= 16);
  }
});

test('text to PNG uses the synchronous image endpoint once, saves exact bytes, downloads and survives restart', async t => {
  const image = png(1024, 1024, true), f = await fixture({ image }); t.after(() => f.close());
  const body = input({ parameters: { resolution: '1.5K', ratio: '16:9', background: 'transparent', output_format: 'png', watermark: true } });
  const created = await request(f.base, '/api/generations', body);
  assert.equal(created.status, 202);
  assert.equal(created.data.run.kind, 'image');
  assert.equal((await request(f.base, '/api/generations', body)).data.run.id, created.data.run.id);
  const state = await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  const run = state.conversations[0].runs[0];
  assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].path, '/api/v3/images/generations');
  assert.deepEqual(f.calls[0].body, { model: DEFAULT_IMAGE_MODEL, prompt: body.prompt, size: '2048x1152', output_format: 'png', background: 'transparent', watermark: true, response_format: 'url' });
  assert.equal(f.calls[0].authorization, 'Bearer test-key-not-real');
  assert.equal(run.taskId, undefined);
  assert.equal(run.status, 'succeeded');
  assert.equal(run.result.background, 'transparent');
  assert.equal(run.result.width, 1024);
  assert.equal(run.result.usage.generated_images, 1);
  assert.equal(f.imagePolls, 0);
  const response = await fetch(`${f.base}${run.result.localUrl}?download=1`);
  assert.equal(response.headers.get('content-type'), 'image/png');
  assert.match(response.headers.get('content-disposition'), /attachment; filename="seedream-/);
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), image);
  assert.equal((await stat(join(f.dataDir, 'images', run.result.filename))).mode & 0o777, 0o600);
  await f.restart();
  assert.equal((await request(f.base, '/api/state', undefined, 'GET')).data.conversations[0].runs[0].result.localUrl, run.result.localUrl);
  assert.equal(f.calls.length, 1);
});

test('single and multi reference images use Base64; generated images can be edited and mixed with videos', async t => {
  const f = await fixture(); t.after(() => f.close());
  const asset = await uploaded(f, png(100, 100));
  const first = await request(f.base, '/api/generations', input({ assetIds: [asset.id] }));
  const firstState = await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.match(f.calls[0].body.image, /^data:image\/png;base64,/);
  assert.equal(f.calls[0].body.size, '2K');
  const run = firstState.conversations[0].runs[0];
  const reference = await request(f.base, `/api/tasks/${run.id}/reference`);
  assert.equal(reference.status, 200);
  assert.equal(reference.data.width, 1024);
  assert.equal((await request(f.base, `/api/tasks/${run.id}/reference`)).data.id, reference.data.id);
  await request(f.base, '/api/generations', input({ conversationId: first.data.conversationId, prompt: '保留构图，改为夜景', assetIds: [reference.data.id, asset.id] }));
  await waitForState(f, s => s.conversations[0]?.runs[1]?.result?.localUrl);
  assert.equal(f.calls[1].body.image.length, 2);
  assert.equal(Buffer.from(f.calls[1].body.image[0].split(',')[1], 'base64').equals(await readFile(join(f.dataDir, 'images', run.result.filename))), true);
  assert.equal((await request(f.base, '/api/generations', input({ model: MODELS[0].id, assetIds: [asset.id] }))).status, 400);
  await request(f.base, '/api/generations', input({ model: MODELS[0].id, conversationId: first.data.conversationId, assetIds: [reference.data.id], parameters: { mode: 'frames' } }));
  const mixed = await waitForState(f, s => s.conversations[0]?.runs[2]?.result?.localUrl);
  assert.deepEqual(mixed.conversations[0].runs.map(r => r.kind), ['image', 'image', 'video']);
  assert.equal(f.calls[2].body.content[1].role, 'first_frame');
});

test('image failures, timeout and service interruption never retry a billable generation', async t => {
  const f = await fixture({ imageDelay: 200, imageTimeout: 60 }); t.after(() => f.close());
  await request(f.base, '/api/generations', input());
  await waitForState(f, s => s.conversations[0]?.runs[0]?.status === 'unknown');
  await f.restart();
  assert.equal(f.calls.length, 1);
  const other = await fixture(); t.after(() => other.close());
  await request(other.base, '/api/generations', input({ prompt: '[fail] 明确失败' }));
  const failed = await waitForState(other, s => s.conversations[0]?.runs[0]?.status === 'failed');
  assert.equal(failed.conversations[0].runs[0].error.code, 'ImageGenerationFailed');
  await request(other.base, '/api/generations', input({ prompt: '[uncertain] 断线' }));
  const uncertain = await waitForState(other, s => s.conversations[0]?.runs[0]?.status === 'unknown');
  const recovery = await request(other.base, `/api/tasks/${uncertain.conversations[0].runs[0].id}/recover`, { taskId: 'cgt-any-task' });
  assert.equal(recovery.status, 400);
  const interrupted = await fixture({ imageDelay: 10000 }); t.after(() => interrupted.close());
  const created = await request(interrupted.base, '/api/generations', input());
  await waitForState(interrupted, s => interrupted.calls.length === 1 && s.conversations[0]?.runs[0]?.status === 'running');
  assert.equal((await request(interrupted.base, `/api/conversations/${created.data.conversationId}`, undefined, 'DELETE')).status, 409);
  await interrupted.restart();
  assert.equal((await request(interrupted.base, '/api/state', undefined, 'GET')).data.conversations[0].runs[0].status, 'unknown');
  assert.equal(interrupted.calls.length, 1);
});

test('image cache retry only downloads again; custom endpoints route by image profile', async t => {
  const f = await fixture(); t.after(() => f.close());
  f.failImageDownload(true);
  const config = await request(f.base, '/api/settings', { model: 'ep-image-test', modelProfile: DEFAULT_IMAGE_MODEL }, 'PUT');
  assert.equal(config.data.models.at(-1).kind, 'image');
  await request(f.base, '/api/generations', input({ model: 'ep-image-test' }));
  const failed = await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.cacheStatus === 'failed');
  const run = failed.conversations[0].runs[0];
  assert.equal(run.status, 'succeeded');
  assert.equal(f.calls[0].body.model, 'ep-image-test');
  assert.equal(f.calls[0].path, '/api/v3/images/generations');
  assert.equal((await request(f.base, `/api/tasks/${run.id}/reference`)).status, 409);
  f.failImageDownload(false);
  await request(f.base, `/api/tasks/${run.id}/cache`);
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(f.calls.length, 1);
  assert.equal(f.imageDownloads, 2);
});
