// @vitest-environment jsdom
//
// Screen test for "Your default catalogue" (§107): save asks first and
// records the time; going back asks (it resets prices), then reloads the
// catalogue; with no default saved, going back is unavailable. The
// database calls are mocked: no test reaches Supabase.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { resetStore } from '../../test/store';
import { useAuthStore } from '../../store/authStore';
import { DefaultCatalogueCard } from '../inventory/DefaultCatalogueCard';
import { ConfirmDialog } from '../common/ConfirmDialog';

const api = vi.hoisted(() => ({
  savedAt: null as string | null,
  save: vi.fn(async () => 44),
  restore: vi.fn(async () => 44),
}));
vi.mock('../../lib/catalogDefaults', () => ({
  fetchDefaultSavedAt: vi.fn(async () => api.savedAt),
  saveMyCatalogDefault: api.save,
  restoreMyCatalogDefault: api.restore,
}));

function setup(savedAt: string | null) {
  api.savedAt = savedAt;
  api.save.mockClear();
  api.restore.mockClear();
  const loadInventory = vi.fn(async () => {});
  resetStore({ loadInventory });
  useAuthStore.setState({ businessId: 'biz_a' });
  render(
    <>
      <DefaultCatalogueCard />
      <ConfirmDialog />
    </>
  );
  return { loadInventory };
}

describe('Your default catalogue', () => {
  it('cannot go back before a default is saved; saving asks first', async () => {
    const user = userEvent.setup();
    setup(null);
    expect(await screen.findByText('No default saved yet.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Go back to my default' }) as HTMLButtonElement).disabled).toBe(true);
    await user.click(screen.getByRole('button', { name: 'Save as my default' }));
    await user.click(await screen.findByRole('button', { name: 'Save as default' }));
    expect(api.save).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(screen.getByText(/Default saved/)).toBeTruthy());
  });

  it('going back warns about prices, then restores and reloads the catalogue', async () => {
    const user = userEvent.setup();
    const { loadInventory } = setup('2026-10-07T10:00:00.000Z');
    await user.click(await screen.findByRole('button', { name: 'Go back to my default' }));
    expect(await screen.findByText(/prices included/)).toBeTruthy();
    await user.click(screen.getByRole('button', { name: 'Go back to default' }));
    await waitFor(() => expect(loadInventory).toHaveBeenCalled());
    expect(api.restore).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the warning is cancelled', async () => {
    const user = userEvent.setup();
    setup('2026-10-07T10:00:00.000Z');
    await user.click(await screen.findByRole('button', { name: 'Go back to my default' }));
    await user.click(await screen.findByRole('button', { name: 'Cancel' }));
    expect(api.restore).not.toHaveBeenCalled();
  });
});
