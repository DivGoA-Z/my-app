// Kitchen style defaults (§117): business → project → unit.

import { describe, expect, it } from 'vitest';
import {
  cabinetGroup,
  effectiveStyleDefaults,
  planStyleChange,
  styleFor,
  withStyleDefaults,
  type StyleDefaults,
} from './styleDefaults';
import { cabinet } from '../test/fixtures';

const base = (extra = {}) => cabinet('base-cabinet', 600, 600, 720, { finishId: 'white', ...extra });
const wall = (extra = {}) => cabinet('wall-cabinet', 600, 350, 720, { finishId: 'white', ...extra });
const tall = (extra = {}) => cabinet('tall-unit', 600, 600, 2100, { finishId: 'white', ...extra });

describe('groups and levels', () => {
  it('sorts cabinets into base, wall and tall', () => {
    expect(cabinetGroup('sink-unit')).toBe('base');
    expect(cabinetGroup('corner-blind')).toBe('base');
    expect(cabinetGroup('wall-cabinet')).toBe('wall');
    expect(cabinetGroup('pantry-unit')).toBe('tall');
  });

  it('tall units follow the base cabinets until given their own', () => {
    const d: StyleDefaults = { base: { finishId: 'teak' }, wall: { finishId: 'white' } };
    expect(styleFor(d, 'tall')).toEqual({ finishId: 'teak' });
    expect(styleFor({ ...d, tall: { finishId: 'grey' } }, 'tall')).toEqual({ finishId: 'grey' });
  });

  it('a kitchen uses its own defaults once set, else the business’s', () => {
    const business: StyleDefaults = { base: { finishId: 'white' }, wall: {} };
    const project: StyleDefaults = { base: { finishId: 'teak' }, wall: {} };
    expect(effectiveStyleDefaults(business, undefined)).toBe(business);
    expect(effectiveStyleDefaults(business, project)).toBe(project);
    expect(effectiveStyleDefaults(undefined, undefined)).toEqual({ base: {}, wall: {} });
  });
});

describe('a new cabinet', () => {
  const d: StyleDefaults = {
    base: { finishId: 'teak', handleId: 'gola', carcassBoardId: 'ply-18', material: 'Plywood', colorOverride: null },
    wall: { finishId: 'white' },
  };

  it('takes its group’s defaults over the catalogue item’s', () => {
    const c = withStyleDefaults(base({ handleId: 'bar', colorOverride: '#ff0000' }), d);
    expect(c).toMatchObject({ finishId: 'teak', handleId: 'gola', carcassBoardId: 'ply-18', material: 'Plywood' });
    // null colour = the finish's own: clears the catalogue's tint.
    expect(c.colorOverride).toBeUndefined();
  });

  it('keeps the catalogue value for anything the default leaves unset', () => {
    expect(withStyleDefaults(wall({ handleId: 'bar' }), d)).toMatchObject({ finishId: 'white', handleId: 'bar' });
  });
});

describe('changing a default', () => {
  const before: StyleDefaults = { base: { finishId: 'white' }, wall: { finishId: 'white' } };
  const after: StyleDefaults = { base: { finishId: 'teak' }, wall: { finishId: 'white' } };

  it('moves the cabinets on the old default, leaves hand-set ones to ask about', () => {
    const cabs = [base({ id: 'b1' }), base({ id: 'b2', finishId: 'oak' }), wall({ id: 'w1' }), tall({ id: 't1' })];
    const plan = planStyleChange(cabs, before, after);
    // Tall follows base (no tall default of its own).
    expect(plan.follow).toEqual([
      { id: 'b1', patch: { finishId: 'teak' } },
      { id: 't1', patch: { finishId: 'teak' } },
    ]);
    expect(plan.handSet).toEqual([{ id: 'b2', patch: { finishId: 'teak' } }]);
  });

  it('with no old default, every cabinet in the group follows', () => {
    const plan = planStyleChange([base({ id: 'b1', finishId: 'oak' })], { base: {}, wall: {} }, after);
    expect(plan.follow).toEqual([{ id: 'b1', patch: { finishId: 'teak' } }]);
    expect(plan.handSet).toEqual([]);
  });

  it('only the fields that changed move', () => {
    const b2: StyleDefaults = { base: { finishId: 'white', handleId: 'gola' }, wall: {} };
    const plan = planStyleChange([base({ id: 'b1', handleId: 'bar' })], { base: { finishId: 'white', handleId: 'bar' }, wall: {} }, b2);
    expect(plan.follow).toEqual([{ id: 'b1', patch: { handleId: 'gola' } }]);
  });

  it('a colour default reaches cabinets on the finish’s own colour', () => {
    const plan = planStyleChange(
      [base({ id: 'b1' }), base({ id: 'b2', colorOverride: '#123456' })],
      { base: { colorOverride: null }, wall: {} },
      { base: { colorOverride: '#c08a4e' }, wall: {} }
    );
    expect(plan.follow).toEqual([{ id: 'b1', patch: { colorOverride: '#c08a4e' } }]);
    expect(plan.handSet).toEqual([{ id: 'b2', patch: { colorOverride: '#c08a4e' } }]);
  });

  it('a board default carries its material with it', () => {
    const plan = planStyleChange(
      [base({ id: 'b1' })],
      { base: {}, wall: {} },
      { base: { carcassBoardId: 'ply-18', material: 'Plywood' }, wall: {} }
    );
    expect(plan.follow[0].patch).toEqual({ carcassBoardId: 'ply-18', material: 'Plywood' });
  });
});
