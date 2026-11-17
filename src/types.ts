import { MODELS, IMAGE_MODELS } from '../public/models.js';

export type VideoModel = (typeof MODELS)[number] & { profileId?: string };
export type ImageModel = (typeof IMAGE_MODELS)[number] & { profileId?: string };
export type Model = VideoModel | ImageModel;
export type Asset = { id: string; filename: string; name: string; mime: string; size: number; url: string; width?: number; height?: number };
export type Parameters = { mode: 'reference' | 'frames'; ratio: string; resolution: string; duration: number; generate_audio: boolean; watermark: boolean };
export type ImageParameters = { ratio: string; resolution: string; output_format: 'png' | 'jpeg'; background: 'auto' | 'transparent' | 'opaque'; watermark: boolean };
export type Draft = { prompt: string; assets: Asset[]; parameters: Parameters; imageParameters: ImageParameters; model: string };
type RunBase<P> = {
  id: string; requestId: string; taskId?: string; prompt: string; assets: Asset[]; parameters: P;
  model: string; modelName?: string; modelProfile?: string; status: string; createdAt: string; updatedAt: string;
  error?: { code: string; message: string }; pollError?: string;
};
type ResultBase = { remoteUrl: string; localUrl?: string; cacheStatus: string; cacheError?: string; usage?: { total_tokens: number; generated_images?: number } };
export type VideoRun = RunBase<Parameters> & { kind?: 'video'; result?: ResultBase & { resolution?: string; ratio?: string; duration?: number } };
export type ImageRun = RunBase<ImageParameters> & { kind: 'image'; result?: ResultBase & { size?: string; output_format: 'png' | 'jpeg'; background?: string; width?: number; height?: number; filename?: string } };
export type Run = VideoRun | ImageRun;
export type Conversation = { id: string; title: string; createdAt: string; updatedAt: string; runs: Run[] };
export type Config = { hasApiKey: boolean; keySource: string | null; model: string; modelProfile: string; models: Model[]; apiBase?: string };
export type Snapshot = { conversations: Conversation[]; config: Config };
