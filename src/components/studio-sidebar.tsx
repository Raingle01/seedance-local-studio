import { ArrowUpRight, Film, MessageSquare, MoreHorizontal, Pencil, Plus, Search, Settings2, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Separator } from '@/components/ui/separator';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarGroupLabel, SidebarHeader, SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem, useSidebar } from '@/components/ui/sidebar';
import { activeStatuses } from '@/lib/studio';
import type { Conversation } from '@/types';
import type { Studio } from '@/hooks/use-studio';

function dateGroup(iso: string) {
  const date = new Date(iso), today = new Date();
  if (date.toDateString() === today.toDateString()) return '今天';
  today.setDate(today.getDate() - 1);
  return date.toDateString() === today.toDateString() ? '昨天' : '更早的创作';
}
type Props = { studio: Studio; search: string; onSearch: (value: string) => void; onRename: (c: Conversation) => void; onDelete: (c: Conversation) => void };
export function StudioSidebar({ studio, search, onSearch, onRename, onDelete }: Props) {
  const { setOpenMobile } = useSidebar();
  const conversations = [...studio.snapshot.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).filter(c => !search || [c.title, ...c.runs.map(r => r.prompt)].some(text => text.toLocaleLowerCase().includes(search.toLocaleLowerCase())));
  const groups = new Map<string, Conversation[]>();
  for (const c of conversations) { const label = dateGroup(c.updatedAt); groups.set(label, [...(groups.get(label) || []), c]); }
  function select(id: string | null) { studio.selectConversation(id); setOpenMobile(false); }
  return (
    <Sidebar className="border-sidebar-border" aria-label="创作记录">
      <SidebarHeader className="gap-5 px-4 pb-3 pt-7">
        <Button variant="ghost" onClick={() => select(null)} aria-label="即刻首页" className="h-auto w-fit justify-start gap-3 px-2 py-0 hover:bg-transparent">
          <img src="/assets/mark.svg" alt="" className="size-8" /><span className="text-[22px] font-semibold tracking-wide">即刻</span><span className="pt-1 text-[8px] tracking-[.2em] text-muted-foreground">STUDIO</span>
        </Button>
        <Button id="new-chat" variant="secondary" onClick={() => select(null)} className="h-10 justify-start gap-2.5 border border-border/60 bg-secondary/80 text-xs shadow-none"><Plus className="size-4" />开启新创作<ArrowUpRight className="ml-auto size-3.5 text-muted-foreground" /></Button>
        <div className="flex items-center gap-2.5 rounded-md border border-primary/15 bg-primary/6 px-3 py-2.5 text-xs"><Film className="size-4 text-primary" /><span>创作工作台</span><Badge variant="outline" className="ml-auto border-transparent p-0 text-[7px] font-normal tracking-wider text-muted-foreground">IMAGE & VIDEO</Badge></div>
      </SidebarHeader>
      <SidebarContent className="gap-0 px-2">
        <SidebarGroup className="pb-1">
          <SidebarGroupLabel className="mb-2 flex justify-between text-[11px]">创作记录<span id="history-count" className="text-[10px] tabular-nums">{studio.snapshot.conversations.length}</span></SidebarGroupLabel>
          <div className="relative px-1"><Search className="pointer-events-none absolute left-3.5 top-2.5 size-3.5 text-muted-foreground" /><Input id="history-search" aria-label="搜索会话" placeholder="搜索你的灵感" value={search} onChange={e => onSearch(e.target.value)} className="h-9 border-transparent bg-transparent pl-9 text-xs shadow-none placeholder:text-muted-foreground/70 focus-visible:border-border focus-visible:ring-0" /></div>
        </SidebarGroup>
        {!conversations.length ? <div className="mx-3 mt-16 flex flex-col items-center text-center text-muted-foreground"><MessageSquare className="mb-4 size-6 opacity-40" /><p className="text-xs">{search ? '还没有找到这份灵感' : '故事，从这里开始'}</p><p className="mt-2 text-[10px] text-muted-foreground/65">{search ? '换个关键词试试' : '你的每一次创作，都会留在这里'}</p></div> : null}
        {[...groups].map(([label, records]) => <SidebarGroup key={label} className="py-1"><SidebarGroupLabel className="text-[10px] text-muted-foreground/70">{label}</SidebarGroupLabel><SidebarGroupContent><SidebarMenu>
          {records.map(c => <SidebarMenuItem key={c.id}>
            <SidebarMenuButton className="h-10 gap-2.5 px-3 text-xs data-[active=true]:bg-primary/10 data-[active=true]:text-foreground" isActive={c.id === studio.activeId} onClick={() => select(c.id)} title={c.title}><MessageSquare className="text-muted-foreground" /><span>{c.title}</span>{c.runs.some(r => activeStatuses.has(r.status)) ? <span className="ml-auto size-1.5 shrink-0 animate-pulse rounded-full bg-primary" aria-label="正在生成" /> : null}</SidebarMenuButton>
            <DropdownMenu><DropdownMenuTrigger asChild><SidebarMenuAction className="top-2" showOnHover aria-label={`管理会话 ${c.title}`}><MoreHorizontal /></SidebarMenuAction></DropdownMenuTrigger><DropdownMenuContent side="right" align="start" className="min-w-36"><DropdownMenuItem onSelect={() => onRename(c)} className="gap-2 text-xs"><Pencil className="size-3.5" />重命名</DropdownMenuItem><DropdownMenuItem onSelect={() => onDelete(c)} className="gap-2 text-xs text-destructive focus:text-destructive"><Trash2 className="size-3.5" />删除会话</DropdownMenuItem></DropdownMenuContent></DropdownMenu>
          </SidebarMenuItem>)}
        </SidebarMenu></SidebarGroupContent></SidebarGroup>)}
      </SidebarContent>
      <SidebarFooter className="gap-4 px-4 pb-5 pt-4">
        <Separator className="bg-border/60" />
        <Button id="open-settings" variant="ghost" onClick={() => { setOpenMobile(false); studio.setSettingsOpen(true); }} className="h-auto justify-start gap-3 px-2 py-2 text-left"><span className="rounded-lg border border-border p-2"><Settings2 className="size-4 text-muted-foreground" /></span><span className="space-y-1"><span className="block text-xs font-normal">工作台设置</span><span className="block text-[10px] font-normal text-muted-foreground">{studio.snapshot.config.hasApiKey ? 'API Key 已配置' : '连接你的 API Key'}</span></span></Button>
        <div className="flex items-center gap-1.5 px-2 text-[9px] text-muted-foreground/70"><span className="size-1 rounded-full bg-emerald-500 dark:bg-emerald-400/50" />创作记录保存在本机<span className="ml-auto text-[8px]">v2.0</span></div>
      </SidebarFooter>
    </Sidebar>
  );
}
