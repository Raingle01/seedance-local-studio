import { Moon, Sun } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { ResolvedTheme } from '@/lib/theme';

export function ThemeToggle({ resolved, onToggle }: { resolved: ResolvedTheme; onToggle: () => void }) {
  const isDark = resolved === 'dark';
  const label = isDark ? '切换到白天模式' : '切换到夜间模式';
  return (
    <Button variant="ghost" size="icon" onClick={onToggle} aria-label={label} title={label} className="size-8 text-muted-foreground hover:text-foreground">
      {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
    </Button>
  );
}
