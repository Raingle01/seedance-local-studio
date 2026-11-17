import { DEFAULT_MODEL, ALL_MODELS, IMAGE_SIZES } from '../../public/models.js';
import type { Asset, Draft, ImageParameters, Model, Parameters } from '@/types';

export const defaults: Parameters = { mode: 'reference', ratio: '16:9', resolution: '720p', duration: 5, generate_audio: true, watermark: false };
export const imageDefaults: ImageParameters = { ratio: 'auto', resolution: '2K', output_format: 'png', background: 'auto', watermark: false };
export const assetLimit = (model: Model, mode: Parameters['mode']) => model.kind === 'image' ? model.maxReferences : mode === 'frames' || !model.maxReferences ? model.frameImages : model.maxReferences;
export function assetFitsModel(asset: Pick<Asset, 'width' | 'height'>, model: Model) {
  const w = asset.width, h = asset.height;
  if (!w || !h) return true;
  return model.kind === 'image' ? Math.min(w, h) > 14 && w * h <= 36000000 && w / h >= 1 / 16 && w / h <= 16 : Math.min(w, h) >= 300 && Math.max(w, h) <= 6000 && w / h >= .4 && w / h <= 2.5;
}
export const activeStatuses = new Set(['submitting', 'queued', 'running']);
export const storage = {
  get<T>(key: string, fallback: T): T { try { return JSON.parse(localStorage.getItem(`seedance:${key}`) || 'null') ?? fallback; } catch { return fallback; } },
  set(key: string, value: unknown) { try { localStorage.setItem(`seedance:${key}`, JSON.stringify(value)); } catch { /* History remains on the server when browser storage is unavailable. */ } },
};
export const draftKey = (id: string | null) => `draft:${id || 'new'}`;
export function readDraft(id: string | null, model = storage.get('selected-model', DEFAULT_MODEL)): Draft {
  const saved = storage.get<Partial<Draft>>(draftKey(id), {});
  return { prompt: saved.prompt || '', assets: saved.assets || [], model: saved.model || model, parameters: { ...defaults, ...saved.parameters }, imageParameters: { ...imageDefaults, ...saved.imageParameters } };
}
export function normalizeDraft(draft: Draft, models: Model[] = ALL_MODELS): Draft {
  const spec = models.find(m => m.id === draft.model) || models[0];
  const p = { ...defaults, ...draft.parameters };
  const imageParameters = { ...imageDefaults, ...draft.imageParameters };
  if (!Object.hasOwn(IMAGE_SIZES, imageParameters.resolution)) imageParameters.resolution = '2K';
  if (imageParameters.ratio !== 'auto' && !Object.hasOwn(IMAGE_SIZES['2K'], imageParameters.ratio)) imageParameters.ratio = 'auto';
  if (imageParameters.background === 'transparent') imageParameters.output_format = 'png';
  if (spec.kind === 'image') return { ...draft, model: spec.id, parameters: p, imageParameters };
  if (!spec.maxReferences && draft.assets.length) p.mode = 'frames';
  if (!spec.resolutions.includes(p.resolution)) p.resolution = '720p';
  if (!((p.duration === -1 && spec.autoDuration) || (p.duration >= spec.minDuration && p.duration <= spec.maxDuration))) p.duration = 5;
  if (p.mode === 'frames' && spec.forceAdaptiveFrames) p.ratio = 'adaptive';
  if (!spec.autoDuration && p.mode !== 'frames' && p.ratio === 'adaptive') p.ratio = '16:9';
  if (!spec.audio) p.generate_audio = false;
  return { ...draft, model: spec.id, parameters: p, imageParameters };
}
export async function api<T>(path: string, options: { method?: string; body?: unknown; headers?: Record<string, string>; signal?: AbortSignal } = {}): Promise<T> {
  const isFile = options.body instanceof Blob;
  const response = await fetch(path, {
    method: options.method,
    signal: options.signal,
    headers: { ...(options.body && !isFile ? { 'Content-Type': 'application/json' } : {}), ...options.headers },
    body: options.body === undefined ? undefined : isFile ? options.body as Blob : JSON.stringify(options.body),
  });
  let result;
  try { result = await response.json(); } catch { throw new Error('本地服务未返回有效响应，请确认服务正在运行。'); }
  if (!response.ok) throw new Error(result.error?.message || `请求失败（${response.status}）`);
  return result as T;
}
export async function validateImage(file: File, model: Model) {
  if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type)) throw new Error('请选择 JPG、PNG、WEBP 或 GIF 图片。');
  if (file.size >= 30 * 1024 * 1024) throw new Error(`${file.name} 超过单张 30MB 的限制。`);
  const url = URL.createObjectURL(file);
  try {
    const image = new Image(); image.src = url; await image.decode();
    const w = image.naturalWidth, h = image.naturalHeight;
    if (!assetFitsModel({ width: w, height: h }, model)) throw new Error(model.kind === 'image' ? `${file.name} 的宽高需大于 14px、总像素不超过 3600 万、宽高比 1:16–16:1。` : `${file.name} 的尺寸需为 300–6000px，宽高比 0.4–2.5。`);
  } finally { URL.revokeObjectURL(url); }
}
export const durationLabel = (value: number) => value === -1 ? '自动时长' : `${value} 秒`;
export const ratioLabel = (value: string) => value === 'adaptive' ? '自动比例' : value;
export const errorMessage = (error: unknown) => error instanceof Error ? error.message : '操作未完成，请重试。';
export const presets = [
  { id: 'landscape', title: '去有风的旷野', category: '自然 · 风光', description: '把山野的呼吸，装进镜头里', image: '/assets/mountains.svg', duration: 8, prompt: '清晨的山间旷野，薄雾缓缓流过层叠的绿色山谷。镜头贴着草尖向前滑行，露珠折射第一缕金色晨光，随后缓慢抬升，展现开阔群山。微风吹动草叶，远处传来鸟鸣。自然电影质感，柔和光线，一镜到底。' },
  { id: 'product', title: '让好物自己说话', category: '产品 · 广告', description: '一束光，一个令人心动的细节', image: '/assets/bottle.svg', duration: 5, prompt: '一支琥珀色玻璃香水瓶置于暖灰色石台上。镜头从瓶身的玻璃纹理微距开始，缓慢环绕拉远，一束午后阳光穿过瓶身，在台面投下金色折射。背景的植物影子轻轻摇曳。高级香水广告，真实材质，极简构图，舒缓的钢琴背景音乐。' },
  { id: 'fantasy', title: '做一场清醒的梦', category: '幻想 · 叙事', description: '让现实之外的世界，拥有形状', image: '/assets/moon.svg', duration: 10, prompt: '一个不属于现实的梦境：巨大的月亮悬在青蓝色的云海上，一艘小小的白色帆船缓缓穿行。镜头从云层中向前推进，云雾在船边轻轻散开，月光照亮船帆。宁静而宏大的超现实画面，细腻的电影质感，空灵的环境音乐。' },
];

export const imagePresets = [
  { ...presets[0], title: '把山野装进画面', description: '一张有呼吸感的自然风光', prompt: '清晨薄雾笼罩的绿色山谷，蜿蜒的小径延伸到远方。柔和晨光穿过山脊，画面通透，层次丰富，宁静的自然风光摄影，横向构图。' },
  { ...presets[1], title: '让产品成为主角', description: '从质感到光线，都恰到好处', prompt: '一支琥珀色玻璃香水瓶，置于暖灰色石台上，背景是柔和的植物投影。阳光穿过瓶身形成金色折射，真实玻璃材质，精致高级的产品广告摄影，极简构图。' },
  { ...presets[2], title: '画出你的梦境', description: '现实之外，还有另一种可能', prompt: '巨大的月亮悬在青蓝色云海之上，一艘白色帆船轻轻漂浮在云端。月光照亮船帆，空气中有细微星尘，宁静而宏大的超现实数字艺术，精细质感。' },
];
