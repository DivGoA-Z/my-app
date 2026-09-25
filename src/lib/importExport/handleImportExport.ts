// src/lib/importExport/handleImportExport.ts
//
// Handle catalogue's own Excel round trip — see
// cabinetImportExport.ts's header comment for the match-key
// reasoning, unchanged here. All flat scalar fields, no FK.

import type { HandleSpec, HandleKind } from '../../types/front';
import {
  buildWorkbookBlob,
  readFirstSheetRows,
  requiredString,
  nonNegativeNumber,
  numberInRange,
  hexColor,
  enumValue,
  resolveRowId,
  flagDuplicateMatchedIds,
  isMarkedForDeletion,
  finalizeRowErrors,
  DELETE_MARKER_HEADER,
} from './xlsxHelpers';

// Duplicated from schema.sql's own check constraint / HandleManager's
// implicit set — see cabinetImportExport.ts's MODULE_TYPES comment
// for why this is a plain literal list rather than an import.
const HANDLE_KINDS: readonly HandleKind[] = ['bar', 'knob', 'edge-profile', 'gola', 'handleless'];
const PRICING_MODES = ['per-unit', 'per-metre'] as const;

const SHEET_NAME = 'Handles';
const HEADERS = [
  'id',
  'label',
  'kind',
  'length_mm',
  'color_hex',
  'metalness',
  'roughness',
  'pricing_mode',
  'price',
  DELETE_MARKER_HEADER,
] as const;

export function exportHandlesXlsx(items: HandleSpec[]): Blob {
  const dataRows = items.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    length_mm: item.lengthMm,
    color_hex: item.colorHex,
    metalness: item.metalness,
    roughness: item.roughness,
    pricing_mode: item.pricingMode,
    price: item.price,
    delete: '',
  }));

  const instructionRows = [
    { column: 'id', meaning: 'Leave BLANK to add a new handle. Leave an existing value UNTOUCHED to update that row — do not type your own.', unit: '—', allowed_values: '—', example: '(blank for a new row)' },
    { column: 'label', meaning: 'Your own name for this handle.', unit: 'text', allowed_values: '—', example: 'Bar handle 128mm — brushed steel' },
    { column: 'kind', meaning: 'What kind of handle this is.', unit: '—', allowed_values: HANDLE_KINDS.join(', '), example: 'bar' },
    { column: 'length_mm', meaning: 'Length along the front for bar/edge-profile/gola; diameter for knob; unused for handleless.', unit: 'mm', allowed_values: '0 or more', example: 128 },
    { column: 'color_hex', meaning: 'Hardware finish colour.', unit: '—', allowed_values: 'hex colour, e.g. #b8bcc0', example: '#b8bcc0' },
    { column: 'metalness', meaning: 'Render material property.', unit: '—', allowed_values: '0 to 1', example: 0.9 },
    { column: 'roughness', meaning: 'Render material property.', unit: '—', allowed_values: '0 to 1', example: 0.35 },
    { column: 'pricing_mode', meaning: 'Bar handles/knobs are bought per piece; gola/edge-profile are cut from stock and billed per running metre.', unit: '—', allowed_values: PRICING_MODES.join(', '), example: 'per-unit' },
    { column: 'price', meaning: 'Price per piece, or per running metre — see pricing_mode.', unit: '₹', allowed_values: '0 or more', example: 180 },
    { column: 'delete', meaning: 'Type DELETE (any case) to remove this handle when you commit. Leave blank to keep/update it. Has no effect on a blank-id (new) row.', unit: '—', allowed_values: 'DELETE, or blank', example: '(blank)' },
  ];

  return buildWorkbookBlob([
    { name: SHEET_NAME, headers: [...HEADERS], rows: dataRows },
    { name: 'Instructions', headers: ['column', 'meaning', 'unit', 'allowed_values', 'example'], rows: instructionRows },
  ]);
}

export interface ParsedHandleRow {
  rowNumber: number;
  isNew: boolean;
  markedForDeletion: boolean;
  data: HandleSpec;
  errors: string[];
}

export async function parseHandlesFile(file: File, existing: HandleSpec[]): Promise<ParsedHandleRow[]> {
  const rows = await readFirstSheetRows(file);
  return parseHandlesRows(rows, existing);
}

export function parseHandlesRows(
  rows: Record<string, string>[],
  existing: HandleSpec[]
): ParsedHandleRow[] {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const now = new Date().toISOString();

  const parsed = rows.map((row, index) => {
    const errors: string[] = [];

    const resolved = resolveRowId(row.id ?? '', existingById);
    const { id, isNew } = resolved;
    if (resolved.error) errors.push(resolved.error);
    const createdAt = !isNew ? existingById.get(id)!.createdAt : now;

    const label = requiredString(row.label ?? '', 'label');
    if (label.error) errors.push(label.error);

    const kind = enumValue(row.kind ?? '', 'kind', HANDLE_KINDS);
    if (kind.error) errors.push(kind.error);

    const lengthMm = nonNegativeNumber(row.length_mm ?? '', 'length_mm');
    if (lengthMm.error) errors.push(lengthMm.error);

    const colorHexResult = hexColor(row.color_hex ?? '', 'color_hex');
    if (colorHexResult.error) errors.push(colorHexResult.error);

    const metalness = numberInRange(row.metalness ?? '', 'metalness', 0, 1);
    if (metalness.error) errors.push(metalness.error);

    const roughness = numberInRange(row.roughness ?? '', 'roughness', 0, 1);
    if (roughness.error) errors.push(roughness.error);

    const pricingMode = enumValue(row.pricing_mode ?? '', 'pricing_mode', PRICING_MODES);
    if (pricingMode.error) errors.push(pricingMode.error);

    const price = nonNegativeNumber(row.price ?? '', 'price');
    if (price.error) errors.push(price.error);

    const markedForDeletion = isMarkedForDeletion(row[DELETE_MARKER_HEADER] ?? '');

    const data: HandleSpec = {
      id,
      label: label.value,
      kind: kind.value ?? HANDLE_KINDS[0],
      lengthMm: lengthMm.value,
      colorHex: colorHexResult.value,
      metalness: metalness.value,
      roughness: roughness.value,
      pricingMode: pricingMode.value ?? PRICING_MODES[0],
      price: price.value,
      createdAt,
      updatedAt: now,
    };

    return {
      rowNumber: index + 2,
      isNew,
      markedForDeletion,
      data,
      errors: finalizeRowErrors(errors, markedForDeletion, isNew),
    };
  });

  flagDuplicateMatchedIds(parsed);

  return parsed;
}

export { HANDLE_KINDS, PRICING_MODES };
