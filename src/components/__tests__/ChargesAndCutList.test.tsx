// @vitest-environment jsdom
//
// Screen tests (§66) for two things you couldn't find or read on 3 Oct:
// the project's charges switch in the quote sidebar, and the Cutting
// List's version dropdown — which used to be hidden entirely when no
// quote carried a frozen list, and only knew about quotes if the quote
// sidebar had been opened first.

import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QuoteSidebar } from '../quote/QuoteSidebar';
import { CutListView } from '../cutlist/CutListView';
import { resetStore } from '../../test/store';
import { useLayoutStore } from '../../store/layoutStore';
import { baseUnit, layout } from '../../test/fixtures';
import { computeCutList, freezeCutList } from '../../lib/cutList';
import { defaultRateCard } from '../../types/rates';
import { defaultConstructionSettings } from '../../types/construction';
import type { CustomerProject } from '../../types/customer';
import type { FrozenQuote } from '../../types/quote';

const project = {
  id: 'project-1',
  clientName: 'Neha Verma',
  phone: '',
  address: '',
  locality: '',
  status: 'Lead',
  createdAt: '',
  updatedAt: '',
} as CustomerProject;

function quote(version: number, withCutList: boolean): FrozenQuote {
  const cl = computeCutList([baseUnit()], defaultConstructionSettings(), [], defaultRateCard(), []);
  return {
    id: `q${version}`,
    projectId: project.id,
    version,
    summary: { grandTotal: 1000 } as FrozenQuote['summary'],
    pricingContext: { construction: defaultConstructionSettings(), rates: defaultRateCard() } as unknown as FrozenQuote['pricingContext'],
    cutList: withCutList ? freezeCutList(cl) : undefined,
    grandTotal: 1000,
    frozenAt: '2026-10-01T10:00:00Z',
  };
}

describe('Project charges in the quote sidebar', () => {
  it('"Customise for this project" makes an own copy; "Use business-level rate-card charges again" drops it', async () => {
    const user = userEvent.setup();
    resetStore({ currentProject: project, currentLayout: layout(), cabinets: [baseUnit()] });
    render(<QuoteSidebar />);

    await user.click(screen.getByRole('button', { name: 'Customise for this project' }));
    expect(useLayoutStore.getState().currentLayout?.chargeRates).toHaveLength(defaultRateCard().othersRates.length);

    await user.click(screen.getByRole('button', { name: 'Use business-level rate-card charges again' }));
    expect(useLayoutStore.getState().currentLayout?.chargeRates).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Customise for this project' })).toBeInTheDocument();
  });
});

const cutListProps = { onClose: () => {}, onOpenWorkshop: () => {}, onOpenDesigner: () => {} };

describe('Cutting List version dropdown', () => {
  it('is always there, loads quotes itself, and greys out quotes frozen before lists were saved', () => {
    const store = resetStore({
      currentProject: project,
      currentLayout: layout(),
      cabinets: [baseUnit()],
      quotes: [quote(2, true), quote(1, false)],
    });
    render(<CutListView {...cutListProps} />);
    expect(store.loadQuotes).toHaveBeenCalled();

    const select = screen.getByRole('combobox', { name: 'Which cutting list' });
    const options = within(select).getAllByRole('option');
    expect(options.map((o) => o.textContent)).toEqual([
      'Current design',
      expect.stringMatching(/^Quote v2/),
      expect.stringMatching(/^Quote v1.*frozen before cutting lists were saved/),
    ]);
    expect(options[2]).toBeDisabled();
    expect(options[1]).toBeEnabled();
  });

  it('with no quotes yet, still shows the dropdown and says so', () => {
    resetStore({ currentProject: project, currentLayout: layout(), cabinets: [baseUnit()] });
    render(<CutListView {...cutListProps} />);
    const select = screen.getByRole('combobox', { name: 'Which cutting list' });
    expect(within(select).getByRole('option', { name: 'No frozen quotes yet' })).toBeDisabled();
  });

  it("picking a frozen quote shows that quote's list", async () => {
    const user = userEvent.setup();
    resetStore({ currentProject: project, currentLayout: layout(), cabinets: [], quotes: [quote(2, true)] });
    render(<CutListView {...cutListProps} />);
    await user.selectOptions(screen.getByRole('combobox', { name: 'Which cutting list' }), 'q2');
    expect(screen.getAllByText('Left side').length).toBeGreaterThan(0);
  });
});

vi.mock('../../lib/downloadBlob', () => ({ downloadBlob: vi.fn() }));
