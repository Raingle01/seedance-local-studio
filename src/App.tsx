import { Component, useEffect, useRef, useState, type ErrorInfo, type ReactNode } from 'react';
import { ArrowUpRight, LoaderCircle, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Separator } from '@/components/ui/separator';
import { SidebarInset, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Toaster } from '@/components/ui/sonner';
import { StudioSidebar } from '@/components/studio-sidebar';
import { Composer } from '@/components/composer';
import { SettingsDialog } from '@/components/settings-dialog';
import { ThemeToggle } from '@/components/theme-toggle';
import { RunCard } from '@/components/run-card';
import { ImageRunCard } from '@/components/image-run-card';
import { useStudio } from '@/hooks/use-studio';
import { useTheme } from '@/hooks/use-theme';
import { api, defaults, errorMessage, normalizeDraft, presets, imagePresets } from '@/lib/studio';
import type { Conversation, VideoRun } from '@/types';

type Action = { type: 'rename'; conversation: Conversation } | { type: 'recover'; run: VideoRun };

function Workspace() {
  const studio = useStudio();
  const { resolved: theme, toggle: toggleTheme } = useTheme();
  const imageMode = studio.model.kind === 'image';
  const inspiration = imageMode ? imagePresets : presets;
  const [search, setSearch] = useState('');
  const [action, setAction] = useState<Action | null>(null);
  const [actionValue, setActionValue] = useState('');
  const [actionError, setActionError] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [deleting, setDeleting] = useState<Conversation | null>(null);
  const [deleteError, setDeleteError] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);
  const scrollRoot = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  const previousConversation = useRef<string | null>(null);
  const lastRun = studio.conversation?.runs.at(-1);
  useEffect(() => {
    const viewport = scrollRoot.current?.querySelector('[data-radix-scroll-area-viewport]');
    const switched = previousConversation.current !== studio.activeId;
    previousConversation.current = studio.activeId;
    if (!viewport) return;
    if (switched || nearBottom.current) requestAnimationFrame(() => { viewport.scrollTop = viewport.scrollHeight; });
  }, [studio.activeId, studio.conversation?.runs.length, lastRun?.status, lastRun?.result?.localUrl]);
  useEffect(() => {
    const preventFileNavigation = (event: DragEvent) => { if (event.dataTransfer?.types.includes('Files')) event.preventDefault(); };
    window.addEventListener('dragover', preventFileNavigation);
    window.addEventListener('drop', preventFileNavigation);
    return () => { window.removeEventListener('dragover', preventFileNavigation); window.removeEventListener('drop', preventFileNavigation); };
  }, []);
  function openAction(value: Action) { setAction(value); setActionValue(value.type === 'rename' ? value.conversation.title : ''); setActionError(''); }
  async function submitAction() {
    if (!action) return;
    setActionBusy(true); setActionError('');
    try {
      if (action.type === 'rename') await studio.rename(action.conversation.id, actionValue.trim());
      else { await api(`/api/tasks/${action.run.id}/recover`, { method: 'POST', body: { taskId: actionValue.trim() } }); toast.success('已恢复追踪，将自动获取结果。'); }
      setAction(null);
    } catch (error) { setActionError(errorMessage(error)); }
    finally { setActionBusy(false); }
  }
  return <SidebarProvider className="h-svh min-h-0 overflow-hidden">
    <StudioSidebar studio={studio} search={search} onSearch={setSearch} onRename={conversation => openAction({ type: 'rename', conversation })} onDelete={conversation => { setDeleting(conversation); setDeleteError(''); }} />
    <SidebarInset className="min-h-0 min-w-0 bg-background">
      <header className="flex h-[68px] shrink-0 items-center justify-between gap-4 border-b border-border/70 px-4 sm:px-7">
        <div className="flex min-w-0 items-center gap-3"><SidebarTrigger id="sidebar-trigger" aria-label="切换侧边栏" title="切换侧边栏" className="text-muted-foreground" /><Separator orientation="vertical" className="hidden h-4 sm:block" /><span className="hidden shrink-0 text-xs text-muted-foreground sm:inline">创作空间</span><span className="hidden text-muted-foreground/40 sm:inline">/</span><span id="conversation-title" className="truncate text-xs">{studio.conversation?.title || '新创作'}</span></div>
        <div className="flex shrink-0 items-center gap-3 sm:gap-5"><ThemeToggle resolved={theme} onToggle={toggleTheme} /><Badge variant="outline" className="gap-1.5 border-transparent px-0 text-[10px] font-normal text-muted-foreground"><span className={`size-1 rounded-full ${studio.online ? 'bg-emerald-500 dark:bg-emerald-400/60' : 'bg-amber-500 dark:bg-amber-300/70'}`} />{studio.online ? '本地运行' : '正在重连'}</Badge><Button asChild variant="ghost" size="sm" className="hidden h-7 gap-1 px-0 text-[10px] font-normal text-muted-foreground hover:bg-transparent hover:text-foreground sm:inline-flex"><a href={imageMode ? "https://ark.volcengine.com/region:cn-beijing/docs/seedream-5-5" : "https://ark.volcengine.com/region:cn-beijing/docs/seedance-2-5"} target="_blank" rel="noreferrer">使用指南<ArrowUpRight className="!size-3" /></a></Button></div>
      </header>
      {studio.conversation ? <>
        <ScrollArea ref={scrollRoot} className="min-h-0 flex-1" onScrollCapture={event => { const node = event.target as HTMLElement; nearBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 150; }}>
          <section id="timeline" className="mx-auto flex w-full max-w-[930px] flex-col gap-9 px-4 py-6 sm:px-10" aria-label="当前对话">{studio.conversation.runs.map(run => run.kind === 'image' ? <ImageRunCard key={run.id} run={run} onReuse={studio.reuse} onEdit={studio.editImage} /> : <RunCard key={run.id} run={run} onReuse={studio.reuse} onRecover={run => openAction({ type: 'recover', run })} />)}</section>
        </ScrollArea>
        <div className="shrink-0 px-3 pb-4 pt-2 sm:px-8 sm:pb-5"><Composer studio={studio} /></div>
      </> : <ScrollArea className="min-h-0 flex-1">
        <main className="home-canvas mx-auto flex min-h-[calc(100svh-68px)] w-full max-w-[930px] flex-col px-4 pb-5 pt-11 sm:px-10 sm:pt-14 lg:pt-[8vh]">
          <section className="mb-8 text-center sm:mb-10"><p className="mb-5 flex items-center justify-center gap-2.5 text-[9px] tracking-[.2em] text-muted-foreground"><Sparkles className="size-3.5 text-primary/80" />{imageMode ? 'YOUR IDEAS. IN FRAME.' : 'YOUR IDEAS. IN MOTION.'}</p><h1 className="text-[27px] font-medium tracking-tight sm:text-[36px]">今天，想创造点什么？</h1><p className="mt-4 text-xs tracking-wide text-muted-foreground">{imageMode ? '从一个想法开始，把想象变成看得见的画面。' : '从一个想法开始，让每一帧都属于你。'}</p></section>
          <Composer studio={studio} />
          <section className="mx-auto mt-9 w-full max-w-[850px]" aria-labelledby="inspiration-title"><div className="mb-4 flex items-center justify-between gap-3"><h2 id="inspiration-title" className="text-xs font-medium sm:text-[13px]">你的下一部作品，从这里开始</h2><span className="flex shrink-0 items-center gap-1 text-[9px] text-muted-foreground sm:text-[10px]">试试这些创意<ArrowUpRight className="size-3" /></span></div><div className="grid grid-cols-3 gap-2.5 sm:gap-4">{inspiration.map((preset, index) => <Button key={preset.id} variant="ghost" onClick={() => studio.updateDraft(previous => normalizeDraft({ ...previous, prompt: preset.prompt, assets: [], model: previous.model, parameters: { ...defaults, duration: preset.duration } }, studio.snapshot.config.models))} className="group block h-auto min-w-0 whitespace-normal rounded-lg p-0 text-left font-normal hover:bg-transparent" aria-label={`使用创意：${preset.title}`}>
            <Card className="overflow-hidden rounded-lg border-border/70 shadow-none"><CardContent className="relative p-0"><img src={preset.image} alt={preset.title} className="aspect-[1.3] w-full object-cover saturate-[.65] transition-[filter,transform] duration-300 group-hover:scale-[1.03] group-hover:saturate-100 sm:aspect-[1.95]" /><span className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" /><span className="absolute bottom-2.5 left-2.5 text-[8px] font-normal text-white/80 sm:text-[10px]">{preset.category}</span></CardContent></Card><span className="mt-3 flex items-center justify-between gap-1 px-0.5 text-[10px] sm:text-xs">{preset.title}<span className="hidden text-[9px] text-muted-foreground/60 sm:inline">0{index + 1}</span></span><span className="mt-1.5 hidden px-0.5 text-[10px] text-muted-foreground sm:block">{preset.description}</span>
          </Button>)}</div></section>
          <footer className="mt-auto flex justify-between gap-3 pt-10 text-[7px] tracking-[.16em] text-muted-foreground/50 sm:pt-12 sm:text-[8px]"><span>IMAGINE IT. MAKE IT MOVE.</span><span>SEEDANCE & SEEDREAM</span></footer>
        </main>
      </ScrollArea>}
    </SidebarInset>
    <SettingsDialog open={studio.settingsOpen} onOpenChange={studio.setSettingsOpen} config={studio.snapshot.config} onSave={studio.applyConfig} />
    <Dialog open={Boolean(action)} onOpenChange={open => { if (!open && !actionBusy) setAction(null); }}><DialogContent className="max-w-[430px] rounded-xl bg-card"><DialogHeader className="text-left"><DialogTitle className="text-lg font-medium">{action?.type === 'rename' ? '给灵感起个名字' : '恢复已有任务'}</DialogTitle><DialogDescription className="pt-1 text-xs leading-6">{action?.type === 'rename' ? '一个好名字，让下一次寻找更容易。' : '从方舟控制台复制这次生成的任务 ID，恢复追踪不会重新提交生成。'}</DialogDescription></DialogHeader><form onSubmit={e => { e.preventDefault(); void submitAction(); }} className="space-y-4"><Label htmlFor="action-input" className="sr-only">{action?.type === 'rename' ? '会话名称' : '任务 ID'}</Label><Input id="action-input" autoComplete="off" value={actionValue} onChange={e => setActionValue(e.target.value)} placeholder={action?.type === 'recover' ? 'cgt-…' : ''} className="bg-background/50 text-xs" autoFocus />{actionError ? <p role="alert" className="text-xs text-destructive">{actionError}</p> : null}<DialogFooter className="flex-row justify-end gap-2"><Button type="button" variant="outline" size="sm" onClick={() => setAction(null)} disabled={actionBusy}>取消</Button><Button id="action-confirm" type="submit" size="sm" disabled={actionBusy}>{actionBusy ? <LoaderCircle className="animate-spin" /> : null}{action?.type === 'rename' ? '保存名称' : '恢复追踪'}</Button></DialogFooter></form></DialogContent></Dialog>
    <AlertDialog open={Boolean(deleting)} onOpenChange={open => { if (!open && !deleteBusy) setDeleting(null); }}><AlertDialogContent className="max-w-[430px] rounded-xl bg-card"><AlertDialogHeader className="text-left"><AlertDialogTitle className="text-lg font-medium">删除这段创作记录？</AlertDialogTitle><AlertDialogDescription className="text-xs leading-6">会话将从侧边栏移除，已保存到本机的图片和视频文件会保留。</AlertDialogDescription></AlertDialogHeader>{deleteError ? <p role="alert" className="text-xs text-destructive">{deleteError}</p> : null}<AlertDialogFooter className="flex-row justify-end gap-2"><AlertDialogCancel disabled={deleteBusy} className="mt-0 h-8 text-xs">取消</AlertDialogCancel><AlertDialogAction id="delete-confirm" disabled={deleteBusy} className="h-8 bg-destructive/85 text-xs text-destructive-foreground hover:bg-destructive" onClick={async event => { event.preventDefault(); if (!deleting) return; setDeleteBusy(true); try { await studio.remove(deleting.id); setDeleting(null); } catch (error) { setDeleteError(errorMessage(error)); } finally { setDeleteBusy(false); } }}>删除会话</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
    <Toaster theme={theme} position="bottom-center" closeButton duration={4500} />
  </SidebarProvider>;
}

class ErrorBoundary extends Component<{ children: ReactNode }, { error: boolean }> {
  state = { error: false };
  static getDerivedStateFromError() { return { error: true }; }
  componentDidCatch(error: Error, info: ErrorInfo) { console.error('界面加载失败', error.message, info.componentStack); }
  render() { return this.state.error ? <div className="grid min-h-svh place-items-center bg-background p-6"><Card className="max-w-sm"><CardContent className="space-y-4 p-6"><h1 className="text-lg">界面暂时无法加载</h1><p className="text-sm text-muted-foreground">创作记录仍保存在本机。刷新页面后可继续。</p><Button onClick={() => location.reload()}>刷新页面</Button></CardContent></Card></div> : this.props.children; }
}
export default function App() { return <ErrorBoundary><Workspace /></ErrorBoundary>; }
