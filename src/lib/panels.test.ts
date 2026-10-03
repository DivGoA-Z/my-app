// Tests for panel specs and board resolution (lib/panels.ts,
// docs/DECISIONS.md §42-§48), and the catalogue re-import fix (§54).

import { describe, expect, it } from 'vitest';
import { describePanels, normalizePanels, resolveCarcassBoard, samePanels } from './panels';
import { parseCabinetCatalogRows } from './importExport/cabinetImportExport';
import { defaultRateCard } from '../types/rates';
import type { CatalogItem } from '../types/Catalog';

describe('panel spec helpers', () => {
  it('a spec restating defaults means "nothing customised"', () => {
    expect(normalizePanels({ back: { included: true }, top: { boardId: undefined } })).toBeUndefined();
    expect(samePanels(undefined, { back: { included: true } })).toBe(true);
  });
  it('describes only what differs from the default', () => {
    expect(describePanels(undefined)).toBe('All panels, default boards');
    expect(
      describePanels({ back: { included: false }, top: { topStyle: 'rails' }, leftSide: { boardId: 'b' }, shelves: { extraCount: 2 } })
    ).toBe('No back · rails top · +2 shelves · 1 custom board');
  });
  it('an unticked panel keeps its board, so re-ticking restores it', () => {
    expect(normalizePanels({ bottom: { included: false, boardId: 'board-bwp-18' } })).toEqual({
      bottom: { included: false, boardId: 'board-bwp-18' },
    });
  });
});

describe('carcass board resolution (§44)', () => {
  const boards = [...defaultRateCard().boards, { id: 'hdmr-25', material: 'HDMR' as const, thicknessMm: 25, ratePerSqM: 1900 }];
  it('a cabinet with no board chosen stays on its original 18mm line, even when a thicker one exists', () => {
    expect(resolveCarcassBoard(boards, { material: 'HDMR' })?.id).toBe('board-hdmr-18');
  });
  it('an explicit choice wins', () => {
    expect(resolveCarcassBoard(boards, { material: 'HDMR', carcassBoardId: 'hdmr-25' })?.id).toBe('hdmr-25');
  });
  it('a deleted choice falls back rather than failing', () => {
    expect(resolveCarcassBoard(boards, { material: 'HDMR', carcassBoardId: 'gone' })?.id).toBe('board-hdmr-18');
  });
});

describe('catalogue Excel re-import keeps what the sheet does not carry (§54)', () => {
  const stored: CatalogItem = {
    id: 'cat1', category: 'Base', label: 'Sink 900', moduleType: 'sink-unit', widthMm: 900, depthMm: 600, heightMm: 720,
    material: 'HDMR', finishId: 'f1', unitPrice: 1000, frontLayout: { kind: 'double-door' }, handleId: 'h1',
    panels: { back: { included: false } }, carcassBoardId: 'board-hdmr-18',
    extraParts: [{ id: 'e1', name: 'Stiffener', lengthMm: 864, widthMm: 100, quantity: 1, edgeLong: 1, edgeShort: 0 }],
    createdAt: 'x', updatedAt: 'x',
  };
  const finishes = [{ id: 'f1', label: 'White' }] as never;
  const row = (material: string) => ({
    id: 'cat1', label: 'Sink 900', category: 'Base', module_type: 'sink-unit', width_mm: '900', depth_mm: '600',
    height_mm: '720', material, finish: 'White', unit_price: '1200',
  });

  it('a price-only re-import keeps front, handle, panels, board and extra parts', () => {
    const [r] = parseCabinetCatalogRows([row('HDMR')], [stored], finishes);
    expect(r.errors).toEqual([]);
    expect(r.data).toMatchObject({
      unitPrice: 1200, frontLayout: { kind: 'double-door' }, handleId: 'h1',
      panels: { back: { included: false } }, carcassBoardId: 'board-hdmr-18',
    });
    expect(r.data.extraParts).toHaveLength(1);
  });
  it('changing the material drops the old board choice, keeps the rest', () => {
    const [r] = parseCabinetCatalogRows([row('BWP')], [stored], finishes);
    expect(r.data.carcassBoardId).toBeUndefined();
    expect(r.data.panels).toEqual({ back: { included: false } });
  });
});
