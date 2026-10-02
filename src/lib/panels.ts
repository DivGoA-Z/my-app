// src/lib/panels.ts
//
// Resolves a cabinet's PanelSpec (types/cabinet.ts) into concrete
// answers — for each panel role, is it built, and from which board line
// (types/rates.ts)? One function, called by the cutting list, which in
// turn feeds the price (docs/DECISIONS.md §42), so "which board is this
// side?" can't be answered two different ways.
//
// Default board, when the cabinet doesn't name one:
//   - back → the rate card's defaultBackBoardId (usually 6mm HDMR,
//     whatever the carcass is).
//   - everything else → the cabinet's own carcass board
//     (item.carcassBoardId — "HDMR 18mm", picked in the catalogue and
//     inspector since §44). Only if that's absent or no longer exists:
//     the material's original 18mm line, then the thickest — see
//     defaultCarcassBoard for why "thickest" alone wasn't safe.
// A named board that no longer exists (the line was deleted) falls back
// to the default AND is reported, so a deleted line can't silently
// reprice or resize a cabinet without anyone noticing.

import type { CabinetPanels, PanelRole, PanelSpec, PlacedCabinetItem } from '../types/cabinet';
import { PANEL_ROLE_LABELS, PANEL_ROLES } from '../types/cabinet';
import type { BoardRate, RateCard } from '../types/rates';
import { boardLabel, legacyBoardId } from '../types/rates';

export interface ResolvedPanel {
  included: boolean;
  // Undefined only when NO suitable line exists at all (e.g. a Plywood
  // cabinet on a rate card with no Plywood line). The cutting list
  // still lists the part, at a fallback thickness, and warns; the price
  // charges ₹0 for it and the quote sidebar flags the cabinet.
  board: BoardRate | undefined;
  // 'top' only — resolved by the cutting list against the business's
  // ConstructionSettings.baseTop when the cabinet doesn't say.
  topStyle?: 'full' | 'rails';
  // 'shelves' only — see PanelSpec.extraCount.
  extraCount?: number;
}

export type ResolvedPanels = Record<PanelRole, ResolvedPanel>;

// The board for a cabinet that never picked one (carcassBoardId absent —
// every cabinet saved before §44). The material's ORIGINAL 18mm line
// first (legacyBoardId — the seeded/migrated line every such cabinet
// was priced on), and only if that line is gone, the thickest line.
//
// "Thickest" alone was the rule until a test run showed the trap in it:
// merely ADDING an "HDMR 25mm" line silently turned every older HDMR
// cabinet into a 25mm carcass (₹2,567 → ₹3,364 on a 600mm base unit,
// and 25mm parts on the cutting list) without anyone touching those
// cabinets. Pinning to the original line means adding a board never
// moves an existing cabinet; only choosing one does.
export function defaultCarcassBoard(boards: BoardRate[], material: PlacedCabinetItem['material']) {
  return (
    boards.find((b) => b.id === legacyBoardId(material)) ??
    boards.filter((b) => b.material === material).sort((a, b) => b.thicknessMm - a.thicknessMm)[0]
  );
}

// The board a cabinet's carcass panels use unless a panel says otherwise.
// Exported because the Material/Board dropdown shows exactly this.
export function resolveCarcassBoard(
  boards: BoardRate[],
  item: Pick<PlacedCabinetItem, 'material' | 'carcassBoardId'>
): BoardRate | undefined {
  return (
    (item.carcassBoardId ? boards.find((b) => b.id === item.carcassBoardId) : undefined) ??
    defaultCarcassBoard(boards, item.material)
  );
}

export function resolvePanels(
  // Only these two fields are read, so a catalogue row resolves the same
  // way a placed cabinet does (lib/boardUsage.ts relies on that).
  item: Pick<PlacedCabinetItem, 'material' | 'panels' | 'carcassBoardId'>,
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>,
  warnings?: string[],
  cabinetRef?: string
): ResolvedPanels {
  const carcassDefault = resolveCarcassBoard(rates.boards, item);
  const backDefault = rates.boards.find((b) => b.id === rates.defaultBackBoardId);
  const out = {} as ResolvedPanels;

  for (const role of PANEL_ROLES) {
    const spec = item.panels?.[role];
    const fallback = role === 'back' ? backDefault : carcassDefault;
    let board = fallback;
    if (spec?.boardId) {
      const named = rates.boards.find((b) => b.id === spec.boardId);
      if (named) board = named;
      else if (warnings && cabinetRef)
        warnings.push(
          `${cabinetRef}: the board chosen for its ${PANEL_ROLE_LABELS[role].toLowerCase()} is no longer on the rate card — using ${
            fallback ? boardLabel(fallback) : 'no board'
          } instead.`
        );
    }
    out[role] = {
      included: spec?.included !== false,
      board,
      topStyle: spec?.topStyle,
      extraCount: spec?.extraCount,
    };
  }
  return out;
}

// Drops every choice that equals its default, so "absent" keeps meaning
// "default" (PanelSpec's contract) and two specs that mean the same
// thing compare equal. Returns undefined when nothing is customised.
export function normalizePanels(panels: CabinetPanels | undefined): CabinetPanels | undefined {
  if (!panels) return undefined;
  const out: CabinetPanels = {};
  for (const role of PANEL_ROLES) {
    const spec = panels[role];
    if (!spec) continue;
    const clean: PanelSpec = {};
    if (spec.included === false) clean.included = false;
    if (spec.boardId) clean.boardId = spec.boardId;
    if (role === 'top' && spec.topStyle) clean.topStyle = spec.topStyle;
    if (role === 'shelves' && spec.extraCount && spec.extraCount > 0) clean.extraCount = Math.floor(spec.extraCount);
    if (Object.keys(clean).length > 0) out[role] = clean;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

export function samePanels(a: CabinetPanels | undefined, b: CabinetPanels | undefined): boolean {
  const na = normalizePanels(a);
  const nb = normalizePanels(b);
  return PANEL_ROLES.every((role) => {
    const x = na?.[role];
    const y = nb?.[role];
    return (
      x?.included === y?.included &&
      x?.boardId === y?.boardId &&
      x?.topStyle === y?.topStyle &&
      x?.extraCount === y?.extraCount
    );
  });
}

// One line for a catalogue row: "All panels" or "No back · rails top ·
// 2 custom boards". Says only what differs from the default.
export function describePanels(panels: CabinetPanels | undefined): string {
  const p = normalizePanels(panels);
  if (!p) return 'All panels, default boards';
  const bits: string[] = [];
  const missing = PANEL_ROLES.filter((r) => p[r]?.included === false);
  if (missing.length > 0) bits.push('No ' + missing.map((r) => PANEL_ROLE_LABELS[r].toLowerCase()).join(', '));
  if (p.top?.topStyle) bits.push(p.top.topStyle === 'rails' ? 'rails top' : 'full top');
  const extra = p.shelves?.included === false ? 0 : (p.shelves?.extraCount ?? 0);
  if (extra > 0) bits.push(`+${extra} shel${extra === 1 ? 'f' : 'ves'}`);
  const custom = PANEL_ROLES.filter((r) => p[r]?.boardId && p[r]?.included !== false).length;
  if (custom > 0) bits.push(`${custom} custom board${custom === 1 ? '' : 's'}`);
  return bits.join(' · ');
}
