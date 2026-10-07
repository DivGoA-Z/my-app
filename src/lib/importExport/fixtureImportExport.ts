// src/lib/importExport/fixtureImportExport.ts
//
// Light fixture catalogue's own Excel round trip — see
// cabinetImportExport.ts's header comment for the match-key
// reasoning, unchanged here. No FK, and the same shape of optional
// scalar fields (model path, per-axis rotation correction) the
// appliance module already has — see applianceImportExport.ts's
// header comment for why those are on the sheet rather than deferred.

import { modelUrlProblem } from '../modelUrl';
import type { FixtureCatalogItem, FixtureKind } from '../../types/fixture';
import {
  buildWorkbookBlob,
  readFirstSheetRows,
  requiredString,
  positiveNumber,
  nonNegativeNumber,
  optionalString,
  optionalNumber,
  enumValue,
  resolveRowId,
  flagDuplicateMatchedIds,
  isMarkedForDeletion,
  finalizeRowErrors,
  DELETE_MARKER_HEADER,
} from './xlsxHelpers';

// Duplicated from schema.sql's own check constraint / FixtureManager's
// implicit set — see cabinetImportExport.ts's MODULE_TYPES comment
// for why this is a plain literal list rather than an import.
const FIXTURE_KINDS: readonly FixtureKind[] = ['strip', 'spot', 'cove', 'pendant', 'plinth', 'drawer'];
const PRICING_MODES = ['per-unit', 'per-metre'] as const;

const SHEET_NAME = 'Fixtures';
const HEADERS = [
  'id',
  'label',
  'kind',
  'color_temp_k',
  'lumens',
  'pricing_mode',
  'price',
  'model_url',
  'model_rotation_x_deg',
  'model_rotation_y_deg',
  'model_rotation_z_deg',
  DELETE_MARKER_HEADER,
] as const;

export function exportFixtureCatalogXlsx(items: FixtureCatalogItem[]): Blob {
  const dataRows = items.map((item) => ({
    id: item.id,
    label: item.label,
    kind: item.kind,
    color_temp_k: item.colorTempK,
    lumens: item.lumens,
    pricing_mode: item.pricingMode,
    price: item.price,
    model_url: item.modelUrl ?? '',
    model_rotation_x_deg: item.modelRotationXDeg ?? '',
    model_rotation_y_deg: item.modelRotationYDeg ?? '',
    model_rotation_z_deg: item.modelRotationZDeg ?? '',
    delete: '',
  }));

  const instructionRows = [
    { column: 'id', meaning: 'Leave BLANK to add a new fixture. Leave an existing value UNTOUCHED to update that row — do not type your own.', unit: '—', allowed_values: '—', example: '(blank for a new row)' },
    { column: 'label', meaning: 'Your own name for this fixture.', unit: 'text', allowed_values: '—', example: 'LED strip 3000K warm white' },
    { column: 'kind', meaning: 'What kind of fixture this is.', unit: '—', allowed_values: FIXTURE_KINDS.join(', '), example: 'strip' },
    { column: 'color_temp_k', meaning: 'Fixed colour temperature — a 3000K and a 6500K strip are different products at different rates.', unit: 'K', allowed_values: 'positive number', example: 3000 },
    { column: 'lumens', meaning: 'Brightness — also decides which fixtures win a slot in the renderer\'s real-light budget.', unit: 'lm', allowed_values: 'positive number', example: 900 },
    { column: 'pricing_mode', meaning: 'strip/cove/plinth are sold by running metre; spot/pendant/drawer by the piece.', unit: '—', allowed_values: PRICING_MODES.join(', '), example: 'per-metre' },
    { column: 'price', meaning: 'Price per piece, or per running metre — see pricing_mode.', unit: '₹', allowed_values: '0 or more', example: 340 },
    { column: 'model_url', meaning: 'Optional — path to a .glb/.gltf 3D model. Leave blank for the plain primitive body.', unit: '—', allowed_values: 'any text, or blank', example: '/models/lighting/pendant-industrial.glb' },
    { column: 'model_rotation_x_deg', meaning: 'Optional — fixed orientation correction, only ever a multiple of 90°.', unit: 'degrees', allowed_values: '0, 90, 180, 270, or blank', example: '(blank)' },
    { column: 'model_rotation_y_deg', meaning: 'Optional — see model_rotation_x_deg.', unit: 'degrees', allowed_values: '0, 90, 180, 270, or blank', example: '(blank)' },
    { column: 'model_rotation_z_deg', meaning: 'Optional — see model_rotation_x_deg.', unit: 'degrees', allowed_values: '0, 90, 180, 270, or blank', example: '(blank)' },
    { column: 'delete', meaning: 'Type DELETE (any case) to remove this fixture when you commit. Leave blank to keep/update it. Has no effect on a blank-id (new) row.', unit: '—', allowed_values: 'DELETE, or blank', example: '(blank)' },
  ];

  return buildWorkbookBlob([
    { name: SHEET_NAME, headers: [...HEADERS], rows: dataRows },
    { name: 'Instructions', headers: ['column', 'meaning', 'unit', 'allowed_values', 'example'], rows: instructionRows },
  ]);
}

export interface ParsedFixtureRow {
  rowNumber: number;
  isNew: boolean;
  markedForDeletion: boolean;
  data: FixtureCatalogItem;
  errors: string[];
}

export async function parseFixtureCatalogFile(
  file: File,
  existing: FixtureCatalogItem[]
): Promise<ParsedFixtureRow[]> {
  const rows = await readFirstSheetRows(file);
  return parseFixtureCatalogRows(rows, existing);
}

export function parseFixtureCatalogRows(
  rows: Record<string, string>[],
  existing: FixtureCatalogItem[]
): ParsedFixtureRow[] {
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

    const kind = enumValue(row.kind ?? '', 'kind', FIXTURE_KINDS);
    if (kind.error) errors.push(kind.error);

    const colorTempK = positiveNumber(row.color_temp_k ?? '', 'color_temp_k');
    if (colorTempK.error) errors.push(colorTempK.error);

    const lumens = positiveNumber(row.lumens ?? '', 'lumens');
    if (lumens.error) errors.push(lumens.error);

    const pricingMode = enumValue(row.pricing_mode ?? '', 'pricing_mode', PRICING_MODES);
    if (pricingMode.error) errors.push(pricingMode.error);

    const price = nonNegativeNumber(row.price ?? '', 'price');
    if (price.error) errors.push(price.error);

    const modelUrl = optionalString(row.model_url ?? '');
    // Same rule as the edit panel (lib/modelUrl.ts): a stray character after
    // .glb silently turns the model into a plain box.
    { const problem = modelUrlProblem(row.model_url ?? ''); if (problem) errors.push(`model_url: ${problem}`); }

    const modelRotationXDeg = optionalNumber(row.model_rotation_x_deg ?? '', 'model_rotation_x_deg');
    if (modelRotationXDeg.error) errors.push(modelRotationXDeg.error);
    const modelRotationYDeg = optionalNumber(row.model_rotation_y_deg ?? '', 'model_rotation_y_deg');
    if (modelRotationYDeg.error) errors.push(modelRotationYDeg.error);
    const modelRotationZDeg = optionalNumber(row.model_rotation_z_deg ?? '', 'model_rotation_z_deg');
    if (modelRotationZDeg.error) errors.push(modelRotationZDeg.error);

    const markedForDeletion = isMarkedForDeletion(row[DELETE_MARKER_HEADER] ?? '');

    // Starts from the STORED row on an update, with the sheet's values
    // laid over it (§54). Today this sheet carries every field, so the
    // spread changes nothing — it's here so that a field added to
    // FixtureCatalogItem later, and not added to the sheet, survives a re-import
    // instead of being silently blanked by the whole-row upsert. That
    // exact failure wiped cabinet fronts, handles and panels.
    const data: FixtureCatalogItem = {
      ...(isNew ? {} : existingById.get(id)),
      id,
      label: label.value,
      kind: kind.value ?? FIXTURE_KINDS[0],
      colorTempK: colorTempK.value,
      lumens: lumens.value,
      pricingMode: pricingMode.value ?? PRICING_MODES[0],
      price: price.value,
      modelUrl,
      modelRotationXDeg: modelRotationXDeg.value,
      modelRotationYDeg: modelRotationYDeg.value,
      modelRotationZDeg: modelRotationZDeg.value,
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

export { FIXTURE_KINDS, PRICING_MODES };
