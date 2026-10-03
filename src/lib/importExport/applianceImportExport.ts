// src/lib/importExport/applianceImportExport.ts
//
// Appliance catalogue's own Excel round trip — see
// cabinetImportExport.ts's header comment for the match-key
// reasoning, unchanged here. No FK-like fields (unlike cabinets'
// finish), but this catalogue does have several genuinely OPTIONAL
// scalar fields (model path, per-axis rotation correction, sink
// cutout dimensions) — included on the sheet rather than deferred,
// since none of them are the kind of nested/structural complexity
// `frontLayout` was for cabinets; they're just fields that are blank
// most of the time.

import type { ApplianceCatalogItem } from '../../types/Catalog';
import type { ApplianceType } from '../../types/appliance';
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

// Duplicated from InventoryManager.tsx's own APPLIANCE_TYPES const —
// see cabinetImportExport.ts's MODULE_TYPES comment for why.
const APPLIANCE_TYPES: readonly ApplianceType[] = [
  'stove',
  'chimney',
  'oven',
  'otg',
  'toaster',
  'sink',
  'fridge',
  'microwave',
  'dishwasher',
  'water-purifier',
];

const SHEET_NAME = 'Appliances';
const HEADERS = [
  'id',
  'label',
  'appliance_type',
  'width_mm',
  'depth_mm',
  'height_mm',
  'default_elevation_mm',
  'model_url',
  'model_rotation_x_deg',
  'model_rotation_y_deg',
  'model_rotation_z_deg',
  'sink_cutout_width_mm',
  'sink_cutout_depth_mm',
  'unit_price',
  DELETE_MARKER_HEADER,
] as const;

export function exportApplianceCatalogXlsx(items: ApplianceCatalogItem[]): Blob {
  const dataRows = items.map((item) => ({
    id: item.id,
    label: item.label,
    appliance_type: item.applianceType,
    width_mm: item.widthMm,
    depth_mm: item.depthMm,
    height_mm: item.heightMm,
    default_elevation_mm: item.defaultElevationMm,
    model_url: item.modelUrl ?? '',
    model_rotation_x_deg: item.modelRotationXDeg ?? '',
    model_rotation_y_deg: item.modelRotationYDeg ?? '',
    model_rotation_z_deg: item.modelRotationZDeg ?? '',
    sink_cutout_width_mm: item.sinkCutoutWidthMm ?? '',
    sink_cutout_depth_mm: item.sinkCutoutDepthMm ?? '',
    unit_price: item.unitPrice,
    delete: '',
  }));

  const instructionRows = [
    { column: 'id', meaning: 'Leave BLANK to add a new appliance. Leave an existing value UNTOUCHED to update that row — do not type your own.', unit: '—', allowed_values: '—', example: '(blank for a new row)' },
    { column: 'label', meaning: 'Your own name for this appliance.', unit: 'text', allowed_values: '—', example: '4-Burner Hob' },
    { column: 'appliance_type', meaning: 'What kind of appliance this is.', unit: '—', allowed_values: APPLIANCE_TYPES.join(', '), example: 'stove' },
    { column: 'width_mm', meaning: 'Appliance width.', unit: 'mm', allowed_values: 'positive number', example: 600 },
    { column: 'depth_mm', meaning: 'Appliance depth.', unit: 'mm', allowed_values: 'positive number', example: 550 },
    { column: 'height_mm', meaning: 'Appliance height.', unit: 'mm', allowed_values: 'positive number', example: 100 },
    { column: 'default_elevation_mm', meaning: 'Default height off the floor when placed.', unit: 'mm', allowed_values: '0 or more', example: 850 },
    { column: 'model_url', meaning: 'Optional — path to a .glb/.gltf 3D model. Leave blank to render a plain box.', unit: '—', allowed_values: 'any text, or blank', example: '/models/hob-600.glb' },
    { column: 'model_rotation_x_deg', meaning: 'Optional — fixed orientation correction for a model exported the wrong way up (Blender is Z-up; glTF wants Y-up).', unit: 'degrees', allowed_values: 'any number, or blank', example: -90 },
    { column: 'model_rotation_y_deg', meaning: 'Optional — fixed correction if the model faces the wrong direction.', unit: 'degrees', allowed_values: 'any number, or blank', example: 90 },
    { column: 'model_rotation_z_deg', meaning: 'Optional — rarely needed.', unit: 'degrees', allowed_values: 'any number, or blank', example: '(blank)' },
    { column: 'sink_cutout_width_mm', meaning: 'Sink rows only — the hole cut into the countertop, smaller than the sink\'s own width_mm. Leave blank for no cutout.', unit: 'mm', allowed_values: 'positive number, or blank', example: 780 },
    { column: 'sink_cutout_depth_mm', meaning: 'Sink rows only — see sink_cutout_width_mm.', unit: 'mm', allowed_values: 'positive number, or blank', example: 430 },
    { column: 'unit_price', meaning: 'Price per unit.', unit: '₹', allowed_values: 'positive number', example: 32000 },
    { column: 'delete', meaning: 'Type DELETE (any case) to remove this appliance when you commit. Leave blank to keep/update it. Has no effect on a blank-id (new) row.', unit: '—', allowed_values: 'DELETE, or blank', example: '(blank)' },
  ];

  return buildWorkbookBlob([
    { name: SHEET_NAME, headers: [...HEADERS], rows: dataRows },
    { name: 'Instructions', headers: ['column', 'meaning', 'unit', 'allowed_values', 'example'], rows: instructionRows },
  ]);
}

export interface ParsedApplianceRow {
  rowNumber: number;
  isNew: boolean;
  markedForDeletion: boolean;
  data: ApplianceCatalogItem;
  errors: string[];
}

export async function parseApplianceCatalogFile(
  file: File,
  existing: ApplianceCatalogItem[]
): Promise<ParsedApplianceRow[]> {
  const rows = await readFirstSheetRows(file);
  return parseApplianceCatalogRows(rows, existing);
}

export function parseApplianceCatalogRows(
  rows: Record<string, string>[],
  existing: ApplianceCatalogItem[]
): ParsedApplianceRow[] {
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

    const applianceType = enumValue(row.appliance_type ?? '', 'appliance_type', APPLIANCE_TYPES);
    if (applianceType.error) errors.push(applianceType.error);

    const widthMm = positiveNumber(row.width_mm ?? '', 'width_mm');
    if (widthMm.error) errors.push(widthMm.error);

    const depthMm = positiveNumber(row.depth_mm ?? '', 'depth_mm');
    if (depthMm.error) errors.push(depthMm.error);

    const heightMm = positiveNumber(row.height_mm ?? '', 'height_mm');
    if (heightMm.error) errors.push(heightMm.error);

    const defaultElevationMm = nonNegativeNumber(row.default_elevation_mm ?? '', 'default_elevation_mm');
    if (defaultElevationMm.error) errors.push(defaultElevationMm.error);

    const modelUrl = optionalString(row.model_url ?? '');

    const modelRotationXDeg = optionalNumber(row.model_rotation_x_deg ?? '', 'model_rotation_x_deg');
    if (modelRotationXDeg.error) errors.push(modelRotationXDeg.error);
    const modelRotationYDeg = optionalNumber(row.model_rotation_y_deg ?? '', 'model_rotation_y_deg');
    if (modelRotationYDeg.error) errors.push(modelRotationYDeg.error);
    const modelRotationZDeg = optionalNumber(row.model_rotation_z_deg ?? '', 'model_rotation_z_deg');
    if (modelRotationZDeg.error) errors.push(modelRotationZDeg.error);

    const sinkCutoutWidthMm = optionalNumber(row.sink_cutout_width_mm ?? '', 'sink_cutout_width_mm');
    if (sinkCutoutWidthMm.error) errors.push(sinkCutoutWidthMm.error);
    else if (sinkCutoutWidthMm.value !== undefined && sinkCutoutWidthMm.value <= 0) {
      errors.push(`sink_cutout_width_mm must be a positive number if set, got "${row.sink_cutout_width_mm}"`);
    }
    const sinkCutoutDepthMm = optionalNumber(row.sink_cutout_depth_mm ?? '', 'sink_cutout_depth_mm');
    if (sinkCutoutDepthMm.error) errors.push(sinkCutoutDepthMm.error);
    else if (sinkCutoutDepthMm.value !== undefined && sinkCutoutDepthMm.value <= 0) {
      errors.push(`sink_cutout_depth_mm must be a positive number if set, got "${row.sink_cutout_depth_mm}"`);
    }

    const unitPrice = positiveNumber(row.unit_price ?? '', 'unit_price');
    if (unitPrice.error) errors.push(unitPrice.error);

    const markedForDeletion = isMarkedForDeletion(row[DELETE_MARKER_HEADER] ?? '');

    // Starts from the STORED row on an update, with the sheet's values
    // laid over it (§54). Today this sheet carries every field, so the
    // spread changes nothing — it's here so that a field added to
    // ApplianceCatalogItem later, and not added to the sheet, survives a re-import
    // instead of being silently blanked by the whole-row upsert. That
    // exact failure wiped cabinet fronts, handles and panels.
    const data: ApplianceCatalogItem = {
      ...(isNew ? {} : existingById.get(id)),
      id,
      label: label.value,
      applianceType: applianceType.value ?? APPLIANCE_TYPES[0],
      widthMm: widthMm.value,
      depthMm: depthMm.value,
      heightMm: heightMm.value,
      defaultElevationMm: defaultElevationMm.value,
      modelUrl,
      modelRotationXDeg: modelRotationXDeg.value,
      modelRotationYDeg: modelRotationYDeg.value,
      modelRotationZDeg: modelRotationZDeg.value,
      sinkCutoutWidthMm: sinkCutoutWidthMm.value,
      sinkCutoutDepthMm: sinkCutoutDepthMm.value,
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

export { APPLIANCE_TYPES };
