// @vitest-environment jsdom
//
// Screen tests for the rate card (§66). The bugs these guard against
// were real: a Save button at the bottom of a long form that nobody saw,
// and a draft that discarded unsaved edits when a board was added from
// another screen.

import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RateCardManager } from '../inventory/RateCardManager';
import { resetStore } from '../../test/store';
import { useLayoutStore } from '../../store/layoutStore';

describe('Rate card', () => {
  it('shows the placeholder-rates banner on the seeded rates', () => {
    resetStore();
    render(<RateCardManager />);
    expect(screen.getByText(/These are placeholder rates/)).toBeInTheDocument();
  });

  it('an edit shows the unsaved bar and enables Save; saving sends the draft and clears it', async () => {
    const user = userEvent.setup();
    const store = resetStore();
    render(<RateCardManager />);
    expect(screen.queryByText(/Unsaved rate changes/)).not.toBeInTheDocument();
    for (const b of screen.getAllByRole('button', { name: 'Save rates' })) expect(b).toBeDisabled();

    const edge = screen.getByLabelText(/Edge banding \(₹ per running metre\)/);
    await user.clear(edge);
    await user.type(edge, '12');

    expect(screen.getByText(/Unsaved rate changes/)).toBeInTheDocument();
    const saves = screen.getAllByRole('button', { name: 'Save rates' });
    expect(saves.length).toBeGreaterThanOrEqual(2); // top and the sticky bar
    await user.click(saves[0]);

    expect(store.updateRateCard).toHaveBeenCalledTimes(1);
    expect(useLayoutStore.getState().rateCard.edgeBandingRatePerM).toBe(12);
    expect(screen.queryByText(/Unsaved rate changes/)).not.toBeInTheDocument();
  });

  it('keeps unsaved edits when a board is added from elsewhere (catalogue "+ Add a new board…")', async () => {
    const user = userEvent.setup();
    resetStore();
    render(<RateCardManager />);
    const edge = screen.getByLabelText(/Edge banding \(₹ per running metre\)/);
    await user.clear(edge);
    await user.type(edge, '9');

    const { rateCard } = useLayoutStore.getState();
    useLayoutStore.setState({
      rateCard: { ...rateCard, boards: [...rateCard.boards, { id: 'new-25', material: 'HDMR', thicknessMm: 25, ratePerSqM: 1900 }] },
    });

    expect(await screen.findByDisplayValue('9')).toBeInTheDocument();
    expect(screen.getByText(/Unsaved rate changes/)).toBeInTheDocument();
  });

  it('the waste switch changes what the page explains', async () => {
    const user = userEvent.setup();
    resetStore();
    render(<RateCardManager />);
    const group = screen.getByRole('radiogroup', { name: 'Sheet waste on quotes' });
    const calculated = [...group.querySelectorAll('button')].find((b) => /calculated/i.test(b.textContent ?? ''))!;
    await user.click(calculated);
    expect(screen.getByText(/lays its own parts out on each board's sheet sizes/)).toBeInTheDocument();
  });
});
