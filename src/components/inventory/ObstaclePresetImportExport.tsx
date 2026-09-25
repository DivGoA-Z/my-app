// src/components/inventory/ObstaclePresetImportExport.tsx
//
// Obstacle preset Excel round trip — second catalogue through the UI
// pattern the cabinet pilot established. See
// CabinetCatalogImportExport.tsx's header comment for the shape this
// mirrors; differences here are just which fields exist.

import { useState } from 'react';
import { toast } from 'sonner';
import { useLayoutStore } from '../../store/layoutStore';
import {
  exportObstaclePresetsXlsx,
  parseObstaclePresetsFile,
  OBSTACLE_TYPES,
  type ParsedObstacleRow,
} from '../../lib/importExport/obstacleImportExport';
import {
  requiredString,
  positiveNumber,
  nonNegativeNumber,
  finalizeRowErrors,
} from '../../lib/importExport/xlsxHelpers';
import { downloadBlob } from '../../lib/downloadBlob';
import { Button } from '../ui/button';
import type { ObstaclePreset } from '../../types/Catalog';

const inputClass = 'w-full rounded border border-gray-300 px-1.5 py-1 text-xs disabled:bg-gray-100 disabled:text-gray-400';

function revalidate(data: ObstaclePreset, priorErrors: string[]): string[] {
  const errors = priorErrors.filter((e) => e.startsWith('Unknown id') || e.includes('appears on more than one row'));
  const label = requiredString(data.label, 'label');
  if (label.error) errors.push(label.error);
  const width = positiveNumber(String(data.widthMm), 'width_mm');
  if (width.error) errors.push(width.error);
  const depth = positiveNumber(String(data.depthMm), 'depth_mm');
  if (depth.error) errors.push(depth.error);
  const height = positiveNumber(String(data.heightMm), 'height_mm');
  if (height.error) errors.push(height.error);
  const elevation = nonNegativeNumber(String(data.elevationMm), 'elevation_mm');
  if (elevation.error) errors.push(elevation.error);
  return errors;
}

export function ObstaclePresetImportExport() {
  const obstaclePresets = useLayoutStore((s) => s.obstaclePresets);
  const bulkUpsertObstaclePresets = useLayoutStore((s) => s.bulkUpsertObstaclePresets);

  const [isOpen, setIsOpen] = useState(false);
  const [rows, setRows] = useState<ParsedObstacleRow[] | null>(null);
  const [isParsing, setIsParsing] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [committedCount, setCommittedCount] = useState<number | null>(null);

  function handleDownload() {
    downloadBlob(exportObstaclePresetsXlsx(obstaclePresets), 'obstacle-presets.xlsx');
  }

  async function handleFileSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError(null);
    setCommittedCount(null);
    setIsParsing(true);
    try {
      setRows(await parseObstaclePresetsFile(file, obstaclePresets));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to read that file.');
      setRows(null);
    } finally {
      setIsParsing(false);
    }
  }

  function updateRow(index: number, patch: Partial<ObstaclePreset>) {
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
      await bulkUpsertObstaclePresets(toUpsert, toDeleteIds);
      setCommittedCount(rows.length);
      setRows(null);
      toast.success(`Saved ${rows.length} preset${rows.length === 1 ? '' : 's'}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to save the imported presets.';
      setError(message);
      toast.error('Failed to save presets', { description: message });
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
            Download your current obstacle presets, edit in Excel, then upload here. Removing a
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

          {error && <p className="text-xs text-red-600">{error}</p>}
          {committedCount !== null && (
            <p className="text-xs text-emerald-700">Saved {committedCount} row{committedCount === 1 ? '' : 's'}.</p>
          )}

          {rows && rows.length > 0 && (
            <div className="flex flex-col gap-2">
              <p className="text-xs text-gray-600">
                {newCount} new, {updatedCount} updated, {deleteCount} removed.
                {hasErrors && <span className="ml-1 text-red-600">Fix every error below before saving.</span>}
              </p>

              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-gray-200 bg-gray-50 text-gray-500">
                      <th className="px-2 py-2 font-medium">Row</th>
                      <th className="px-2 py-2 font-medium">Delete?</th>
                      <th className="px-2 py-2 font-medium">Label</th>
                      <th className="px-2 py-2 font-medium">Type</th>
                      <th className="px-2 py-2 font-medium">W×D (mm)</th>
                      <th className="px-2 py-2 font-medium">Floor-to-ceiling</th>
                      <th className="px-2 py-2 font-medium">Height (mm)</th>
                      <th className="px-2 py-2 font-medium">Off floor (mm)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((row, index) => (
                      <tr
                        key={row.data.id}
                        className={row.markedForDeletion ? 'border-b border-gray-100 bg-red-50 align-top' : 'border-b border-gray-100 align-top'}
                      >
                        <td className="px-2 py-1.5 text-gray-500">
                          {row.rowNumber}
                          <div className="text-[10px]">{row.markedForDeletion ? 'delete' : row.isNew ? 'new' : 'update'}</div>
                        </td>
                        <td className="px-2 py-1.5">
                          <input
                            type="checkbox"
                            checked={row.markedForDeletion}
                            disabled={row.isNew}
                            title={row.isNew ? "New rows can't be deleted" : 'Delete this row on commit'}
                            onChange={(e) => toggleDelete(index, e.target.checked)}
                          />
                        </td>
                        <td className="px-2 py-1.5">
                          <input className={inputClass} disabled={row.markedForDeletion} value={row.data.label} onChange={(e) => updateRow(index, { label: e.target.value })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className={inputClass}
                            disabled={row.markedForDeletion}
                            value={row.data.type}
                            onChange={(e) => updateRow(index, { type: e.target.value as ObstaclePreset['type'] })}
                          >
                            {OBSTACLE_TYPES.map((t) => (
                              <option key={t} value={t}>{t}</option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <div className="flex gap-1">
                            <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.widthMm} onChange={(e) => updateRow(index, { widthMm: Number(e.target.value) })} />
                            <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.depthMm} onChange={(e) => updateRow(index, { depthMm: Number(e.target.value) })} />
                          </div>
                        </td>
                        <td className="px-2 py-1.5">
                          <select
                            className={inputClass}
                            disabled={row.markedForDeletion}
                            value={row.data.floorToCeiling ? 'yes' : 'no'}
                            onChange={(e) => updateRow(index, { floorToCeiling: e.target.value === 'yes' })}
                          >
                            <option value="yes">yes</option>
                            <option value="no">no</option>
                          </select>
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.heightMm} onChange={(e) => updateRow(index, { heightMm: Number(e.target.value) })} />
                        </td>
                        <td className="px-2 py-1.5">
                          <input type="number" className={inputClass} disabled={row.markedForDeletion} value={row.data.elevationMm} onChange={(e) => updateRow(index, { elevationMm: Number(e.target.value) })} />
                          {row.markedForDeletion ? (
                            row.errors.length > 0 ? (
                              <ul className="mt-1 list-disc pl-3 text-[10px] text-red-600">
                                {row.errors.map((err) => <li key={err}>{err}</li>)}
                              </ul>
                            ) : (
                              <p className="mt-1 text-[10px] text-red-600">Will be deleted</p>
                            )
                          ) : (
                            row.errors.length > 0 && (
                              <ul className="mt-1 list-disc pl-3 text-[10px] text-red-600">
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
