import { useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { DEFAULT_MODEL, DEFAULT_IMAGE_MODEL, ALL_MODELS, MODELS } from '../../public/models.js';
import { api, assetFitsModel, assetLimit, draftKey, errorMessage, imageDefaults, normalizeDraft, readDraft, storage, validateImage } from '@/lib/studio';
import type { Asset, Config, Draft, ImageRun, Model, Run, Snapshot } from '@/types';

const initialSnapshot: Snapshot = { conversations: [], config: { hasApiKey: false, keySource: null, model: DEFAULT_MODEL, modelProfile: DEFAULT_MODEL, models: ALL_MODELS } };

export function useStudio() {
  const [snapshot, setSnapshot] = useState<Snapshot>(initialSnapshot);
  const [activeId, setActiveId] = useState<string | null>(() => storage.get('active', null));
  const [draft, setDraft] = useState<Draft>(() => readDraft(storage.get('active', null)));
  const [online, setOnline] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [uploading, setUploading] = useState(0);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const snapshotRef = useRef(snapshot);
  const activeRef = useRef(activeId);
  const draftRef = useRef(draft);
  const submittingRef = useRef(false);
  const hydratedRef = useRef(false);
  const uploadQueue = useRef(Promise.resolve());
  const requestIdentity = useRef<{ signature: string; id: string } | null>(null);

  function updateDraft(next: Draft | ((previous: Draft) => Draft)) {
    const value = typeof next === 'function' ? next(draftRef.current) : next;
    draftRef.current = value;
    setDraft(value);
    storage.set(draftKey(activeRef.current), value);
  }
  function selectConversation(id: string | null) {
    storage.set(draftKey(activeRef.current), draftRef.current);
    activeRef.current = id;
    setActiveId(id);
    storage.set('active', id);
    updateDraft(normalizeDraft(readDraft(id), snapshotRef.current.config.models));
  }
  function applySnapshot(next: Snapshot) {
    snapshotRef.current = next;
    setSnapshot(next);
    setLoaded(true);
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      const saved = storage.get<Partial<Draft>>(draftKey(activeRef.current), {});
      const preferred = saved.model || storage.get('selected-model', next.config.model);
      updateDraft(normalizeDraft({ ...draftRef.current, model: preferred }, next.config.models));
    }
    if (activeRef.current && !next.conversations.some(c => c.id === activeRef.current)) selectConversation(null);
  }
  useEffect(() => {
    const controller = new AbortController();
    api<Snapshot>('/api/state', { signal: controller.signal }).then(data => {
      applySnapshot(data);
      setOnline(true);
    }).catch(error => { if (!controller.signal.aborted) toast.error(errorMessage(error)); });
    const stream = new EventSource('/api/events');
    stream.addEventListener('state', event => {
      try { applySnapshot(JSON.parse(event.data)); setOnline(true); }
      catch { toast.error('同步记录失败，请刷新页面重试。'); }
    });
    stream.onopen = () => setOnline(true);
    stream.onerror = () => setOnline(false);
    return () => { controller.abort(); stream.close(); };
  }, []);

  function changeModel(id: string) {
    const spec = snapshotRef.current.config.models.find(m => m.id === id);
    if (!spec) return;
    const current = draftRef.current;
    const limit = assetLimit(spec, current.parameters.mode);
    if (current.assets.length > limit) { toast.error(`${spec.name} 在此模式下最多支持 ${limit} 张图片，请先移除多余图片。`); return; }
    if (current.assets.some(a => !assetFitsModel(a, spec))) { toast.error('部分参考图片的尺寸不适用于此模型，请先移除。'); return; }
    updateDraft(normalizeDraft({ ...current, model: id }, snapshotRef.current.config.models));
    storage.set('selected-model', id);
    storage.set(`selected-${spec.kind}-model`, id);
  }
  function changeKind(kind: 'image' | 'video') {
    const preferred = storage.get(`selected-${kind}-model`, kind === 'image' ? DEFAULT_IMAGE_MODEL : DEFAULT_MODEL);
    const spec = snapshotRef.current.config.models.find(m => m.id === preferred && m.kind === kind) || snapshotRef.current.config.models.find(m => m.kind === kind);
    if (spec) changeModel(spec.id);
  }
  function changeMode(mode: 'reference' | 'frames') {
    const current = draftRef.current;
    const spec = snapshotRef.current.config.models.find(m => m.id === current.model) || MODELS[0];
    if (spec.kind === 'image') return;
    const limit = mode === 'frames' ? spec.frameImages : spec.maxReferences;
    if (current.assets.length > limit) { toast.error(`当前模式最多支持 ${limit} 张图片，请先移除多余图片。`); return; }
    updateDraft(normalizeDraft({ ...current, parameters: { ...current.parameters, mode } }, snapshotRef.current.config.models));
  }
  function uploadFiles(files: FileList | File[]) {
    const selected = [...files];
    if (!selected.length) return;
    const destination = activeRef.current;
    setUploading(value => value + 1);
    uploadQueue.current = uploadQueue.current.then(async () => {
      for (const file of selected) {
        let current = destination === activeRef.current ? draftRef.current : readDraft(destination);
        const models = snapshotRef.current.config.models;
        const spec = models.find(m => m.id === current.model) || MODELS[0];
        if (spec.kind !== 'image' && !spec.maxReferences) current = normalizeDraft({ ...current, parameters: { ...current.parameters, mode: 'frames' } }, models);
        const limit = assetLimit(spec, current.parameters.mode);
        if (current.assets.length >= limit) { toast.error(`当前模式最多添加 ${limit} 张图片。`); break; }
        try {
          await validateImage(file, spec);
          const asset = await api<Asset>('/api/uploads', { method: 'POST', headers: { 'Content-Type': file.type, 'X-File-Name': encodeURIComponent(file.name) }, body: file });
          const latest = destination === activeRef.current ? draftRef.current : readDraft(destination);
          const latestModel = snapshotRef.current.config.models.find(m => m.id === latest.model) || MODELS[0];
          if (latest.assets.length >= assetLimit(latestModel, latest.parameters.mode) || !assetFitsModel(asset, latestModel)) { toast.error('模型或参考图已变化，这张图片不符合当前限制。'); continue; }
          const next = normalizeDraft({ ...latest, assets: [...latest.assets, asset] }, snapshotRef.current.config.models);
          if (destination === activeRef.current) updateDraft(next);
          else storage.set(draftKey(destination), next);
        } catch (error) { toast.error(errorMessage(error)); }
      }
    }).catch(error => { toast.error(errorMessage(error)); }).finally(() => setUploading(value => value - 1));
  }
  async function generate() {
    if (submittingRef.current || uploading) return;
    if (!online) { toast.error('本地服务正在重连，请稍后再试。'); return; }
    if (!snapshotRef.current.config.hasApiKey) { setSettingsOpen(true); return; }
    const current = draftRef.current;
    const image = snapshotRef.current.config.models.find(m => m.id === current.model)?.kind === 'image';
    const prompt = current.prompt.trim();
    if (image && !prompt) { toast.error('描述想生成的画面，或说明需要怎样修改参考图。'); return; }
    if (!prompt && !current.assets.length) { toast.error('写下一点想法，或添加一张参考图。'); return; }
    if (!image && current.parameters.mode === 'frames' && !current.assets.length) { toast.error('首尾帧模式需要至少一张首帧图片。'); return; }
    const destination = activeRef.current;
    const originalDraft = JSON.stringify(current);
    const payload = { conversationId: destination, prompt, assetIds: current.assets.map(a => a.id), parameters: image ? current.imageParameters : current.parameters, model: current.model };
    const signature = JSON.stringify(payload);
    if (requestIdentity.current?.signature !== signature) requestIdentity.current = { signature, id: crypto.randomUUID() };
    const requestId = requestIdentity.current.id;
    submittingRef.current = true;
    setSubmitting(true);
    try {
      let result: { conversationId: string; run?: Run };
      try { result = await api('/api/generations', { method: 'POST', body: { ...payload, requestId } }); }
      catch (error) {
        const fresh = await api<Snapshot>('/api/state').catch(() => null);
        const found = fresh?.conversations.find(c => c.runs.some(r => r.requestId === requestId));
        if (!found) throw error;
        result = { conversationId: found.id };
      }
      // Fetch before selecting the new conversation so it is present in state.
      const fresh = await api<Snapshot>('/api/state');
      applySnapshot(fresh);
      if (activeRef.current === destination) {
        const untouched = JSON.stringify(draftRef.current) === originalDraft;
        if (untouched) storage.set(draftKey(destination), {});
        activeRef.current = result.conversationId;
        setActiveId(result.conversationId);
        storage.set('active', result.conversationId);
        if (untouched) updateDraft({ ...current, prompt: '', assets: [] });
        else storage.set(draftKey(result.conversationId), draftRef.current);
      }
      requestIdentity.current = null;
    } catch (error) { toast.error(errorMessage(error)); }
    finally { submittingRef.current = false; setSubmitting(false); }
  }
  function reuse(run: Run) {
    if (!snapshotRef.current.config.models.some(m => m.id === run.model)) {
      toast.error('这条记录使用的自定义接入点已变更，请先在设置中恢复接入点。');
      return;
    }
    updateDraft(normalizeDraft({ ...draftRef.current, prompt: run.prompt, assets: run.assets, ...(run.kind === 'image' ? { imageParameters: run.parameters } : { parameters: run.parameters }), model: run.model }, snapshotRef.current.config.models));
    toast.success('提示词、模型和参考图已带回输入框。');
  }
  async function editImage(run: ImageRun) {
    const destination = activeRef.current;
    try {
      const asset = await api<Asset>(`/api/tasks/${run.id}/reference`, { method: 'POST' });
      if (activeRef.current !== destination) return;
      const model = snapshotRef.current.config.models.some(m => m.id === run.model) ? run.model : DEFAULT_IMAGE_MODEL;
      updateDraft(normalizeDraft({ ...draftRef.current, prompt: '', assets: [asset], model, imageParameters: { ...imageDefaults, ...run.parameters, background: 'opaque' } }, snapshotRef.current.config.models));
      toast.success('图片已带入参考区，写下这一次想修改的内容。');
      requestAnimationFrame(() => document.getElementById('prompt')?.focus());
    } catch (error) { toast.error(errorMessage(error)); }
  }
  function applyConfig(config: Config) {
    const next = { ...snapshotRef.current, config };
    snapshotRef.current = next;
    setSnapshot(next);
    const current = draftRef.current;
    const fits = (model: Model) => current.assets.length <= assetLimit(model, current.parameters.mode) && current.assets.every(a => assetFitsModel(a, model));
    const selected = config.models.find(m => m.id === current.model);
    // Keep the draft usable when its custom endpoint is removed or its profile
    // changes to a model that cannot accept the existing reference images.
    if (!selected || !fits(selected)) {
      const fallback = config.models.find(fits) || MODELS[0];
      updateDraft(normalizeDraft({ ...current, model: fallback.id }, config.models));
    }
    const spec = config.models.find(m => m.id === config.model);
    if (spec && fits(spec)) changeModel(config.model);
  }
  async function rename(id: string, title: string) {
    await api(`/api/conversations/${id}`, { method: 'PATCH', body: { title } });
    applySnapshot(await api<Snapshot>('/api/state'));
  }
  async function remove(id: string) {
    await api(`/api/conversations/${id}`, { method: 'DELETE' });
    storage.set(draftKey(id), {});
    if (activeRef.current === id) {
      activeRef.current = null; setActiveId(null); storage.set('active', null);
      updateDraft(normalizeDraft(readDraft(null), snapshotRef.current.config.models));
    }
    applySnapshot(await api<Snapshot>('/api/state'));
    toast.success('会话已删除');
  }
  const conversation = snapshot.conversations.find(c => c.id === activeId);
  const model = snapshot.config.models.find(m => m.id === draft.model) || MODELS[0];
  return { snapshot, activeId, conversation, draft, model, online, loaded, submitting, uploading, settingsOpen, setSettingsOpen, updateDraft, selectConversation, changeModel, changeKind, changeMode, uploadFiles, generate, reuse, editImage, applyConfig, rename, remove };
}

export type Studio = ReturnType<typeof useStudio>;
