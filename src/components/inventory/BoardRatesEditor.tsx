// src/components/inventory/BoardRatesEditor.tsx
//
// The rate card's board lines (RateCard.boards — types/rates.ts): one
// row per board the business buys, material + thickness + ₹/m², and the
// business-wide default back board. Lives in its own file because it is
// the only rate-card section with a picker inside each row; the rest of
// RateCardManager is flat number inputs.
//
// A new line gets crypto.randomUUID() HERE, at the moment a person adds
// it — that's fine, it's saved with that id and never regenerated. The
// fingerprint trap (§35) is only about ids generated on every LOAD.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { useLayoutStore } from '../../store/layoutStore';
import { findBoardUsage, type BoardUsage } from '../../lib/boardUsage';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import {
  MATERIAL_RATE_KEYS,
  MATERIAL_RATE_LABELS,
  boardLabel,
  type BoardRate,
} from '../../types/rates';
import type { MaterialType } from '../../types/cabinet';
import { DEFAULT_SHEET_SIZE, type SheetSize } from '../../types/rates';
import { defaultCarcassBoard } from '../../lib/panels';

export function BoardRatesEditor({
  boards,
  defaultBackBoardId,
  onChange,
}: {
  boards: BoardRate[];
  defaultBackBoardId: string;
  onChange: (boards: BoardRate[], defaultBackBoardId: string) => void;
}) {
  const catalogue = useLayoutStore((s) => s.cabinetCatalog);
  const currentProject = useLayoutStore((s) => s.currentProject);
  const cabinets = useLayoutStore((s) => s.cabinets);
  const looseParts = useLayoutStore((s) => s.currentLayout?.looseParts);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ board: string; usage: BoardUsage } | null>(null);

  // Your rule: a board line anything is cut from can't be removed — the
  // business is told where it's used instead. Checked against the
  // boards as they are NOW (before removal), because that's what decides
  // which line each cabinet currently resolves to.
  async function tryRemove(board: BoardRate) {
    setCheckingId(board.id);
    setBlocked(null);
    try {
      const usage = await findBoardUsage(
        board.id,
        { boards, defaultBackBoardId },
        catalogue,
        currentProject
          ? { id: currentProject.id, name: currentProject.clientName, cabinets, looseParts: looseParts ?? [] }
          : null
      );
      if (usage.projectNames.length > 0 || usage.catalogueLabels.length > 0) {
        setBlocked({ board: boardLabel(board), usage });
        return;
      }
      onChange(
        boards.filter((x) => x.id !== board.id),
        defaultBackBoardId
      );
    } catch (err) {
      toast.error("Couldn't remove the board", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setCheckingId(null);
    }
  }

  const update = (id: string, patch: Partial<BoardRate>) =>
    onChange(
      boards.map((b) => (b.id === id ? { ...b, ...patch } : b)),
      defaultBackBoardId
    );

  return (
    <div className="flex flex-col gap-3">
      {/* One card per board line (§77): material, thickness and rate on
          top, its sheet sizes underneath. */}
      {boards.map((b) => (
        <div key={b.id} className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 md:p-4">
          <div className="flex flex-wrap items-end gap-2">
            <label className="flex min-w-0 flex-[1_1_200px] flex-col gap-1.5 text-[13px] font-semibold">
              Material
              <Select value={b.material} onValueChange={(v) => update(b.id, { material: v as MaterialType })}>
                <SelectTrigger className="h-11! w-full min-w-0 rounded-[10px] bg-card text-[15px] font-medium [&>span]:truncate">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {MATERIAL_RATE_KEYS.map((m) => (
                    <SelectItem key={m} value={m}>
                      {MATERIAL_RATE_LABELS[m]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
            <label className="flex w-28 flex-col gap-1.5 text-[13px] font-semibold">
              Thickness
              <span className="flex h-11 items-center gap-1.5 rounded-[10px] border border-input bg-card px-3">
                <Input
                  aria-label="Thickness in mm"
                  type="number"
                  min={1}
                  step={1}
                  value={b.thicknessMm}
                  onChange={(e) => update(b.id, { thicknessMm: Number(e.target.value) })}
                  className="h-auto min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[15px] shadow-none focus-visible:ring-0"
                />
                <span className="text-sm font-normal text-muted-foreground">mm</span>
              </span>
            </label>
            <label className="flex w-40 flex-col gap-1.5 text-[13px] font-semibold">
              Rate
              <span className="flex h-11 items-center gap-1.5 rounded-[10px] border border-input bg-card px-3">
                <span className="text-sm font-normal text-muted-foreground">₹</span>
                <Input
                  aria-label="Rate per square metre"
                  type="number"
                  min={0}
                  step={1}
                  value={b.ratePerSqM}
                  onChange={(e) => update(b.id, { ratePerSqM: Number(e.target.value) })}
                  className="h-auto min-w-0 border-0 bg-transparent p-0 text-right font-mono text-[15px] shadow-none focus-visible:ring-0"
                />
                <span className="text-sm font-normal text-muted-foreground">/m²</span>
              </span>
            </label>
            {/* The default back board can't be removed from here — pick a
                different default first. Otherwise every back would
                silently lose its board. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-touch"
              aria-label={`Remove ${boardLabel(b)}`}
              disabled={b.id === defaultBackBoardId || checkingId !== null}
              title={b.id === defaultBackBoardId ? 'This is the default back board — choose another default first' : undefined}
              onClick={() => tryRemove(b)}
              className="text-muted-foreground hover:text-destructive"
            >
              {checkingId === b.id ? '…' : '✕'}
            </Button>
          </div>
          <SheetSizesEditor sizes={b.sheetSizes ?? []} onChange={(sheetSizes) => update(b.id, { sheetSizes })} />
        </div>
      ))}
      {blocked && (
        <Alert className="border-warning/30 bg-warning-soft">
          <AlertDescription className="text-warning-foreground">
            <strong className="font-semibold">{blocked.board} can't be removed — it's in use.</strong>
            {blocked.usage.projectNames.length > 0 && (
              <> Used in project{blocked.usage.projectNames.length === 1 ? '' : 's'}:{' '}
                {blocked.usage.projectNames.join(', ')}.</>
            )}
            {blocked.usage.catalogueLabels.length > 0 && (
              <> Used by catalogue item{blocked.usage.catalogueLabels.length === 1 ? '' : 's'}:{' '}
                {blocked.usage.catalogueLabels.join(', ')}.</>
            )}{' '}
            Move those cabinets to another board first (or, if it's their material's default
            carcass board, add the replacement line before removing this one).
          </AlertDescription>
        </Alert>
      )}

      <Button
        type="button"
        variant="outline"
        size="touch"
        className="self-start"
        onClick={() =>
          onChange(
            [...boards, { id: crypto.randomUUID(), material: 'HDMR', thicknessMm: 18, ratePerSqM: 0 }],
            defaultBackBoardId
          )
        }
      >
        + Add board
      </Button>

      {/* Makes the "thickest line of its material" default VISIBLE where
          it can go wrong. Found by running the pricing: delete "HDMR
          18mm" and every HDMR cabinet silently becomes a 6mm carcass —
          on the price AND the cutting list — because a board was still
          found. Showing the resolved carcass board per material, live,
          means that edit can't happen unseen. */}
      <div className="rounded-xl bg-secondary px-4 py-3 text-[13px] leading-relaxed text-muted-foreground">
        <span className="font-semibold text-foreground">Carcass board for cabinets with no board chosen: </span>
        {MATERIAL_RATE_KEYS.map((m, i) => {
          const board = defaultCarcassBoard(boards, m);
          return (
            <span key={m} className={board && board.thicknessMm < 12 ? 'font-medium text-destructive' : undefined}>
              {i > 0 ? ' · ' : ''}
              {MATERIAL_RATE_LABELS[m]} → {board ? `${board.thicknessMm}mm` : 'none'}
            </span>
          );
        })}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-secondary pt-3">
        <span className="flex flex-col">
          <span className="text-[15px] font-medium">Default back board</span>
          <span className="text-[13px] text-muted-foreground">What every cabinet's back is cut from</span>
        </span>
        <Select value={defaultBackBoardId} onValueChange={(v) => onChange(boards, v)}>
          <SelectTrigger className="h-11! w-56 rounded-[10px] bg-card text-[15px] font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {boards.map((b) => (
              <SelectItem key={b.id} value={b.id}>
                {boardLabel(b)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
    </div>
  );
}

// The sizes one board line is bought in (BoardRate.sheetSizes, §52) —
// any number, so one board can come in several. Shown as removable chips
// plus a small add box; empty means the 8×4 default, said so in grey.
function SheetSizesEditor({ sizes, onChange }: { sizes: SheetSize[]; onChange: (sizes: SheetSize[]) => void }) {
  const [length, setLength] = useState(DEFAULT_SHEET_SIZE.lengthMm);
  const [width, setWidth] = useState(DEFAULT_SHEET_SIZE.widthMm);
  const exists = sizes.some((z) => z.lengthMm === length && z.widthMm === width);
  const box = 'h-9 w-20 rounded-lg border border-input bg-card px-2 text-right font-mono text-sm';
  return (
    <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
      <span className="font-medium">Sheet sizes</span>
      {sizes.length === 0 && (
        <span className="inline-flex h-8 items-center rounded-full bg-secondary px-3 font-mono text-[13px]">
          {DEFAULT_SHEET_SIZE.lengthMm} × {DEFAULT_SHEET_SIZE.widthMm} <span className="ml-1 font-sans">(default)</span>
        </span>
      )}
      {sizes.map((z, i) => (
        <span key={`${z.lengthMm}x${z.widthMm}`} className="inline-flex h-8 items-center gap-1.5 rounded-full bg-secondary pl-3 pr-1 font-mono text-[13px] text-foreground">
          {z.lengthMm} × {z.widthMm}
          <button
            type="button"
            aria-label={`Remove ${z.lengthMm} by ${z.widthMm}`}
            className="flex size-6 items-center justify-center rounded-full text-muted-foreground hover:bg-card hover:text-foreground"
            onClick={() => onChange(sizes.filter((_, k) => k !== i))}
          >
            ✕
          </button>
        </span>
      ))}
      <span className="flex items-center gap-1.5">
        <input type="number" min={1} aria-label="New sheet length in mm" value={length} onChange={(e) => setLength(Number(e.target.value))} className={box} />
        ×
        <input type="number" min={1} aria-label="New sheet width in mm" value={width} onChange={(e) => setWidth(Number(e.target.value))} className={box} />
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-9"
          disabled={!(length > 0) || !(width > 0) || exists}
          onClick={() => onChange([...sizes, { lengthMm: length, widthMm: width }])}
        >
          + Add size
        </Button>
      </span>
    </div>
  );
}
