import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock3, Copy, Download, Expand, LoaderCircle, Pencil, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Elapsed } from '@/components/run-card';
import { activeStatuses, api, errorMessage } from '@/lib/studio';
import type { ImageRun } from '@/types';

export function ImageRunCard({ run, onReuse, onEdit }: { run: ImageRun; onReuse: (run: ImageRun) => void; onEdit: (run: ImageRun) => Promise<void> }) {
  const [editing, setEditing] = useState(false);
  const [imageError, setImageError] = useState(false);
  const result = run.result, p = run.parameters;
  const source = result?.localUrl || result?.remoteUrl;
  const imageDimensions = result?.size?.match(/^(\d+)x(\d+)$/);
  const aspectRatio = imageDimensions ? `${imageDimensions[1]} / ${imageDimensions[2]}` : '1 / 1';
  const running = activeStatuses.has(run.status);
  const accountOverdue = !running && run.error?.code === 'AccountOverdueError';
  useEffect(() => { setImageError(false); }, [source]);
  async function copy() {
    try { await navigator.clipboard.writeText(run.prompt); toast.success('提示词已复制'); }
    catch { toast.error('无法访问剪贴板，请选中文字复制。'); }
  }
  async function cache() {
    try { await api(`/api/tasks/${run.id}/cache`, { method: 'POST' }); toast.success('正在重新保存图片'); }
    catch (error) { toast.error(errorMessage(error)); }
  }
  const backgroundLabel = (value?: string) => value === 'transparent' ? '透明背景' : value === 'opaque' ? '实色背景' : '自动背景';
  return <article data-run-id={run.id} data-kind="image" className="space-y-6">
    <div className="ml-auto flex max-w-[92%] flex-col items-end sm:max-w-[84%]">
      <p className="mb-2 text-[10px] text-muted-foreground">你 <span className="mx-1.5 opacity-50">·</span>{new Date(run.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
      {run.assets.length ? <div className="mb-2 flex flex-wrap justify-end gap-2">{run.assets.map((asset, index) => <a key={`${asset.id}-${index}`} href={asset.url} target="_blank" rel="noreferrer" aria-label={`查看图片 ${index + 1}`}><img src={asset.url} alt={`图片 ${index + 1}：${asset.name}`} className="checkerboard size-[72px] rounded-lg border border-border object-cover" loading="lazy" /></a>)}</div> : null}
      <Card className="rounded-xl rounded-br-sm border-primary/15 bg-primary/7 shadow-none"><CardContent className="whitespace-pre-wrap break-words px-4 py-3 text-[13px] leading-7">{run.prompt}</CardContent></Card>
      <div className="mt-2 flex flex-wrap justify-end gap-1.5">{[run.assets.length ? '参考图生图' : '文生图', p.ratio === 'auto' ? '自动比例' : p.ratio, p.resolution, p.output_format.toUpperCase(), backgroundLabel(p.background)].map((label, index) => <Badge key={index} variant="secondary" className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">{label}</Badge>)}</div>
    </div>
    <div className="max-w-[670px]">
      <div className="mb-3 flex items-center gap-2.5"><Avatar className="size-6 rounded-md"><AvatarImage src="/assets/mark.svg" /><AvatarFallback className="rounded-md text-[10px]">即</AvatarFallback></Avatar><span className="text-xs">即刻</span><Badge variant="outline" className="rounded px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">{run.modelName || 'Seedream'}</Badge></div>
      {run.status === 'succeeded' && result ? <>
        <Card className="overflow-hidden rounded-xl shadow-none">
          <Dialog><DialogTrigger asChild><Button variant="ghost" className="checkerboard group relative block h-auto w-full rounded-none p-0 hover:bg-transparent" aria-label="放大查看生成图片">
            <img src={source} alt={run.prompt} style={{ aspectRatio }} className="generated-image block max-h-[440px] min-h-36 w-full object-contain" onError={() => setImageError(true)} />
            <span className="absolute right-3 top-3 rounded-md bg-black/50 p-1.5 text-white/80 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"><Expand className="size-4" /></span>
          </Button></DialogTrigger><DialogContent className="max-h-[92dvh] max-w-5xl overflow-y-auto rounded-xl bg-card p-4 sm:p-5"><DialogHeader className="pr-7 text-left"><DialogTitle className="text-sm font-medium">图片预览</DialogTitle><DialogDescription className="text-[11px]">{result.size || p.resolution} · {result.output_format.toUpperCase()} · {backgroundLabel(result.background)}</DialogDescription></DialogHeader><img src={source} alt={run.prompt} className="checkerboard mx-auto max-h-[70dvh] w-full object-contain" /></DialogContent></Dialog>
          {imageError ? <p role="status" className="px-4 py-3 text-xs leading-6 text-amber-600 dark:text-amber-200/70">图片暂时无法显示，可以尝试下载原图，或重新保存到本机。</p> : null}
          <CardFooter className="flex items-center justify-between gap-3 px-4 py-3"><div><p className="flex items-center gap-1.5 text-xs"><Check className="size-3.5 text-primary" />你的想象，已成为画面</p><p className="mt-1.5 text-[10px] text-muted-foreground">{result.size || p.resolution} · {result.output_format.toUpperCase()} · {backgroundLabel(result.background)}</p></div><span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">{result.localUrl ? <Check className="size-3" /> : <Clock3 className="size-3" />}{result.localUrl ? '已保存到本机' : result.cacheStatus === 'failed' ? '尚未保存到本机' : '正在保存到本机'}</span></CardFooter>
          {result.cacheStatus === 'failed' ? <p className="px-4 pb-4 text-[11px] leading-5 text-amber-600 dark:text-amber-200/70">本地保存暂未完成：{result.cacheError}</p> : null}
        </Card>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button asChild size="sm" className="h-8 text-[11px] shadow-none"><a href={result.localUrl ? `${result.localUrl}?download=1` : result.remoteUrl} download={Boolean(result.localUrl)} target={result.localUrl ? undefined : '_blank'} rel="noreferrer"><Download />下载图片</a></Button>
          <Button variant="outline" size="sm" disabled={editing || !result.localUrl} className="h-8 text-[11px]" onClick={async () => { setEditing(true); try { await onEdit(run); } finally { setEditing(false); } }}>{editing ? <LoaderCircle className="animate-spin" /> : <Pencil />}继续编辑</Button>
          <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => onReuse(run)}><RotateCcw />再次创作</Button>
          <Button variant="ghost" size="sm" className="h-8 text-[11px] text-muted-foreground" onClick={copy}><Copy />复制提示词</Button>
          {result.cacheStatus === 'failed' ? <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={cache}><Download />重新保存</Button> : null}
        </div>
      </> : <>
        <Card className="rounded-xl shadow-none"><CardContent className="px-5 py-6"><p className="flex items-center gap-2.5 text-sm font-medium">{running ? <LoaderCircle className="size-[18px] animate-spin text-primary" /> : <AlertTriangle className="size-[18px] text-amber-600 dark:text-amber-200/70" />}{running ? '正在绘制你的想象' : accountOverdue ? '账号欠费，暂时无法生成图片' : run.status === 'unknown' ? '这次图片生成的结果需要确认' : '这次图片生成没有完成'}</p><p className="mt-3 break-words text-xs leading-6 text-muted-foreground">{running ? 'Seedream 正在生成画面。完成后，图片会自动出现在这里；你可以继续创作。' : accountOverdue ? '方舟接口提示当前 API Key 所属账号存在欠费。请在火山引擎控制台核对并处理欠费，恢复服务后点击「复用提示词」重新生成。' : run.error?.message || '请检查提示词和参考图后重试。'}</p>{accountOverdue ? <Dialog><DialogTrigger asChild><Button variant="ghost" size="sm" className="mt-2 h-8 text-[11px] text-muted-foreground">查看错误详情</Button></DialogTrigger><DialogContent className="max-w-lg"><DialogHeader><DialogTitle>方舟接口错误详情</DialogTitle><DialogDescription>联系平台支持时，可以提供以下错误码与 Request ID。</DialogDescription></DialogHeader><p className="break-all text-xs font-medium">{run.error?.code}</p><p className="whitespace-pre-wrap break-all text-xs leading-6 text-muted-foreground">{run.error?.message}</p></DialogContent></Dialog> : null}{run.status === 'unknown' ? <p className="mt-3 text-xs leading-6 text-muted-foreground">连接已中断，无法确认请求是否完成。请先在方舟控制台核对请求记录，本地不会自动重复生成。</p> : null}{run.error?.code ? <Badge variant="outline" className="mt-3 max-w-full break-all rounded text-[10px] font-normal text-muted-foreground">{run.error.code}</Badge> : null}</CardContent>{running ? <><Separator /><CardFooter className="flex justify-between gap-3 px-4 py-3 text-[9px] text-muted-foreground"><span>完成后自动保存图片</span><Elapsed start={run.createdAt} /></CardFooter></> : null}</Card>
        {!running ? <div className="mt-3 flex flex-wrap gap-2"><Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => onReuse(run)}><RotateCcw />复用提示词</Button><Button variant="ghost" size="sm" className="h-8 text-[11px] text-muted-foreground" onClick={copy}><Copy />复制提示词</Button></div> : null}
      </>}
    </div>
  </article>;
}
