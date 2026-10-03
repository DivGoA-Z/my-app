// src/components/designer/CabinetDesignerPage.tsx
//
// The Cabinet Designer: one cabinet's panels — which exist, and which
// board each is cut from — with its parts and board cost updating live.
// Agreed 2 Oct 2026: the catalogue row and the inspector sidebar have no
// room for "every panel can have its own board", so this is its own page
// (docs/DECISIONS.md §45).
//
// Opened two ways, one screen:
//   - from a CATALOGUE row → edits that product's defaults (what every
//     cabinet added from it starts with). Saved to the catalogue.
//   - from a PLACED cabinet ("Panels & boards…" in the inspector) →
//     edits that cabinet only, for this project. Saved to the layout,
//     undoable like any other design edit. Can push its board to every
//     cabinet in the kitchen, or its panels to every cabinet of the same
//     type.
//
// Edits are a local DRAFT until Save, same as the rate card: the parts
// and price beside the table show the draft, so you see "untick back →
// ₹X less" before committing anything.
//
// Every number shown comes from lib/cutList.ts's cabinetCutParts — the
// exact function the quote prices from and the cutting list prints —
// so this page cannot show a price the quote disagrees with (Principle 1).
//
// The 3D preview (CabinetPreview3D, §46) draws the cabinet as its actual
// panels from the same parts list, linked both ways to the table:
// hovering a row lights its panel, clicking a panel finds its row.

import { useMemo, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Alert, AlertDescription } from '../ui/alert';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import { BoardSelect } from '../common/BoardSelect';
import { ExtraPartsEditor } from '../common/ExtraPartsEditor';
import { useLayoutStore } from '../../store/layoutStore';
import { confirmDialog } from '../../store/confirmDialogStore';
import {
  PANEL_ROLES,
  PANEL_ROLE_LABELS,
  type CabinetPanels,
  type ExtraPart,
  type MaterialType,
  type PanelRole,
  type PanelSpec,
  type PlacedCabinetItem,
} from '../../types/cabinet';
import { boardLabel } from '../../types/rates';
import { cabinetCutParts, describeEdgeBanding, partAreaSqM } from '../../lib/cutList';
import { normalizePanels, resolvePanels, samePanels } from '../../lib/panels';
import { hasCountertop } from '../../lib/cabinetGeometry';
import { useEffectiveConstruction } from '../../hooks/usePhysicalCabinets';
import { resolveFinish } from '../../types/finish';
import { CabinetPreview3D } from './CabinetPreview3D';

export type DesignerTarget = { kind: 'catalogue'; itemId: string } | { kind: 'cabinet'; cabinetId: string };

interface Draft {
  material: MaterialType;
  carcassBoardId?: string;
  panels?: CabinetPanels;
  extraParts?: ExtraPart[];
}

// Extra parts compared by value — small arrays of plain objects; an
// emptied list and an absent one mean the same thing.
function sameExtraParts(a: ExtraPart[] | undefined, b: ExtraPart[] | undefined): boolean {
  const x = a ?? [];
  const y = b ?? [];
  return (
    x.length === y.length &&
    x.every((p, i) => {
      const q = y[i];
      return (
        p.id === q.id &&
        p.name === q.name &&
        p.lengthMm === q.lengthMm &&
        p.widthMm === q.widthMm &&
        p.quantity === q.quantity &&
        p.boardId === q.boardId &&
        p.edgeLong === q.edgeLong &&
        p.edgeShort === q.edgeShort
      );
    })
  );
}

const DEFAULT = '__default__';

const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

function formatModuleType(moduleType: string): string {
  return moduleType
    .split('-')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

// What each row means, in the trade's words — shown under the role name.
const ROLE_HINTS: Record<PanelRole, string> = {
  leftSide: 'Use a different board for an exposed end side.',
  rightSide: 'Use a different board for an exposed end side.',
  top: 'Base units usually take two rails — the countertop covers them.',
  bottom: 'A sink unit sometimes has none, or a water-resistant board.',
  back: 'Often left off a sink unit for the plumbing.',
  shelves: 'Fixed shelves and the dividers between rows.',
  fronts: 'Untick if shutters are bought in ready-made. Finish is chosen separately.',
  drawerBoxes: 'The box behind each drawer front. Untick if drawer boxes are bought ready-made.',
};

export function CabinetDesignerPage({ target, onBack }: { target: DesignerTarget; onBack: () => void }) {
  const catalogue = useLayoutStore((s) => s.cabinetCatalog);
  const cabinets = useLayoutStore((s) => s.cabinets);
  const rateCard = useLayoutStore((s) => s.rateCard);
  // A placed cabinet is sized by its project's effective settings (the
  // project's depth override, §61); a catalogue row by the business's.
  const businessConstruction = useLayoutStore((s) => s.constructionSettings);
  const projectConstruction = useEffectiveConstruction();
  const construction = target.kind === 'cabinet' ? projectConstruction : businessConstruction;
  const finishes = useLayoutStore((s) => s.finishes);
  const currentLayout = useLayoutStore((s) => s.currentLayout);
  const updateCabinet = useLayoutStore((s) => s.updateCabinet);
  const updateCabinets = useLayoutStore((s) => s.updateCabinets);
  const upsertCabinetCatalogItem = useLayoutStore((s) => s.upsertCabinetCatalogItem);

  const catalogueItem = target.kind === 'catalogue' ? catalogue.find((c) => c.id === target.itemId) : undefined;
  const cabinet = target.kind === 'cabinet' ? cabinets.find((c) => c.id === target.cabinetId) : undefined;
  const source = catalogueItem ?? cabinet;

  const initial: Draft | undefined = source
    ? {
        material: source.material,
        carcassBoardId: source.carcassBoardId,
        panels: source.panels,
        extraParts: source.extraParts,
      }
    : undefined;
  const [draft, setDraft] = useState<Draft | undefined>(initial);
  const [saving, setSaving] = useState(false);
  // Which panel is lit in the 3D preview: the table row under the mouse,
  // else the last panel clicked in 3D (which also highlights its row).
  const [hoverRole, setHoverRole] = useState<PanelRole | null>(null);
  const [pickedRole, setPickedRole] = useState<PanelRole | null>(null);
  const litRole = hoverRole ?? pickedRole;

  // A pseudo-cabinet built from the target plus the draft, so a catalogue
  // row is measured and priced by exactly the code a placed cabinet is.
  const preview: PlacedCabinetItem | undefined = useMemo(() => {
    if (!source || !draft) return undefined;
    if (cabinet) return { ...cabinet, ...draft };
    const item = catalogueItem!;
    return {
      id: item.id,
      layoutId: '',
      moduleType: item.moduleType,
      x: 0,
      y: 0,
      widthMm: item.widthMm,
      depthMm: item.depthMm,
      heightMm: item.heightMm,
      elevationMm: 0,
      rotationDeg: 0,
      finishId: item.finishId,
      unitPrice: item.unitPrice,
      quantity: 1,
      frontLayout: item.frontLayout,
      handleId: item.handleId,
      ...draft,
    };
  }, [source, cabinet, catalogueItem, draft]);

  const warnings: string[] = [];
  const parts = preview ? cabinetCutParts(preview, 'This cabinet', construction, finishes, rateCard, warnings) : [];
  const resolved = preview ? resolvePanels(preview, rateCard) : undefined;
  const boardCost = parts.reduce((t, p) => t + partAreaSqM(p) * p.ratePerSqM, 0);
  const boardArea = parts.reduce((t, p) => t + partAreaSqM(p), 0);
  const wasteFactor =
    target.kind === 'cabinet' ? (currentLayout?.sheetWasteFactor ?? rateCard.sheetWasteFactor) : rateCard.sheetWasteFactor;

  if (!source || !draft || !preview || !resolved) {
    return (
      <div className="flex flex-col gap-4 p-8">
        <Button variant="outline" size="sm" className="self-start" onClick={onBack}>
          ← Back
        </Button>
        <p className="text-xs text-gray-500">This cabinet no longer exists.</p>
      </div>
    );
  }

  const dirty =
    draft.material !== source.material ||
    draft.carcassBoardId !== source.carcassBoardId ||
    !samePanels(draft.panels, source.panels) ||
    !sameExtraParts(draft.extraParts, source.extraParts);

  const isBase = hasCountertop(source.moduleType);
  const title =
    catalogueItem?.label ?? `${formatModuleType(source.moduleType)} ${source.widthMm}×${source.depthMm}×${source.heightMm}`;
  const pricedBoards = rateCard.boards.filter((b) => b.ratePerSqM > 0);

  const setPanel = (role: PanelRole, patch: Partial<PanelSpec>) => {
    const next = { ...(draft.panels ?? {}), [role]: { ...(draft.panels?.[role] ?? {}), ...patch } };
    setDraft({ ...draft, panels: normalizePanels(next) });
  };

  async function save() {
    if (!draft) return;
    const patch = {
      material: draft.material,
      carcassBoardId: draft.carcassBoardId,
      panels: normalizePanels(draft.panels),
      extraParts: draft.extraParts && draft.extraParts.length > 0 ? draft.extraParts : undefined,
    };
    setSaving(true);
    try {
      if (catalogueItem) {
        await upsertCabinetCatalogItem({ ...catalogueItem, ...patch });
        toast.success(`Saved "${catalogueItem.label}" — cabinets added from it from now on use these panels`);
      } else if (cabinet) {
        updateCabinet(cabinet.id, patch);
        toast.success('Saved for this cabinet');
      }
    } catch (err) {
      toast.error("Couldn't save", { description: err instanceof Error ? err.message : undefined });
    } finally {
      setSaving(false);
    }
  }

  async function applyBoardToKitchen() {
    if (!draft || !cabinet) return;
    const board = resolved!.leftSide.board;
    const ok = await confirmDialog({
      title: `Use ${board ? boardLabel(board) : 'this board'} for every cabinet in this kitchen?`,
      description: `Sets the carcass board on all ${cabinets.length} cabinets. Panels a cabinet has given its own board keep it. You can undo this.`,
      confirmLabel: 'Apply to all',
      destructive: false,
    });
    if (!ok) return;
    updateCabinets(
      cabinets.map((c) => c.id),
      { material: draft.material, carcassBoardId: draft.carcassBoardId }
    );
    toast.success(`Carcass board set on ${cabinets.length} cabinets`);
  }

  async function applyPanelsToType() {
    if (!draft || !cabinet) return;
    const same = cabinets.filter((c) => c.moduleType === cabinet.moduleType);
    const typeLabel = formatModuleType(cabinet.moduleType);
    const ok = await confirmDialog({
      title: `Copy these panels to every ${typeLabel} in this kitchen?`,
      description: `Replaces the panel choices (which panels exist, their boards, extra shelves and extra parts) on ${same.length} ${typeLabel} cabinet${same.length === 1 ? '' : 's'}. You can undo this.`,
      confirmLabel: 'Copy panels',
      destructive: false,
    });
    if (!ok) return;
    updateCabinets(
      same.map((c) => c.id),
      {
        material: draft.material,
        carcassBoardId: draft.carcassBoardId,
        panels: normalizePanels(draft.panels),
        // The same ids land on every target cabinet. Harmless: an extra
        // part's id only keys rows within ONE cabinet's own list.
        extraParts: draft.extraParts?.length ? draft.extraParts : undefined,
      }
    );
    toast.success(`Panels copied to ${same.length} cabinet${same.length === 1 ? '' : 's'}`);
  }

  return (
    <div className="flex flex-col gap-4 p-8">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={onBack}>
          ← Back
        </Button>
        <div className="flex flex-col">
          <h2 className="text-sm font-semibold text-gray-800">Cabinet Designer — {title}</h2>
          <span className="text-[11px] text-gray-500">
            {target.kind === 'catalogue'
              ? 'Catalogue default — every cabinet added from this row starts with these panels.'
              : 'This cabinet only, in this project.'}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {dirty && !saving && (
            <Button variant="link" size="sm" className="h-auto p-0 text-xs" onClick={() => setDraft(initial)}>
              Discard changes
            </Button>
          )}
          <Button size="sm" onClick={save} disabled={!dirty || saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </div>
      </div>

      {dirty && (
        <Alert className="border-amber-300 bg-amber-50">
          <AlertDescription className="text-amber-900">
            Unsaved changes — the parts and price on the right show them, but nothing else does
            until you save.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* ---- Left: carcass board + panels ---- */}
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1 text-xs text-gray-600">
            Carcass board (every panel uses it unless you choose another below)
            <BoardSelect
              material={draft.material}
              carcassBoardId={draft.carcassBoardId}
              onChange={(patch) => setDraft({ ...draft, ...patch })}
              triggerClassName="w-full"
            />
          </div>

          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="px-2 py-1.5 font-medium">Panel</th>
                  <th className="px-2 py-1.5 font-medium">Built</th>
                  <th className="px-2 py-1.5 font-medium">Board</th>
                </tr>
              </thead>
              <tbody>
                {PANEL_ROLES.map((role) => {
                  const spec = draft.panels?.[role];
                  const included = spec?.included !== false;
                  const fallback =
                    role === 'back'
                      ? rateCard.boards.find((b) => b.id === rateCard.defaultBackBoardId)
                      : resolvePanels({ material: draft.material, carcassBoardId: draft.carcassBoardId }, rateCard)
                          .leftSide.board;
                  const chosen = spec?.boardId ? rateCard.boards.find((b) => b.id === spec.boardId) : undefined;
                  return (
                    <tr
                      key={role}
                      id={`designer-panel-${role}`}
                      onMouseEnter={() => setHoverRole(role)}
                      onMouseLeave={() => setHoverRole(null)}
                      className={`border-b border-gray-100 align-top ${litRole === role ? 'bg-amber-50' : ''}`}
                    >
                      <td className="px-2 py-1.5">
                        <div className={included ? 'text-gray-800' : 'text-gray-400 line-through'}>
                          {PANEL_ROLE_LABELS[role]}
                        </div>
                        <div className="text-[10px] text-gray-400">{ROLE_HINTS[role]}</div>
                      </td>
                      <td className="px-2 py-1.5">
                        <Checkbox
                          checked={included}
                          aria-label={`${PANEL_ROLE_LABELS[role]} built`}
                          onCheckedChange={(checked) => setPanel(role, { included: checked === true })}
                        />
                      </td>
                      <td className="flex flex-col gap-1 px-2 py-1.5">
                        <Select
                          value={chosen ? chosen.id : DEFAULT}
                          disabled={!included}
                          onValueChange={(v) => setPanel(role, { boardId: v === DEFAULT ? undefined : v })}
                        >
                          <SelectTrigger size="sm" className="w-full">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value={DEFAULT}>
                              Default — {fallback ? boardLabel(fallback) : 'no board'}
                            </SelectItem>
                            {pricedBoards.map((b) => (
                              <SelectItem key={b.id} value={b.id}>
                                {boardLabel(b)} — ₹{b.ratePerSqM}/m²
                              </SelectItem>
                            ))}
                            {spec?.boardId && !chosen && (
                              <SelectItem value={spec.boardId} disabled>
                                (board no longer on the rate card)
                              </SelectItem>
                            )}
                          </SelectContent>
                        </Select>
                        {role === 'shelves' && included && (
                          <label className="flex items-center justify-between gap-2 text-[11px] text-gray-600">
                            Extra shelves
                            <input
                              type="number"
                              min={0}
                              max={8}
                              value={spec?.extraCount ?? 0}
                              onChange={(e) =>
                                setPanel('shelves', { extraCount: Math.max(0, Math.min(8, Math.floor(Number(e.target.value) || 0))) })
                              }
                              className="w-14 rounded border border-gray-300 px-1.5 py-0.5 text-right text-xs"
                              aria-label="Extra shelves"
                            />
                          </label>
                        )}
                        {role === 'top' && included && (
                          <Select
                            value={spec?.topStyle ?? DEFAULT}
                            onValueChange={(v) =>
                              setPanel('top', { topStyle: v === DEFAULT ? undefined : (v as 'full' | 'rails') })
                            }
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={DEFAULT}>
                                Default — {isBase ? 'two rails' : 'full top panel'}
                              </SelectItem>
                              <SelectItem value="full">Full top panel</SelectItem>
                              <SelectItem value="rails">Two rails (front and back)</SelectItem>
                            </SelectContent>
                          </Select>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Hand-entered parts beyond the standard panels (§48) — on the
              cutting list and priced at their board's rate. */}
          <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
            <div>
              <span className="text-xs font-medium text-gray-700">Extra parts</span>
              <p className="text-[10px] text-gray-400">
                Anything the panels above don't cover — a stiffener, a partition. Listed on the
                cutting list and charged like any panel. "Carcass board" follows this cabinet's
                board.
              </p>
            </div>
            <ExtraPartsEditor
              parts={draft.extraParts ?? []}
              onChange={(extraParts) => setDraft({ ...draft, extraParts })}
              namePlaceholder="e.g. Stiffener"
            />
          </div>

          {target.kind === 'cabinet' && (
            <div className="flex flex-col gap-2 rounded-md border border-gray-200 p-3">
              <span className="text-xs font-medium text-gray-700">Apply to this kitchen</span>
              <div className="flex flex-wrap gap-2">
                <Button size="xs" variant="outline" onClick={applyBoardToKitchen}>
                  Use this carcass board for every cabinet
                </Button>
                <Button size="xs" variant="outline" onClick={applyPanelsToType}>
                  Copy these panels to every {formatModuleType(source.moduleType)}
                </Button>
              </div>
              <span className="text-[10px] text-gray-400">
                Uses the choices on screen, saved or not. Undo reverses it in one step.
              </span>
            </div>
          )}
        </div>

        {/* ---- Right: 3D preview, then live parts and board cost ---- */}
        <div className="flex flex-col gap-2">
          <CabinetPreview3D
            parts={parts}
            widthMm={source.widthMm}
            heightMm={source.heightMm}
            depthMm={source.depthMm}
            frontColor={resolveFinish(finishes, preview.finishId)?.solidColor}
            highlightRole={litRole}
            undrawnCount={parts.filter((p) => p.role === 'extra' || p.notDrawn).length}
            onPickRole={(role) => {
              setPickedRole(role);
              document.getElementById(`designer-panel-${role}`)?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }}
          />
          <div className="flex items-baseline justify-between">
            <h3 className="text-xs font-semibold text-gray-800">Parts and board cost</h3>
            <span className="text-[11px] text-gray-500">{boardArea.toFixed(2)} m² of board</span>
          </div>
          <div className="overflow-x-auto rounded-md border border-gray-200">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                  <th className="px-2 py-1.5 font-medium">Part</th>
                  <th className="px-2 py-1.5 text-right font-medium">L × W (mm)</th>
                  <th className="px-2 py-1.5 font-medium">Board</th>
                  <th className="px-2 py-1.5 font-medium">Edge</th>
                  <th className="px-2 py-1.5 text-right font-medium">₹</th>
                </tr>
              </thead>
              <tbody>
                {parts.map((p, i) => (
                  <tr key={i} className="border-b border-gray-100">
                    <td className="px-2 py-1 text-gray-800">
                      {p.name}
                      {p.quantity > 1 ? ` ×${p.quantity}` : ''}
                    </td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {p.lengthMm} × {p.widthMm}
                    </td>
                    <td className={`px-2 py-1 ${p.boardId ? 'text-gray-600' : 'text-red-600'}`}>{p.boardName}</td>
                    <td className="px-2 py-1">{describeEdgeBanding(p.edgeBanding)}</td>
                    <td className="px-2 py-1 text-right tabular-nums">
                      {inr.format(partAreaSqM(p) * p.ratePerSqM)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-col gap-0.5 text-xs text-gray-700">
            <div className="flex justify-between">
              <span>Board, as cut</span>
              <span className="tabular-nums">{inr.format(boardCost)}</span>
            </div>
            <div className="flex justify-between font-semibold">
              <span>Board on the quote (× {wasteFactor} sheet waste)</span>
              <span className="tabular-nums">{inr.format(boardCost * wasteFactor)}</span>
            </div>
            <span className="text-[10px] text-gray-400">
              Board only, at cost — finish, hardware, labour and margin are added on the quote. Sizes
              follow your workshop settings (defaults if you've never opened them).
            </span>
          </div>
          {warnings.length > 0 && (
            <ul className="list-disc pl-4 text-[11px] text-amber-800">
              {warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
