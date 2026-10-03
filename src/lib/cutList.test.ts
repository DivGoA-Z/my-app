// Tests for the cutting list (lib/cutList.ts). Every expected size here
// was first worked out by hand and checked by a throwaway run during
// docs/DECISIONS.md §41-§48; these make those checks permanent (§55).

import { describe, expect, it } from 'vitest';
import { computeCutList, type CutPart } from './cutList';
import { defaultRateCard } from '../types/rates';
import { baseUnit, cabinet, construction, lShapedKitchen } from '../test/fixtures';

const rates = defaultRateCard();
const parts = (cabs: Parameters<typeof computeCutList>[0], c = construction()) =>
  computeCutList(cabs, c, [], rates, []).parts;
const find = (ps: CutPart[], name: string) => ps.find((p) => p.name === name)!;
const size = (p: CutPart) => [p.lengthMm, p.widthMm, p.thicknessMm];

describe('600×600×720 base unit, default construction', () => {
  const ps = parts([baseUnit()]);

  it('sides are full height × (depth − 18mm shutter)', () => {
    expect(size(find(ps, 'Left side'))).toEqual([720, 582, 18]);
    expect(size(find(ps, 'Right side'))).toEqual([720, 582, 18]);
  });
  it('bottom fits between the sides', () => {
    expect(size(find(ps, 'Bottom'))).toEqual([564, 582, 18]);
  });
  it('base unit gets two rails, not a full top', () => {
    expect(size(find(ps, 'Front rail'))).toEqual([564, 100, 18]);
    expect(size(find(ps, 'Back rail'))).toEqual([564, 100, 18]);
    expect(ps.some((p) => p.name === 'Top')).toBe(false);
  });
  it('grooved 6mm back is the inner opening plus 8mm each side', () => {
    expect(size(find(ps, 'Back'))).toEqual([700, 580, 6]);
  });
  it('shutter is the face minus 3mm reveals, banded all round', () => {
    const s = find(ps, 'Shutter');
    expect(size(s)).toEqual([714, 594, 18]);
    expect(s.edgeBanding).toEqual({ length: 2, width: 2 });
  });
});

describe('construction conventions', () => {
  it('bottom over the sides shortens the sides and widens the bottom', () => {
    const ps = parts([baseUnit({ heightMm: 850 })], construction({ bottomFit: 'over-sides' }));
    expect(find(ps, 'Left side').lengthMm).toBe(832);
    expect(find(ps, 'Bottom').lengthMm).toBe(600);
  });
  it('the top corner rule applies to rails too (§47)', () => {
    const ps = parts([baseUnit({ heightMm: 850 })], construction({ topFit: 'over-sides' }));
    expect(find(ps, 'Front rail').lengthMm).toBe(600);
    expect(find(ps, 'Left side').lengthMm).toBe(832);
  });
  it('a nailed-on back is full size and takes its thickness out of the depth', () => {
    const ps = parts([baseUnit()], construction({ backFit: 'nailed-on' }));
    expect(size(find(ps, 'Back'))).toEqual([720, 600, 6]);
    expect(find(ps, 'Left side').widthMm).toBe(576);
  });
  it('an inset back pushes top/bottom forward of itself', () => {
    const ps = parts([baseUnit()], construction({ backFit: 'inset-full' }));
    expect(find(ps, 'Bottom').widthMm).toBe(576);
  });
  it('"carcass only" depth makes the carcass the full stated depth (§47)', () => {
    const ps = parts([baseUnit({ heightMm: 850 })], construction({ depthIncludesFront: false }));
    expect(size(find(ps, 'Left side'))).toEqual([850, 600, 18]);
  });
});

describe('rounding and edge banding', () => {
  it('rounds exact halves DOWN so double doors never exceed the cabinet (§41)', () => {
    const ps = parts([cabinet('wall-cabinet', 800, 350, 720, { frontLayout: { kind: 'double-door' } })]);
    const leaves = ps.filter((p) => p.name === 'Shutter');
    expect(leaves.map((p) => p.widthMm)).toEqual([395, 395]);
    expect(2 * 395 + 3 * 3).toBeLessThanOrEqual(800);
  });
  it('wall cabinet sides band their bottom edge too — seen from below (§47)', () => {
    const ps = parts([cabinet('wall-cabinet', 600, 350, 720, { frontLayout: { kind: 'single-door' } })]);
    expect(find(ps, 'Left side').edgeBanding).toEqual({ length: 1, width: 1 });
  });
  it('base cabinet sides band only the front edge', () => {
    expect(find(parts([baseUnit()]), 'Left side').edgeBanding).toEqual({ length: 1, width: 0 });
  });
  it('backs and back rails are never banded', () => {
    const ps = parts([baseUnit()]);
    expect(find(ps, 'Back').edgeBanding).toEqual({ length: 0, width: 0 });
    expect(find(ps, 'Back rail').edgeBanding).toEqual({ length: 0, width: 0 });
  });
});

describe('panels, extra shelves, extra and loose parts', () => {
  it('an unticked back is not listed', () => {
    expect(parts([baseUnit({ panels: { back: { included: false } } })]).some((p) => p.name === 'Back')).toBe(false);
  });
  it('a per-panel board changes that panel only', () => {
    const ps = parts([baseUnit({ panels: { leftSide: { boardId: 'board-bwp-18' } } })]);
    expect(find(ps, 'Left side').boardName).toContain('BWP');
    expect(find(ps, 'Right side').boardName).toContain('HDMR');
  });
  it('an extra shelf in a door cabinet is a real shelf (§48)', () => {
    const ps = parts([baseUnit({ panels: { shelves: { extraCount: 1 } } })]);
    expect(size(find(ps, 'Shelf'))).toEqual([564, 556, 18]);
  });
  it('extra parts on a cabinet follow its carcass board by default', () => {
    const ps = parts([
      baseUnit({ extraParts: [{ id: 'e', name: 'Stiffener', lengthMm: 564, widthMm: 100, quantity: 2, edgeLong: 1, edgeShort: 0 }] }),
    ]);
    const s = find(ps, 'Stiffener');
    expect([s.lengthMm, s.widthMm, s.quantity]).toEqual([564, 100, 2]);
    expect(s.boardId).toBe('board-hdmr-18');
  });
  it('loose parts are listed under "Loose"', () => {
    const cl = computeCutList([], construction(), [], rates, [
      { id: 'f', name: 'Filler', lengthMm: 720, widthMm: 75, quantity: 2, boardId: 'board-hdmr-18', edgeLong: 1, edgeShort: 0 },
    ]);
    expect(cl.parts).toHaveLength(1);
    expect(cl.parts[0].cabinetRef).toBe('Loose');
  });
  it('drawer fronts replace the door — the front is never counted twice', () => {
    const drawers = parts([cabinet('drawer-unit', 600, 600, 720, { frontLayout: { kind: 'drawers', count: 3 } })]);
    const fronts = drawers.filter((p) => p.kind === 'front');
    expect(fronts).toHaveLength(3);
    expect(drawers.some((p) => p.name === 'Shutter')).toBe(false);
  });
});

describe('where fronts are cut from (§57)', () => {
  const finish = (patternCategory: 'solid' | 'wood') => [{ id: 'f', label: 'F', patternCategory }] as never;
  const shutter = (frontsFrom: 'carcass-board' | 'prelaminated', pattern?: 'solid' | 'wood') =>
    find(computeCutList([baseUnit({ finishId: 'f' })], construction({ frontsFrom }), pattern ? finish(pattern) : [], rates, []).parts, 'Shutter');

  it('cut from the carcass board and laminated after: may turn, and shares the carcass stack', () => {
    const s = shutter('carcass-board', 'wood');
    expect(s.grainFixed).toBe(false);
    expect(s.stockKey).toBe('board-hdmr-18');
  });
  it('pre-laminated wood grain: grain fixed, its own stack per finish', () => {
    const s = shutter('prelaminated', 'wood');
    expect(s.grainFixed).toBe(true);
    expect(s.stockKey).toContain('|front|');
  });
  it('pre-laminated solid colour: may turn', () => {
    expect(shutter('prelaminated', 'solid').grainFixed).toBe(false);
  });
  it('shared stock puts carcass and fronts in one group; pre-laminated splits them', () => {
    const labels = (frontsFrom: 'carcass-board' | 'prelaminated') =>
      computeCutList(lShapedKitchen(), construction({ frontsFrom }), [], rates, []).groups.map((g) => g.label);
    expect(labels('carcass-board')).toEqual(['HDMR 18mm — carcass, fronts', 'HDMR 6mm — backs']);
    expect(labels('prelaminated')).toHaveLength(3);
  });
});

describe('drawer boxes (§56)', () => {
  const unit = () => cabinet('drawer-unit', 600, 600, 720, { frontLayout: { kind: 'drawers', count: 3 } });
  const byName = (ps: CutPart[], name: string) => ps.filter((p) => p.name === name);

  it('tandem: a bottom and a back per drawer, sized from the standard rules', () => {
    const ps = parts([unit()]);
    // inner width 564, inner depth 582 → 550mm runner; fronts 236 high
    expect(byName(ps, 'Drawer bottom').map(size)).toEqual([[540, 489, 18], [540, 489, 18], [540, 489, 18]]);
    expect(byName(ps, 'Drawer back').map(size)).toEqual([[477, 176, 18], [477, 176, 18], [477, 176, 18]]);
    expect(byName(ps, 'Drawer side')).toHaveLength(0);
  });
  it('wooden: two sides, inner front & back, and a thin grooved bottom per drawer', () => {
    const ps = parts([unit()], construction({ drawerBox: 'wooden' }));
    expect(byName(ps, 'Drawer side').map((p) => [p.lengthMm, p.widthMm, p.quantity])).toEqual(
      Array(3).fill([550, 196, 2])
    );
    expect(byName(ps, 'Drawer inner front & back').map((p) => [p.lengthMm, p.widthMm, p.quantity])).toEqual(
      Array(3).fill([503, 196, 2])
    );
    expect(byName(ps, 'Drawer bottom').map(size)).toEqual(Array(3).fill([530, 519, 6]));
  });
  it('unticking "Drawer boxes" (bought ready-made) lists none', () => {
    const ps = parts([{ ...unit(), panels: { drawerBoxes: { included: false } } }]);
    expect(ps.some((p) => p.name.startsWith('Drawer') && p.kind !== 'front')).toBe(false);
  });
  it('a cabinet too shallow for any runner warns instead of guessing', () => {
    const cl = computeCutList(
      [cabinet('drawer-unit', 600, 250, 720, { frontLayout: { kind: 'drawers', count: 2 } })],
      construction(),
      [],
      rates,
      []
    );
    expect(cl.parts.some((p) => p.name === 'Drawer bottom')).toBe(false);
    expect(cl.warnings.some((w) => w.includes('too shallow'))).toBe(true);
  });
});

describe('3D positions match the cut sizes (§46)', () => {
  const conventions = [
    construction(),
    construction({ drawerBox: 'wooden' }),
    construction({ bottomFit: 'over-sides', topFit: 'over-sides', backFit: 'nailed-on' }),
    construction({ backFit: 'inset-full' }),
    construction({ depthIncludesFront: false }),
  ];
  const cabs = [
    ...lShapedKitchen(),
    cabinet('tall-unit', 600, 600, 2100, {
      frontLayout: { kind: 'mixed', rows: [{ kind: 'open-shelf', count: 2, heightRatio: 1 }, { kind: 'single-door', heightRatio: 1 }] },
      panels: { shelves: { extraCount: 1 } },
    }),
  ];

  for (const c of conventions) {
    const ps = computeCutList(cabs, c, [], rates, []).parts.filter((p) => p.role !== 'extra');
    it(`every box matches its part and sits inside its cabinet (${c.backFit}, ${c.drawerBox}, ${c.depthIncludesFront ? 'incl. shutter' : 'carcass only'})`, () => {
      for (const p of ps) {
        const cab = cabs.find((x) => x.id === p.cabinetId)!;
        expect(p.boxes.length).toBe(p.quantity / cab.quantity);
        for (const b of p.boxes) {
          const got = [b.sx, b.sy, b.sz].map(Math.round).sort((x, y) => x - y);
          const want = [p.lengthMm, p.widthMm, p.thicknessMm].sort((x, y) => x - y);
          got.forEach((v, i) => expect(Math.abs(v - want[i])).toBeLessThanOrEqual(1));
          const frontSlack = p.kind === 'front' && !c.depthIncludesFront ? 18 : 0;
          expect(Math.abs(b.cx) + b.sx / 2).toBeLessThanOrEqual(cab.widthMm / 2 + 0.5);
          expect(Math.abs(b.cy) + b.sy / 2).toBeLessThanOrEqual(cab.heightMm / 2 + 0.5);
          expect(Math.abs(b.cz) + b.sz / 2).toBeLessThanOrEqual(cab.depthMm / 2 + frontSlack + 0.5);
        }
      }
    });
    it(`no two panels occupy the same space (${c.backFit}, ${c.drawerBox}, ${c.depthIncludesFront ? 'incl. shutter' : 'carcass only'})`, () => {
      for (const cab of cabs) {
        // A grooved back, and a wooden drawer's grooved bottom, sit IN
        // their grooves — overlapping the panels around them by design.
        const grooved = (p: CutPart) =>
          (p.name === 'Back' && c.backFit === 'grooved') || (p.name === 'Drawer bottom' && c.drawerBox === 'wooden');
        const pieces = ps
          .filter((p) => p.cabinetId === cab.id && !grooved(p))
          .flatMap((p) => p.boxes);
        const ov = (a: number, as: number, b: number, bs: number) =>
          Math.max(0, Math.min(a + as / 2, b + bs / 2) - Math.max(a - as / 2, b - bs / 2));
        for (let i = 0; i < pieces.length; i++)
          for (let j = i + 1; j < pieces.length; j++) {
            const a = pieces[i];
            const b = pieces[j];
            expect(ov(a.cx, a.sx, b.cx, b.sx) * ov(a.cy, a.sy, b.cy, b.sy) * ov(a.cz, a.sz, b.cz, b.sz)).toBeLessThanOrEqual(1);
          }
      }
    });
  }
});
