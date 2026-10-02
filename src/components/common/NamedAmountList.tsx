// src/components/common/NamedAmountList.tsx
//
// An editable list of { label, amount } rows with add/remove. Shared by
// the rate card's itemised "others" rates (RateCardManager — a ₹ rate
// with a per-row basis) and a project's hand-entered lump sums
// (QuoteSidebar — a flat ₹ amount), which are the same editing job on
// differently-named fields. Callers map their own shape to `value` and
// back, so neither data type has to rename a field to fit this.
//
// `choices` is optional: when given, every row gets a small segmented
// picker (the rate card uses it for per sq ft / per cabinet / lump
// sum), and a new row starts on `defaultChoice`. `flagOptions` is
// optional too: one checkbox per option on every row (the rate card
// passes "Show on quote"; a project's own list adds "Add margin"), a
// new row starting on each option's `defaultValue`.

import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Label } from '../ui/label';
import { Checkbox } from '../ui/checkbox';

export interface NamedAmountRow {
  id: string;
  label: string;
  value: number;
  choice?: string;
  flags?: Record<string, boolean>;
}

export interface NamedAmountFlag {
  key: string;
  label: string;
  defaultValue: boolean;
}

export interface NamedAmountChoice {
  value: string;
  label: string;
}

export function NamedAmountList({
  title,
  rows,
  onChange,
  labelPlaceholder,
  inputClassName = '',
  choices,
  defaultChoice,
  flagOptions,
}: {
  title?: string;
  rows: NamedAmountRow[];
  onChange: (rows: NamedAmountRow[]) => void;
  labelPlaceholder: string;
  inputClassName?: string;
  choices?: NamedAmountChoice[];
  defaultChoice?: string;
  flagOptions?: NamedAmountFlag[];
}) {
  const update = (id: string, patch: Partial<NamedAmountRow>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  return (
    <div className="flex flex-col gap-2">
      {title && <span className="text-[11px] font-medium text-gray-500">{title}</span>}
      {rows.length === 0 && <p className="text-[11px] text-gray-400">Nothing here yet.</p>}
      {/* Keyed by id, not index, so deleting a middle row doesn't hand
          its neighbour's half-typed label to React's reused input. */}
      {rows.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center gap-2">
          <Input
            aria-label="Name"
            placeholder={labelPlaceholder}
            value={r.label}
            onChange={(e) => update(r.id, { label: e.target.value })}
            className={`min-w-32 flex-1 ${inputClassName}`}
          />
          {choices && (
            <div role="radiogroup" aria-label="Charged" className="flex gap-1">
              {choices.map((c) => (
                <Button
                  key={c.value}
                  type="button"
                  role="radio"
                  aria-checked={r.choice === c.value}
                  variant={r.choice === c.value ? 'secondary' : 'ghost'}
                  size="xs"
                  onClick={() => update(r.id, { choice: c.value })}
                >
                  {r.choice === c.value ? '✓ ' : ''}
                  {c.label}
                </Button>
              ))}
            </div>
          )}
          <Input
            aria-label="Amount"
            type="number"
            min={0}
            step={1}
            value={r.value}
            onChange={(e) => update(r.id, { value: Number(e.target.value) })}
            className={`w-24 text-right ${inputClassName}`}
          />
          {flagOptions?.map((f) => (
            <Label
              key={f.key}
              className="flex items-center gap-1.5 text-[11px] font-normal text-gray-600"
            >
              <Checkbox
                checked={r.flags?.[f.key] ?? f.defaultValue}
                onCheckedChange={(checked) =>
                  update(r.id, { flags: { ...r.flags, [f.key]: checked === true } })
                }
              />
              {f.label}
            </Label>
          ))}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Remove ${r.label || 'row'}`}
            onClick={() => onChange(rows.filter((x) => x.id !== r.id))}
          >
            ✕
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="xs"
        className="self-start"
        onClick={() =>
          onChange([
            ...rows,
            {
              id: crypto.randomUUID(),
              label: '',
              value: 0,
              choice: defaultChoice,
              flags: Object.fromEntries((flagOptions ?? []).map((f) => [f.key, f.defaultValue])),
            },
          ])
        }
      >
        + Add
      </Button>
    </div>
  );
}
