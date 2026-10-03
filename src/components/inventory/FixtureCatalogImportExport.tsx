// src/components/inventory/FixtureCatalogImportExport.tsx
//
// Light fixture catalogue Excel round trip — see
// CabinetCatalogImportExport.tsx's header comment for the shape this
// mirrors.

import { useState } from 'react';
import { toast } from 'sonner';
import { useLayoutStore } from '../../store/layoutStore';
import {
  exportFixtureCatalogXlsx,
  parseFixtureCatalogFile,
  FIXTURE_KINDS,
  PRICING_MODES,
  type ParsedFixtureRow,
} from '../../lib/importExport/fixtureImportExport';
import {
  requiredString,
  positiveNumber,
  nonNegativeNumber,
  finalizeRowErrors,
} from '../../lib/importExport/xlsxHelpers';
import { downloadBlob } from '../../lib/downloadBlob';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { FixtureCatalogItem } from '../../types/fixture';

const inputClass = 'w-full rounded border border-input px-1.5 py-1 text-xs disabled:bg-secondary disabled:text-muted-foreground';

function revalidate(data: FixtureCatalogItem, priorErrors: string[]): string[] {
  const errors = priorErrors.filter((e) => e.startsWith('Unknown id') || e.includes('appears on more than one row'));
  const label = requiredString(data.label, 'label');
  if (label.error) errors.push(label.error);
  const colorTemp = positiveNumber(String(data.colorTempK), 'color_temp_k');
  if (colorTemp.error) errors.push(colorTemp.error);
  const lumens = positiveNumber(String(data.lumens), 'lumens');
  if (lumens.error) errors.push(lumens.error);
  const price = nonNegativeNumber(String(data.price), 'price');
  if (price.error) errors.push(price.error);
  return errors;
}

export function FixtureCatalogImportExport() {
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const bulkUpsertFixtureCatalogItems = useLayoutStore((s) => s.bulkUpsertFixtureCatalogItems);

  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<ParsedFixtureRow[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);

  function handleDownload() {
    downloadBlob(exportFixtureCatalogXlsx(fixtureCatalog), 'fixture-catalogue.xlsx');
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setCommittedCount(null);
    setIsParsing(true);
    try {
      setRows(await parseFixtureCatalogFile(file, fixtureCatalog));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read that file.');
      setRows(null);
    } finally {
      setIsParsing(false);
    }
  }

  function updateRow(index: number, patch: Partial<FixtureCatalogItem>) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row = next[index];
      const data = { ...row.data, ...patch };
      next[index] = { ...row, data, errors: revalidate(data, row.errors) };
      return next;
    });
  }

  function toggleDelete(index: number, checked: boolean) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row = next[index];
      const errors = checked
        ? finalizeRowErrors(row.errors, true, row.isNew)
        : revalidate(row.data, row.errors);
      next[index] = { ...row, markedForDeletion: checked, errors };
      return next;
    });
  }

  async function handleCommit() {
    if (!rows) return;
    setIsCommitting(true);
    setError(null);
    try {
      const toUpsert = rows.filter((r) => !r.markedForDeletion).map((r) => r.data);
      const toDeleteIds = rows.filter((r) => r.markedForDeletion).map((r) => r.data.id);
      await bulkUpsertFixtureCatalogItems(toUpsert, toDeleteIds);
      setCommittedCount(rows.length);
      setRows(null);
      toast.success(`Saved ${rows.length} fixture${rows.length === 1 ? '' : 's'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save the imported fixtures.';
      setError(message);
      toast.error('Failed to save fixtures', { description: message });
    } finally {
      setIsCommitting(false);
    }
  }

  const deleteCount = rows?.filter((r) => r.markedForDeletion).length ?? 0;
  const newCount = rows?.filter((r) => r.isNew && !r.markedForDeletion).length ?? 0;
  const updatedCount = rows ? rows.length - newCount - deleteCount : 0;
  const hasErrors = rows?.some((r) => r.errors.length > 0) ?? false;

  return (
    <div className="rounded-xl border border-dashed border-input bg-background px-4 py-3">
      <Button
        type="button"
        variant="link"
        size="xs"
        className="h-auto self-start p-0 text-xs font-medium"
        onClick={() => setIsOpen((open) => !open)}
      >
        {isOpen ? 'Hide bulk edit via Excel' : 'Bulk edit via Excel'}
      </Button>

      {isOpen && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[13px] text-muted-foreground">
            Download your current fixture catalogue, edit in Excel, then upload here. Removing a
            row from the sheet does nothing — type DELETE in the delete column (or check the box
            below after uploading) to actually remove one.
          </p>

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="xs" onClick={handleDownload}>
              Download for editing
            </Button>
            <Button type="button" variant="outline" size="xs" asChild>
              <label className="cursor-pointer">
                {isParsing ? 'Reading…' : 'Upload edited file'}
                <input type="file" accept=".xlsx" onChange={handleFileSelected} disabled={isParsing} className="hidden" />
              </label>
            </Button>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}
          {committedCount !== null && (
            <p className="text-xs text-success">Saved {committedCount} row{committedCount === 1 ? '' : 's'}.</p>
          )}

          {rows && rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-muted-foreground">
                {newCount} new, {updatedCount} updated, {deleteCount} removed.
                {hasErrors && <span className="ml-1 text-destructive">Fix every error below before saving.</span>}
              </p>

              <div className="overflow-x-auto rounded-xl border border-border bg-card">
                <table className="w-full border-collapse text-left text-sm">
                  <thead>
                    <tr className="border-b border-border bg-secondary text-[13px] text-muted-foreground">
                      <th className="px-3 py-2.5 font-semibold">Row</th>
                      <th className="px-3 py-2.5 font-semibold">Delete?</th>
                      <th className="px-3 py-2.5 font-semibold">Label</th>
                      <th className="px-3 py-2.5 font-semibold">Kind</th>
                      <th className="px-3 py-2.5 font-semibold">Colour temp (K)</th>
                      <th className="px-3 py-2.5 font-semibold">Lumens</th>
                      <th className="px-3 py-2.5 font-semibold">Model path</th>
                      <th className="px-3 py-2.5 font-semibold">Pricing</th>
                      <th className="px-3 py-2.5 font-semibold">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={row.data.id}
                        className={row.markedForDeletion ? 'border-b border-border/70 bg-red-50 align-top' : 'border-b border-border/70 align-top last:border-b-0'}
                      >
                        <td className="px-2 py-1.5 text-muted-foreground">
                          {row.rowNumber}
                          <div className="text-xs">{row.markedForDeletion ? 'delete' : row.isNew ? 'new' : 'update'}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Checkbox
                            checked={row.markedForDeletion}
                            disabled={row.isNew}
                            title={row.isNew ? "New rows can't be deleted" : 'Delete this row on commit'}
                            onCheckedChange={(checked) => toggleDelete(index, checked === true)}
                          />
                        </td>
                        <td className="px-3 py-2">
                          <input className={inputClass} disabled={row.markedForDeletion} value={row.data.label} onChange={(e) => updateRow(index, { label: e.target.value })} />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            disabled={row.markedForDeletion}
                            value={row.data.kind}
                            onValueChange={(value) => updateRow(index, { kind: value as FixtureCatalogItem['kind'] })}
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {FIXTURE_KINDS.map((k) => (
                                <SelectItem key={k} value={k}>{k}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.colorTempK} onChange={(e) => updateRow(index, { colorTempK: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.lumens} onChange={(e) => updateRow(index, { lumens: Number(e.target.value) })} />
                        </td>
                        <td className="px-3 py-2">
                          <input className={inputClass} disabled={row.markedForDeletion} value={row.data.modelUrl ?? ''} onChange={(e) => updateRow(index, { modelUrl: e.target.value || undefined })} />
                        </td>
                        <td className="px-3 py-2">
                          <Select
                            disabled={row.markedForDeletion}
                            value={row.data.pricingMode}
                            onValueChange={(value) => updateRow(index, { pricingMode: value as FixtureCatalogItem['pricingMode'] })}
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {PRICING_MODES.map((m) => (
                                <SelectItem key={m} value={m}>{m}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-3 py-2">
                          <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.price} onChange={(e) => updateRow(index, { price: Number(e.target.value) })} />
                          {row.markedForDeletion ? (
                            row.errors.length > 0 ? (
                              <ul className="mt-1 list-disc pl-3 text-xs text-destructive">
                                {row.errors.map((err) => <li key={err}>{err}</li>)}
                              </ul>
                            ) : (
                              <p className="mt-1 text-xs text-destructive">Will be deleted</p>
                            )
                          ) : (
                            row.errors.length > 0 && (
                              <ul className="mt-1 list-disc pl-3 text-xs text-destructive">
                                {row.errors.map((err) => <li key={err}>{err}</li>)}
                              </ul>
                            )
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <Button
                type="button"
                size="sm"
                className="self-start"
                onClick={handleCommit}
                disabled={hasErrors || isCommitting}
              >
                {isCommitting ? 'Saving…' : `Commit ${rows.length} change${rows.length === 1 ? '' : 's'}`}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
