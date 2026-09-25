// src/components/dashboard/CustomerDashboard.tsx
//
// Sales-rep-facing pipeline view, now backed by Supabase's `projects`
// table (see supabase/schema.sql) instead of local sample data. Fetches
// on mount; supports creating a new lead and changing a project's
// status inline, both written straight to Supabase. "Open 2D Canvas"
// still hands off to onOpenCanvas — that path already loads the
// client's saved layout from Supabase via loadProject() in the layout
// store, so nothing changes there.
//
// Also shows a "360° Views" button per row for any lead with captured
// panoramas — fetched via fetchCapturedPanoramasByProject(), which
// follows the real CameraNode.layoutId -> RoomLayout.projectId chain
// (not a timestamp guess) to link a capture back to its lead. Clicking
// it opens a small picker (a project can have multiple captured camera
// nodes) and then PanoramaViewerModal for whichever one is chosen.

import { useEffect, useMemo, useState } from 'react';
import type { CustomerProject, LeadStatus } from '../../types/customer';
import type { CameraNode } from '../../types/Camera';
import { fetchCustomers, createCustomer, updateCustomerStatus } from '../../lib/customers';
import { fetchCapturedPanoramasByProject } from '../../lib/Persistence';
import { PanoramaViewerModal } from '../panorama/PanoramaViewerModal';
import { useAuthStore } from '../../store/authStore';

export interface CustomerDashboardProps {
  onOpenCanvas: (projectId: string) => void;
}

const STATUS_STYLES: Record<LeadStatus, { label: string; className: string }> = {
  Lead: { label: 'Lead', className: 'bg-gray-100 text-gray-700' },
  'Layout Drafted': { label: 'Drafted', className: 'bg-blue-100 text-blue-700' },
  'Quote Sent': { label: 'Sent', className: 'bg-amber-100 text-amber-700' },
  Approved: { label: 'Approved', className: 'bg-green-100 text-green-700' },
  'In Production': { label: 'In Production', className: 'bg-purple-100 text-purple-700' },
};

const ALL_STATUSES: LeadStatus[] = [
  'Lead',
  'Layout Drafted',
  'Quote Sent',
  'Approved',
  'In Production',
];

const INR_FORMATTER = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

interface NewLeadForm {
  clientName: string;
  phone: string;
  address: string;
  locality: string;
}

const EMPTY_FORM: NewLeadForm = { clientName: '', phone: '', address: '', locality: '' };

export function CustomerDashboard({ onOpenCanvas }: CustomerDashboardProps) {
  const businessId = useAuthStore((s) => s.businessId);
  const [customers, setCustomers] = useState<CustomerProject[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  const [isFormOpen, setIsFormOpen] = useState(false);
  const [form, setForm] = useState<NewLeadForm>(EMPTY_FORM);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // projectId -> its captured camera nodes (only ones with a
  // panoramaUrl) — see fetchCapturedPanoramasByProject's comment for
  // how this is linked. Best-effort: a failure here just means the
  // "360° Views" button doesn't show up, it doesn't block the rest of
  // the dashboard from loading.
  const [panoramasByProject, setPanoramasByProject] = useState<Record<string, CameraNode[]>>({});
  const [panoramaMenuProjectId, setPanoramaMenuProjectId] = useState<string | null>(null);
  const [viewingPanoramaCamera, setViewingPanoramaCamera] = useState<CameraNode | null>(null);

  useEffect(() => {
    let cancelled = false;
    // No setIsLoading(true) here — this effect only ever runs once on
    // mount ([] deps below), and isLoading already starts true (see
    // its useState above), so setting it again synchronously here was
    // always redundant and trips the "no synchronous setState in an
    // effect body" lint rule for no benefit.
    fetchCustomers()
      .then((rows) => {
        if (!cancelled) setCustomers(rows);
      })
      .catch((err) => {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : 'Failed to load customers.');
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    fetchCapturedPanoramasByProject()
      .then((map) => {
        if (!cancelled) setPanoramasByProject(map);
      })
      .catch(() => {
        // Non-critical — see the comment above panoramasByProject.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter((c) =>
      [c.clientName, c.phone, c.locality].some((field) => field.toLowerCase().includes(q))
    );
  }, [customers, query]);

  async function handleStatusChange(customerId: string, nextStatus: LeadStatus) {
    const previous = customers;
    setStatusUpdatingId(customerId);
    // Optimistic — the row updates immediately, and rolls back if the
    // write to Supabase actually fails.
    setCustomers((prev) =>
      prev.map((c) => (c.id === customerId ? { ...c, status: nextStatus } : c))
    );
    try {
      await updateCustomerStatus(customerId, nextStatus);
    } catch (err) {
      setCustomers(previous);
      setLoadError(err instanceof Error ? err.message : 'Failed to update status.');
    } finally {
      setStatusUpdatingId(null);
    }
  }

  async function handleCreate() {
    if (!form.clientName.trim() || !form.phone.trim()) {
      setCreateError('Client name and phone are required.');
      return;
    }
    if (!businessId) {
      setCreateError('No business found for this account — sign out and back in, or check business_users.');
      return;
    }
    setIsCreating(true);
    setCreateError(null);
    try {
      const created = await createCustomer(form, businessId);
      setCustomers((prev) => [created, ...prev]);
      setForm(EMPTY_FORM);
      setIsFormOpen(false);
    } catch (err) {
      setCreateError(err instanceof Error ? err.message : 'Failed to create lead.');
    } finally {
      setIsCreating(false);
    }
  }

  return (
    <div className="flex flex-col gap-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-center justify-between gap-4">
        <h2 className="text-sm font-semibold text-gray-700">Customer Pipeline</h2>
        <div className="flex items-center gap-2">
          <input
            type="text"
            placeholder="Search by name, phone, or location..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-64 rounded border border-gray-300 px-3 py-1.5 text-sm"
          />
          <button
            onClick={() => setIsFormOpen((open) => !open)}
            className="rounded bg-gray-800 px-3 py-1.5 text-sm text-white hover:bg-gray-700"
          >
            + New Lead
          </button>
        </div>
      </div>

      {isFormOpen && (
        <div className="flex flex-col gap-2 rounded border border-gray-200 bg-gray-50 p-3">
          <div className="grid grid-cols-2 gap-2">
            <input
              placeholder="Client name"
              value={form.clientName}
              onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Phone number"
              value={form.phone}
              onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Address"
              value={form.address}
              onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
            <input
              placeholder="Locality (e.g. Dwarka, Delhi)"
              value={form.locality}
              onChange={(e) => setForm((f) => ({ ...f, locality: e.target.value }))}
              className="rounded border border-gray-300 px-2 py-1.5 text-sm"
            />
          </div>
          {createError && <p className="text-xs text-red-600">{createError}</p>}
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={isCreating}
              className="rounded bg-gray-800 px-3 py-1.5 text-xs text-white hover:bg-gray-700 disabled:opacity-50"
            >
              {isCreating ? 'Creating...' : 'Create Lead'}
            </button>
            <button
              onClick={() => {
                setIsFormOpen(false);
                setCreateError(null);
              }}
              className="rounded border border-gray-300 px-3 py-1.5 text-xs text-gray-700 hover:bg-gray-100"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {loadError && (
        <p className="rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700">
          {loadError}
        </p>
      )}

      {isLoading ? (
        <p className="text-sm text-gray-500">Loading customers...</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <thead>
              <tr className="border-b border-gray-200 text-xs text-gray-500">
                <th className="py-2 pr-3 font-medium">Client Name</th>
                <th className="py-2 pr-3 font-medium">Phone Number</th>
                <th className="py-2 pr-3 font-medium">Location</th>
                <th className="py-2 pr-3 font-medium">Status</th>
                <th className="py-2 pr-3 text-right font-medium">Total Quote</th>
                <th className="py-2 pr-3 font-medium">360° Views</th>
                <th className="py-2 pl-3 font-medium" />
              </tr>
            </thead>
            <tbody>
              {filtered.map((customer) => {
                const status = STATUS_STYLES[customer.status];
                return (
                  <tr key={customer.id} className="border-b border-gray-100">
                    <td className="py-2 pr-3 text-gray-800">{customer.clientName}</td>
                    <td className="py-2 pr-3 text-gray-600">{customer.phone}</td>
                    <td className="py-2 pr-3 text-gray-600">{customer.locality}</td>
                    <td className="py-2 pr-3">
                      <select
                        value={customer.status}
                        disabled={statusUpdatingId === customer.id}
                        onChange={(e) =>
                          handleStatusChange(customer.id, e.target.value as LeadStatus)
                        }
                        className={`rounded-full border-0 px-2 py-0.5 text-xs font-medium ${status.className}`}
                      >
                        {ALL_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_STYLES[s].label}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-2 pr-3 text-right text-gray-800">
                      {customer.quoteTotal != null
                        ? INR_FORMATTER.format(customer.quoteTotal)
                        : '—'}
                    </td>
                    <td className="relative py-2 pr-3">
                      {panoramasByProject[customer.id]?.length ? (
                        <>
                          <button
                            onClick={() =>
                              setPanoramaMenuProjectId((current) =>
                                current === customer.id ? null : customer.id
                              )
                            }
                            className="rounded border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50"
                          >
                            360° Views ({panoramasByProject[customer.id].length})
                          </button>
                          {panoramaMenuProjectId === customer.id && (
                            <div className="absolute left-0 top-full z-10 mt-1 flex w-48 flex-col gap-1 rounded-lg border border-gray-200 bg-white p-2 shadow-lg">
                              {panoramasByProject[customer.id].map((camera) => (
                                <button
                                  key={camera.id}
                                  onClick={() => {
                                    setViewingPanoramaCamera(camera);
                                    setPanoramaMenuProjectId(null);
                                  }}
                                  className="rounded px-2 py-1 text-left text-xs text-gray-700 hover:bg-gray-50"
                                >
                                  {camera.label}
                                </button>
                              ))}
                            </div>
                          )}
                        </>
                      ) : (
                        <span className="text-xs text-gray-300">—</span>
                      )}
                    </td>
                    <td className="py-2 pl-3 text-right">
                      <button
                        onClick={() => onOpenCanvas(customer.id)}
                        className="rounded bg-gray-800 px-3 py-1 text-xs font-medium text-white hover:bg-gray-700"
                      >
                        Open 2D Canvas
                      </button>
                    </td>
                  </tr>
                );
              })}

              {filtered.length === 0 && (
                <tr>
                  <td colSpan={7} className="py-6 text-center text-sm text-gray-400">
                    {customers.length === 0
                      ? 'No customers yet — add your first lead.'
                      : `No clients match "${query}".`}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <PanoramaViewerModal
        isOpen={viewingPanoramaCamera !== null}
        onClose={() => setViewingPanoramaCamera(null)}
        cameraLabel={viewingPanoramaCamera?.label ?? ''}
        panoramaUrl={viewingPanoramaCamera?.panoramaUrl}
      />
    </div>
  );
}
