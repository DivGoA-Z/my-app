// @vitest-environment jsdom
//
// Screen test for the duplicates merge (§80): references move to the
// copy kept BEFORE the others are deleted, and the default handle is
// always the one kept.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DuplicatesBanner } from '../inventory/DuplicatesReview';
import { resetStore } from '../../test/store';
import { DEFAULT_HANDLE_ID, type HandleSpec } from '../../types/front';

const calls: string[] = [];
vi.mock('../../lib/duplicates', async (orig) => ({
  ...(await orig<typeof import('../../lib/duplicates')>()),
  fetchLayoutRefs: vi.fn(async () => [{ id: 'L1', cabinets: [{ handleId: 'h-copy' }], appliances: [], fixtures: [] }]),
  repointDesigns: vi.fn(async (kind: string, removed: string[], keep: string) => {
    calls.push(`repoint ${kind} ${removed.join(',')} -> ${keep}`);
    return 1;
  }),
}));

const handle = (id: string, label: string): HandleSpec => ({
  id, label, kind: 'bar', lengthMm: 128, colorHex: '#999999', metalness: 0.9, roughness: 0.3, pricingMode: 'per-unit', price: 180, createdAt: '2026-01-01', updatedAt: '',
});

describe('Possible duplicates', () => {
  it('merges onto the default handle: repoints first, then deletes the copies', async () => {
    const user = userEvent.setup();
    const removeHandle = vi.fn(async (id: string) => {
      calls.push(`delete ${id}`);
    });
    resetStore({
      handles: [handle(DEFAULT_HANDLE_ID, 'Bar handle 128mm — brushed steel'), handle('h-copy', 'Bar Handle 128mm — Brushed Steel'), handle('other', 'Knob 30mm')],
      removeHandle,
    });
    // Auto-confirm the dialog.
    const confirmModule = await import('../../store/confirmDialogStore');
    vi.spyOn(confirmModule, 'confirmDialog').mockResolvedValue(true);

    render(<DuplicatesBanner />);
    expect(screen.getByText(/1 item appears more than once/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    // The default handle is the pick, and the copy can't be picked instead.
    expect(within(dialog).getByRole('radio', { name: /brushed steel.*default/i })).toHaveAttribute('aria-checked', 'true');
    await vi.waitFor(() => expect(within(dialog).getByText(/Used: 1 in 1 design/)).toBeInTheDocument());

    await user.click(within(dialog).getByRole('button', { name: 'Merge' }));
    await vi.waitFor(() => expect(removeHandle).toHaveBeenCalledWith('h-copy'));
    expect(calls).toEqual([`repoint handles h-copy -> ${DEFAULT_HANDLE_ID}`, 'delete h-copy']);
  });
});

describe('Merge selected', () => {
  it('closes the panel at once and merges only the ticked groups', async () => {
    const user = userEvent.setup();
    calls.length = 0;
    const removeHandle = vi.fn(async (id: string) => {
      calls.push(`delete ${id}`);
    });
    resetStore({
      handles: [
        handle('a1', 'Knob 30mm'), handle('a2', 'knob 30mm'),
        handle('b1', 'Bar 192mm'), handle('b2', 'BAR 192MM'),
      ],
      removeHandle,
    });
    const confirmModule = await import('../../store/confirmDialogStore');
    vi.spyOn(confirmModule, 'confirmDialog').mockResolvedValue(true);

    render(<DuplicatesBanner />);
    await user.click(screen.getByRole('button', { name: 'Review' }));
    const dialog = await screen.findByRole('dialog');
    await vi.waitFor(() => expect(within(dialog).getAllByText(/Not used anywhere|Used:/).length).toBeGreaterThan(0));

    // Leave the "Bar 192mm" group out.
    const boxes = within(dialog).getAllByRole('checkbox', { name: 'Include in Merge all' });
    await user.click(boxes[0]);
    await user.click(within(dialog).getByRole('button', { name: 'Merge 1 selected' }));

    await vi.waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await vi.waitFor(() => expect(removeHandle).toHaveBeenCalledTimes(1));
    expect(calls.filter((c) => c.startsWith('delete'))).toHaveLength(1);
  });
});
