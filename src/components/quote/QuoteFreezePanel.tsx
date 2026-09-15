// src/components/quote/QuoteFreezePanel.tsx
//
// The bottom of the quote sidebar: what has been sent, whether it still
// matches the design, and the button that freezes the next version.
//
// Kept as its own component rather than folded into QuoteSidebar
// because QuoteSidebar is deliberately a pure consumer of useBOM() with
// no actions in it — everything it shows is derived. This panel WRITES,
// and mixing the two would make it much easier to accidentally give the
// sidebar a reason to hold state.
//
// The distinction this UI exists to make: the table above is LIVE and
// moves as you design. A frozen quote does not. Once one exists, a
// designer needs to know at a glance which of those two numbers the
// customer is holding.

import { useEffect, useState } from 'react';
import { useLayoutStore } from '../../store/layoutStore';
import { useQuoteStatus } from '../../hooks/useQuoteStatus';

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

export function QuoteFreezePanel() {
  const currentProject = useLayoutStore((s) => s.currentProject);
  const loadQuotes = useLayoutStore((s) => s.loadQuotes);
  const freezeCurrentQuote = useLayoutStore((s) => s.freezeCurrentQuote);
  const isFreezing = useLayoutStore((s) => s.isFreezingQuote);
  const quoteError = useLayoutStore((s) => s.quoteError);

  const { status, latest } = useQuoteStatus();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);

  // Reload whenever the open project changes — quotes are per project,
  // so carrying the previous project's list over would show one
  // customer another customer's quote history.
  useEffect(() => {
    void loadQuotes();
  }, [loadQuotes, currentProject?.id]);

  if (!currentProject) return null;

  async function freeze() {
    const frozen = await freezeCurrentQuote(note.trim() || undefined);
    if (frozen) {
      setNote('');
      setShowNote(false);
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-gray-200 pt-3">
      {status === 'unquoted' && (
        <p className="text-[11px] text-gray-500">
          Nothing sent yet. Freezing records these figures so they stay fixed even if
          rates or the design change later.
        </p>
      )}

      {latest && (
        <div
          className={
            status === 'stale'
              ? 'rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-900'
              : 'rounded-md border border-emerald-300 bg-emerald-50 p-2.5 text-[11px] text-emerald-900'
          }
        >
          <div className="flex justify-between font-medium">
            <span>Quote v{latest.version}</span>
            <span>{INR.format(latest.grandTotal)}</span>
          </div>
          <div className="mt-0.5">Frozen {formatDate(latest.frozenAt)}</div>
          {latest.note && <div className="mt-0.5 italic">{latest.note}</div>}
          {status === 'stale' ? (
            <p className="mt-1.5">
              The design or rates have changed since. The table above shows the current
              figures; your customer is holding v{latest.version}. Freeze v
              {latest.version + 1} to send the updated one.
            </p>
          ) : (
            <p className="mt-1.5">Matches the current design.</p>
          )}
        </div>
      )}

      {showNote ? (
        <input
          type="text"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="Note — e.g. sent on WhatsApp, revised after site visit"
          className="rounded border border-gray-300 px-2 py-1.5 text-xs"
          autoFocus
        />
      ) : (
        <button
          type="button"
          onClick={() => setShowNote(true)}
          className="self-start text-[11px] text-gray-500 underline"
        >
          Add a note
        </button>
      )}

      {quoteError && <p className="text-xs text-red-600">{quoteError}</p>}

      <button
        type="button"
        onClick={freeze}
        disabled={isFreezing}
        className="rounded bg-blue-600 px-3 py-2 text-xs font-medium text-white disabled:bg-gray-300"
      >
        {isFreezing
          ? 'Freezing…'
          : latest
            ? `Freeze v${latest.version + 1} & send`
            : 'Freeze & send'}
      </button>

      <p className="text-[11px] text-gray-500">
        A frozen quote is never edited. Revising creates the next version, so what you
        sent stays on record.
      </p>
    </div>
  );
}
