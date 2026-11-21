import { useEffect, useState } from 'react';
import { AlertTriangle, Check, Clock3, Copy, Download, ExternalLink, Link2, LoaderCircle, RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { activeStatuses, api, durationLabel, errorMessage, ratioLabel } from '@/lib/studio';
import { cn } from '@/lib/utils';
import type { VideoRun as Run } from '@/types';
import { getModel } from '../../public/models.js';

export function Elapsed({ start }: { start: string }) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const seconds = Math.max(0, Math.floor((now - new Date(start).getTime()) / 1000));
  return <span className="shrink-0 tabular-nums">已等待 {seconds >= 60 ? `${Math.floor(seconds / 60)} 分 ` : ''}{seconds % 60} 秒</span>;
}
export function RunCard({ run, onReuse, onRecover }: { run: Run; onReuse: (run: Run) => void; onRecover: (run: Run) => void }) {
  const p = run.parameters;
  const [videoError, setVideoError] = useState(false);
  async function copy() {
    try { await navigator.clipboard.writeText(run.prompt); toast.success('提示词已复制'); }
    catch { toast.error('无法访问剪贴板，请选中文字复制。'); }
  }
  async function taskAction(action: 'cache' | 'refresh') {
    try { await api(`/api/tasks/${run.id}/${action}`, { method: 'POST' }); toast.success(action === 'cache' ? '正在重新保存视频' : '已刷新任务状态'); }
    catch (error) { toast.error(errorMessage(error)); }
  }
  const result = run.result;
  const running = activeStatuses.has(run.status);
  const success = run.status === 'succeeded' && result;
  const source = result?.localUrl || result?.remoteUrl;
  useEffect(() => { setVideoError(false); }, [source]);
  const statusTitle = { submitting: '正在把想法交给 Seedance', queued: '灵感已就位，正在排队', running: '你的想象，正在逐帧成形', failed: '这次生成没有完成', expired: '任务已超时', cancelled: '任务已取消', unknown: '提交结果需要确认' }[run.status] || '正在获取任务状态';
  const statusDescription = { submitting: '正在提交提示词和参考图片，任务创建后会自动跟进。', queued: '任务已创建。轮到你的时候，画面就会开始发生。', running: '可以继续创作，也可以先去喝杯水。完成后，视频会自动出现在这里。' }[run.status];
  return (
    <article data-run-id={run.id} className="space-y-6">
      <div className="ml-auto flex max-w-[92%] flex-col items-end sm:max-w-[84%]">
        <p className="mb-2 text-[10px] text-muted-foreground">你 <span className="mx-1.5 opacity-50">·</span>{new Date(run.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })}</p>
        {run.assets.length ? <div className="mb-2 flex flex-wrap justify-end gap-2">{run.assets.map((asset, index) => <a key={`${asset.id}-${index}`} href={asset.url} target="_blank" rel="noreferrer" aria-label={`查看图片 ${index + 1}`}><img src={asset.url} alt={`图片 ${index + 1}：${asset.name}`} className="size-[72px] rounded-lg border border-border object-cover" loading="lazy" /></a>)}</div> : null}
        <Card className="rounded-xl rounded-br-sm border-primary/15 bg-primary/7 shadow-none"><CardContent className="whitespace-pre-wrap break-words px-4 py-3 text-[13px] leading-7">{run.prompt || '让这幅画面动起来。'}</CardContent></Card>
        <div className="mt-2 flex flex-wrap justify-end gap-1.5">{[p.mode === 'frames' ? '首尾帧' : run.assets.length ? '多图参考' : '文生视频', ratioLabel(p.ratio), p.resolution, durationLabel(p.duration), p.generate_audio ? '有声视频' : '无声视频'].map((label, i) => <Badge key={i} variant="secondary" className="rounded border border-border/50 px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">{label}</Badge>)}</div>
      </div>
      <div className="max-w-[670px]">
        <div className="mb-3 flex items-center gap-2.5"><Avatar className="size-6 rounded-md"><AvatarImage src="/assets/mark.svg" /><AvatarFallback className="rounded-md text-[10px]">即</AvatarFallback></Avatar><span className="text-xs">即刻</span><Badge variant="outline" className="rounded px-1.5 py-0.5 text-[9px] font-normal text-muted-foreground">{run.modelName || getModel(run.model)?.name || 'Seedance'}</Badge></div>
        {success ? <>
          <Card className="overflow-hidden rounded-xl shadow-none"><video controls playsInline preload="metadata" src={source} onError={() => setVideoError(true)} className="result-video block max-h-[min(42vh,420px)] w-full bg-black/80 object-contain" aria-label="生成的视频" />{videoError ? <p className="px-4 py-3 text-xs leading-6 text-amber-600 dark:text-amber-200/70">浏览器暂时无法播放该视频，可以下载后使用本地播放器打开。</p> : null}<CardFooter className="flex justify-between gap-3 px-4 py-3"><div><p className="flex items-center gap-1.5 text-xs"><Check className="size-3.5 text-primary" />你的画面，已经发生</p><p className="mt-1 text-[10px] text-muted-foreground">{result.resolution || p.resolution} · {ratioLabel(result.ratio || p.ratio)} · {durationLabel(result.duration ?? p.duration)}</p></div><span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground">{result.localUrl ? <Check className="size-3" /> : <Clock3 className="size-3" />}{result.localUrl ? '已保存到本机' : result.cacheStatus === 'failed' ? '尚未保存到本机' : '正在保存到本机'}</span></CardFooter>{result.cacheStatus === 'failed' ? <p className="px-4 pb-4 text-[11px] leading-5 text-amber-600 dark:text-amber-200/70">本地保存暂未完成：{result.cacheError}<br />可下载原视频，或点击“重新保存”。</p> : null}</Card>
          <div className="mt-3 flex flex-wrap gap-2"><Button asChild size="sm" className="h-8 text-[11px] shadow-none"><a href={result.localUrl ? `${result.localUrl}?download=1` : result.remoteUrl} download={result.localUrl ? true : undefined} target={result.localUrl ? undefined : '_blank'} rel="noreferrer"><Download />下载视频</a></Button><Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => onReuse(run)}><RotateCcw />再次创作</Button><Button variant="ghost" size="sm" className="h-8 text-[11px] text-muted-foreground" onClick={copy}><Copy />复制提示词</Button>{result.cacheStatus === 'failed' ? <Button variant="outline" size="sm" onClick={() => taskAction('cache')} className="h-8 text-[11px]"><Download />重新保存</Button> : null}</div>
        </> : <>
          <Card className={cn('rounded-xl shadow-none', !running && 'border-amber-500/20 bg-amber-50 dark:border-amber-200/15 dark:bg-amber-100/[.025]')}><CardContent className="px-5 py-6"><p className="flex items-center gap-2.5 text-sm font-medium">{running ? <LoaderCircle className="size-[18px] animate-spin text-primary" /> : <AlertTriangle className="size-[18px] text-amber-600 dark:text-amber-200/70" />}{statusTitle}</p><p className="mt-3 break-words text-xs leading-6 text-muted-foreground">{running ? statusDescription : run.error?.message || '请检查生成参数后重试。'}</p>{running ? <div className="mt-6 flex items-center text-[10px] text-muted-foreground/60">{['提交创意', '等待生成', '画面生成', '完成'].map((step, index) => <div key={step} className="flex items-center"><span className={cn('flex items-center gap-1.5 whitespace-nowrap', index <= (run.status === 'running' ? 2 : run.status === 'queued' ? 1 : 0) && 'text-primary')}><span className="size-1 rounded-full bg-current" />{step}</span>{index < 3 ? <Separator className="mx-2 w-5 sm:mx-3 sm:w-8" /> : null}</div>)}</div> : null}{run.pollError ? <p className="mt-4 break-words text-[11px] leading-5 text-amber-600 dark:text-amber-200/70">状态查询暂时中断，正在自动重试：{run.pollError}</p> : null}{run.error?.code ? <Badge variant="outline" className="mt-3 max-w-full break-all rounded text-[10px] font-normal text-muted-foreground">{run.error.code}</Badge> : null}{run.status === 'unknown' ? <p className="mt-3 text-xs leading-6 text-muted-foreground">请求可能已到达方舟。请先在控制台确认；找到任务 ID 后，可恢复追踪，避免重复生成。</p> : null}</CardContent>{running ? <><Separator /><CardFooter className="flex justify-between gap-3 px-4 py-3 text-[9px] text-muted-foreground"><span className="truncate" title={run.taskId}>{run.taskId || '正在获取任务 ID'}</span><Elapsed start={run.createdAt} /></CardFooter></> : null}</Card>
          <div className="mt-3 flex flex-wrap gap-2">{!running ? <><Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => onReuse(run)}><RotateCcw />复用提示词</Button><Button variant="ghost" size="sm" className="h-8 text-[11px] text-muted-foreground" onClick={copy}><Copy />复制提示词</Button></> : null}{run.pollError ? <Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => taskAction('refresh')}><RotateCcw />立即刷新</Button> : null}{run.status === 'unknown' ? <><Button variant="outline" size="sm" className="h-8 text-[11px]" onClick={() => onRecover(run)}><Link2 />用任务 ID 恢复追踪</Button><Button asChild variant="ghost" size="sm" className="h-8 text-[11px]"><a href="https://ark.volcengine.com/region:cn-beijing/experience/gen_video?model=doubao-seedance" target="_blank" rel="noreferrer">方舟控制台<ExternalLink /></a></Button></> : null}</div>
        </>}
      </div>
    </article>
  );
}
