// src/components/inventory/CatalogueKit.tsx
//
// The building blocks of every catalogue list (§76): search box, filter
// chips, a tappable row, icon and swatch tiles, the empty line and the
// "+ New" button. One set, so every section looks and behaves alike.

import type { ReactNode } from 'react';
import { Box, ChevronRight, Plus, Search } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { useLayoutStore } from '../../store/layoutStore';
import { finishSwatch } from '../../lib/designFinishes';
import { cn } from '@/lib/utils';

// ---- Shared list pieces ----

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <label className="flex h-11 min-w-0 flex-[1_1_260px] items-center gap-2 rounded-[10px] border border-input bg-card px-3 text-muted-foreground">
      <Search className="size-[18px] shrink-0" />
      <Input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-auto border-0 bg-transparent p-0 text-[15px] shadow-none focus-visible:ring-0"
      />
    </label>
  );
}

export function Chips({ options, value, onChange }: { options: string[]; value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => (
        <button
          key={o}
          type="button"
          aria-pressed={value === o}
          onClick={() => onChange(o)}
          className={cn(
            'h-9 rounded-full px-3.5 text-sm font-semibold',
            value === o ? 'bg-foreground text-background' : 'bg-secondary text-muted-foreground hover:text-foreground'
          )}
        >
          {o}
        </button>
      ))}
    </div>
  );
}

// One row of a catalogue list: an icon/picture, name and detail on the
// left, facts in the middle (laptop), the price and a chevron on the
// right. The whole row is the button that opens the editor.
export function ListRow({
  media,
  title,
  sub,
  facts,
  end,
  onClick,
}: {
  media: ReactNode;
  title: string;
  sub: string;
  facts?: ReactNode;
  end?: ReactNode;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-3.5 border-b border-secondary px-1 py-3 text-left transition-colors last:border-b-0 hover:bg-background md:px-2"
    >
      {media}
      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold">{title}</div>
        <div className="truncate text-[13px] text-muted-foreground">{sub}</div>
      </div>
      {facts && <div className="hidden items-center gap-6 text-sm text-muted-foreground lg:flex">{facts}</div>}
      {end}
      <ChevronRight className="size-5 shrink-0 text-muted-foreground" />
    </button>
  );
}

export function IconTile({ Icon }: { Icon: typeof Box }) {
  return (
    <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-secondary text-muted-foreground">
      <Icon className="size-5" strokeWidth={1.7} />
    </div>
  );
}

export function SwatchTile({ finishId }: { finishId: string }) {
  const finish = useLayoutStore((s) => s.finishes.find((f) => f.id === finishId));
  const sw = finishSwatch(finish);
  return (
    <div className="size-11 shrink-0 overflow-hidden rounded-xl bg-secondary ring-1 ring-border">
      {sw?.image ? (
        <img src={sw.image} alt="" className="size-full object-cover" />
      ) : sw?.color ? (
        <div className="size-full" style={{ backgroundColor: sw.color }} />
      ) : (
        <Box className="m-3 size-5 text-muted-foreground" strokeWidth={1.7} />
      )}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="py-8 text-center text-[15px] text-muted-foreground">{children}</p>;
}

export function NewButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <Button size="touch" onClick={onClick}>
      <Plus /> {label}
    </Button>
  );
}

