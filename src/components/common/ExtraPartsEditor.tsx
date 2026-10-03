// src/components/common/ExtraPartsEditor.tsx
//
// Edits a list of hand-entered board parts (ExtraPart, types/cabinet.ts)
// — shared by the Cabinet Designer (parts on one cabinet) and the
// Cutting List page (loose parts for the project), so both edit the
// same fields the same way (§48).
//
// Every row is priced (real area × its board's rate) and listed on the
// cutting list, so the board picker offers only PRICED lines, same rule
// as BoardSelect. On a cabinet, "Carcass board" (no boardId) is a valid
// choice — the part follows the cabinet. A loose part has no cabinet to
// follow, so `requireBoard` hides that option and a new row starts on a
// real board.

import { Plus } from 'lucide-react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { useLayoutStore } from '../../store/layoutStore';
import type { ExtraPart } from '../../types/cabinet';
import { boardLabel } from '../../types/rates';
import { defaultCarcassBoard } from '../../lib/panels';

const CARCASS = '__carcass__';
const EDGE_OPTIONS = ['0', '1', '2'] as const;

export function ExtraPartsEditor({
  parts,
  onChange,
  requireBoard = false,
  namePlaceholder,
}: {
  parts: ExtraPart[];
  onChange: (parts: ExtraPart[]) => void;
  requireBoard?: boolean;
  namePlaceholder: string;
}) {
  const boards = useLayoutStore((s) => s.rateCard.boards);
  const priced = boards.filter((b) => b.ratePerSqM > 0);
  const update = (id: string, patch: Partial<ExtraPart>) =>
    onChange(parts.map((p) => (p.id === id ? { ...p, ...patch } : p)));

  function addRow() {
    const firstBoard = defaultCarcassBoard(boards, 'HDMR') ?? priced[0];
    onChange([
      ...parts,
      {
        id: crypto.randomUUID(),
        name: '',
        lengthMm: 0,
        widthMm: 0,
        quantity: 1,
        boardId: requireBoard ? firstBoard?.id : undefined,
        edgeLong: 1,
        edgeShort: 0,
      },
    ]);
  }

  return (
    <div className="flex flex-col gap-2">
      {parts.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="text-[11px] text-gray-500">
                <th className="py-1 pr-2 font-medium">Name</th>
                <th className="py-1 pr-2 text-right font-medium">Length</th>
                <th className="py-1 pr-2 text-right font-medium">Width</th>
                <th className="py-1 pr-2 text-right font-medium">Qty</th>
                <th className="py-1 pr-2 font-medium">Board</th>
                <th className="py-1 pr-2 font-medium" title="How many long / short edges get edge banding">
                  Banded L / W
                </th>
                <th />
              </tr>
            </thead>
            <tbody>
              {parts.map((p) => (
                <tr key={p.id} className="align-middle">
                  <td className="py-1 pr-2">
                    <Input
                      aria-label="Part name"
                      placeholder={namePlaceholder}
                      value={p.name}
                      onChange={(e) => update(p.id, { name: e.target.value })}
                      className="h-7 min-w-28 text-xs"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label="Length in mm"
                      type="number"
                      min={0}
                      value={p.lengthMm}
                      onChange={(e) => update(p.id, { lengthMm: Number(e.target.value) })}
                      className="h-7 w-20 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label="Width in mm"
                      type="number"
                      min={0}
                      value={p.widthMm}
                      onChange={(e) => update(p.id, { widthMm: Number(e.target.value) })}
                      className="h-7 w-20 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Input
                      aria-label="Quantity"
                      type="number"
                      min={1}
                      value={p.quantity}
                      onChange={(e) => update(p.id, { quantity: Number(e.target.value) })}
                      className="h-7 w-14 text-right text-xs"
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <Select
                      value={p.boardId ?? CARCASS}
                      onValueChange={(v) => update(p.id, { boardId: v === CARCASS ? undefined : v })}
                    >
                      <SelectTrigger size="sm" className="w-40">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {!requireBoard && <SelectItem value={CARCASS}>Carcass board</SelectItem>}
                        {priced.map((b) => (
                          <SelectItem key={b.id} value={b.id}>
                            {boardLabel(b)}
                          </SelectItem>
                        ))}
                        {p.boardId && !priced.some((b) => b.id === p.boardId) && (
                          <SelectItem value={p.boardId} disabled>
                            (not a priced board)
                          </SelectItem>
                        )}
                      </SelectContent>
                    </Select>
                  </td>
                  <td className="py-1 pr-2">
                    <div className="flex items-center gap-1">
                      {(['edgeLong', 'edgeShort'] as const).map((k) => (
                        <Select
                          key={k}
                          value={String(p[k])}
                          onValueChange={(v) => update(p.id, { [k]: Number(v) as 0 | 1 | 2 })}
                        >
                          <SelectTrigger size="sm" className="w-14" aria-label={k === 'edgeLong' ? 'Long edges banded' : 'Short edges banded'}>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {EDGE_OPTIONS.map((n) => (
                              <SelectItem key={n} value={n}>
                                {n}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      ))}
                    </div>
                  </td>
                  <td className="py-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      aria-label={`Remove ${p.name || 'part'}`}
                      onClick={() => onChange(parts.filter((x) => x.id !== p.id))}
                    >
                      ✕
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <Button type="button" variant="outline" size="touch" className="self-start" onClick={addRow}>
        <Plus /> Add part
      </Button>
    </div>
  );
}
