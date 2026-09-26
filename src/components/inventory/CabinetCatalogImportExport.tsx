// src/components/inventory/CabinetCatalogImportExport.tsx
//
// The Excel round trip for the cabinet catalogue — download, edit,
// upload, validate, fix inline, commit — per docs/PRINCIPLES.md's
// "Inventory import and export". Pilot catalogue; the same pattern
// (a lib/importExport/<catalog>.ts module + a panel like this one)
// repeats for obstacles/appliances/handles/fixtures too.
//
// Collapsed behind a toggle by default — this sits above the existing
// one-row-at-a-time cabinet table in InventoryManager.tsx, and most
// visits to that screen are a single quick edit, not a bulk one.

import { useState } from 'react';
import { toast } from 'sonner';
import { useLayoutStore } from '../../store/layoutStore';
import {
  exportCabinetCatalogXlsx,
  parseCabinetCatalogFile,
  MODULE_TYPES,
  MATERIALS,
  type ParsedCabinetRow,
} from '../../lib/importExport/cabinetImportExport';
import { requiredString, positiveNumber, finalizeRowErrors } from '../../lib/importExport/xlsxHelpers';
import { downloadBlob } from '../../lib/downloadBlob';
import { Button } from '../ui/button';
import { Checkbox } from '../ui/checkbox';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../ui/select';
import type { CatalogItem } from '../../types/Catalog';

// Radix Select rejects an empty-string item value, so "no finish
// chosen yet" needs a real sentinel, mapped back to '' in the handler
// (revalidate already treats '' as "finish must be selected").
const NO_FINISH_VALUE = '__none__';

const inputClass = 'w-full rounded border border-gray-300 px-1.5 py-1 text-xs disabled:bg-gray-100 disabled:text-gray-400';

// Re-checks only the fields this grid actually lets someone edit
// (label/category/dimensions/price via plain inputs; module_type/
// material/finish via a dropdown, which can't produce an invalid value
// at all). Reuses the exact same string-in validators the parser
// itself calls, rather than a second copy of "what counts as valid",
// with values coerced back to strings the way a spreadsheet cell's
// text always was. Identity errors (duplicate/unknown id) aren't
// re-derived here — see the parser's own comment on why id has no
// inline fix — so any error string starting with those stays put.
function revalidate(data: CatalogItem, priorErrors: string[]): string[] {
  const errors = priorErrors.filter(
    (e) => e.startsWith('Unknown id') || e.includes('appears on more than one row')
  );
  const label = requiredString(data.label, 'label');
  if (label.error) errors.push(label.error);
  const category = requiredString(data.category, 'category');
  if (category.error) errors.push(category.error);
  const width = positiveNumber(String(data.widthMm), 'width_mm');
  if (width.error) errors.push(width.error);
  const depth = positiveNumber(String(data.depthMm), 'depth_mm');
  if (depth.error) errors.push(depth.error);
  const height = positiveNumber(String(data.heightMm), 'height_mm');
  if (height.error) errors.push(height.error);
  const price = positiveNumber(String(data.unitPrice), 'unit_price');
  if (price.error) errors.push(price.error);
  if (!data.finishId) errors.push('finish must be selected');
  return errors;
}

export function CabinetCatalogImportExport() {
  const cabinetCatalog = useLayoutStore((s) => s.cabinetCatalog);
  const finishes = useLayoutStore((s) => s.finishes);
  const bulkUpsertCabinetCatalogItems = useLayoutStore((s) => s.bulkUpsertCabinetCatalogItems);

  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<ParsedCabinetRow[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);

  function handleDownload() {
    const blob = exportCabinetCatalogXlsx(cabinetCatalog, finishes);
    downloadBlob(blob, 'cabinet-catalogue.xlsx');
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = ''; // lets the same filename be re-selected after a fix-and-reupload
    if (!file) return;
    setError(null);
    setCommittedCount(null);
    setIsParsing(true);
    try {
      const parsed = await parseCabinetCatalogFile(file, cabinetCatalog, finishes);
      setRows(parsed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read that file.');
      setRows(null);
    } finally {
      setIsParsing(false);
    }
  }

  function updateRow(index: number, patch: Partial<CatalogItem>) {
    setRows((prev) => {
      if (!prev) return prev;
      const next = [...prev];
      const row = next[index];
      const data = { ...row.data, ...patch };
      next[index] = { ...row, data, errors: revalidate(data, row.errors) };
      return next;
    });
  }

  // Un-marking restores normal field validation (revalidate); marking
  // narrows errors down to just the id ones (finalizeRowErrors) — a
  // row about to be deleted shouldn't be blocked by a bad price it's
  // not going to keep anyway.
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
      await bulkUpsertCabinetCatalogItems(toUpsert, toDeleteIds);
      setCommittedCount(rows.length);
      setRows(null);
      toast.success(`Saved ${rows.length} cabinet${rows.length === 1 ? '' : 's'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save the imported cabinets.';
      setError(message);
      toast.error('Failed to save cabinets', { description: message });
    } finally {
      setIsCommitting(false);
    }
  }

  const deleteCount = rows?.filter((r) => r.markedForDeletion).length ?? 0;
  const newCount = rows?.filter((r) => r.isNew && !r.markedForDeletion).length ?? 0;
  const updatedCount = rows ? rows.length - newCount - deleteCount : 0;
  const hasErrors = rows?.some((r) => r.errors.length > 0) ?? false;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
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
          <p className="text-[11px] text-gray-500">
            Download your current cabinet list, edit it in Excel (change prices/dimensions, add
            new rows, leave the id column alone), then upload it here. Removing a row from the
            sheet does nothing — type DELETE in the delete column (or check the box below after
            uploading) to actually remove one.
          </p>

          <div className="flex gap-2">
            <Button type="button" variant="outline" size="xs" onClick={handleDownload}>
              Download for editing
            </Button>
            <Button type="button" variant="outline" size="xs" asChild>
              <label className="cursor-pointer">
                {isParsing ? 'Reading…' : 'Upload edited file'}
                <input
                  type="file"
                  accept=".xlsx"
                  onChange={handleFileSelected}
                  disabled={isParsing}
                  className="hidden"
                />
              </label>
            </Button>
          </div>

          {error && <p className="text-xs text-red-600">{error}</p>}
          {committedCount !== null && (
            <p className="text-xs text-emerald-700">
              Saved {committedCount} row{committedCount === 1 ? '' : 's'}.
            </p>
          )}

          {rows && rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-600">
                {newCount} new, {updatedCount} updated, {deleteCount} removed.
                {hasErrors && (
                  <span className="ml-1 text-red-600">Fix every error below before saving.</span>
                )}
              </p>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                      <th className="px-2 py-2 font-medium">Row</th>
                      <th className="px-2 py-2 font-medium">Delete?</th>
                      <th className="px-2 py-2 font-medium">Label</th>
                      <th className="px-2 py-2 font-medium">Category</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">W×D×H (mm)</th>
                      <th className="px-2 py-2 font-medium">Material</th>
                      <th className="px-2 py-2 font-medium">Finish</th>
                      <th className="px-2 py-2 font-medium">Price</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={row.data.id}
                        className={
                          row.markedForDeletion
                            ? 'border-b border-gray-100 bg-red-50 align-top'
                            : 'border-b border-gray-100 align-top'
                        }
                      >
                        <td className="px-2 py-1.5 text-gray-500">
                          {row.rowNumber}
                          <div className="text-[10px]">
                            {row.markedForDeletion ? 'delete' : row.isNew ? 'new' : 'update'}
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Checkbox
                            checked={row.markedForDeletion}
                            disabled={row.isNew}
                            title={row.isNew ? "New rows can't be deleted" : 'Delete this row on commit'}
                            onCheckedChange={(checked) => toggleDelete(index, checked === true)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={inputClass}
                            disabled={row.markedForDeletion}
                            value={row.data.label}
                            onChange={(e) => updateRow(index, { label: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            className={inputClass}
                            disabled={row.markedForDeletion}
                            value={row.data.category}
                            onChange={(e) => updateRow(index, { category: e.target.value })}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            disabled={row.markedForDeletion}
                            value={row.data.moduleType}
                            onValueChange={(value) =>
                              updateRow(index, { moduleType: value as CatalogItem['moduleType'] })
                            }
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MODULE_TYPES.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <input
                              type="number"
                              className={inputClass}
                              disabled={row.markedForDeletion}
                              value={row.data.widthMm}
                              onChange={(e) => updateRow(index, { widthMm: Number(e.target.value) })}
                            />
                            <input
                              type="number"
                              className={inputClass}
                              disabled={row.markedForDeletion}
                              value={row.data.depthMm}
                              onChange={(e) => updateRow(index, { depthMm: Number(e.target.value) })}
                            />
                            <input
                              type="number"
                              className={inputClass}
                              disabled={row.markedForDeletion}
                              value={row.data.heightMm}
                              onChange={(e) => updateRow(index, { heightMm: Number(e.target.value) })}
                            />
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            disabled={row.markedForDeletion}
                            value={row.data.material}
                            onValueChange={(value) =>
                              updateRow(index, { material: value as CatalogItem['material'] })
                            }
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              {MATERIALS.map((m) => (
                                <SelectItem key={m} value={m}>
                                  {m}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <Select
                            disabled={row.markedForDeletion}
                            value={row.data.finishId || NO_FINISH_VALUE}
                            onValueChange={(value) =>
                              updateRow(index, { finishId: value === NO_FINISH_VALUE ? '' : value })
                            }
                          >
                            <SelectTrigger size="sm" className="w-full">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value={NO_FINISH_VALUE}>— select —</SelectItem>
                              {finishes.map((f) => (
                                <SelectItem key={f.id} value={f.id}>
                                  {f.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="number"
                            className={inputClass}
                            disabled={row.markedForDeletion}
                            value={row.data.unitPrice}
                            onChange={(e) => updateRow(index, { unitPrice: Number(e.target.value) })}
                          />
                          {row.markedForDeletion ? (
                            row.errors.length > 0 ? (
                              <ul className="mt-1 list-disc pl-3 text-[10px] text-red-600">
                                {row.errors.map((err) => (
                                  <li key={err}>{err}</li>
                                ))}
                              </ul>
                            ) : (
                              <p className="mt-1 text-[10px] text-red-600">Will be deleted</p>
                            )
                          ) : (
                            row.errors.length > 0 && (
                              <ul className="mt-1 list-disc pl-3 text-[10px] text-red-600">
                                {row.errors.map((err) => (
                                  <li key={err}>{err}</li>
                                ))}
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
