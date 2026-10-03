// src/components/customers/customerData.ts
//
// The customer list as Home and Customers both need it: the projects
// rows, plus each project's sent-quote history and captured 360° views.
// The two extras are best-effort, as on the old dashboard — a failure
// there only hides a menu, it never blocks the page.

import { useEffect, useState } from 'react';
import { fetchCustomers } from '../../lib/customers';
import { fetchAllQuoteHistoriesByProject, type QuoteHistoryEntry } from '../../lib/quotes';
import { fetchCapturedPanoramasByProject } from '../../lib/Persistence';
import type { CustomerProject } from '../../types/customer';
import type { CameraNode } from '../../types/Camera';

export function useCustomerList() {
  const [customers, setCustomers] = useState<CustomerProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [quoteHistories, setQuoteHistories] = useState<Record<string, QuoteHistoryEntry[]>>({});
  const [panoramas, setPanoramas] = useState<Record<string, CameraNode[]>>({});

  useEffect(() => {
    let cancelled = false;
    fetchCustomers()
      .then((rows) => !cancelled && setCustomers(rows))
      .catch((err) => !cancelled && setError(err instanceof Error ? err.message : 'Failed to load customers.'))
      .finally(() => !cancelled && setIsLoading(false));
    fetchAllQuoteHistoriesByProject()
      .then((map) => !cancelled && setQuoteHistories(map))
      .catch(() => {});
    fetchCapturedPanoramasByProject()
      .then((map) => !cancelled && setPanoramas(map))
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return { customers, setCustomers, isLoading, error, setError, quoteHistories, panoramas };
}

export const INR = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 });

export function formatShortDate(isoOrDate: string): string {
  const d = isoOrDate.length === 10 ? new Date(`${isoOrDate}T00:00:00`) : new Date(isoOrDate);
  return d.toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric', month: 'short' });
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((w) => w[0]!.toUpperCase())
      .join('') || '?'
  );
}
