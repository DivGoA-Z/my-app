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
import { toast } from 'sonner';
import { useLayoutStore } from '../../store/layoutStore';
import { Button } from '../ui/button';
import { Alert, AlertDescription } from '../ui/alert';
import { useQuoteStatus } from '../../hooks/useQuoteStatus';
import { generateQuotePdfBlob } from '../../lib/quotePdf';
import { uploadQuotePdf } from '../../lib/quotePdfStorage';
import { buildWhatsAppLink } from '../../lib/whatsapp';
import { downloadBlob } from '../../lib/downloadBlob';
import type { FrozenQuote } from '../../types/quote';
import type { CustomerProject } from '../../types/customer';

const INR = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  maximumFractionDigits: 0,
});

function buildWhatsAppMessage(quote: FrozenQuote, project: CustomerProject, pdfUrl: string): string {
  return (
    `Hi ${project.clientName}, here's your kitchen quote (v${quote.version}): ` +
    `${INR.format(quote.grandTotal)} total.\n\nView/download the PDF: ${pdfUrl}`
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

// onOpenCutList: open the Cutting List page on a frozen quote's own list
// (§60). App.tsx owns screen switching, so it's passed in.
export function QuoteFreezePanel({ onOpenCutList }: { onOpenCutList?: (quoteId: string) => void } = {}) {
  const currentProject = useLayoutStore((s) => s.currentProject);
  const loadQuotes = useLayoutStore((s) => s.loadQuotes);
  const freezeCurrentQuote = useLayoutStore((s) => s.freezeCurrentQuote);
  const markCurrentQuoteSent = useLayoutStore((s) => s.markCurrentQuoteSent);
  const isFreezing = useLayoutStore((s) => s.isFreezingQuote);
  const quoteError = useLayoutStore((s) => s.quoteError);

  const { status, latest } = useQuoteStatus();
  const [note, setNote] = useState('');
  const [showNote, setShowNote] = useState(false);
  // Which export is in flight, if any — distinct from isFreezingQuote,
  // since exporting an already-frozen quote is a read of it, not a
  // write, and shouldn't compete with that button's own disabled state.
  const [exporting, setExporting] = useState<'pdf' | 'whatsapp' | null>(null);
  const [exportError, setExportError] = useState<string | null>(null);
  // Where to send THIS share — never written to the project or
  // anywhere else, purely a one-off override for this click. Resets
  // itself for free just by being ordinary component state: switching
  // projects (or reloading) remounts this panel with fresh defaults.
  const [sendTarget, setSendTarget] = useState<'stored' | 'other'>('stored');
  const [otherPhone, setOtherPhone] = useState('');

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
      toast.success(`Quote v${frozen.version} frozen`);
    } else {
      // The inline `quoteError` paragraph below stays as the persistent
      // detail; the toast is what actually gets NOTICED regardless of
      // scroll position, per PRINCIPLES.md's "silence after clicking is
      // the most common reason users click twice."
      toast.error('Failed to freeze quote', {
        description: useLayoutStore.getState().quoteError ?? undefined,
      });
    }
  }

  async function downloadPdf() {
    if (!latest || !currentProject) return;
    setExportError(null);
    setExporting('pdf');
    try {
      const blob = generateQuotePdfBlob(latest, currentProject);
      downloadBlob(blob, `${currentProject.clientName} — kitchen quote v${latest.version}.pdf`);
      toast.success('PDF downloaded');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to generate PDF.';
      setExportError(message);
      toast.error('Failed to generate PDF', { description: message });
    } finally {
      setExporting(null);
    }
  }

  async function shareOnWhatsApp() {
    if (!latest || !currentProject) return;
    const targetPhone = sendTarget === 'other' ? otherPhone.trim() : currentProject.phone;
    if (!targetPhone) return;

    setExportError(null);
    setExporting('whatsapp');
    try {
      const blob = generateQuotePdfBlob(latest, currentProject);
      const pdfUrl = await uploadQuotePdf(currentProject.id, latest.version, blob);
      const message = buildWhatsAppMessage(latest, currentProject, pdfUrl);
      // Opens in a new tab rather than navigating away from the
      // canvas — a designer sending a quote is usually mid-session,
      // not done with it.
      window.open(buildWhatsAppLink(targetPhone, message), '_blank');
      toast.success('Opening WhatsApp…');
      // Best-effort: the share itself already happened (the WhatsApp
      // tab is open) by this point, so a failure recording sent_at
      // shouldn't read as the share having failed — markCurrentQuoteSent
      // already surfaces its own error via quoteError if it does.
      void markCurrentQuoteSent(latest.id);
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Failed to share quote.';
      setExportError(errorMessage);
      toast.error('Failed to share quote', { description: errorMessage });
    } finally {
      setExporting(null);
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
          <div className="mt-0.5">
            {latest.sentAt ? (
              <>Sent on WhatsApp {formatDate(latest.sentAt)}</>
            ) : (
              <span className="text-amber-700">Not yet sent — frozen, but never shared</span>
            )}
          </div>
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
          {/* The cutting list frozen with this version (§60) — what the
              workshop should cut if the customer agreed to it. */}
          {latest.cutList && onOpenCutList && (
            <Button
              type="button"
              variant="link"
              size="sm"
              className="mt-1 h-auto self-start p-0 text-[11px]"
              onClick={() => onOpenCutList(latest.id)}
            >
              Cutting list for v{latest.version} →
            </Button>
          )}
          {!latest.cutList && (
            <p className="mt-1 text-[11px] text-gray-500">
              v{latest.version} was frozen before cutting lists were saved with quotes — freeze a new
              version to keep its cutting list.
            </p>
          )}

          <div className="mt-2 flex flex-col gap-1 text-[11px] text-gray-600">
            <span>Send WhatsApp to:</span>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="quote-send-target"
                checked={sendTarget === 'stored'}
                onChange={() => setSendTarget('stored')}
              />
              {currentProject.phone} (on file)
            </label>
            <label className="flex items-center gap-1.5">
              <input
                type="radio"
                name="quote-send-target"
                checked={sendTarget === 'other'}
                onChange={() => setSendTarget('other')}
              />
              A different number, just this once
            </label>
            {sendTarget === 'other' && (
              <input
                type="tel"
                value={otherPhone}
                onChange={(e) => setOtherPhone(e.target.value)}
                placeholder="+91-XXXXX-XXXXX"
                autoFocus
                // Deliberately not persisted anywhere — this is a
                // one-off override for this share, not saved to the
                // project, so it's gone the moment this panel unmounts.
                className="rounded border border-gray-300 px-2 py-1 text-[11px]"
              />
            )}
          </div>

          <div className="mt-2 flex gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="h-auto min-h-7 flex-1 py-1 whitespace-normal border-current"
              onClick={downloadPdf}
              disabled={exporting !== null}
            >
              {exporting === 'pdf' ? 'Generating…' : 'Download PDF'}
            </Button>
            <Button
              type="button"
              size="xs"
              className="h-auto min-h-7 flex-1 py-1 whitespace-normal bg-emerald-600 hover:bg-emerald-700"
              onClick={shareOnWhatsApp}
              disabled={exporting !== null || (sendTarget === 'other' && otherPhone.trim() === '')}
            >
              {exporting === 'whatsapp' ? 'Preparing…' : 'Share on WhatsApp'}
            </Button>
          </div>
          {exportError && (
            <Alert variant="destructive" className="mt-1.5">
              <AlertDescription>{exportError}</AlertDescription>
            </Alert>
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
        <Button
          type="button"
          variant="link"
          size="xs"
          className="h-auto self-start p-0 text-[11px] text-muted-foreground"
          onClick={() => setShowNote(true)}
        >
          Add a note
        </Button>
      )}

      {quoteError && (
        <Alert variant="destructive">
          <AlertDescription>{quoteError}</AlertDescription>
        </Alert>
      )}

      <Button type="button" size="sm" onClick={freeze} disabled={isFreezing}>
        {isFreezing
          ? 'Freezing…'
          : latest
            ? `Freeze v${latest.version + 1}`
            : 'Freeze quote'}
      </Button>

      <p className="text-[11px] text-gray-500">
        A frozen quote is never edited. Revising creates the next version, so what you
        sent stays on record.
      </p>
    </div>
  );
}
