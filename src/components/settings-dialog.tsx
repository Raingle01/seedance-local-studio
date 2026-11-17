import { useEffect, useState } from 'react';
import { Check, ExternalLink, KeyRound, LoaderCircle } from 'lucide-react';
import { toast } from 'sonner';
import { ALL_MODELS, DEFAULT_MODEL } from '../../public/models.js';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StudioSelect } from '@/components/studio-select';
import { api, errorMessage } from '@/lib/studio';
import type { Config } from '@/types';

export function SettingsDialog({ open, onOpenChange, config, onSave }: { open: boolean; onOpenChange: (open: boolean) => void; config: Config; onSave: (config: Config) => void }) {
  const [apiKey, setApiKey] = useState('');
  const [selection, setSelection] = useState(config.model);
  const [endpoint, setEndpoint] = useState('');
  const [profile, setProfile] = useState(config.modelProfile || DEFAULT_MODEL);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (open) {
      setSelection(config.model.startsWith('ep-') ? 'custom' : config.model);
      setEndpoint(config.model.startsWith('ep-') ? config.model : '');
      setProfile(config.modelProfile || DEFAULT_MODEL);
      setError('');
    }
    setApiKey('');
  }, [open]);
  async function save() {
    if (!apiKey.trim() && !config.hasApiKey) { setError('请先输入 API Key。'); return; }
    if (selection === 'custom' && !endpoint.trim().startsWith('ep-')) { setError('请填写以 ep- 开头的接入点 ID。'); return; }
    setBusy(true); setError('');
    try {
      const updated = await api<Config>('/api/settings', { method: 'PUT', body: { model: selection === 'custom' ? endpoint.trim() : selection, modelProfile: profile, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) } });
      onSave(updated); setApiKey(''); onOpenChange(false); toast.success('设置已保存。可以开始生成图片或视频了。');
    } catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  async function clearKey() {
    setBusy(true);
    try { onSave(await api<Config>('/api/settings', { method: 'PUT', body: { clearKey: true } })); onOpenChange(false); toast.success('已移除本地设置中的密钥。'); }
    catch (error) { setError(errorMessage(error)); }
    finally { setBusy(false); }
  }
  return <Dialog open={open} onOpenChange={value => { if (!busy) onOpenChange(value); }}><DialogContent id="settings-dialog" className="max-h-[90dvh] max-w-[460px] overflow-y-auto rounded-xl border-border bg-card p-6 sm:p-7">
    <DialogHeader className="text-left"><span className="mb-3 flex size-10 items-center justify-center rounded-xl border border-primary/20 bg-primary/10"><KeyRound className="size-5 text-primary" /></span><DialogTitle className="text-xl font-medium">连接你的创作引擎</DialogTitle><DialogDescription className="pt-1 text-xs leading-6">使用火山方舟 API Key，开始创作你的图片与视频。</DialogDescription></DialogHeader>
    <form onSubmit={e => { e.preventDefault(); void save(); }} className="space-y-5">
      <div className="space-y-2.5"><div className="flex items-center justify-between"><Label htmlFor="api-key" className="text-xs font-medium">ARK API Key</Label><Button asChild variant="link" className="h-auto p-0 text-[10px] text-muted-foreground"><a href="https://ark.volcengine.com/region:cn-beijing/apiKey" target="_blank" rel="noreferrer">获取密钥<ExternalLink className="!size-3" /></a></Button></div><Input id="api-key" type="password" autoComplete="off" spellCheck={false} value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={config.hasApiKey ? '已配置 · 留空保持原密钥' : '输入 API Key'} className="h-10 bg-background/50 text-xs" /><p className="text-[10px] leading-5 text-muted-foreground">{config.keySource === 'environment' ? '已从环境变量读取密钥，填写新值后优先使用本地设置。' : '密钥仅保存在本机服务端，不写入浏览器存储。'}</p></div>
      <div className="space-y-2.5"><Label htmlFor="default-model" className="text-xs font-medium">默认模型</Label><StudioSelect id="default-model" label="默认模型" value={selection} onChange={setSelection} options={[...ALL_MODELS.map(m => ({ value: m.id, label: m.name + (m.tag === 'LEGACY' ? ' · 即将下线' : '') })), { value: 'custom', label: '自定义接入点…' }]} className="h-10 bg-background/50" /><p className="text-[10px] leading-5 text-muted-foreground">每次生成时，都可以在输入框上方切换模型。</p></div>
      {selection === 'custom' ? <><div className="space-y-2.5"><Label htmlFor="model-id" className="text-xs">接入点 ID</Label><Input id="model-id" value={endpoint} onChange={e => setEndpoint(e.target.value)} placeholder="ep-…" spellCheck={false} autoComplete="off" className="h-10 bg-background/50 font-mono text-xs" /></div><div className="space-y-2.5"><Label htmlFor="model-profile" className="text-xs">接入点实际使用的模型</Label><StudioSelect id="model-profile" label="接入点实际使用的模型" value={profile} onChange={setProfile} options={ALL_MODELS.map(m => ({ value: m.id, label: m.name }))} className="h-10 bg-background/50" /><p className="text-[10px] leading-5 text-muted-foreground">用于匹配图片或视频接口，以及对应的参数限制。</p></div></> : null}
      <div className="flex flex-wrap gap-2">{['北京区域', 'Seedance / Seedream', '本地保存'].map(text => <Badge key={text} variant="secondary" className="rounded px-2 py-1 text-[9px] font-normal text-muted-foreground">{text}</Badge>)}</div>
      {error ? <p role="alert" className="text-xs leading-5 text-destructive">{error}</p> : null}
      <DialogFooter className="flex-row items-center justify-end gap-3 pt-2">{config.keySource === 'settings' ? <Button id="clear-key" type="button" variant="ghost" className="mr-auto h-8 px-0 text-[10px] text-destructive hover:bg-transparent hover:text-destructive" disabled={busy} onClick={clearKey}>移除已保存密钥</Button> : null}<Button id="save-settings" type="submit" className="gap-3 text-xs" disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <Check />}保存设置</Button></DialogFooter>
    </form>
  </DialogContent></Dialog>;
}
