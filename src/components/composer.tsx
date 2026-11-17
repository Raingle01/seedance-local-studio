import { useEffect, useRef, useState } from 'react';
import { ArrowUpRight, Clock3, Film, Image as ImageIcon, ImagePlus, LoaderCircle, RectangleHorizontal, Settings2, Sparkles, Volume2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card';
import { Textarea } from '@/components/ui/textarea';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StudioSelect } from '@/components/studio-select';
import { assetLimit } from '@/lib/studio';
import { cn } from '@/lib/utils';
import type { Studio } from '@/hooks/use-studio';
import type { ImageParameters, Parameters } from '@/types';

const optionClass = 'text-[10px] sm:text-[11px]';
function VideoOptions({ studio }: { studio: Studio }) {
  const { model, draft } = studio;
  if (model.kind === 'image') return null;
  const p = draft.parameters, frames = p.mode === 'frames';
  const durations = Array.from({ length: model.maxDuration - model.minDuration + 1 }, (_, i) => ({ value: String(i + model.minDuration), label: `${i + model.minDuration} 秒` }));
  if (model.autoDuration) durations.push({ value: '-1', label: '自动时长' });
  const update = (next: Partial<Parameters>) => studio.updateDraft(previous => ({ ...previous, parameters: { ...previous.parameters, ...next } }));
  return <>
    <StudioSelect compact id="mode" label="生成模式" value={p.mode} onChange={value => studio.changeMode(value as Parameters['mode'])} options={[{ value: 'reference', label: model.maxReferences ? '多图参考' : '文生视频' }, { value: 'frames', label: model.frameImages === 1 ? '首帧' : '首尾帧' }]} className={optionClass} />
    <Separator orientation="vertical" className="mx-1 hidden h-3 sm:block" />
    <StudioSelect compact id="ratio" label="画面比例" value={p.ratio} onChange={ratio => update({ ratio })} disabled={frames && model.forceAdaptiveFrames} icon={RectangleHorizontal} options={['16:9', '9:16', '1:1', '4:3', '3:4', '21:9', 'adaptive'].map(value => ({ value, label: value === 'adaptive' ? '自动比例' : value, disabled: value === 'adaptive' && !model.autoDuration && !frames }))} className={`${optionClass} [&>svg:first-child]:hidden min-[420px]:[&>svg:first-child]:block`} />
    <StudioSelect compact id="resolution" label="视频分辨率" value={p.resolution} onChange={resolution => update({ resolution })} options={model.resolutions.map(value => ({ value, label: value === '4k' ? '4K' : value }))} className={optionClass} />
    <StudioSelect compact id="duration" label="视频时长" value={String(p.duration)} onChange={value => update({ duration: Number(value) })} icon={Clock3} options={durations} className={`${optionClass} [&>svg:first-child]:hidden lg:[&>svg:first-child]:block`} />
  </>;
}
function ImageOptions({ studio }: { studio: Studio }) {
  const p = studio.draft.imageParameters;
  const update = (next: Partial<ImageParameters>) => studio.updateDraft(previous => ({ ...previous, imageParameters: { ...previous.imageParameters, ...next } }));
  return <>
    <StudioSelect compact id="image-ratio" label="图片比例" value={p.ratio} onChange={ratio => update({ ratio })} options={['auto', '1:1', '16:9', '9:16', '4:3', '3:4', '3:2', '2:3', '21:9'].map(value => ({ value, label: value === 'auto' ? '自动比例' : value }))} className={optionClass} />
    <StudioSelect compact id="image-resolution" label="图片分辨率" value={p.resolution} onChange={resolution => update({ resolution })} options={studio.model.resolutions.map(value => ({ value, label: value }))} className={optionClass} />
    <StudioSelect compact id="image-format" label="图片格式" value={p.output_format} onChange={value => update({ output_format: value as ImageParameters['output_format'], ...(value === 'jpeg' && p.background === 'transparent' ? { background: 'opaque' } : {}) })} options={[{ value: 'png', label: 'PNG' }, { value: 'jpeg', label: 'JPEG' }]} className={optionClass} />
    <StudioSelect compact id="image-background" label="图片背景" value={p.background} onChange={value => update({ background: value as ImageParameters['background'], ...(value === 'transparent' ? { output_format: 'png' } : {}) })} options={[{ value: 'auto', label: '自动背景' }, { value: 'opaque', label: '实色背景' }, { value: 'transparent', label: '透明背景' }]} className={optionClass} />
  </>;
}
export function Composer({ studio }: { studio: Studio }) {
  const { draft, model, conversation, submitting, uploading } = studio;
  const imageMode = model.kind === 'image';
  const p = draft.parameters;
  const frames = !imageMode && p.mode === 'frames';
  const limit = assetLimit(model, p.mode);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const dragDepth = useRef(0);
  const [dragging, setDragging] = useState(false);
  const compact = Boolean(conversation);
  useEffect(() => {
    if (!textarea.current) return;
    textarea.current.style.height = 'auto';
    textarea.current.style.height = `${Math.min(textarea.current.scrollHeight, compact ? 140 : 200)}px`;
  }, [draft.prompt, compact]);
  const hint = imageMode ? draft.assets.length ? '描述要修改的内容，用“图片1”引用参考图' : '单张输出 · 最多 10 张参考图 · 支持透明 PNG' : frames ? `${model.frameImages === 1 ? '添加一张首帧图片' : '图片 1 为首帧，图片 2 为尾帧'}${model.forceAdaptiveFrames ? ' · 自动比例' : ''}` : draft.assets.length ? '用“图片1”“图片2”在提示词中引用素材' : `${model.minDuration}–${model.maxDuration} 秒 · ${model.resolutions.join(' / ')}`;
  return <section className="mx-auto w-full max-w-[850px] shrink-0" aria-label={imageMode ? '创建图片' : '创建视频'}>
    <form id="generation-form" onSubmit={event => { event.preventDefault(); void studio.generate(); }}
      onDragEnter={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); dragDepth.current++; setDragging(true); } }}
      onDragOver={event => { if (event.dataTransfer.types.includes('Files')) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; } }}
      onDragLeave={() => { dragDepth.current--; if (dragDepth.current <= 0) setDragging(false); }}
      onDrop={event => { event.preventDefault(); dragDepth.current = 0; setDragging(false); studio.uploadFiles(event.dataTransfer.files); }}>
      <Card className={cn('relative overflow-visible rounded-xl border-border bg-card shadow-sm transition-colors focus-within:border-primary/45', dragging && 'border-primary')}>
        <CardHeader className={cn('flex flex-row flex-wrap items-center gap-2.5 space-y-0 px-4 pb-2 pt-4 sm:px-5', compact && 'pt-3')}>
          <StudioSelect compact id="creation-type" label="创作类型" value={imageMode ? 'image' : 'video'} onChange={value => studio.changeKind(value as 'image' | 'video')} options={[{ value: 'image', label: '图片生成' }, { value: 'video', label: '视频生成' }]} icon={imageMode ? ImageIcon : Film} className="h-8 shrink-0 px-0 text-[11px] font-medium sm:px-0" />
          <StudioSelect id="model-select" label="选择生成模型" groupLabel={imageMode ? '图片模型' : '视频模型'} value={draft.model} onChange={studio.changeModel} options={studio.snapshot.config.models.filter(m => m.kind === model.kind).map(m => ({ value: m.id, label: m.name + (m.tag === 'LEGACY' ? ' · 即将下线' : '') }))} icon={Sparkles} className="h-8 w-auto min-w-0 max-w-[min(280px,54vw)] gap-2 border-border/70 bg-secondary/60 px-2.5 text-[11px] shadow-none" />
            <Tooltip><TooltipTrigger asChild><Button type="button" variant="outline" size="sm" id="add-images" className="h-7 gap-1.5 border-border bg-secondary/40 px-2 text-[10px] shadow-none [&_svg]:size-3.5" onClick={() => fileInput.current?.click()}><ImagePlus />添加参考图{draft.assets.length ? <span className="ml-1 text-primary">{draft.assets.length}/{limit}</span> : null}</Button></TooltipTrigger>
              <TooltipContent className="max-w-64 text-xs">JPG、PNG、WEBP、GIF，单张小于 30MB。{imageMode ? '宽高大于 14px、总像素不超过 3600 万、宽高比 1:16–16:1。' : '宽高分别为 300–6000px，宽高比 0.4–2.5。'}</TooltipContent></Tooltip>
          <Badge variant="secondary" id="model-tag" className="hidden rounded px-1.5 py-0.5 text-[8px] font-medium tracking-wider text-muted-foreground sm:inline-flex">{model.tag}</Badge>

        </CardHeader>
        <CardContent className="px-0 pb-0">
          {draft.assets.length ? <div className="flex gap-3 overflow-x-auto px-5 pt-3" aria-label="参考图片">{draft.assets.map((asset, i) => <div key={`${asset.id}-${i}`} className="relative w-[68px] shrink-0">
            <img className="checkerboard h-16 w-[68px] rounded-md border border-border object-cover" src={asset.url} alt={asset.name} />
            <Button type="button" variant="secondary" size="icon" className="absolute -right-1.5 -top-1.5 size-5 rounded-full border border-border shadow-sm [&_svg]:size-3" aria-label={`移除图片 ${i + 1}`} onClick={() => studio.updateDraft(previous => ({ ...previous, assets: previous.assets.filter((_, index) => index !== i) }))}><X /></Button>
            <p className="pb-1 pt-1.5 text-center text-[9px] text-muted-foreground">{frames ? i === 0 ? '首帧' : '尾帧' : `图片 ${i + 1}`}</p>
          </div>)}</div> : null}
          <Label htmlFor="prompt" className="sr-only">{imageMode ? '图片提示词' : '视频提示词'}</Label>
          <Textarea id="prompt" ref={textarea} value={draft.prompt} onChange={e => studio.updateDraft(previous => ({ ...previous, prompt: e.target.value }))} rows={compact ? 2 : 3} maxLength={10000}
            placeholder={imageMode ? draft.assets.length ? '想怎样改变这张图？描述要修改的内容，以及想保留的细节…' : '描述你想看见的画面。主体、构图、光线与风格，一切由你定义…' : '描述你的视频创意。场景、角色、镜头、声音，一切由你定义…'}
            className={cn('max-h-[200px] min-h-[108px] resize-none rounded-none border-0 bg-transparent px-4 py-5 text-[13px] leading-7 shadow-none placeholder:text-muted-foreground/65 focus-visible:ring-0 sm:px-5', compact && 'min-h-16 max-h-[140px] py-3')}
            onKeyDown={e => {
              if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
              e.preventDefault();
              if (e.repeat || submitting || uploading > 0 || !studio.online) return;
              void studio.generate();
            }}
            onPaste={e => { const files = [...e.clipboardData.items].filter(item => item.type.startsWith('image/')).map(item => item.getAsFile()).filter((file): file is File => Boolean(file)); if (files.length) { e.preventDefault(); studio.uploadFiles(files); } }} />
          {draft.prompt.length > 300 ? <p className="px-4 pb-3 text-right text-[10px] tabular-nums text-muted-foreground sm:px-5">{draft.prompt.length} / 10,000</p> : null}
        </CardContent>
        <Separator className="bg-border/70" />
        <CardFooter className="flex flex-wrap items-center justify-between gap-2 p-3 sm:flex-nowrap">
          <div className="flex w-full min-w-0 flex-wrap items-center gap-0.5 sm:w-auto sm:flex-nowrap">
            {imageMode ? <ImageOptions studio={studio} /> : <VideoOptions studio={studio} />}
            <div className="ml-auto flex shrink-0 items-center sm:ml-0">
              {!imageMode ? <Tooltip><TooltipTrigger asChild><div className={cn('flex h-8 shrink-0 items-center gap-1.5 rounded-md px-1.5 sm:px-2', !model.audio && 'opacity-45')}>
                <Checkbox id="audio-toggle" aria-label="生成同步声音" disabled={!model.audio} checked={p.generate_audio} onCheckedChange={checked => studio.updateDraft(previous => ({ ...previous, parameters: { ...previous.parameters, generate_audio: checked === true } }))} className="size-3.5" />
                <Label htmlFor="audio-toggle" className="flex cursor-pointer items-center gap-1 whitespace-nowrap text-[10px] font-normal text-muted-foreground"><Volume2 className="hidden size-3.5 lg:block" />声音</Label>
              </div></TooltipTrigger><TooltipContent>{model.audio ? '生成与画面同步的声音' : '此模型仅生成无声视频'}</TooltipContent></Tooltip> : null}
              <Popover><PopoverTrigger asChild><Button type="button" variant="ghost" size="icon" id="more-options" aria-label="更多生成设置" className="size-8 shrink-0 text-muted-foreground [&_svg]:size-3.5"><Settings2 /></Button></PopoverTrigger>
                <PopoverContent side="top" align="end" className="w-64 rounded-lg p-4"><p className="mb-4 text-xs font-medium">生成选项</p><div className="flex items-center justify-between gap-3">
                  <Label htmlFor="watermark" className="text-xs font-normal">添加水印</Label><Checkbox id="watermark" checked={imageMode ? draft.imageParameters.watermark : p.watermark} onCheckedChange={checked => studio.updateDraft(previous => imageMode ? { ...previous, imageParameters: { ...previous.imageParameters, watermark: checked === true } } : { ...previous, parameters: { ...previous.parameters, watermark: checked === true } })} />
                </div><Separator className="my-4" /><p className="text-[11px] leading-5 text-muted-foreground">{model.description}</p></PopoverContent>
              </Popover>
            </div>
          </div>
          <Button id="generate-button" type="submit" disabled={submitting || uploading > 0 || !studio.online} className="h-9 w-full gap-3 rounded-lg px-4 text-xs shadow-none sm:w-auto">{submitting || uploading ? <><LoaderCircle className="animate-spin" />{uploading ? '上传图片中' : '正在提交'}</> : <>{imageMode ? '生成图片' : '生成视频'}<ArrowUpRight /></>}</Button>
        </CardFooter>
        {dragging ? <div className="pointer-events-none absolute inset-0 z-20 flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-primary bg-card/95"><ImagePlus className="size-8 text-primary" /><p className="text-sm">放下图片，让灵感有迹可循</p><p className="text-xs text-muted-foreground">最多 {limit} 张图片</p></div> : null}
      </Card>
    </form>
    <div className="flex flex-wrap justify-between gap-x-3 gap-y-1 px-1 pt-2.5 text-[9px] leading-4 text-muted-foreground/75"><span>{hint}</span><span className="shrink-0">Enter 发送 · Shift + Enter 换行</span></div>
    <input ref={fileInput} id="image-input" type="file" accept="image/jpeg,image/png,image/webp,image/gif" multiple hidden onChange={e => { if (e.target.files) studio.uploadFiles(e.target.files); e.target.value = ''; }} />
  </section>;
}
