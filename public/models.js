// Source: Ark's model list, Create Video Generation Task API and Image Generation API.
// Last checked: 2026-11-17. The server and browser share the same capability table.
export const MODELS = [
  { id: 'doubao-seedance-2-5-flash-261115', name: 'Seedance 2.5 Flash', tag: 'FAST', description: '快速生成，让灵感即刻成片', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 30, autoDuration: true, maxReferences: 10, frameImages: 2, audio: true, forceAdaptiveFrames: true, omniType: true },
  { id: 'doubao-seedance-2-5-260628', name: 'Seedance 2.5', tag: '4K', description: '精细画质，长镜头与丰富细节', resolutions: ['480p', '720p', '1080p', '4k'], minDuration: 4, maxDuration: 30, autoDuration: true, maxReferences: 30, frameImages: 2, audio: true, forceAdaptiveFrames: true, omniType: true },
  { id: 'doubao-seedance-2-0-260128', name: 'Seedance 2.0', tag: '4K', description: '多图参考，原生音画同步', resolutions: ['480p', '720p', '1080p', '4k'], minDuration: 4, maxDuration: 15, autoDuration: true, maxReferences: 9, frameImages: 2, audio: true, forceAdaptiveFrames: false, omniType: false },
  { id: 'doubao-seedance-2-0-fast-260128', name: 'Seedance 2.0 Fast', tag: 'FAST', description: '轻快的多模态视频创作', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 15, autoDuration: true, maxReferences: 9, frameImages: 2, audio: true, forceAdaptiveFrames: false, omniType: false },
  { id: 'doubao-seedance-2-0-mini-260615', name: 'Seedance 2.0 Mini', tag: 'MINI', description: '轻量模型，适合日常灵感尝试', resolutions: ['480p', '720p'], minDuration: 4, maxDuration: 15, autoDuration: true, maxReferences: 9, frameImages: 2, audio: true, forceAdaptiveFrames: false, omniType: false },
  { id: 'doubao-seedance-1-0-pro-250528', name: 'Seedance 1.0 Pro', tag: 'LEGACY', description: '文生视频与首尾帧 · 官方标记即将下线', resolutions: ['480p', '720p', '1080p'], minDuration: 2, maxDuration: 12, autoDuration: false, maxReferences: 0, frameImages: 2, audio: false, forceAdaptiveFrames: false, omniType: false },
  { id: 'doubao-seedance-1-0-pro-fast-251015', name: 'Seedance 1.0 Pro Fast', tag: 'LEGACY', description: '文生视频与单首帧 · 官方标记即将下线', resolutions: ['480p', '720p', '1080p'], minDuration: 2, maxDuration: 12, autoDuration: false, maxReferences: 0, frameImages: 1, audio: false, forceAdaptiveFrames: false, omniType: false },
].map(model => ({ ...model, kind: /** @type {'video'} */ ('video') }));
export const IMAGE_MODELS = [
  { id: 'doubao-seedream-5-5-261028', name: 'Seedream 5.5', kind: /** @type {'image'} */ ('image'), tag: 'IMAGE', description: '细腻画面、多图融合与连续编辑，支持原生透明 PNG', resolutions: ['1K', '1.5K', '2K'], maxReferences: 10 },
];
export const ALL_MODELS = [...MODELS, ...IMAGE_MODELS];
export const DEFAULT_MODEL = MODELS[0].id;
export const DEFAULT_IMAGE_MODEL = IMAGE_MODELS[0].id;
export function getModel(id) { return ALL_MODELS.find(model => model.id === id); }

// Seedream 5.5's documented pixel presets. Explicit ratios use size=WxH;
// automatic composition sends only the resolution tier (e.g. size=2K).
export const IMAGE_SIZES = {
  '1K': { '1:1': '1024x1024', '4:3': '1152x864', '3:4': '864x1152', '16:9': '1424x800', '9:16': '800x1424', '3:2': '1248x832', '2:3': '832x1248', '21:9': '1568x672' },
  '1.5K': { '1:1': '1536x1536', '4:3': '1792x1344', '3:4': '1344x1792', '16:9': '2048x1152', '9:16': '1152x2048', '3:2': '1872x1248', '2:3': '1248x1872', '21:9': '2352x1008' },
  '2K': { '1:1': '2048x2048', '4:3': '2368x1776', '3:4': '1776x2368', '16:9': '2816x1584', '9:16': '1584x2816', '3:2': '2496x1664', '2:3': '1664x2496', '21:9': '3136x1344' },
};
