// Blind/magic corner fixed panel (§116): where it goes, what it does to
// the fronts, the swing check and the cutting list.

import { describe, expect, it } from 'vitest';
import { doorsBesidePanel, fitCornerPanel, fitCornerPanelDetail } from './cornerPanel';
import { cabinetFrontBreakdown, cornerPanelWidthMm } from './fronts';
import { detectCabinetReachConflicts } from './cabinetClearance';
import { computeCutList } from './cutList';
import { currentFootprintRect } from './footprint';
import { defaultFrontLayout } from '../types/front';
import { defaultRateCard } from '../types/rates';
import { cabinet, construction } from '../test/fixtures';

const room = { widthMm: 3000, depthMm: 3000 };
const rates = defaultRateCard();

// A blind corner on the north wall, in the north-west corner, and the
// west wall's run meeting it (a 600 × 600 unit turned to face east).
const blind = (extra = {}) => cabinet('corner-blind', 1000, 600, 720, { x: 0, y: 0, ...extra });
const westRun = (extra = {}) => cabinet('base-cabinet', 600, 600, 720, { x: 0, y: 600, rotationDeg: 270, ...extra });

describe('fitCornerPanel', () => {
  it('goes on the end the meeting run covers, as wide as that run is deep', () => {
    expect(fitCornerPanel(blind(), room, [westRun()])).toEqual({ side: 'left', widthMm: 600 });
  });

  it('takes the meeting run’s PHYSICAL depth (shutter in front of the carcass)', () => {
    // 600 carcass + 18 shutter, turned to face east: 618 out from the wall.
    const run = cabinet('base-cabinet', 600, 618, 720, { rotationDeg: 270, x: 9, y: 591 });
    expect(currentFootprintRect(run)).toMatchObject({ x: 0, widthMm: 618, y: 600 });
    expect(fitCornerPanel(blind(), room, [run])).toEqual({ side: 'left', widthMm: 618 });
  });

  it('finds the right-hand end too', () => {
    const b = blind({ x: 2000 });
    const run = westRun({ x: 2400, rotationDeg: 90 });
    expect(fitCornerPanel(b, room, [run])).toEqual({ side: 'right', widthMm: 600 });
  });

  it('works on a turned unit: on the west wall, the north end is its right', () => {
    // 1000 wide along the west wall (y 0..1000), facing east.
    const b = blind({ rotationDeg: 270, x: -200, y: 200 });
    expect(currentFootprintRect(b)).toMatchObject({ x: 0, y: 0, widthMm: 600, depthMm: 1000 });
    const northRun = cabinet('base-cabinet', 600, 600, 720, { x: 600, y: 0 });
    expect(fitCornerPanel(b, room, [northRun])).toEqual({ side: 'right', widthMm: 600 });
  });

  it('with no meeting run yet: the end against a wall, the kitchen’s usual run depth', () => {
    expect(fitCornerPanel(blind(), room, [])).toEqual({ side: 'left', widthMm: 600 });
    expect(fitCornerPanel(blind({ x: 2000 }), room, [])).toEqual({ side: 'right', widthMm: 600 });
    // A 900-deep catalogue blind corner: its own depth says nothing about
    // the run that will meet it. The other base cabinets do.
    const deep = cabinet('corner-blind', 900, 900, 850, { x: 0, y: 0 });
    const runs = [1200, 1800].map((x) => cabinet('base-cabinet', 600, 618, 720, { x, y: 0 }));
    expect(fitCornerPanel(deep, room, runs)).toEqual({ side: 'left', widthMm: 618 });
    expect(fitCornerPanel(deep, room, [])).toEqual({ side: 'left', widthMm: 600 });
  });

  it('ignores wall cabinets and cabinets beside it rather than in front', () => {
    const wall = cabinet('wall-cabinet', 600, 600, 720, { x: 0, y: 600, rotationDeg: 270 });
    const beside = cabinet('base-cabinet', 600, 600, 720, { x: 1000, y: 0 });
    expect(fitCornerPanel(blind({ x: 0 }), room, [wall, beside])).toEqual({ side: 'left', widthMm: 600 });
  });

  it('hinges the door away from the panel, so it opens into free floor', () => {
    expect(doorsBesidePanel(blind(), { side: 'left', widthMm: 600 })).toEqual({ kind: 'single-door', hinge: 'right' });
    expect(doorsBesidePanel(blind(), { side: 'right', widthMm: 600 })).toEqual({ kind: 'single-door', hinge: 'left' });
  });
});

describe('fronts with a fixed panel', () => {
  const b = blind({ cornerPanel: { side: 'left', widthMm: 600 }, frontLayout: { kind: 'single-door', hinge: 'right' } });

  it('splits the front: a fixed panel at the corner end, the door beside it', () => {
    const f = cabinetFrontBreakdown(b, defaultFrontLayout('corner-blind', 1000), undefined, rates.hardware);
    const panel = f.panels.find((p) => p.cornerPanel)!;
    const door = f.panels.find((p) => !p.cornerPanel)!;
    expect(panel).toMatchObject({ kind: 'false-front', widthMm: 600, heightMm: 720, centerXMm: -200, handle: null });
    expect(door.kind).toBe('single-door');
    expect(door.centerXMm).toBeCloseTo(300, 0);
    // Hinges only for the one door; the panel has none.
    expect(f.hardware.find((h) => h.type === 'hinge')?.count).toBe(2);
  });

  it('never leaves less than 150 mm of door', () => {
    expect(cornerPanelWidthMm({ ...b, cornerPanel: { side: 'left', widthMm: 950 } })).toBe(850);
    // Only blind and magic corners have one.
    expect(cornerPanelWidthMm({ ...b, moduleType: 'base-cabinet' })).toBe(0);
  });

  it('is listed on the cutting list as its own board part', () => {
    const parts = computeCutList([b], construction(), [], rates, []).parts;
    const panel = parts.find((p) => p.name === 'Corner fixed panel')!;
    expect(panel).toBeDefined();
    expect([panel.lengthMm, panel.widthMm]).toEqual([720, 600]);
    expect(parts.filter((p) => p.name === 'Shutter')).toHaveLength(1);
  });
});

describe('swing check with a fixed panel', () => {
  it('the old full-width doors swing into the meeting run; the fitted unit does not', () => {
    const legacy = blind();
    expect(detectCabinetReachConflicts([legacy, westRun()], 3000, 3000).issues.length).toBeGreaterThan(0);

    const fitted = blind({ cornerPanel: { side: 'left', widthMm: 600 }, frontLayout: { kind: 'single-door', hinge: 'right' } });
    expect(detectCabinetReachConflicts([fitted, westRun()], 3000, 3000).issues).toEqual([]);
  });

  it('still flags a panel too narrow for the run: the door then hits its box', () => {
    const narrow = blind({ cornerPanel: { side: 'left', widthMm: 300 }, frontLayout: { kind: 'single-door', hinge: 'right' } });
    expect(detectCabinetReachConflicts([narrow, westRun()], 3000, 3000).issues.length).toBeGreaterThan(0);
  });
});

describe('wall corners (§118)', () => {
  // A 900 wall cabinet on the north wall, hung 1450–2170, in the north-west
  // corner; the west wall's wall cabinets (350 deep) hang in front of its end.
  const wallUnit = (extra = {}) => cabinet('wall-cabinet', 900, 350, 720, { x: 0, y: 0, ...extra });
  const westWall = (extra = {}) => cabinet('wall-cabinet', 600, 350, 720, { x: -125, y: 475, rotationDeg: 270, ...extra });

  it('fits against the wall run meeting it, at its own height', () => {
    expect(currentFootprintRect(westWall())).toMatchObject({ x: 0, y: 350, widthMm: 350 });
    expect(fitCornerPanelDetail(wallUnit(), room, [westWall()])).toEqual({ panel: { side: 'left', widthMm: 350 }, metRun: true });
  });

  it('never counts the base cabinets below as its meeting run', () => {
    // A base unit in the same plan spot, on the floor.
    expect(fitCornerPanelDetail(wallUnit(), room, [westRun()]).metRun).toBe(false);
  });

  it('an ordinary wall cabinet with nothing meeting it gets no panel on placement', () => {
    const d = fitCornerPanelDetail(wallUnit({ x: 1000 }), room, []);
    expect(d.metRun).toBe(false);
    // (Picked by hand in the inspector, it would default to a wall run's depth.)
    expect(d.panel.widthMm).toBe(350);
  });

  it('splits a wall cabinet’s front the same way', () => {
    const w = wallUnit({ cornerPanel: { side: 'left', widthMm: 350 }, frontLayout: { kind: 'single-door', hinge: 'right' } });
    const f = cabinetFrontBreakdown(w, defaultFrontLayout('wall-cabinet', 900), undefined, rates.hardware);
    expect(f.panels.find((p) => p.cornerPanel)?.widthMm).toBe(350);
    // The 550 left over, less the reveal gaps between doors.
    expect(f.panels.find((p) => !p.cornerPanel)!.widthMm).toBeGreaterThan(530);
    expect(f.panels.find((p) => !p.cornerPanel)!.widthMm).toBeLessThanOrEqual(550);
  });
});
