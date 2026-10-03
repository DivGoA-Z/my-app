// src/lib/nesting.ts
//
// Sheet nesting: lays a cutting list's parts out on whole sheets, to
// count sheets and MEASURE waste (docs/DECISIONS.md §49) — the measured
// counterpart to the sheet waste factor a business otherwise types from
// experience. An add-on (Principle 12): nothing in designing or quoting
// needs it; the quote only changes if the business presses "use this".
//
// THE HEURISTIC — a known one, per docs/PRINCIPLES.md ("don't invent an
// algorithm"): Jukka Jylänki's guillotine bin packing, "Best Area Fit"
// placement with the "Shorter Leftover Axis" split rule (Jylänki, "A
// Thousand Ways to Pack the Bin", 2010). Guillotine, specifically,
// because every cut it implies runs straight across a piece from edge to
// edge — what a panel saw or table saw in a small workshop can actually
// cut. A free-form packer (MaxRects) packs tighter on paper but can
// produce layouts a panel saw can't follow.
//
// It's a heuristic: good layouts, not provably optimal ones — 2D sheet
// packing is a hard problem every cutting tool approximates. To do
// better than one pass cheaply, it runs every combination of the paper's
// placement rules (Best Area / Best Short Side / Best Long Side Fit),
// split rules (Shorter / Longer Leftover Axis, Minimize / Maximize Area)
// and four standard part orderings — 48 passes, milliseconds for a
// kitchen — with the paper's free-rectangle merge, and keeps the best
// (fewest sheets, then the emptiest last sheet, whose leftover is the
// most reusable offcut). One combination alone was measurably weak: on a
// typical L-shaped kitchen it needed 3 sheets of backs and 3 of fronts
// where 2 of each is the area minimum (§49).
//
// GEOMETRY. Sheet x runs along its LENGTH (2440), which is also the
// grain direction. A part whose grain is fixed (CutPart.grainFixed —
// fronts) keeps its length along x; anything else may rotate 90°.
// Kerf (the saw blade's width) is reserved on every piece by inflating
// it by one kerf in each direction, and the usable area by one kerf too,
// so the last piece against an edge doesn't pay for a cut it doesn't
// need. The sheet's factory edges are trimmed off first (`trimMm` per
// side), so nothing is placed in that border.

import type { CutPart } from './cutList';
import { MM2_PER_SQM, groupKey } from './cutList';
import { DEFAULT_SHEET_SIZE, boardSheetSizes, type BoardRate, type SheetSize } from '../types/rates';

// One sheet size plus how it's cut — what a single packing pass needs.
export interface SheetSpec {
  lengthMm: number;
  widthMm: number;
  kerfMm: number;
  trimMm: number;
}

// One piece placed on a sheet. x/y are the piece's corner in sheet mm
// (origin at the sheet's corner, x along the length), excluding kerf.
export interface PlacedPiece {
  part: CutPart;
  x: number;
  y: number;
  // Size as laid out — swapped from the part's length × width if rotated.
  w: number;
  h: number;
  rotated: boolean;
}

export interface NestedSheet {
  pieces: PlacedPiece[];
  usedAreaMm2: number;
  // This sheet's own size — a board bought in several sizes can end up
  // with sheets of more than one (§52).
  lengthMm: number;
  widthMm: number;
}

// How the workshop cuts, independent of sheet size (Workshop settings).
export interface CutSpec {
  kerfMm: number;
  trimMm: number;
}

export interface NestResult {
  sheets: NestedSheet[];
  // Pieces too big for the sheet in any allowed orientation — listed,
  // never silently dropped.
  unplaced: CutPart[];
  partsAreaSqM: number;
  sheetsAreaSqM: number;
  // 1 − parts/sheets, over every sheet bought (0 when nothing is nested).
  wastePercent: number;
  // (lastSheetOffcutSqM lived here briefly — the last sheet's leftover,
  // reported apart so the business could price waste excluding it. You
  // asked for one figure with every sheet counted in full — §51.)
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

interface Piece {
  part: CutPart;
  // Length × width as cut (no kerf).
  l: number;
  wd: number;
  canRotate: boolean;
}

type PlaceRule = 'area' | 'shortSide' | 'longSide';
type SplitRule = 'shorterAxis' | 'longerAxis' | 'minArea' | 'maxArea';

// Merges pairs of free rectangles that share a full edge back into one
// (Jylänki's MergeFreeList) — without it, a long strip gets chopped into
// pieces too short for a long part even though the space is there.
function mergeFree(free: Rect[]) {
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = free[i];
      const b = free[j];
      if (a.w === b.w && a.x === b.x) {
        if (a.y + a.h === b.y) { a.h += b.h; free.splice(j, 1); j--; continue; }
        if (b.y + b.h === a.y) { a.y = b.y; a.h += b.h; free.splice(j, 1); j--; continue; }
      }
      if (a.h === b.h && a.y === b.y) {
        if (a.x + a.w === b.x) { a.w += b.w; free.splice(j, 1); j--; continue; }
        if (b.x + b.w === a.x) { a.x = b.x; a.w += b.w; free.splice(j, 1); j--; }
      }
    }
  }
}

function packOnce(
  pieces: Piece[],
  spec: SheetSpec,
  placeRule: PlaceRule,
  splitRule: SplitRule
): { sheets: NestedSheet[]; unplaced: CutPart[] } {
  const usableW = spec.lengthMm - 2 * spec.trimMm + spec.kerfMm;
  const usableH = spec.widthMm - 2 * spec.trimMm + spec.kerfMm;
  const sheets: { free: Rect[]; placed: PlacedPiece[]; used: number }[] = [];
  const unplaced: CutPart[] = [];

  const fits = (r: Rect, w: number, h: number) => w <= r.w && h <= r.h;

  for (const pc of pieces) {
    const options: { w: number; h: number; rotated: boolean }[] = [{ w: pc.l, h: pc.wd, rotated: false }];
    if (pc.canRotate && pc.l !== pc.wd) options.push({ w: pc.wd, h: pc.l, rotated: true });
    // Kerf-inflated footprints.
    const opts = options.map((o) => ({ ...o, fw: o.w + spec.kerfMm, fh: o.h + spec.kerfMm }));

    if (!opts.some((o) => o.fw <= usableW && o.fh <= usableH)) {
      unplaced.push(pc.part);
      continue;
    }

    // Best Area Fit across every open sheet: the free rectangle that
    // leaves the least area over; ties broken by the shorter side's
    // leftover (BSSF), then the earlier sheet.
    let best: { sheet: number; rect: number; o: (typeof opts)[number]; score: number; tie: number } | null = null;
    sheets.forEach((sh, si) =>
      sh.free.forEach((r, ri) => {
        for (const o of opts) {
          if (!fits(r, o.fw, o.fh)) continue;
          const leftW = r.w - o.fw;
          const leftH = r.h - o.fh;
          const short = Math.min(leftW, leftH);
          const long = Math.max(leftW, leftH);
          const area = r.w * r.h - o.fw * o.fh;
          const [score, tie] =
            placeRule === 'area' ? [area, short] : placeRule === 'shortSide' ? [short, long] : [long, short];
          if (!best || score < best.score || (score === best.score && tie < best.tie)) {
            best = { sheet: si, rect: ri, o, score, tie };
          }
        }
      })
    );

    if (!best) {
      sheets.push({ free: [{ x: 0, y: 0, w: usableW, h: usableH }], placed: [], used: 0 });
      const r = sheets[sheets.length - 1].free[0];
      const o = opts.find((x) => fits(r, x.fw, x.fh))!;
      best = { sheet: sheets.length - 1, rect: 0, o, score: 0, tie: 0 };
    }

    const { sheet: si, rect: ri, o } = best as { sheet: number; rect: number; o: (typeof opts)[number] };
    const sh = sheets[si];
    const r = sh.free[ri];
    sh.placed.push({
      part: pc.part,
      x: spec.trimMm + r.x,
      y: spec.trimMm + r.y,
      w: o.w,
      h: o.h,
      rotated: o.rotated,
    });
    sh.used += pc.l * pc.wd;

    // Split the leftover L into two rectangles — horizontally (a full-
    // width strip above) or vertically (a full-height strip beside), per
    // the split rule.
    const leftW = r.w - o.fw;
    const leftH = r.h - o.fh;
    const horizontal =
      splitRule === 'shorterAxis'
        ? leftW <= leftH
        : splitRule === 'longerAxis'
          ? leftW > leftH
          : splitRule === 'minArea'
            ? o.fw * leftH > leftW * o.fh
            : o.fw * leftH <= leftW * o.fh;
    const next: Rect[] =
      horizontal
        ? [
            { x: r.x, y: r.y + o.fh, w: r.w, h: leftH }, // full-width strip above
            { x: r.x + o.fw, y: r.y, w: leftW, h: o.fh }, // beside the piece
          ]
        : [
            { x: r.x + o.fw, y: r.y, w: leftW, h: r.h }, // full-height strip beside
            { x: r.x, y: r.y + o.fh, w: o.fw, h: leftH }, // above the piece
          ];
    sh.free.splice(ri, 1, ...next.filter((n) => n.w > 0 && n.h > 0));
    mergeFree(sh.free);
  }

  return {
    sheets: sheets.map((s) => ({
      pieces: s.placed,
      usedAreaMm2: s.used,
      lengthMm: spec.lengthMm,
      widthMm: spec.widthMm,
    })),
    unplaced,
  };
}

// The standard orderings guillotine packers are usually run with; the
// best result wins.
const ORDERINGS: ((a: Piece, b: Piece) => number)[] = [
  (a, b) => b.l * b.wd - a.l * a.wd, // area, largest first
  (a, b) => Math.max(b.l, b.wd) - Math.max(a.l, a.wd), // longest side first
  (a, b) => b.l + b.wd - (a.l + a.wd), // perimeter
  (a, b) => Math.min(b.l, b.wd) - Math.min(a.l, a.wd), // widest first
];

// The best of all rule/ordering combinations for ONE sheet size.
function bestSingleSize(pieces: Piece[], spec: SheetSpec): { sheets: NestedSheet[]; unplaced: CutPart[] } {
  if (pieces.length === 0) return { sheets: [], unplaced: [] };
  const placeRules: PlaceRule[] = ['area', 'shortSide', 'longSide'];
  const splitRules: SplitRule[] = ['shorterAxis', 'longerAxis', 'minArea', 'maxArea'];
  let best: { sheets: NestedSheet[]; unplaced: CutPart[] } | null = null;
  for (const order of ORDERINGS) {
    const sorted = [...pieces].sort(order);
    for (const pr of placeRules) {
      for (const sr of splitRules) {
        const run = packOnce(sorted, spec, pr, sr);
        if (!best) {
          best = run;
          continue;
        }
        const lastUsed = (r: typeof run) => r.sheets[r.sheets.length - 1]?.usedAreaMm2 ?? 0;
        if (
          run.sheets.length < best.sheets.length ||
          (run.sheets.length === best.sheets.length && lastUsed(run) < lastUsed(best))
        ) {
          best = run;
        }
      }
    }
  }
  return best!;
}

const toPieces = (parts: CutPart[]): Piece[] =>
  parts.map((p) => ({ part: p, l: p.lengthMm, wd: p.widthMm, canRotate: !p.grainFixed }));

const sheetArea = (z: SheetSize) => z.lengthMm * z.widthMm;

// Lays parts out on sheets of the given sizes (§52). With ONE size this
// is just the guillotine packer above. With several — a board bought in
// more than one size — the choice is a simple, explainable rule on top
// of the same packer, not a new algorithm:
//   1. For each size, fill with sheets of that size. Any piece too big
//      for it goes onto the smallest other size it fits.
//   2. Then try to finish smaller: re-pack the LAST full-size sheet's
//      pieces onto each smaller size, smallest first, and take the first
//      that holds them all on one sheet.
//   3. Keep the plan that leaves the fewest pieces unplaced, then buys
//      the least sheet area, then the fewest sheets.
// Recent results, keyed on exactly what the packing depends on: every
// piece's size and grain, the sheet sizes, the cut. Calculated waste mode
// (§53) re-prices — and so would re-pack — on every design edit,
// including every frame of dragging a cabinet across the plan; a drag
// moves a cabinet but changes no part's SIZE, so it's a cache hit. Small
// and bounded; results are deterministic, so a hit is always correct.
const CACHE_LIMIT = 64;
const nestCache = new Map<string, NestResult>();

function cacheKey(parts: CutPart[], sizes: SheetSize[], cut: CutSpec): string {
  const pieces = parts
    .map((p) => `${p.lengthMm}x${p.widthMm}x${p.quantity}${p.grainFixed ? 'g' : ''}`)
    .sort()
    .join(',');
  return `${sizes.map((z) => `${z.lengthMm}x${z.widthMm}`).join('+')}|${cut.kerfMm}|${cut.trimMm}|${pieces}`;
}

export function nestParts(parts: CutPart[], sizes: SheetSize[], cut: CutSpec): NestResult {
  const key = cacheKey(parts, sizes, cut);
  const hit = nestCache.get(key);
  // The cached layout's pieces point at the CutPart objects from the run
  // that filled it; sizes are identical, but labels (cabinet ref, name)
  // could differ — so a hit is only reused when every part matches by
  // identity-relevant fields too. Otherwise recompute.
  if (hit && sameLabels(hit, parts)) return hit;
  const result = nestUncached(parts, sizes, cut);
  if (nestCache.size >= CACHE_LIMIT) nestCache.delete(nestCache.keys().next().value!);
  nestCache.set(key, result);
  return result;
}

function sameLabels(result: NestResult, parts: CutPart[]): boolean {
  const label = (p: CutPart) => `${p.cabinetRef}|${p.name}|${p.lengthMm}x${p.widthMm}`;
  const want = new Set(parts.map(label));
  return [...result.sheets.flatMap((sh) => sh.pieces.map((pc) => pc.part)), ...result.unplaced].every((p) =>
    want.has(label(p))
  );
}

// Each board line's MEASURED waste factor for a set of parts — the
// calculated mode's numbers (§53). Parts are nested in the same groups the
// cutting list shows (board, and finish for fronts — each its own stack
// of sheets), on the sizes that board is bought in; the groups belonging
// to one board line are then combined: sheet area bought ÷ part area,
// every sheet counted. Unplaced (too-big) pieces are left out of both.
export interface BoardWaste {
  boardId: string;
  factor: number;
  partsAreaSqM: number;
  sheetsAreaSqM: number;
  sheets: number;
}

export function measuredBoardWaste(
  parts: CutPart[],
  boards: BoardRate[],
  cut: CutSpec
): Map<string, BoardWaste> {
  const byGroup = new Map<string, CutPart[]>();
  for (const p of parts) {
    if (!p.boardId) continue;
    const key = groupKey(p);
    byGroup.set(key, [...(byGroup.get(key) ?? []), p]);
  }
  const out = new Map<string, BoardWaste>();
  for (const groupParts of byGroup.values()) {
    const boardId = groupParts[0].boardId!;
    const r = nestParts(groupParts, boardSheetSizes(boards.find((b) => b.id === boardId)), cut);
    const prev = out.get(boardId) ?? { boardId, factor: 1, partsAreaSqM: 0, sheetsAreaSqM: 0, sheets: 0 };
    const partsAreaSqM = prev.partsAreaSqM + r.partsAreaSqM;
    const sheetsAreaSqM = prev.sheetsAreaSqM + r.sheetsAreaSqM;
    out.set(boardId, {
      boardId,
      partsAreaSqM,
      sheetsAreaSqM,
      sheets: prev.sheets + r.sheets.length,
      factor: partsAreaSqM > 0 ? sheetsAreaSqM / partsAreaSqM : 1,
    });
  }
  return out;
}

function nestUncached(parts: CutPart[], sizes: SheetSize[], cut: CutSpec): NestResult {
  // One piece per physical piece — a "Shelf ×4" row is four pieces.
  const pieces: Piece[] = toPieces(parts.flatMap((p) => Array.from({ length: p.quantity }, () => p)));
  const partsAreaMm2 = pieces.reduce((t, pc) => t + pc.l * pc.wd, 0);
  const options = (sizes.length > 0 ? sizes : [DEFAULT_SHEET_SIZE]).filter(
    (z) => z.lengthMm > 0 && z.widthMm > 0
  );
  const spec = (z: SheetSize): SheetSpec => ({ ...z, ...cut });
  const ascending = [...options].sort((a, b) => sheetArea(a) - sheetArea(b));

  const plans = options.map((size) => {
    const main = bestSingleSize(pieces, spec(size));
    let sheets = [...main.sheets];
    // Pieces that didn't fit this size → the smallest other size that
    // takes them.
    let leftover = toPieces(main.unplaced);
    for (const other of ascending) {
      if (leftover.length === 0 || other === size) continue;
      const r = bestSingleSize(leftover, spec(other));
      sheets = [...sheets, ...r.sheets];
      leftover = toPieces(r.unplaced);
    }
    // Finish smaller where one smaller sheet holds the last sheet's pieces.
    const lastIdx = main.sheets.length - 1;
    if (lastIdx >= 0) {
      const lastPieces = toPieces(main.sheets[lastIdx].pieces.map((pc) => pc.part));
      for (const smaller of ascending) {
        if (sheetArea(smaller) >= sheetArea(size)) break;
        const r = bestSingleSize(lastPieces, spec(smaller));
        if (r.sheets.length === 1 && r.unplaced.length === 0) {
          sheets = sheets.map((sh, k) => (k === lastIdx ? r.sheets[0] : sh));
          break;
        }
      }
    }
    return { sheets, unplaced: leftover.map((pc) => pc.part) };
  });

  const area = (p: (typeof plans)[number]) => p.sheets.reduce((t, sh) => t + sh.lengthMm * sh.widthMm, 0);
  const best =
    plans.sort(
      (a, b) =>
        a.unplaced.length - b.unplaced.length || area(a) - area(b) || a.sheets.length - b.sheets.length
    )[0] ?? { sheets: [], unplaced: [] };

  const sheetsAreaMm2 = best.sheets.reduce((t, sh) => t + sh.lengthMm * sh.widthMm, 0);
  const placedAreaMm2 = partsAreaMm2 - best.unplaced.reduce((t, p) => t + p.lengthMm * p.widthMm, 0);
  return {
    ...best,
    partsAreaSqM: placedAreaMm2 / MM2_PER_SQM,
    sheetsAreaSqM: sheetsAreaMm2 / MM2_PER_SQM,
    wastePercent: sheetsAreaMm2 > 0 ? (1 - placedAreaMm2 / sheetsAreaMm2) * 100 : 0,
  };
}
