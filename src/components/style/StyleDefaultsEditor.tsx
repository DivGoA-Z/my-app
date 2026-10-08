// src/components/style/StyleDefaultsEditor.tsx
//
// Edits a set of kitchen style defaults (§117): base / wall / tall, each
// with a finish, colour, handle and carcass board. The same editor serves
// the kitchen ("Style" in the editor's top bar) and the business (the
// Catalogue page); the host decides what a change does. Any field can be
// left as "no default", which keeps each catalogue item's own value.

import { useState } from 'react';
import { Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLayoutStore } from '../../store/layoutStore';
import { finishSwatch } from '../../lib/designFinishes';
import { boardLabel } from '../../types/rates';
import {
  CABINET_GROUP_LABELS,
  styleFor,
  type CabinetGroup,
  type CabinetStyle,
  type StyleDefaults,
} from '../../lib/styleDefaults';
import { ColorPicker } from '../common/ColorPicker';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Label } from '../ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';

const NONE = '__none__';
const GROUPS: CabinetGroup[] = ['base', 'wall', 'tall'];

export function StyleDefaultsEditor({
  value,
  onChange,
}: {
  value: StyleDefaults;
  onChange: (next: StyleDefaults) => void;
}) {
  const [group, setGroup] = useState<CabinetGroup>('base');
  const tallSameAsBase = value.tall === undefined;
  const style = styleFor(value, group);
  const editable = !(group === 'tall' && tallSameAsBase);

  function setStyle(next: CabinetStyle) {
    onChange({ ...value, [group]: next });
  }

  return (
    <div className="flex flex-col gap-4">
      <div role="tablist" aria-label="Cabinet group" className="flex rounded-xl bg-secondary p-1">
        {GROUPS.map((g) => (
          <button
            key={g}
            type="button"
            role="tab"
            aria-selected={group === g}
            onClick={() => setGroup(g)}
            className={cn(
              'h-9 flex-1 rounded-[9px] px-3 text-sm font-semibold',
              group === g ? 'bg-foreground text-background' : 'text-muted-foreground hover:text-foreground'
            )}
          >
            {CABINET_GROUP_LABELS[g]}
          </button>
        ))}
      </div>

      {group === 'tall' && (
        <Label className="flex items-center gap-2.5 text-sm font-medium">
          <Checkbox
            checked={tallSameAsBase}
            onCheckedChange={(on) => onChange({ ...value, tall: on ? undefined : { ...value.base } })}
          />
          Same as the base cabinets
        </Label>
      )}

      <fieldset disabled={!editable} className={cn('flex flex-col gap-4', !editable && 'opacity-50')}>
        <FinishField value={style.finishId} onChange={(finishId) => setStyle({ ...style, finishId })} />
        <ColourField value={style.colorOverride} onChange={(colorOverride) => setStyle({ ...style, colorOverride })} />
        <HandleField value={style.handleId} onChange={(handleId) => setStyle({ ...style, handleId })} />
        <BoardField
          value={style.carcassBoardId}
          onChange={(board) => setStyle({ ...style, carcassBoardId: board?.id, material: board?.material })}
        />
      </fieldset>
    </div>
  );
}

function FinishField({ value, onChange }: { value?: string; onChange: (id: string | undefined) => void }) {
  const finishes = useLayoutStore((s) => s.finishes);
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[13px] font-semibold">Finish</span>
        {value && (
          <Button variant="link" size="sm" className="h-auto p-0 text-[13px]" onClick={() => onChange(undefined)}>
            No default
          </Button>
        )}
      </div>
      {!value && <span className="text-xs text-muted-foreground">No default: each cabinet keeps its catalogue item&rsquo;s finish.</span>}
      <div role="radiogroup" aria-label="Default finish" className="grid grid-cols-4 gap-1.5">
        {finishes.map((f) => {
          const sw = finishSwatch(f);
          const on = f.id === value;
          const name = f.brand ? `${f.brand} ${f.label}` : f.label;
          return (
            <button
              key={f.id}
              type="button"
              role="radio"
              aria-checked={on}
              title={name}
              onClick={() => onChange(f.id)}
              className={cn(
                'flex flex-col gap-1 rounded-lg border p-1 text-left',
                on ? 'border-primary ring-2 ring-primary' : 'border-border hover:border-primary/60'
              )}
            >
              <span
                className="relative block aspect-square w-full rounded-md border border-black/5 bg-cover bg-center"
                style={sw?.image ? { backgroundImage: `url(${sw.image})` } : { backgroundColor: sw?.color ?? '#dcd7cf' }}
              >
                {on && (
                  <span className="absolute top-0.5 right-0.5 flex size-4 items-center justify-center rounded-full bg-primary text-primary-foreground">
                    <Check className="size-3" />
                  </span>
                )}
              </span>
              <span className="line-clamp-2 text-[11px] leading-tight font-medium">{name}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function ColourField({ value, onChange }: { value?: string | null; onChange: (v: string | null | undefined) => void }) {
  const [picking, setPicking] = useState(false);
  const mode = value === undefined ? 'none' : value === null ? 'finish' : 'custom';
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[13px] font-semibold">Colour</span>
      <div role="radiogroup" aria-label="Default colour" className="grid grid-cols-3 gap-1.5">
        {(
          [
            ['none', 'No default'],
            ['finish', 'Finish’s own'],
            ['custom', 'Custom'],
          ] as const
        ).map(([m, label]) => (
          <Button
            key={m}
            role="radio"
            aria-checked={mode === m}
            variant={mode === m ? 'default' : 'outline'}
            size="sm"
            onClick={() => {
              if (m === 'none') onChange(undefined);
              else if (m === 'finish') onChange(null);
              else {
                if (mode !== 'custom') onChange('#c08a4e');
                setPicking(true);
              }
            }}
          >
            {m === 'custom' && mode === 'custom' && (
              <span className="size-3.5 rounded-sm border border-black/10" style={{ backgroundColor: value! }} />
            )}
            {label}
          </Button>
        ))}
      </div>
      {mode === 'custom' && picking && (
        <div className="rounded-xl border border-border bg-card p-2.5">
          <ColorPicker value={value!} onChange={onChange} />
        </div>
      )}
    </div>
  );
}

function HandleField({ value, onChange }: { value?: string; onChange: (id: string | undefined) => void }) {
  const handles = useLayoutStore((s) => s.handles);
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
      Handle
      <Select value={value ?? NONE} onValueChange={(v) => onChange(v === NONE ? undefined : v)}>
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No default</SelectItem>
          {handles.map((h) => (
            <SelectItem key={h.id} value={h.id}>
              {h.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}

function BoardField({
  value,
  onChange,
}: {
  value?: string;
  onChange: (board: { id: string; material: CabinetStyle['material'] } | undefined) => void;
}) {
  const boards = useLayoutStore((s) => s.rateCard.boards);
  return (
    <label className="flex flex-col gap-1.5 text-[13px] font-semibold">
      Carcass board
      <Select
        value={value ?? NONE}
        onValueChange={(v) => {
          const b = boards.find((x) => x.id === v);
          onChange(b ? { id: b.id, material: b.material } : undefined);
        }}
      >
        <SelectTrigger className="w-full">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE}>No default</SelectItem>
          {boards.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {boardLabel(b)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </label>
  );
}
