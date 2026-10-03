// @vitest-environment jsdom
//
// Screen tests for the new Home and Customers pages (§70). Supabase is
// replaced at the lib boundary: the customer list comes from a variable,
// and stage changes are spied on.

import { describe, expect, it, vi, beforeEach } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HomePage } from '../home/HomePage';
import { CustomersPage } from '../customers/CustomersPage';
import { resetStore } from '../../test/store';
import type { CustomerProject } from '../../types/customer';

const daysAgo = (d: number) => new Date(Date.now() - d * 86400000).toISOString();
let rows: CustomerProject[] = [];
const updateCustomerStatus = vi.fn(async () => new Date().toISOString());

vi.mock('../../lib/customers', () => ({
  fetchCustomers: vi.fn(async () => rows),
  updateCustomerStatus: (...a: unknown[]) => updateCustomerStatus(...(a as [])),
  setInstallDate: vi.fn(async () => {}),
  createCustomer: vi.fn(),
}));
vi.mock('../../lib/quotes', () => ({ fetchAllQuoteHistoriesByProject: vi.fn(async () => ({})) }));
vi.mock('../../lib/Persistence', () => ({ fetchCapturedPanoramasByProject: vi.fn(async () => ({})) }));

function customer(id: string, status: CustomerProject['status'], extra: Partial<CustomerProject> = {}): CustomerProject {
  return { id, clientName: `Customer ${id}`, phone: '9999', address: '', locality: 'Rohini', status, createdAt: daysAgo(20), updatedAt: daysAgo(1), statusChangedAt: daysAgo(1), ...extra };
}

beforeEach(() => {
  updateCustomerStatus.mockClear();
  rows = [
    customer('a', 'Quote Sent', { quoteTotal: 100000, statusChangedAt: daysAgo(5) }),
    customer('b', 'Approved', { quoteTotal: 50000 }),
    customer('c', 'In Production', { quoteTotal: 25000 }),
    customer('d', 'Layout Drafted'),
  ];
});

describe('Home', () => {
  it('shows the four agreed cards from the customer list, and follow-ups with an action', async () => {
    resetStore();
    render(<HomePage onOpenDesign={() => {}} onNavigate={() => {}} />);
    expect(await screen.findByText('Approved jobs (open)')).toBeInTheDocument();
    expect(screen.getByText('2 jobs · 1 not started · 1 in production')).toBeInTheDocument();
    expect(screen.getByText(/₹75,000/)).toBeInTheDocument();
    // Customer a: quote sent 5 days ago → WhatsApp; c: in production with no date.
    expect(screen.getByRole('button', { name: /WhatsApp/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Set date' })).toBeInTheDocument();
    expect(screen.getByText(/Your quotes use sample rates/)).toBeInTheDocument();
  });
});

describe('Customers', () => {
  it('moving a customer to Lost needs a reason before it saves', async () => {
    const user = userEvent.setup();
    resetStore();
    render(<CustomersPage onOpenDesign={() => {}} />);
    await user.click((await screen.findAllByRole('button', { name: 'Actions for Customer d' }))[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'Lost' }));

    const dialog = await screen.findByRole('dialog');
    const confirm = within(dialog).getByRole('button', { name: 'Mark as lost' });
    expect(confirm).toBeDisabled();
    await user.click(within(dialog).getByRole('radio', { name: 'Price' }));
    await user.click(confirm);

    expect(updateCustomerStatus).toHaveBeenCalledWith('d', { status: 'Lost', reason: 'price', note: '' });
  });

  it('other stages change straight away, with no dialog', async () => {
    const user = userEvent.setup();
    resetStore();
    render(<CustomersPage onOpenDesign={() => {}} />);
    await user.click((await screen.findAllByRole('button', { name: 'Actions for Customer b' }))[0]);
    await user.click(await screen.findByRole('menuitem', { name: 'In production' }));
    expect(updateCustomerStatus).toHaveBeenCalledWith('b', { status: 'In Production' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Production', () => {
  it('lists approved and in-production jobs and moves them along', async () => {
    const user = userEvent.setup();
    resetStore();
    const { ProductionPage } = await import('../production/ProductionPage');
    const onOpenCutList = vi.fn();
    render(<ProductionPage onOpenCutList={onOpenCutList} onOpenDesign={() => {}} />);
    expect(await screen.findByText('Customer b')).toBeInTheDocument();
    expect(screen.getByText('Customer c')).toBeInTheDocument();
    expect(screen.queryByText('Customer a')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Start production' }));
    expect(updateCustomerStatus).toHaveBeenCalledWith('b', { status: 'In Production' });
    await user.click(screen.getAllByRole('button', { name: /Cutting list/ })[0]);
    expect(onOpenCutList).toHaveBeenCalled();
  });
});
