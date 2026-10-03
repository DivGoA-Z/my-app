// @vitest-environment jsdom
//
// Screen tests for the Cabinet Designer (§66): panel ticks change the
// parts list, edits are a draft until Save, Save writes the catalogue
// row, and Back always leaves (it once looped back into the Designer).

import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CabinetDesignerPage } from '../designer/CabinetDesignerPage';
import { resetStore } from '../../test/store';
import type { CatalogItem } from '../../types/Catalog';

// The 3D preview needs WebGL, which jsdom doesn't have; it's checked by eye.
vi.mock('../designer/CabinetPreview3D', () => ({ CabinetPreview3D: () => null }));

const row: CatalogItem = {
  id: 'cat-base-600',
  category: 'Base',
  label: 'Base 600',
  moduleType: 'base-cabinet',
  widthMm: 600,
  depthMm: 600,
  heightMm: 720,
  material: 'HDMR',
  finishId: 'none',
  frontLayout: { kind: 'single-door' },
  unitPrice: 0,
  createdAt: '',
  updatedAt: '',
};

const target = { kind: 'catalogue', itemId: row.id } as const;

describe('Cabinet Designer', () => {
  it('unticking a panel removes its part and enables Save; Discard puts it back', async () => {
    const user = userEvent.setup();
    resetStore({ cabinetCatalog: [row] });
    render(<CabinetDesignerPage target={target} onBack={() => {}} />);
    const save = screen.getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    expect(screen.getByRole('cell', { name: 'Back' })).toBeInTheDocument();

    await user.click(screen.getByRole('checkbox', { name: 'Back built' }));
    expect(save).toBeEnabled();
    expect(screen.queryByRole('cell', { name: 'Back' })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Discard changes' }));
    expect(save).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Back built' })).toBeChecked();
  });

  it('Save writes the panel choice to the catalogue row', async () => {
    const user = userEvent.setup();
    const store = resetStore({ cabinetCatalog: [row] });
    render(<CabinetDesignerPage target={target} onBack={() => {}} />);
    await user.click(screen.getByRole('checkbox', { name: 'Back built' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(store.upsertCabinetCatalogItem).toHaveBeenCalledWith(
      expect.objectContaining({ id: row.id, panels: expect.objectContaining({ back: expect.objectContaining({ included: false }) }) })
    );
  });

  it('Back leaves the Designer', async () => {
    const user = userEvent.setup();
    resetStore({ cabinetCatalog: [row] });
    const onBack = vi.fn();
    render(<CabinetDesignerPage target={target} onBack={onBack} />);
    await user.click(screen.getByRole('button', { name: '← Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});
