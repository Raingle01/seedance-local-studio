import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture, png, request, waitForState } from './helpers.mjs';
import { validateGeneration, MODEL } from '../server/app.mjs';
import { MODELS } from '../public/models.js';

const input = (prompt = '雾中的山谷', extra = {}) => ({ requestId: randomUUID(), prompt, ...extra });

test('Flash validation: 4–30 seconds, 480/720p, references and automatic frame ratio', () => {
  const uploads = Array.from({ length: 11 }, (_, i) => ({ id: String(i), size: 1024 }));
  const result = validateGeneration({ ...input(), parameters: { mode: 'frames', ratio: '16:9', duration: 30 }, assetIds: ['0', '1'] }, uploads);
  assert.equal(result.parameters.ratio, 'adaptive');
  assert.throws(() => validateGeneration({ ...input(), parameters: { resolution: '1080p' } }, uploads), /仅支持/);
  assert.throws(() => validateGeneration({ ...input(), parameters: { duration: 31 } }, uploads), /时长/);
  assert.throws(() => validateGeneration({ ...input(), parameters: { duration: '5' } }, uploads), /时长/);
  assert.throws(() => validateGeneration({ ...input(), parameters: { mode: 'frames' } }, uploads), /需要/);
  assert.throws(() => validateGeneration({ ...input(), assetIds: uploads.map(a => a.id) }, uploads), /最多/);
  assert.throws(() => validateGeneration({ ...input(), assetIds: ['missing'] }, uploads), /不存在/);
  assert.throws(() => validateGeneration({ ...input(), assetIds: ['big'] }, [{ id: 'big', size: 49 * 1024 * 1024 }]), /64MB/);
  assert.equal(validateGeneration(input(), uploads).parameters.generate_audio, true);
});

test('model limits distinguish 2.5, 2.0, and legacy models', () => {
  const uploads = Array.from({ length: 30 }, (_, i) => ({ id: String(i), size: 1024 }));
  const full = MODELS[1], second = MODELS[2], legacy = MODELS[5], legacyFast = MODELS[6];
  const highRes = validateGeneration({ ...input(), assetIds: uploads.map(a => a.id), parameters: { duration: 30, resolution: '4k' } }, uploads, full);
  assert.equal(highRes.assets.length, 30);
  assert.throws(() => validateGeneration({ ...input(), parameters: { duration: 30 } }, uploads, second), /4–15/);
  assert.throws(() => validateGeneration({ ...input(), assetIds: uploads.slice(0, 10).map(a => a.id) }, uploads, second), /最多/);
  assert.equal(validateGeneration({ ...input(), assetIds: ['0'], parameters: { mode: 'frames', ratio: '9:16' } }, uploads, second).parameters.ratio, '9:16');
  assert.equal(validateGeneration({ ...input(), parameters: { duration: 2, resolution: '1080p' } }, uploads, legacy).parameters.generate_audio, false);
  assert.throws(() => validateGeneration({ ...input(), parameters: { duration: -1 } }, uploads, legacy), /2–12/);
  assert.throws(() => validateGeneration({ ...input(), parameters: { ratio: 'adaptive' } }, uploads, legacy), /自动比例/);
  assert.throws(() => validateGeneration({ ...input(), assetIds: ['0'] }, uploads, legacy), /不支持多图/);
  assert.throws(() => validateGeneration({ ...input(), assetIds: ['0', '1'], parameters: { mode: 'frames' } }, uploads, legacyFast), /最多/);
});

test('each generation uses its selected model and strips unsupported legacy fields', async t => {
  const f = await fixture(); t.after(() => f.close());
  const first = await request(f.base, '/api/generations', input('高质量创作', { model: MODELS[1].id, parameters: { resolution: '4k', duration: 30 } }));
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  await request(f.base, '/api/generations', input('经典创作', { conversationId: first.data.conversationId, model: MODELS[5].id, parameters: { resolution: '1080p', duration: 2, generate_audio: true } }));
  const final = await waitForState(f, s => s.conversations[0]?.runs[1]?.result?.localUrl);
  assert.equal(f.calls[0].body.model, MODELS[1].id);
  assert.equal(f.calls[1].body.model, MODELS[5].id);
  assert.equal(f.calls[1].body.generate_audio, undefined);
  assert.equal(f.calls[1].body.omni_reference_task_type, undefined);
  assert.equal(final.conversations[0].runs[1].modelName, 'Seedance 1.0 Pro');
  assert.equal((await request(f.base, '/api/generations', input('拒绝未知模型', { model: 'unrecognized-model' }))).status, 400);
});

test('custom endpoints apply the selected underlying model capabilities', async t => {
  const f = await fixture(); t.after(() => f.close());
  const config = await request(f.base, '/api/settings', { model: 'ep-test-custom', modelProfile: MODELS[2].id }, 'PUT');
  assert.equal(config.data.models.at(-1).maxDuration, 15);
  assert.equal((await request(f.base, '/api/generations', input('不支持30秒', { model: 'ep-test-custom', parameters: { duration: 30 } }))).status, 400);
  await request(f.base, '/api/generations', input('接入点生成', { model: 'ep-test-custom', parameters: { resolution: '4k' } }));
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(f.calls[0].body.model, 'ep-test-custom');
  assert.equal(f.calls[0].body.resolution, '4k');
});

test('text → task → polling → local video; correct API payload, idempotency, range and restart', async t => {
  const f = await fixture(); t.after(() => f.close());
  const submission = input('海浪拍打岩石', { parameters: { duration: 11, ratio: '9:16', resolution: '480p', generate_audio: false, watermark: true } });
  const created = await request(f.base, '/api/generations', submission);
  assert.equal(created.status, 202);
  const duplicate = await request(f.base, '/api/generations', submission);
  assert.equal(duplicate.data.run.id, created.data.run.id);
  const state = await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(f.calls.length, 1);
  const payload = f.calls[0].body;
  assert.equal(payload.model, MODEL);
  assert.deepEqual(payload.content, [{ type: 'text', text: '海浪拍打岩石' }]);
  assert.equal(payload.duration, 11);
  assert.equal(payload.generate_audio, false);
  assert.equal(payload.watermark, true);
  assert.equal(payload.ratio, '9:16');
  assert.equal(payload.resolution, '480p');
  assert.equal(f.calls[0].authorization, 'Bearer test-key-not-real');
  const localUrl = state.conversations[0].runs[0].result.localUrl;
  const media = await fetch(`${f.base}${localUrl}`, { headers: { Range: 'bytes=5-9' } });
  assert.equal(media.status, 206);
  assert.equal(await media.text(), 'video');
  const suffix = await fetch(`${f.base}${localUrl}`, { headers: { Range: 'bytes=-8' } });
  assert.equal(await suffix.text(), 'requests');
  const invalidRange = await fetch(`${f.base}${localUrl}`, { headers: { Range: 'bytes=999-' } });
  assert.equal(invalidRange.status, 416);
  assert.equal(f.mediaDownloads, 1);
  await f.restart();
  const restored = (await request(f.base, '/api/state', undefined, 'GET')).data;
  assert.equal(restored.conversations[0].runs[0].result.localUrl, localUrl);
  assert.equal(f.mediaDownloads, 1);
  assert.equal((await fetch(`${f.base}${localUrl}?download=1`)).headers.get('content-disposition').startsWith('attachment;'), true);
});

test('uploaded reference images use data URLs, and first/last frame roles are exclusive', async t => {
  const f = await fixture(); t.after(() => f.close());
  const response = await fetch(`${f.base}/api/uploads`, { method: 'POST', headers: { 'Content-Type': 'image/png', 'X-File-Name': encodeURIComponent('参考.png') }, body: png() });
  assert.equal(response.status, 201);
  const asset = await response.json();
  assert.equal(asset.name, '参考.png');
  await request(f.base, '/api/generations', input('图片1中的山谷', { assetIds: [asset.id] }));
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(f.calls[0].body.content[1].role, 'reference_image');
  assert.match(f.calls[0].body.content[1].image_url.url, /^data:image\/png;base64,/);
  assert.equal(f.calls[0].body.omni_reference_task_type, 'reference');
  await request(f.base, '/api/generations', input('', { assetIds: [asset.id, asset.id], parameters: { mode: 'frames', ratio: '16:9' } }));
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.deepEqual(f.calls[1].body.content.map(c => c.role), ['first_frame', 'last_frame']);
  assert.equal(f.calls[1].body.ratio, 'adaptive');
  assert.equal(f.calls[1].body.omni_reference_task_type, undefined);
  const invalid = await fetch(`${f.base}/api/uploads`, { method: 'POST', headers: { 'Content-Type': 'image/png' }, body: 'not-an-image' });
  assert.equal(invalid.status, 400);
});

test('transient polling errors recover; failed and rejected generations preserve errors', async t => {
  const f = await fixture(); t.after(() => f.close());
  await request(f.base, '/api/generations', input('[transient] 日落'));
  const success = await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(success.conversations[0].runs[0].pollError, undefined);
  await request(f.base, '/api/generations', input('[fail] 日落'));
  const failed = await waitForState(f, s => s.conversations[0]?.runs[0]?.status === 'failed');
  assert.equal(failed.conversations[0].runs[0].error.code, 'GenerationFailed');
  await request(f.base, '/api/generations', input('[reject] 日落'));
  const rejected = await waitForState(f, s => s.conversations[0]?.runs[0]?.status === 'failed');
  assert.equal(rejected.conversations[0].runs[0].error.code, 'InvalidParameter');
});

test('running jobs resume across service restart; active history cannot be deleted', async t => {
  const f = await fixture(); t.after(() => f.close()); f.hold(true);
  const result = await request(f.base, '/api/generations', input('向前推进'));
  await waitForState(f, s => s.conversations[0]?.runs[0]?.status === 'running');
  const deletion = await request(f.base, `/api/conversations/${result.data.conversationId}`, undefined, 'DELETE');
  assert.equal(deletion.status, 409);
  await f.restart(); f.hold(false);
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(f.calls.length, 1);
  await request(f.base, `/api/conversations/${result.data.conversationId}`, { title: '新标题' }, 'PATCH');
  assert.equal((await request(f.base, '/api/state', undefined, 'GET')).data.conversations[0].title, '新标题');
  const deleted = await request(f.base, `/api/conversations/${result.data.conversationId}`, undefined, 'DELETE');
  assert.equal(deleted.status, 200);
});

test('uncertain submissions are never repeated and can recover an existing task ID', async t => {
  const f = await fixture(); t.after(() => f.close());
  const result = await request(f.base, '/api/generations', input('[uncertain] 夜晚'));
  await waitForState(f, s => s.conversations[0]?.runs[0]?.status === 'unknown');
  await f.restart();
  assert.equal(f.calls.length, 1);
  f.tasks.set('cgt-recovered-task', { count: 3, prompt: '夜晚', body: { duration: 5, ratio: '16:9', resolution: '720p' } });
  const recover = await request(f.base, `/api/tasks/${result.data.run.id}/recover`, { taskId: 'cgt-recovered-task' });
  assert.equal(recover.status, 200);
  await waitForState(f, s => s.conversations[0]?.runs[0]?.result?.localUrl);
  assert.equal(f.calls.length, 1);
});

test('settings stay server-side; unsafe origins, unsupported models and private files are blocked', async t => {
  const f = await fixture(); t.after(() => f.close());
  const saved = await request(f.base, '/api/settings', { apiKey: 'private-key-for-test', model: MODEL }, 'PUT');
  assert.equal(saved.status, 200);
  assert.equal(saved.data.hasApiKey, true);
  assert.equal(JSON.stringify(saved.data).includes('private-key-for-test'), false);
  const state = await fetch(`${f.base}/api/state`);
  assert.equal((await state.text()).includes('private-key-for-test'), false);
  assert.equal((await stat(join(f.dataDir, 'settings.json'))).mode & 0o777, 0o600);
  assert.equal(JSON.parse(await readFile(join(f.dataDir, 'settings.json'), 'utf8')).apiKey, 'private-key-for-test');
  const badOrigin = await fetch(`${f.base}/api/settings`, { method: 'PUT', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(badOrigin.status, 403);
  assert.equal((await fetch(`${f.base}/.data/settings.json`)).status, 404);
  assert.equal((await request(f.base, '/api/settings', { model: 'some-other-model' }, 'PUT')).status, 400);
  const cleared = await request(f.base, '/api/settings', { clearKey: true }, 'PUT');
  assert.equal(cleared.data.keySource, 'environment');
});

test('SSE immediately delivers history and then pushes updates', async t => {
  const f = await fixture(); t.after(() => f.close());
  const controller = new AbortController();
  const response = await fetch(`${f.base}/api/events`, { signal: controller.signal });
  assert.equal(response.headers.get('content-type'), 'text/event-stream');
  const reader = response.body.getReader();
  const first = new TextDecoder().decode((await reader.read()).value);
  assert.match(first, /event: state/);
  assert.match(first, /"conversations":\[\]/);
  await request(f.base, '/api/generations', input('SSE 测试'));
  const next = new TextDecoder().decode((await reader.read()).value);
  assert.match(next, /SSE 测试/);
  controller.abort();
  await reader.cancel().catch(() => {});
});

test('a crash during POST is marked uncertain instead of resubmitted on restart', async t => {
  const f = await fixture(); t.after(() => f.close());
  const history = { uploads: [], conversations: [{ id: randomUUID(), title: '中断的创作', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runs: [{ id: randomUUID(), status: 'submitting', prompt: '云海', assets: [], parameters: {}, createdAt: new Date().toISOString() }] }] };
  // Stop first, then prepare the same on-disk record a crash could leave behind.
  // The helper restart persists current state, so seed before constructing a second isolated app.
  const { createApp } = await import('../server/app.mjs');
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const dir = await mkdtemp(join(tmpdir(), 'seedance-crash-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await writeFile(join(dir, 'history.json'), JSON.stringify(history));
  const app = await createApp({ dataDir: dir });
  const { listen } = await import('./helpers.mjs');
  const base = await listen(app.server);
  t.after(() => app.close());
  const restored = await request(base, '/api/state', undefined, 'GET');
  assert.equal(restored.data.conversations[0].runs[0].status, 'unknown');
});
