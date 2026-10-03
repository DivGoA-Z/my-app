// @vitest-environment jsdom
//
// Screen tests for board lines (§66): the carcass board dropdown only
// offers PRICED boards and can create a new one on the rate card (§43);
// a board anything is cut from can't be removed (§44).

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BoardSelect } from '../common/BoardSelect';
import { BoardRatesEditor } from '../inventory/BoardRatesEditor';
import { resetStore } from '../../test/store';
import { useLayoutStore } from '../../store/layoutStore';
import { defaultRateCard, legacyBoardId } from '../../types/rates';

// findBoardUsage looks through every saved project in Supabase; here
// it answers from a variable the test sets.
let usage = { projectNames: [] as string[], catalogueLabels: [] as string[] };
vi.mock('../../lib/boardUsage', () => ({ findBoardUsage: vi.fn(async () => usage) }));

describe('Carcass board dropdown', () => {
  it('lists only priced boards, plus "+ Add a new board…"', async () => {
    const user = userEvent.setup();
    const card = defaultRateCard();
    resetStore({
      rateCard: { ...card, boards: card.boards.map((b) => (b.material === 'MDF' ? { ...b, ratePerSqM: 0 } : b)) },
    });
    render(<BoardSelect material="HDMR" onChange={() => {}} />);
    await user.click(screen.getByRole('combobox'));
    const names = screen.getAllByRole('option').map((o) => o.textContent);
    expect(names.some((n) => n?.startsWith('MDF'))).toBe(false);
    expect(names.some((n) => n?.startsWith('HDMR 18mm'))).toBe(true);
    expect(names).toContain('+ Add a new board…');
  });

  it('a new board needs a rate, is saved to the rate card, and is picked', async () => {
    const user = userEvent.setup();
    const store = resetStore();
    const onChange = vi.fn();
    render(<BoardSelect material="HDMR" onChange={onChange} />);
    await user.click(screen.getByRole('combobox'));
    await user.click(screen.getByRole('option', { name: '+ Add a new board…' }));

    const dialog = screen.getByRole('dialog');
    const add = within(dialog).getByRole('button', { name: 'Add board' });
    expect(add).toBeDisabled(); // ₹0 isn't allowed
    const [thickness, rate] = within(dialog).getAllByRole('spinbutton');
    await user.clear(thickness);
    await user.type(thickness, '25');
    await user.clear(rate);
    await user.type(rate, '1900');
    await user.click(add);

    expect(store.updateRateCard).toHaveBeenCalledTimes(1);
    const added = useLayoutStore.getState().rateCard.boards.find((b) => b.thicknessMm === 25);
    expect(added).toMatchObject({ material: 'HDMR', ratePerSqM: 1900 });
    expect(onChange).toHaveBeenCalledWith({ material: 'HDMR', carcassBoardId: added!.id });
  });
});

describe('Removing a board line', () => {
  const card = defaultRateCard();
  const mdf = card.boards.find((b) => b.id === legacyBoardId('MDF'))!;

  it('is blocked while a project uses it, naming the project', async () => {
    const user = userEvent.setup();
    resetStore();
    usage = { projectNames: ['Neha Verma'], catalogueLabels: [] };
    const onChange = vi.fn();
    render(<BoardRatesEditor boards={card.boards} defaultBackBoardId={card.defaultBackBoardId} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove MDF 18mm' }));
    expect(await screen.findByText(/can't be removed — it's in use/)).toBeInTheDocument();
    expect(screen.getByText(/Neha Verma/)).toBeInTheDocument();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('goes through when nothing uses it', async () => {
    const user = userEvent.setup();
    resetStore();
    usage = { projectNames: [], catalogueLabels: [] };
    const onChange = vi.fn();
    render(<BoardRatesEditor boards={card.boards} defaultBackBoardId={card.defaultBackBoardId} onChange={onChange} />);
    await user.click(screen.getByRole('button', { name: 'Remove MDF 18mm' }));
    await vi.waitFor(() => expect(onChange).toHaveBeenCalledTimes(1));
    expect(onChange.mock.calls[0][0].some((b: { id: string }) => b.id === mdf.id)).toBe(false);
  });

  it('the default back board cannot be removed at all', () => {
    resetStore();
    render(<BoardRatesEditor boards={card.boards} defaultBackBoardId={card.defaultBackBoardId} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'Remove HDMR 6mm' })).toBeDisabled();
  });
});
