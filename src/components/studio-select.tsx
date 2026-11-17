import type { LucideIcon } from 'lucide-react';
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';

type Option = { value: string; label: string; disabled?: boolean };
type Props = {
  id: string; label: string; value: string; options: Option[]; onChange: (value: string) => void;
  disabled?: boolean; icon?: LucideIcon; className?: string; compact?: boolean; groupLabel?: string;
};
export function StudioSelect({ id, label, value, options, onChange, disabled, icon: Icon, className, compact, groupLabel }: Props) {
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger id={id} aria-label={label} className={cn('gap-2 text-xs focus:ring-ring/50', compact && 'h-8 w-auto min-w-0 shrink-0 gap-1 border-transparent bg-transparent px-1.5 shadow-none hover:bg-accent [&>svg:last-child]:size-3 sm:gap-2 sm:px-2', className)}>
        {Icon ? <Icon className="size-3.5 shrink-0 text-muted-foreground" /> : null}
        <SelectValue placeholder={label} />
      </SelectTrigger>
      <SelectContent position="popper" sideOffset={5} collisionPadding={12} className="max-h-[min(18rem,var(--radix-select-content-available-height))] min-w-36 border-border/80 p-1 shadow-xl">
        <SelectGroup>
          {groupLabel ? <SelectLabel className="px-2 py-2 text-[10px] font-medium text-muted-foreground">{groupLabel}</SelectLabel> : null}
          {options.map(option => <SelectItem key={option.value} value={option.value} disabled={option.disabled} className="cursor-pointer rounded-md py-2 text-xs">{option.label}</SelectItem>)}
        </SelectGroup>
      </SelectContent>
    </Select>
  );
}
