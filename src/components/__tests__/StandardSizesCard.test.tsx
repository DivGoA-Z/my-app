// @vitest-environment jsdom
//
// Screen test for Catalogue → Cabinets' Standard sizes (§147): cabinets
// off the standard are listed; "Use standard" and "Keep as exception"
// save the right change; editing the standard saves it. Store actions are
// spies: nothing reaches Supabase.

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore } from '../../test/store';
import { useLayoutStore } from '../../store/layoutStore';
import { StandardSizesCard } from '../inventory/StandardSizesCard';
import type { CatalogItem } from '../../types/Catalog';

const cab = (id: string, label: string, moduleType: CatalogItem['moduleType'], depthMm: number, heightMm: number, extra: Partial<CatalogItem> = {}) =>
  ({ id, label, category: 'Base', moduleType, widthMm: 600, depthMm, heightMm, material: 'HDMR', finishId: 'f', unitPrice: 0, createdAt: '', updatedAt: '', ...extra }) as CatalogItem;

const items = [
  cab('a', 'Base 600', 'base-cabinet', 600, 850),
  cab('b', 'Low base 600', 'base-cabinet', 600, 720),
  cab('c', 'Wall 600 deep', 'wall-cabinet', 350, 700),
  cab('d', 'Corner 900', 'corner-magic', 900, 850),
  cab('e', 'Tall 2400', 'tall-unit', 600, 2400, { sizeException: true }),
];

function setup() {
  const upsert = vi.fn(async () => {});
  resetStore({ upsertCabinetCatalogItem: upsert });
  render(<StandardSizesCard items={items} />);
  return { upsert };
}

describe('Standard sizes card (§147)', () => {
  it('lists only cabinets off the standard, not corners at their own depth or kept exceptions', () => {
    setup();
    expect(screen.getByText('2 cabinets differ from the standard')).toBeInTheDocument();
    expect(screen.getByText('Low base 600')).toBeInTheDocument();
    expect(screen.getByText('Wall 600 deep')).toBeInTheDocument();
    expect(screen.queryByText('Corner 900')).toBeNull();
    expect(screen.queryByText('Tall 2400')).toBeNull();
  });

  it('Use standard resizes one; Keep as exception marks it', async () => {
    const { upsert } = setup();
    await userEvent.click(screen.getAllByRole('button', { name: 'Use standard' })[0]);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'b', depthMm: 600, heightMm: 850 }));
    await userEvent.click(screen.getAllByRole('button', { name: 'Keep as exception' })[1]);
    expect(upsert).toHaveBeenLastCalledWith(expect.objectContaining({ id: 'c', depthMm: 350, sizeException: true }));
  });

  it('saves an edited standard', async () => {
    setup();
    const depths = screen.getAllByLabelText(/Depth/);
    await userEvent.clear(depths[1]);
    await userEvent.type(depths[1], '350');
    await userEvent.click(screen.getByRole('button', { name: 'Save standard sizes' }));
    expect(useLayoutStore.getState().standardSizes.wall.depthMm).toBe(350);
  });
});
