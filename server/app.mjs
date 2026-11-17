import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile, rename, mkdir, stat, unlink } from 'node:fs/promises';
import { createReadStream, createWriteStream } from 'node:fs';
import { join, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { imageSize } from 'image-size';
import { MODELS, ALL_MODELS, IMAGE_MODELS, IMAGE_SIZES, DEFAULT_MODEL, getModel } from '../public/models.js';

export const MODEL = DEFAULT_MODEL;
const API_BASE = 'https://ark.cn-beijing.volces.com/api/v3';
const PUBLIC = fileURLToPath(new URL('../public/', import.meta.url));
const MB = 1024 * 1024;
const ACTIVE = new Set(['submitting', 'queued', 'running']);
const REMOTE_STATES = new Set(['queued', 'running', 'succeeded', 'failed', 'expired', 'cancelled']);
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.mp4': 'video/mp4', '.jpg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.gif': 'image/gif' };

class AppError extends Error {
  constructor(status, message, code = '') { super(message); this.status = status; this.code = code; }
}
function assert(condition, message, status = 400) { if (!condition) throw new AppError(status, message); }
async function loadJSON(path, fallback) {
  try { return JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return fallback; throw new Error(`无法读取 ${path}，请先检查或备份该文件。`, { cause: error }); }
}
async function atomicJSON(path, value) {
  await writeFile(`${path}.tmp`, JSON.stringify(value, null, 2), { mode: 0o600 });
  await rename(`${path}.tmp`, path);
}
async function body(req, limit) {
  assert(!req.headers['content-length'] || Number(req.headers['content-length']) <= limit, '文件或请求体过大。', 413);
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new AppError(413, '文件或请求体过大。');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}
async function jsonBody(req) {
  assert(req.headers['content-type']?.split(';')[0] === 'application/json', '请使用 JSON 请求。', 415);
  let value;
  try { value = JSON.parse((await body(req, MB)).toString()); }
  catch (error) { if (error instanceof AppError) throw error; throw new AppError(400, 'JSON 格式不正确。'); }
  assert(value && typeof value === 'object' && !Array.isArray(value), '请求格式不正确。');
  return value;
}
function json(res, status, value) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(value));
}
function detectedImage(bytes) {
  if (bytes.length > 24 && bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'image/png';
  if (bytes.length > 12 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) return 'image/jpeg';
  if (bytes.length > 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP') return 'image/webp';
  if (bytes.length > 10 && /^GIF8[79]a$/.test(bytes.toString('ascii', 0, 6))) return 'image/gif';
  return null;
}
function dimensions(bytes) {
  try { const { width, height } = imageSize(bytes); assert(width > 0 && height > 0, '图片尺寸无效。'); return { width, height }; }
  catch { throw new AppError(400, '无法读取图片尺寸，请选择有效图片。'); }
}
function validateAssetDimensions(assets, image = false) {
  for (const { width: w, height: h } of assets) {
    if (!w || !h) continue; // Older uploaded assets predate dimension metadata.
    assert(image ? Math.min(w, h) > 14 && w * h <= 36000000 && w / h >= 1 / 16 && w / h <= 16 : Math.min(w, h) >= 300 && Math.max(w, h) <= 6000 && w / h >= .4 && w / h <= 2.5,
      image ? '生图参考图片宽高需大于 14px、总像素不超过 3600 万、宽高比为 1:16–16:1。' : '视频参考图片宽高需为 300–6000px、宽高比为 0.4–2.5。');
  }
}

export function validateImageGeneration(input, uploads, spec = IMAGE_MODELS[0]) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  assert(prompt.length > 0 && prompt.length <= 10000, '图片生成需要提示词，请输入 1–10,000 个字符。');
  const ids = input.assetIds ?? [];
  assert(Array.isArray(ids) && ids.length <= spec.maxReferences && ids.every(id => typeof id === 'string'), `${spec.name} 最多支持 ${spec.maxReferences} 张参考图片。`);
  const assets = ids.map(id => uploads.find(item => item.id === id));
  assert(assets.every(Boolean), '部分参考图片不存在，请重新上传。');
  validateAssetDimensions(assets, true);
  const p = input.parameters ?? {};
  assert(p && typeof p === 'object' && !Array.isArray(p), '生成参数格式不正确。');
  const resolution = p.resolution ?? '2K', ratio = p.ratio ?? 'auto';
  assert(spec.resolutions.includes(resolution), 'Seedream 5.5 支持 1K、1.5K、2K 分辨率。');
  assert(ratio === 'auto' || Object.hasOwn(IMAGE_SIZES[resolution], ratio), '不支持的图片比例。');
  const output_format = p.output_format ?? 'png', background = p.background ?? 'auto';
  assert(['png', 'jpeg'].includes(output_format), '图片格式应为 PNG 或 JPEG。');
  assert(['auto', 'transparent', 'opaque'].includes(background), '不支持的图片背景类型。');
  assert(!(output_format === 'jpeg' && background === 'transparent'), '透明背景需要使用 PNG 格式。');
  assert(p.watermark === undefined || typeof p.watermark === 'boolean', 'watermark 必须是布尔值。');
  assert(assets.reduce((n, a) => n + Math.ceil(a.size / 3) * 4, 0) + Buffer.byteLength(prompt) + 10000 < 64 * MB, '参考图片合计过大，请压缩图片；本地请求上限为 64MB。');
  return { prompt, assets, parameters: { resolution, ratio, output_format, background, watermark: p.watermark ?? false } };
}

// Model-specific constraints come from one table shared with the UI.
export function validateGeneration(input, uploads, spec = MODELS[0]) {
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : '';
  assert(prompt.length <= 10000, '提示词过长，请控制在 10,000 字以内。');
  const ids = input.assetIds ?? [];
  assert(Array.isArray(ids) && ids.length <= Math.max(spec.maxReferences, spec.frameImages) && ids.every(id => typeof id === 'string'), `${spec.name} 最多支持 ${Math.max(spec.maxReferences, spec.frameImages)} 张图片。`);
  const assets = ids.map(id => uploads.find(item => item.id === id));
  assert(assets.every(Boolean), '部分参考图片不存在，请重新上传。');
  validateAssetDimensions(assets);
  assert(prompt || assets.length, '请输入提示词或添加参考图片。');
  const p = input.parameters ?? {};
  assert(p && typeof p === 'object' && !Array.isArray(p), '生成参数格式不正确。');
  const mode = p.mode ?? 'reference';
  assert(['reference', 'frames'].includes(mode), '请选择有效的生成模式。');
  if (mode === 'frames') assert(assets.length >= 1 && assets.length <= spec.frameImages, `此模型的首帧模式需要 1–${spec.frameImages} 张图片。`);
  else assert(assets.length <= spec.maxReferences, spec.maxReferences ? `${spec.name} 最多支持 ${spec.maxReferences} 张参考图。` : '该模型不支持多图参考，请使用首帧或首尾帧模式。');
  const ratio = mode === 'frames' && spec.forceAdaptiveFrames ? 'adaptive' : (p.ratio ?? '16:9');
  assert(['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'].includes(ratio), '不支持的画面比例。');
  assert(spec.autoDuration || assets.length || ratio !== 'adaptive', 'Seedance 1.0 文生视频不支持自动比例，请选择具体比例。');
  const resolution = p.resolution ?? '720p';
  assert(spec.resolutions.includes(resolution), `${spec.name} 仅支持 ${spec.resolutions.join('、')}。`);
  const duration = p.duration ?? 5;
  assert(Number.isInteger(duration) && ((spec.autoDuration && duration === -1) || (duration >= spec.minDuration && duration <= spec.maxDuration)), `${spec.name} 视频时长应为 ${spec.minDuration}–${spec.maxDuration} 秒${spec.autoDuration ? '，或选择自动' : ''}。`);
  for (const key of ['generate_audio', 'watermark']) assert(p[key] === undefined || typeof p[key] === 'boolean', `${key} 必须是布尔值。`);
  assert(assets.reduce((n, a) => n + Math.ceil(a.size / 3) * 4, 0) + Buffer.byteLength(prompt) + 10000 < 64 * MB, '参考图片合计过大，Base64 请求不能超过 64MB，请减少图片或压缩后上传。');
  return { prompt, assets, parameters: { mode, ratio, resolution, duration, generate_audio: spec.audio ? (p.generate_audio ?? true) : false, watermark: p.watermark ?? false } };
}

export async function createApp({ dataDir, apiBase = API_BASE, apiKey = '', model = MODEL, modelProfile = MODEL, pollInterval = 4000, imageTimeout = 300000 } = {}) {
  for (const dir of [dataDir, join(dataDir, 'uploads'), join(dataDir, 'videos'), join(dataDir, 'images')]) await mkdir(dir, { recursive: true, mode: 0o700 });
  const dbPath = join(dataDir, 'history.json');
  const settingsPath = join(dataDir, 'settings.json');
  const db = await loadJSON(dbPath, { conversations: [], uploads: [] });
  let settings = await loadJSON(settingsPath, {});
  const listeners = new Set();
  const operations = new Set();
  const polling = new Set();
  const downloading = new Set();
  const nextPoll = new Map();
  const pollFailures = new Map();
  const abort = new AbortController();
  let closing = false;
  let saveQueue = Promise.resolve();
  let settingsQueue = Promise.resolve();
  const key = () => settings.apiKey || apiKey;
  const modelId = () => settings.model || model;
  const clean = value => {
    let message = String(value ?? '未知错误').slice(0, 2000);
    for (const secret of [key(), apiKey]) if (secret) message = message.split(secret).join('[已隐藏]');
    return message;
  };
  const configuredProfile = () => settings.modelProfile || modelProfile;
  const modelOptions = () => {
    const configured = modelId();
    const profile = getModel(configuredProfile()) || MODELS[0];
    return configured.startsWith('ep-') ? [...ALL_MODELS, { ...profile, id: configured, profileId: profile.id, name: `自定义接入点 · ${profile.name}`, tag: 'CUSTOM' }] : ALL_MODELS;
  };
  const config = () => ({ hasApiKey: Boolean(key()), keySource: settings.apiKey ? 'settings' : apiKey ? 'environment' : null, model: modelId(), modelProfile: configuredProfile(), models: modelOptions(), apiBase: API_BASE });
  const snapshot = () => ({ conversations: db.conversations, config: config() });
  function save() {
    const serialized = JSON.stringify(db);
    const operation = saveQueue.catch(() => {}).then(() => atomicJSON(dbPath, JSON.parse(serialized)));
    saveQueue = operation;
    return operation;
  }
  function emit() {
    const packet = `event: state\ndata: ${JSON.stringify(snapshot())}\n\n`;
    for (const response of listeners) if (!response.destroyed) response.write(packet);
  }
  async function changed() { await save(); emit(); }
  function background(fn) {
    const operation = Promise.resolve().then(fn).catch(error => console.error('后台操作失败:', clean(error.message))).finally(() => operations.delete(operation));
    operations.add(operation);
    return operation;
  }
  function allRuns() { return db.conversations.flatMap(c => c.runs); }
  function runById(id) { const run = allRuns().find(r => r.id === id); assert(run, '没有找到这个任务。', 404); return run; }
  async function ark(path, method = 'GET', payload, timeout = 60000) {
    assert(key(), '请先在设置中填写 ARK API Key。');
    const response = await fetch(`${apiBase}${path}`, {
      method,
      headers: { Authorization: `Bearer ${key()}`, 'Content-Type': 'application/json' },
      body: payload ? JSON.stringify(payload) : undefined,
      signal: AbortSignal.any([abort.signal, AbortSignal.timeout(timeout)]),
    });
    const raw = await response.text();
    let data;
    try { data = JSON.parse(raw); }
    catch { throw new AppError(502, `方舟返回了非 JSON 响应（HTTP ${response.status}）。`, 'InvalidResponse'); }
    if (!response.ok) throw new AppError(response.status, clean(data.error?.message || data.message || `方舟请求失败（HTTP ${response.status}）。`), data.error?.code || `HTTP_${response.status}`);
    return data;
  }
  async function payloadFor(run) {
    const content = run.prompt ? [{ type: 'text', text: run.prompt }] : [];
    for (const [index, asset] of run.assets.entries()) {
      const bytes = await readFile(join(dataDir, 'uploads', asset.filename));
      content.push({ type: 'image_url', image_url: { url: `data:${asset.mime};base64,${bytes.toString('base64')}` }, role: run.parameters.mode === 'frames' ? (index ? 'last_frame' : 'first_frame') : 'reference_image' });
    }
    const { mode, ...parameters } = run.parameters;
    const spec = getModel(run.modelProfile || run.model) || MODELS[0];
    if (!spec.audio) delete parameters.generate_audio;
    return { model: run.model, content, ...parameters, ...(spec.omniType && mode === 'reference' && run.assets.length ? { omni_reference_task_type: 'reference' } : {}) };
  }
  async function submit(run) {
    try {
      const payload = await payloadFor(run);
      const result = await ark('/contents/generations/tasks', 'POST', payload);
      assert(typeof result.id === 'string' && /^[a-zA-Z0-9_-]{1,200}$/.test(result.id), '方舟未返回有效的任务 ID。', 502);
      run.taskId = result.id;
      run.status = 'queued';
      run.updatedAt = new Date().toISOString();
      await changed();
      await poll(run);
    } catch (error) {
      // An ambiguous POST must never be silently retried: it may already be billable.
      run.status = error instanceof AppError && error.status >= 400 && error.status < 500 ? 'failed' : 'unknown';
      run.error = { message: clean(error.message), code: error.code || 'SubmissionUncertain' };
      run.updatedAt = new Date().toISOString();
      await changed();
    }
  }
  async function submitImage(run) {
    let sent = false;
    try {
      const images = [];
      for (const asset of run.assets) {
        const bytes = await readFile(join(dataDir, 'uploads', asset.filename));
        images.push(`data:${asset.mime};base64,${bytes.toString('base64')}`);
      }
      const { resolution, ratio, output_format, background: imageBackground, watermark } = run.parameters;
      const payload = {
        model: run.model, prompt: run.prompt,
        size: ratio === 'auto' ? resolution : IMAGE_SIZES[resolution][ratio],
        output_format, background: imageBackground, watermark, response_format: 'url',
        ...(images.length ? { image: images.length === 1 ? images[0] : images } : {}),
      };
      run.status = 'running';
      run.updatedAt = new Date().toISOString();
      await changed();
      sent = true;
      // Seedream 5.5 returns the finished image in this response. It has no
      // video-style task ID, polling endpoint or stream of partial images.
      const result = await ark('/images/generations', 'POST', payload, imageTimeout);
      if (result.error || result.data?.[0]?.error) {
        const error = result.error || result.data[0].error;
        throw new AppError(422, clean(error.message), error.code || 'ImageGenerationFailed');
      }
      const item = result.data?.[0];
      assert(typeof item?.url === 'string', '方舟未返回有效的图片地址。', 502);
      const remote = new URL(item.url);
      assert(remote.protocol === 'https:' || (apiBase !== API_BASE && remote.protocol === 'http:'), '图片地址协议不受支持。', 502);
      run.result = { remoteUrl: item.url, size: item.size, output_format: item.output_format || output_format, background: item.background || imageBackground, usage: result.usage, cacheStatus: 'pending' };
      run.status = 'succeeded';
      run.updatedAt = new Date().toISOString();
      await changed();
      await cacheImage(run);
    } catch (error) {
      run.status = !sent || (error instanceof AppError && error.status >= 400 && error.status < 500) ? 'failed' : 'unknown';
      run.error = { message: clean(error.message), code: error.code || (sent ? 'ImageResultUncertain' : 'ImagePreparationFailed') };
      run.updatedAt = new Date().toISOString();
      await changed();
    }
  }
  async function cacheImage(run) {
    if (!run.result?.remoteUrl || run.result.localUrl || downloading.has(run.id)) return;
    downloading.add(run.id);
    run.result.cacheStatus = 'saving';
    delete run.result.cacheError;
    await changed();
    let temporary;
    try {
      const remote = new URL(run.result.remoteUrl);
      assert(remote.protocol === 'https:' || (apiBase !== API_BASE && remote.protocol === 'http:'), '图片地址协议不受支持。');
      const response = await fetch(remote, { signal: AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]) });
      assert(response.ok && response.body, `图片保存失败（HTTP ${response.status}）。`, 502);
      assert(!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= 50 * MB, '图片超过本地 50MB 保存上限。');
      const chunks = []; let length = 0;
      for await (const chunk of response.body) {
        length += chunk.length;
        assert(length <= 50 * MB, '图片超过本地 50MB 保存上限。');
        chunks.push(chunk);
      }
      const bytes = Buffer.concat(chunks), mime = detectedImage(bytes);
      assert(['image/png', 'image/jpeg'].includes(mime), '方舟图片不是有效的 PNG / JPEG 文件。', 502);
      const { width, height } = dimensions(bytes);
      const filename = `${run.id}.${IMAGE_TYPES[mime]}`;
      const target = join(dataDir, 'images', filename);
      temporary = `${target}.part`;
      await writeFile(temporary, bytes, { mode: 0o600 });
      await rename(temporary, target);
      Object.assign(run.result, { localUrl: `/media/images/${filename}`, filename, output_format: mime === 'image/png' ? 'png' : 'jpeg', width, height, size: `${width}x${height}`, cacheStatus: 'saved' });
    } catch (error) {
      if (temporary) await unlink(temporary).catch(() => {});
      run.result.cacheStatus = 'failed';
      run.result.cacheError = clean(error.message);
    } finally { downloading.delete(run.id); await changed(); }
  }
  async function referenceFromImage(run) {
    assert(run.kind === 'image' && run.status === 'succeeded' && run.result?.localUrl, '图片保存到本机后才能继续编辑，请稍候或重新保存。', 409);
    const id = `generated-${run.id}`;
    const existing = db.uploads.find(a => a.id === id);
    if (existing) return existing;
    const bytes = await readFile(join(dataDir, 'images', run.result.filename));
    assert(bytes.length < 30 * MB, '该图片超过参考图的 30MB 限制，请压缩后上传。');
    const mime = detectedImage(bytes), filename = `${id}.${IMAGE_TYPES[mime]}`;
    const asset = { id, filename, mime, size: bytes.length, ...dimensions(bytes), name: `生成图片-${run.id.slice(0, 8)}.${IMAGE_TYPES[mime]}`, url: `/media/uploads/${filename}` };
    await writeFile(join(dataDir, 'uploads', filename), bytes, { mode: 0o600 });
    if (!db.uploads.some(a => a.id === id)) db.uploads.push(asset);
    await save();
    return asset;
  }
  async function cacheVideo(run) {
    if (!run.result?.remoteUrl || run.result.localUrl || downloading.has(run.id)) return;
    downloading.add(run.id);
    run.result.cacheStatus = 'saving';
    delete run.result.cacheError;
    await changed();
    const target = join(dataDir, 'videos', `${run.id}.mp4`);
    try {
      const remote = new URL(run.result.remoteUrl);
      // The only source is the trusted Ark task response, never a client-supplied URL.
      assert(remote.protocol === 'https:' || (apiBase !== API_BASE && remote.protocol === 'http:'), '视频地址协议不受支持。');
      const signal = AbortSignal.any([abort.signal, AbortSignal.timeout(180000)]);
      const response = await fetch(remote, { signal });
      assert(response.ok && response.body, `视频保存失败（HTTP ${response.status}）。`, 502);
      assert(!response.headers.get('content-length') || Number(response.headers.get('content-length')) <= 500 * MB, '视频超过本地 500MB 保存上限。');
      let length = 0;
      const limiter = new Transform({ transform(chunk, _encoding, callback) {
        length += chunk.length;
        callback(length > 500 * MB ? new Error('视频超过本地 500MB 保存上限。') : null, chunk);
      } });
      await pipeline(Readable.fromWeb(response.body), limiter, createWriteStream(`${target}.part`, { mode: 0o600 }), { signal });
      assert(length > 0, '视频文件为空。', 502);
      await rename(`${target}.part`, target);
      run.result.localUrl = `/media/videos/${run.id}.mp4`;
      run.result.cacheStatus = 'saved';
    } catch (error) {
      await unlink(`${target}.part`).catch(() => {});
      run.result.cacheStatus = 'failed';
      run.result.cacheError = clean(error.message);
    } finally {
      downloading.delete(run.id);
      await changed();
    }
  }
  async function poll(run) {
    if (run.kind === 'image' || !run.taskId || !['queued', 'running'].includes(run.status) || polling.has(run.id)) return;
    polling.add(run.id);
    try {
      const result = await ark(`/contents/generations/tasks/${encodeURIComponent(run.taskId)}`);
      assert(REMOTE_STATES.has(result.status), '方舟返回了未知任务状态。', 502);
      run.status = result.status;
      run.updatedAt = new Date().toISOString();
      delete run.pollError;
      pollFailures.delete(run.id);
      if (result.error) run.error = { code: clean(result.error.code), message: clean(result.error.message) };
      if (result.status === 'succeeded') {
        assert(typeof result.content?.video_url === 'string', '任务已完成，但尚未返回视频地址。', 502);
        run.result = { remoteUrl: result.content.video_url, resolution: result.resolution, ratio: result.ratio, duration: result.duration, seed: result.seed, usage: result.usage, cacheStatus: 'pending' };
      }
      await changed();
      if (run.result) background(() => cacheVideo(run));
      nextPoll.set(run.id, Date.now() + pollInterval);
    } catch (error) {
      // A failed status query says nothing about the outcome of the generation.
      if (run.status === 'succeeded' && !run.result) run.status = 'running';
      const failures = (pollFailures.get(run.id) || 0) + 1;
      pollFailures.set(run.id, failures);
      run.pollError = clean(error.message);
      nextPoll.set(run.id, Date.now() + Math.min(pollInterval * 2 ** Math.min(failures, 4), 60000));
      await changed();
    } finally { polling.delete(run.id); }
  }

  for (const run of allRuns()) {
    if (run.status === 'submitting' || (run.kind === 'image' && ACTIVE.has(run.status))) {
      run.status = 'unknown';
      run.error = { code: 'InterruptedSubmission', message: run.kind === 'image' ? '上次生成图片时本地服务中断，无法确认生成结果。请在方舟控制台核对请求记录；本地不会自动重复生成。' : '上次提交时本地服务中断。请先在方舟控制台确认任务是否已创建，再决定是否重新生成。' };
    }
    if (run.result?.cacheStatus === 'saving') run.result.cacheStatus = 'pending';
    if (run.status === 'succeeded' && !run.result?.localUrl && ['pending', undefined].includes(run.result?.cacheStatus)) background(() => run.kind === 'image' ? cacheImage(run) : cacheVideo(run));
  }
  await save();
  const timer = setInterval(() => {
    if (closing) return;
    let available = 4 - polling.size;
    for (const run of allRuns()) {
      if (available <= 0) break;
      if (run.kind !== 'image' && ['queued', 'running'].includes(run.status) && Date.now() >= (nextPoll.get(run.id) || 0) && !polling.has(run.id)) {
        available--;
        nextPoll.set(run.id, Date.now() + pollInterval);
        background(() => poll(run));
      }
    }
  }, Math.min(1000, pollInterval));
  timer.unref();
  const heartbeat = setInterval(() => { for (const res of listeners) res.write(': heartbeat\n\n'); }, 15000);
  heartbeat.unref();

  async function serveFile(req, res, file, download = false) {
    let metadata;
    try { metadata = await stat(file); }
    catch { throw new AppError(404, '文件不存在。'); }
    const headers = { 'Content-Type': MIME[extname(file)] || 'application/octet-stream', 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-cache' };
    if (download) headers['Content-Disposition'] = `attachment; filename="${file.includes('/images/') ? 'seedream' : 'seedance'}-${file.split('/').pop()}"`;
    const range = req.headers.range;
    let start = 0;
    let end = metadata.size - 1;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) { res.writeHead(416, { 'Content-Range': `bytes */${metadata.size}` }); res.end(); return; }
      if (!match[1]) start = Math.max(0, metadata.size - Number(match[2]));
      else { start = Number(match[1]); end = match[2] ? Math.min(Number(match[2]), end) : end; }
      if (start > end || start >= metadata.size) { res.writeHead(416, { 'Content-Range': `bytes */${metadata.size}` }); res.end(); return; }
      headers['Content-Range'] = `bytes ${start}-${end}/${metadata.size}`;
    }
    headers['Content-Length'] = end - start + 1;
    res.writeHead(range ? 206 : 200, headers);
    if (req.method === 'HEAD') { res.end(); return; }
    const stream = createReadStream(file, { start, end });
    res.on('close', () => stream.destroy());
    stream.on('error', () => res.destroy());
    stream.pipe(res);
  }

  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' https: data: blob:; media-src 'self' https: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
    try {
      const host = req.headers.host || '';
      const hostname = new URL(`http://${host}`).hostname;
      assert(['localhost', '127.0.0.1', '[::1]'].includes(hostname), '仅允许从本机访问。', 403);
      assert(!req.headers.origin || req.headers.origin === `http://${host}`, '不允许跨站访问本地服务。', 403);
      assert(req.headers['sec-fetch-site'] !== 'cross-site', '不允许跨站访问本地服务。', 403);
      const url = new URL(req.url, `http://${host}`);
      const path = url.pathname;
      if (path === '/api/state' && req.method === 'GET') return json(res, 200, snapshot());
      if (path === '/api/events' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
        res.write(`event: state\ndata: ${JSON.stringify(snapshot())}\n\n`);
        listeners.add(res);
        res.on('close', () => listeners.delete(res));
        return;
      }
      if (path === '/api/settings' && req.method === 'PUT') {
        const input = await jsonBody(req);
        const updated = { ...settings };
        if (input.apiKey !== undefined) {
          assert(typeof input.apiKey === 'string' && input.apiKey.trim().length >= 8 && input.apiKey.length <= 4096 && !/\s/.test(input.apiKey.trim()), '请填写有效的 API Key。');
          updated.apiKey = input.apiKey.trim();
        }
        if (input.clearKey === true) delete updated.apiKey;
        if (input.model !== undefined) {
          assert(typeof input.model === 'string' && (getModel(input.model.trim()) || /^ep-[\w-]{1,140}$/.test(input.model.trim())), '请选择受支持的 Seedance / Seedream 模型，或填写 ep- 接入点 ID。');
          updated.model = input.model.trim();
        }
        if (input.modelProfile !== undefined) {
          assert(Boolean(getModel(input.modelProfile)), '请选择接入点实际使用的模型。');
          updated.modelProfile = input.modelProfile;
        }
        const operation = settingsQueue.catch(() => {}).then(() => atomicJSON(settingsPath, updated));
        settingsQueue = operation;
        await operation;
        settings = updated;
        nextPoll.clear();
        emit();
        return json(res, 200, config());
      }
      if (path === '/api/uploads' && req.method === 'POST') {
        const mime = req.headers['content-type']?.split(';')[0];
        assert(IMAGE_TYPES[mime], '仅支持 JPG、PNG、WEBP、GIF 图片。', 415);
        const bytes = await body(req, 30 * MB - 1);
        assert(detectedImage(bytes) === mime, '文件内容与图片格式不匹配，请选择有效图片。');
        const id = randomUUID();
        const filename = `${id}.${IMAGE_TYPES[mime]}`;
        let name = '参考图片';
        try { name = decodeURIComponent(req.headers['x-file-name'] || name).slice(0, 200); } catch { /* use default name */ }
        const asset = { id, filename, name, mime, size: bytes.length, ...dimensions(bytes), url: `/media/uploads/${filename}` };
        await writeFile(join(dataDir, 'uploads', filename), bytes, { mode: 0o600 });
        db.uploads.push(asset);
        await save();
        return json(res, 201, asset);
      }
      if (path === '/api/generations' && req.method === 'POST') {
        const input = await jsonBody(req);
        assert(typeof input.requestId === 'string' && /^[a-zA-Z0-9-]{16,100}$/.test(input.requestId), '提交标识无效，请刷新页面重试。');
        const duplicateConversation = db.conversations.find(c => c.runs.some(r => r.requestId === input.requestId));
        if (duplicateConversation) return json(res, 200, { conversationId: duplicateConversation.id, run: duplicateConversation.runs.find(r => r.requestId === input.requestId) });
        assert(key(), '请先在设置中填写 ARK API Key。', 401);
        const selectedModel = input.model || modelId();
        const spec = modelOptions().find(m => m.id === selectedModel);
        assert(spec, '请选择受支持的模型，或先在设置中配置接入点。');
        const validated = spec.kind === 'image' ? validateImageGeneration(input, db.uploads, spec) : validateGeneration(input, db.uploads, spec);
        let conversation = input.conversationId ? db.conversations.find(c => c.id === input.conversationId) : null;
        if (input.conversationId) assert(conversation, '会话不存在，请新建会话。', 404);
        const now = new Date().toISOString();
        const run = { id: randomUUID(), requestId: input.requestId, kind: spec.kind, ...validated, model: selectedModel, modelProfile: spec.profileId || spec.id, modelName: spec.name, status: 'submitting', createdAt: now, updatedAt: now };
        if (!conversation) {
          conversation = { id: randomUUID(), title: validated.prompt.slice(0, 24) || '参考图片创作', createdAt: now, updatedAt: now, runs: [] };
          db.conversations.unshift(conversation);
        }
        conversation.runs.push(run);
        conversation.updatedAt = now;
        await changed();
        background(() => run.kind === 'image' ? submitImage(run) : submit(run));
        return json(res, 202, { conversationId: conversation.id, run });
      }
      const conversationRoute = path.match(/^\/api\/conversations\/([\w-]+)$/);
      if (conversationRoute) {
        const conversation = db.conversations.find(c => c.id === conversationRoute[1]);
        assert(conversation, '会话不存在。', 404);
        if (req.method === 'PATCH') {
          const input = await jsonBody(req);
          assert(typeof input.title === 'string' && input.title.trim().length > 0 && input.title.trim().length <= 80, '会话名称需为 1–80 个字符。');
          conversation.title = input.title.trim();
          await changed();
          return json(res, 200, conversation);
        }
        if (req.method === 'DELETE') {
          assert(!conversation.runs.some(r => ACTIVE.has(r.status) || downloading.has(r.id)), '该会话仍有任务在生成或保存，请完成后再删除。', 409);
          db.conversations.splice(db.conversations.indexOf(conversation), 1);
          await changed();
          return json(res, 200, { ok: true });
        }
      }
      const taskRoute = path.match(/^\/api\/tasks\/([\w-]+)\/(refresh|cache|recover|reference)$/);
      if (taskRoute && req.method === 'POST') {
        const run = runById(taskRoute[1]);
        if (taskRoute[2] === 'reference') return json(res, 200, await referenceFromImage(run));
        if (taskRoute[2] === 'refresh') { assert(run.kind !== 'image', '图片生成没有独立的状态查询接口。'); await poll(run); }
        if (taskRoute[2] === 'cache') {
          assert(run.result?.remoteUrl, '尚未生成可保存的结果。');
          background(() => run.kind === 'image' ? cacheImage(run) : cacheVideo(run));
        }
        if (taskRoute[2] === 'recover') {
          assert(run.kind !== 'image' && run.status === 'unknown', '此任务不支持通过视频任务 ID 恢复。');
          const input = await jsonBody(req);
          assert(typeof input.taskId === 'string' && /^cgt-[a-zA-Z0-9_-]{4,180}$/.test(input.taskId), '请填写方舟控制台中的 cgt- 视频任务 ID。');
          run.taskId = input.taskId;
          run.status = 'queued';
          delete run.error;
          await changed();
          background(() => poll(run));
        }
        return json(res, 200, run);
      }
      if (req.method === 'GET' || req.method === 'HEAD') {
        const upload = db.uploads.find(a => a.url === path);
        if (upload) return await serveFile(req, res, join(dataDir, 'uploads', upload.filename));
        const image = allRuns().find(r => r.kind === 'image' && r.result?.localUrl === path);
        if (image) return await serveFile(req, res, join(dataDir, 'images', image.result.filename), url.searchParams.has('download'));
        const video = allRuns().find(r => r.kind !== 'image' && r.result?.localUrl === path);
        if (video) return await serveFile(req, res, join(dataDir, 'videos', `${video.id}.mp4`), url.searchParams.has('download'));
        // Static files are explicitly allowlisted; settings and history are never exposed.
        const staticFiles = new Set(['/index.html', '/build/app.js', '/build/app.css', '/assets/mountains.svg', '/assets/bottle.svg', '/assets/moon.svg', '/assets/mark.svg']);
        const resource = path === '/' ? '/index.html' : path;
        if (staticFiles.has(resource)) return await serveFile(req, res, join(PUBLIC, resource));
      }
      throw new AppError(404, '页面或接口不存在。');
    } catch (error) {
      if (res.headersSent) return res.end();
      const status = error instanceof AppError ? error.status : 500;
      json(res, status, { error: { message: error instanceof AppError ? clean(error.message) : '本地服务发生错误，请查看终端。', code: error instanceof AppError ? error.code : 'LocalError' } });
      if (!(error instanceof AppError)) console.error(clean(error.message));
    }
  });
  server.requestTimeout = 120000;
  return {
    server,
    async close() {
      closing = true;
      clearInterval(timer);
      clearInterval(heartbeat);
      abort.abort();
      for (const listener of listeners) listener.end();
      await new Promise(resolve => { server.close(resolve); server.closeIdleConnections(); });
      while (operations.size) await Promise.allSettled([...operations]);
      await saveQueue;
      await settingsQueue;
    },
  };
}
