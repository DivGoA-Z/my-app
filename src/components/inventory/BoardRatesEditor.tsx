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
        currentProject ? { id: currentProject.id, name: currentProject.clientName, cabinets } : null
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
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-[1fr_6rem_7rem_2rem] gap-2 text-[11px] font-medium text-gray-500">
        <span>Board</span>
        <span className="text-right">Thickness (mm)</span>
        <span className="text-right">₹ per sq m</span>
        <span />
      </div>
      {boards.map((b) => (
        <div key={b.id} className="grid grid-cols-[1fr_6rem_7rem_2rem] items-center gap-2">
          <Select value={b.material} onValueChange={(v) => update(b.id, { material: v as MaterialType })}>
            <SelectTrigger size="sm" className="w-full">
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
          <Input
            aria-label="Thickness in mm"
            type="number"
            min={1}
            step={1}
            value={b.thicknessMm}
            onChange={(e) => update(b.id, { thicknessMm: Number(e.target.value) })}
            className="text-right"
          />
          <Input
            aria-label="Rate per square metre"
            type="number"
            min={0}
            step={1}
            value={b.ratePerSqM}
            onChange={(e) => update(b.id, { ratePerSqM: Number(e.target.value) })}
            className="text-right"
          />
          {/* The default back board can't be removed from here — pick a
              different default first. Otherwise every back would
              silently lose its board. */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            aria-label={`Remove ${boardLabel(b)}`}
            disabled={b.id === defaultBackBoardId || checkingId !== null}
            title={b.id === defaultBackBoardId ? 'This is the default back board — choose another default first' : undefined}
            onClick={() => tryRemove(b)}
          >
            {checkingId === b.id ? '…' : '✕'}
          </Button>
        </div>
      ))}
      {blocked && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-900">
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
        size="xs"
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
      <div className="mt-1 rounded-md bg-gray-50 px-2 py-1.5 text-[11px] text-gray-600">
        <span className="font-medium">Carcass board for cabinets with no board chosen: </span>
        {MATERIAL_RATE_KEYS.map((m, i) => {
          const board = defaultCarcassBoard(boards, m);
          return (
            <span key={m} className={board && board.thicknessMm < 12 ? 'font-medium text-red-600' : undefined}>
              {i > 0 ? ' · ' : ''}
              {MATERIAL_RATE_LABELS[m]} → {board ? `${board.thicknessMm}mm` : 'none'}
            </span>
          );
        })}
      </div>

      <div className="mt-1 flex items-center justify-between gap-3 text-xs text-gray-600">
        <span>Default back board</span>
        <Select value={defaultBackBoardId} onValueChange={(v) => onChange(boards, v)}>
          <SelectTrigger size="sm" className="w-48">
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
