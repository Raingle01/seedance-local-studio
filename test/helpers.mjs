import http from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createApp } from '../server/app.mjs';

export async function listen(server, port = 0) {
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
  return `http://127.0.0.1:${server.address().port}`;
}
export function png(width = 400, height = 400, alpha = false) {
  const crc32 = bytes => {
    let crc = -1;
    for (const byte of bytes) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
    }
    return (crc ^ -1) >>> 0;
  };
  const chunk = (type, data) => {
    const content = Buffer.concat([Buffer.from(type), data]);
    const result = Buffer.alloc(data.length + 12);
    result.writeUInt32BE(data.length, 0); content.copy(result, 4); result.writeUInt32BE(crc32(content), result.length - 4);
    return result;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = alpha ? 6 : 2;
  const channels = alpha ? 4 : 3;
  const pixels = Buffer.alloc((width * channels + 1) * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const i = y * (width * channels + 1) + 1 + x * channels;
    pixels[i] = 60 + Math.round(80 * x / width); pixels[i + 1] = 100 + Math.round(75 * y / height); pixels[i + 2] = 75;
    if (alpha) pixels[i + 3] = (x - width / 2) ** 2 + (y - height / 2) ** 2 < (Math.min(width, height) * .36) ** 2 ? 220 : 0;
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}
export async function fixture({ pollInterval = 30, port = 0, video = Buffer.from('test-video-bytes-for-range-requests'), keepData = false, image = png(1024, 1024, true), imageDelay = 40, imageTimeout = 300000 } = {}) {
  const dataDir = await mkdtemp(join(tmpdir(), 'seedance-test-'));
  const calls = [];
  const tasks = new Map();
  let mediaDownloads = 0;
  let imageDownloads = 0;
  let brokenImageDownload = false;
  let imagePolls = 0;
  let hold = false;
  let url;
  const upstream = http.createServer(async (req, res) => {
    if (req.url === '/fixture.mp4') { mediaDownloads++; res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': video.length }); res.end(video); return; }
    if (req.url === '/fixture.png') { imageDownloads++; res.writeHead(brokenImageDownload ? 503 : 200, { 'Content-Type': 'image/png' }); res.end(brokenImageDownload ? 'temporarily unavailable' : image); return; }
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk);
      const body = JSON.parse(Buffer.concat(chunks).toString());
      const prompt = body.prompt || body.content?.find(c => c.type === 'text')?.text || '';
      calls.push({ body, path: req.url, authorization: req.headers.authorization });
      if (prompt.includes('[reject]')) { res.writeHead(400); res.end(JSON.stringify({ error: { code: 'InvalidParameter', message: '参考参数不合法' } })); return; }
      if (prompt.includes('[uncertain]')) { req.socket.destroy(); return; }
      if (req.url === '/api/v3/images/generations') {
        await new Promise(resolve => { const timer = setTimeout(resolve, imageDelay); res.once('close', () => { clearTimeout(timer); resolve(); }); });
        if (res.destroyed) return;
        if (prompt.includes('[fail]')) { res.end(JSON.stringify({ data: [{ error: { code: 'ImageGenerationFailed', message: '测试：图片生成失败' } }] })); return; }
        res.end(JSON.stringify({ model: body.model, created: Math.floor(Date.now() / 1000), data: [{ url: `${url}/fixture.png`, size: '1024x1024', output_format: 'png', background: body.background === 'auto' ? 'opaque' : body.background }], usage: { generated_images: 1, input_images: body.image ? [].concat(body.image).length : 0, total_tokens: 4096 } })); return;
      }
      const id = `cgt-test-${calls.length}`;
      tasks.set(id, { count: 0, prompt, body });
      res.end(JSON.stringify({ id })); return;
    }
    const id = req.url.split('/').pop();
    if (req.url.startsWith('/api/v3/images/')) imagePolls++;
    const task = tasks.get(id);
    if (!task) { res.writeHead(404); res.end(JSON.stringify({ error: { code: 'NotFound', message: '任务不存在' } })); return; }
    task.count++;
    if (task.prompt.includes('[transient]') && task.count === 2) { res.writeHead(429); res.end(JSON.stringify({ error: { code: 'RateLimit', message: '查询限流，请重试' } })); return; }
    const status = hold ? 'running' : task.count < 2 ? 'queued' : task.count < 4 ? 'running' : task.prompt.includes('[fail]') ? 'failed' : 'succeeded';
    res.end(JSON.stringify({ id, status, ...(status === 'failed' ? { error: { code: 'GenerationFailed', message: '测试：内容生成失败' } } : {}), ...(status === 'succeeded' ? { content: { video_url: `${url}/fixture.mp4` }, duration: task.body.duration === -1 ? 7 : task.body.duration, ratio: task.body.ratio === 'adaptive' ? '1:1' : task.body.ratio, resolution: task.body.resolution, usage: { total_tokens: 12345 } } : {}) }));
  });
  url = await listen(upstream);
  let app = await createApp({ dataDir, apiBase: `${url}/api/v3`, apiKey: 'test-key-not-real', pollInterval, imageTimeout });
  let base = await listen(app.server, port);
  return {
    dataDir, calls, tasks,
    get base() { return base; },
    get mediaDownloads() { return mediaDownloads; },
    get imageDownloads() { return imageDownloads; },
    get imagePolls() { return imagePolls; },
    failImageDownload(value) { brokenImageDownload = value; },
    hold(value) { hold = value; },
    async restart() { await app.close(); app = await createApp({ dataDir, apiBase: `${url}/api/v3`, apiKey: 'test-key-not-real', pollInterval, imageTimeout }); base = await listen(app.server, port); },
    async close() { await app.close(); await new Promise(resolve => { upstream.close(resolve); upstream.closeIdleConnections(); }); if (!keepData) await rm(dataDir, { recursive: true, force: true }); },
  };
}
export async function request(base, path, body, method = 'POST') {
  const response = await fetch(`${base}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: response.status, data: await response.json() };
}
export async function waitForState(f, predicate, timeout = 6000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    const response = await fetch(`${f.base}/api/state`);
    const state = await response.json();
    if (predicate(state)) return state;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Timed out waiting for test state');
}
