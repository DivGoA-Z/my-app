// src/lib/importExport/cabinetImportExport.ts
//
// The cabinet catalogue's own Excel round trip — the pilot for
// docs/PRINCIPLES.md's "Inventory import and export" design. Deferred
// from the sheet on purpose: `frontLayout` (a nested discriminated-
// union JSONB — drawer counts, hinge side, mixed-front rows) and
// `handleId`. Flattening that union into spreadsheet columns would be
// real design work for a feature nobody asked for; this sheet covers
// what a business actually bulk-edits — label, category, module type,
// dimensions, material, finish, price. Both stay in-app-only edits via
// the existing Front Picker.
//
// MATCH KEY: the row's own `id`, not a separate business-assigned
// code — none of the catalogues has one today (see DECISIONS.md), and
// the id already does exactly what a match key needs to: present in
// the sheet = update that row; blank = insert a new one. The exported
// sheet always carries the id column so a normal edit-and-reupload
// round trip preserves it untouched; nothing asks a business to type
// or read a UUID.
//
// `finishId` (a UUID FK) round-trips through the finish's LABEL
// instead — nobody should have to type a UUID into Excel. Resolved
// against the CURRENT finish catalogue at import time.

import type { CatalogItem } from '../../types/Catalog';
import type { ModuleType, MaterialType } from '../../types/cabinet';
import type { SurfaceFinish } from '../../types/finish';
import {
  buildWorkbookBlob,
  readFirstSheetRows,
  requiredString,
  positiveNumber,
  nonNegativeNumber,
  enumValue,
  resolveRowId,
  flagDuplicateMatchedIds,
  isMarkedForDeletion,
  finalizeRowErrors,
  DELETE_MARKER_HEADER,
} from './xlsxHelpers';

// Duplicated from InventoryManager.tsx's own MODULE_TYPES/MATERIALS
// consts rather than imported — those are local to that component
// file, not exported, and re-deriving a short literal list here is
// simpler than changing that file just to share it. Keep in sync by
// hand if a module type or material is ever added.
const MODULE_TYPES: readonly ModuleType[] = [
  'base-cabinet',
  'wall-cabinet',
  'tall-unit',
  'sink-unit',
  'cylinder-trolley',
  'drawer-unit',
  'corner-blind',
  'corner-magic',
  'corner-carousel',
  'pantry-unit',
];

const MATERIALS: readonly MaterialType[] = ['HDMR', 'Plywood', 'MDF', 'Particle Board', 'BWP'];

const SHEET_NAME = 'Cabinets';
const HEADERS = [
  'id',
  'label',
  'category',
  'module_type',
  'width_mm',
  'depth_mm',
  'height_mm',
  'material',
  'finish',
  'unit_price',
  DELETE_MARKER_HEADER,
] as const;

export function exportCabinetCatalogXlsx(items: CatalogItem[], finishes: SurfaceFinish[]): Blob {
  const finishLabelById = new Map(finishes.map((f) => [f.id, f.label]));

  const dataRows = items.map((item) => ({
    id: item.id,
    label: item.label,
    category: item.category,
    module_type: item.moduleType,
    width_mm: item.widthMm,
    depth_mm: item.depthMm,
    height_mm: item.heightMm,
    material: item.material,
    finish: finishLabelById.get(item.finishId) ?? '',
    unit_price: item.unitPrice,
    delete: '',
  }));

  const instructionRows = [
    { column: 'id', meaning: 'Leave BLANK to add a new cabinet. Leave an existing value UNTOUCHED to update that row — do not type your own.', unit: '—', allowed_values: '—', example: '(blank for a new row)' },
    { column: 'label', meaning: "Your own name for this piece, shown on the toolbar button.", unit: 'text', allowed_values: '—', example: 'Base Cabinet 600' },
    { column: 'category', meaning: 'Free grouping label you choose.', unit: 'text', allowed_values: '—', example: 'Base' },
    { column: 'module_type', meaning: 'What kind of cabinet this is.', unit: '—', allowed_values: MODULE_TYPES.join(', '), example: 'base-cabinet' },
    { column: 'width_mm', meaning: 'Cabinet width.', unit: 'mm', allowed_values: 'positive number', example: 600 },
    { column: 'depth_mm', meaning: 'Cabinet depth.', unit: 'mm', allowed_values: 'positive number', example: 600 },
    { column: 'height_mm', meaning: 'Cabinet height.', unit: 'mm', allowed_values: 'positive number', example: 850 },
    { column: 'material', meaning: 'Carcass substrate — costing only, never visible.', unit: '—', allowed_values: MATERIALS.join(', '), example: 'HDMR' },
    { column: 'finish', meaning: 'Must match an existing finish\'s name exactly (see Manage Inventory → Finishes).', unit: '—', allowed_values: 'any finish label in your catalogue', example: 'Merino Walnut 4102 (Laminate)' },
    { column: 'unit_price', meaning: 'A REFERENCE price only, shown when browsing the catalogue — this no longer feeds the quote at all. Every real cost (material, finish, hardware, fabrication, labour, margin) is computed live from this cabinet\'s own attributes and your rate card. Leave at 0, or fill in an estimate for your own browsing convenience.', unit: '₹', allowed_values: '0 or more', example: 0 },
    { column: 'delete', meaning: 'Type DELETE (any case) to remove this cabinet when you commit. Leave blank to keep/update it. Has no effect on a blank-id (new) row — there\'s nothing yet to delete.', unit: '—', allowed_values: 'DELETE, or blank', example: '(blank)' },
    { column: '(not on this sheet)', meaning: 'Front configuration (doors/drawers) and handle are edited in the app only, from each cabinet\'s Front Picker — not bulk-editable here.', unit: '—', allowed_values: '—', example: '—' },
  ];

  return buildWorkbookBlob([
    { name: SHEET_NAME, headers: [...HEADERS], rows: dataRows },
    {
      name: 'Instructions',
      headers: ['column', 'meaning', 'unit', 'allowed_values', 'example'],
      rows: instructionRows,
    },
  ]);
}

export interface ParsedCabinetRow {
  // 1-based, matching the row number a business would see if they
  // opened the sheet again — header is row 1, so the first data row
  // is 2.
  rowNumber: number;
  isNew: boolean;
  markedForDeletion: boolean;
  data: CatalogItem;
  errors: string[];
}

export async function parseCabinetCatalogFile(
  file: File,
  existing: CatalogItem[],
  finishes: SurfaceFinish[]
): Promise<ParsedCabinetRow[]> {
  const rows = await readFirstSheetRows(file);
  return parseCabinetCatalogRows(rows, existing, finishes);
}

export function parseCabinetCatalogRows(
  rows: Record<string, string>[],
  existing: CatalogItem[],
  finishes: SurfaceFinish[]
): ParsedCabinetRow[] {
  const existingById = new Map(existing.map((item) => [item.id, item]));
  const finishIdByLabel = new Map(finishes.map((f) => [f.label.trim().toLowerCase(), f.id]));
  const fallbackFinishId = finishes[0]?.id ?? '';
  const now = new Date().toISOString();

  const parsed = rows.map((row, index) => {
    const errors: string[] = [];

    // Doesn't get a review-grid input to "fix" — the real fix for an
    // unknown id is either clearing the cell (adds as new) or
    // correcting it back to the original file's value, neither of
    // which belongs in a free-text box next to the other, genuinely
    // editable fields.
    const resolved = resolveRowId(row.id ?? '', existingById);
    const { id, isNew } = resolved;
    if (resolved.error) errors.push(resolved.error);
    const createdAt = !isNew ? existingById.get(id)!.createdAt : now;

    const label = requiredString(row.label ?? '', 'label');
    if (label.error) errors.push(label.error);

    const category = requiredString(row.category ?? '', 'category');
    if (category.error) errors.push(category.error);

    const moduleType = enumValue(row.module_type ?? '', 'module_type', MODULE_TYPES);
    if (moduleType.error) errors.push(moduleType.error);

    const widthMm = positiveNumber(row.width_mm ?? '', 'width_mm');
    if (widthMm.error) errors.push(widthMm.error);

    const depthMm = positiveNumber(row.depth_mm ?? '', 'depth_mm');
    if (depthMm.error) errors.push(depthMm.error);

    const heightMm = positiveNumber(row.height_mm ?? '', 'height_mm');
    if (heightMm.error) errors.push(heightMm.error);

    const material = enumValue(row.material ?? '', 'material', MATERIALS);
    if (material.error) errors.push(material.error);

    const finishLabel = (row.finish ?? '').trim();
    const resolvedFinishId = finishIdByLabel.get(finishLabel.toLowerCase());
    if (!resolvedFinishId) {
      errors.push(`finish "${finishLabel}" doesn't match any finish in your catalogue (Manage Inventory → Finishes) — check spelling.`);
    }

    // nonNegativeNumber, not positiveNumber: unitPrice no longer feeds
    // the live quote at all (docs/DECISIONS.md §15) — it's a reference
    // figure shown when browsing the catalogue, and 0 is the expected,
    // common case now, not an error.
    const unitPrice = nonNegativeNumber(row.unit_price ?? '', 'unit_price');
    if (unitPrice.error) errors.push(unitPrice.error);

    const markedForDeletion = isMarkedForDeletion(row[DELETE_MARKER_HEADER] ?? '');

    const data: CatalogItem = {
      id,
      label: label.value,
      category: category.value,
      moduleType: moduleType.value ?? MODULE_TYPES[0],
      widthMm: widthMm.value,
      depthMm: depthMm.value,
      heightMm: heightMm.value,
      material: material.value ?? MATERIALS[0],
      finishId: resolvedFinishId ?? fallbackFinishId,
      unitPrice: unitPrice.value,
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

// Re-exported so the review-grid UI can offer real <select> dropdowns
// for the two enum fields when fixing a row inline, instead of a bare
// text input a business could mistype again.
export { MODULE_TYPES, MATERIALS };
