// src/components/common/BoardSelect.tsx
//
// A cabinet's carcass board picker — shared by the catalogue's add/edit
// rows and the cabinet inspector. It picks a BOARD LINE ("HDMR 18mm —
// ₹1,400/m²"), not just a material: you pointed out (2 Oct 2026) that
// the catalogue showed "HDMR" without saying which thickness, because it
// silently meant "the thickest HDMR line". Choosing a line sets both
// carcassBoardId and the matching `material`, which older parts of the
// app still read. The back board is shown underneath, read-only, so the
// cabinet's two boards are visible together; changing a single panel's
// board (an exposed end side, a BWP bottom) is the Cabinet Designer's
// job.
//
// Rules carried over from MaterialSelect (§43), which this replaced:
//   1. Only PRICED lines are offered (ratePerSqM > 0). An unpriced line
//      would quietly price the carcass at ₹0.
//   2. "+ Add a new board…" creates the line on the business rate card,
//      saved immediately — not a private one-off on this cabinet.
//   3. A cabinet whose current board is unpriced or missing still shows
//      it, marked, so the dropdown never misreports the value.

import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectSeparator, SelectTrigger, SelectValue } from '../ui/select';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { useLayoutStore } from '../../store/layoutStore';
import type { MaterialType } from '../../types/cabinet';
import { MATERIAL_RATE_KEYS, MATERIAL_RATE_LABELS, boardLabel, type BoardRate } from '../../types/rates';
import { resolveCarcassBoard } from '../../lib/panels';

const NEW_BOARD = '__new_board__';
const NONE = '__none__';

const inr = new Intl.NumberFormat('en-IN', { maximumFractionDigits: 0 });

export function BoardSelect({
  material,
  carcassBoardId,
  onChange,
  triggerClassName,
}: {
  material: MaterialType;
  carcassBoardId?: string;
  onChange: (patch: { material: MaterialType; carcassBoardId: string }) => void;
  triggerClassName?: string;
}) {
  const rateCard = useLayoutStore((s) => s.rateCard);
  const updateRateCard = useLayoutStore((s) => s.updateRateCard);
  const [open, setOpen] = useState(false);
  const [newMaterial, setNewMaterial] = useState<MaterialType>('HDMR');
  const [thickness, setThickness] = useState(18);
  const [rate, setRate] = useState(0);
  const [saving, setSaving] = useState(false);

  const current = resolveCarcassBoard(rateCard.boards, { material, carcassBoardId });
  const priced = rateCard.boards.filter((b) => b.ratePerSqM > 0);
  const currentUnpriced = current !== undefined && !priced.some((b) => b.id === current.id);
  const back = rateCard.boards.find((b) => b.id === rateCard.defaultBackBoardId);

  const pick = (board: BoardRate) => onChange({ material: board.material, carcassBoardId: board.id });

  async function addBoard() {
    setSaving(true);
    try {
      const board: BoardRate = {
        id: crypto.randomUUID(),
        material: newMaterial,
        thicknessMm: thickness,
        ratePerSqM: rate,
      };
      await updateRateCard({ ...rateCard, boards: [...rateCard.boards, board] });
      pick(board);
      setOpen(false);
      toast.success(`Added ${boardLabel(board)} to your rate card`);
    } catch (err) {
      toast.error("Couldn't add the board", {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex flex-col gap-0.5">
      <Select
        value={current?.id ?? NONE}
        onValueChange={(v) => {
          if (v === NEW_BOARD) {
            setNewMaterial(material);
            setThickness(18);
            setRate(0);
            setOpen(true);
            return;
          }
          const board = rateCard.boards.find((b) => b.id === v);
          if (board) pick(board);
        }}
      >
        <SelectTrigger size="sm" className={triggerClassName}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {priced.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {boardLabel(b)} — ₹{inr.format(b.ratePerSqM)}/m²
            </SelectItem>
          ))}
          {currentUnpriced && current && (
            <SelectItem value={current.id} disabled>
              {boardLabel(current)} (₹0 — set a rate)
            </SelectItem>
          )}
          {!current && (
            <SelectItem value={NONE} disabled>
              {MATERIAL_RATE_LABELS[material]} (no board line)
            </SelectItem>
          )}
          <SelectSeparator />
          <SelectItem value={NEW_BOARD}>+ Add a new board…</SelectItem>
        </SelectContent>
      </Select>
      <span className="text-[10px] text-gray-400">
        Back: {back ? boardLabel(back) : 'no default back board'}
      </span>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add a board</DialogTitle>
            <DialogDescription>
              Added to your rate card's Boards and saved straight away, so every cabinet and
              project can use it.
            </DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-3 text-xs text-gray-600">
            <div className="flex flex-col gap-1">
              Material
              <Select value={newMaterial} onValueChange={(v) => setNewMaterial(v as MaterialType)}>
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
            </div>
            <label className="flex items-center justify-between gap-3">
              Thickness (mm)
              <Input
                type="number"
                min={1}
                step={1}
                value={thickness}
                onChange={(e) => setThickness(Number(e.target.value))}
                className="w-28 text-right"
              />
            </label>
            <label className="flex items-center justify-between gap-3">
              ₹ per sq m
              <Input
                type="number"
                min={0}
                step={1}
                value={rate}
                onChange={(e) => setRate(Number(e.target.value))}
                className="w-28 text-right"
              />
            </label>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            {/* A rate is required — the whole point is that no cabinet
                ends up on an unpriced board. */}
            <Button
              type="button"
              size="sm"
              onClick={addBoard}
              disabled={saving || !(rate > 0) || !(thickness > 0)}
            >
              {saving ? 'Adding…' : 'Add board'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
