// src/lib/importExport/obstacleImportExport.ts
//
// Obstacle presets' Excel round trip — second catalogue through the
// pattern the cabinet pilot proved (see cabinetImportExport.ts's
// header comment for the match-key reasoning, which applies unchanged
// here). No FK-like fields on this catalogue, so no label-resolution
// step is needed — every column maps straight onto a scalar field.

import type { ObstaclePreset } from '../../types/Catalog';
import type { ObstacleType } from '../../types/layout';
import {
  buildWorkbookBlob,
  readFirstSheetRows,
  requiredString,
  positiveNumber,
  nonNegativeNumber,
  booleanValue,
  enumValue,
  resolveRowId,
  flagDuplicateMatchedIds,
  isMarkedForDeletion,
  finalizeRowErrors,
  DELETE_MARKER_HEADER,
} from './xlsxHelpers';

// Duplicated from InventoryManager.tsx's own OBSTACLE_TYPES const —
// see cabinetImportExport.ts's MODULE_TYPES comment for why.
const OBSTACLE_TYPES: readonly ObstacleType[] = ['pillar', 'shaft', 'exposed-pipe', 'electrical-panel'];

const SHEET_NAME = 'Obstacles';
const HEADERS = [
  'id',
  'label',
  'type',
  'width_mm',
  'depth_mm',
  'floor_to_ceiling',
  'height_mm',
  'elevation_mm',
  DELETE_MARKER_HEADER,
] as const;

export function exportObstaclePresetsXlsx(items: ObstaclePreset[]): Blob {
  const dataRows = items.map((item) => ({
    id: item.id,
    label: item.label,
    type: item.type,
    width_mm: item.widthMm,
    depth_mm: item.depthMm,
    floor_to_ceiling: item.floorToCeiling ? 'yes' : 'no',
    height_mm: item.heightMm,
    elevation_mm: item.elevationMm,
    delete: '',
  }));

  const instructionRows = [
    { column: 'id', meaning: 'Leave BLANK to add a new preset. Leave an existing value UNTOUCHED to update that row — do not type your own.', unit: '—', allowed_values: '—', example: '(blank for a new row)' },
    { column: 'label', meaning: 'Your own name for this preset.', unit: 'text', allowed_values: '—', example: 'Standard Column' },
    { column: 'type', meaning: 'What kind of obstacle this is.', unit: '—', allowed_values: OBSTACLE_TYPES.join(', '), example: 'pillar' },
    { column: 'width_mm', meaning: 'Obstacle width.', unit: 'mm', allowed_values: 'positive number', example: 300 },
    { column: 'depth_mm', meaning: 'Obstacle depth.', unit: 'mm', allowed_values: 'positive number', example: 300 },
    { column: 'floor_to_ceiling', meaning: 'If yes, the obstacle always runs from the floor to the room\'s own ceiling height, and height_mm/elevation_mm below are ignored.', unit: '—', allowed_values: 'yes, no', example: 'yes' },
    { column: 'height_mm', meaning: 'Only used when floor_to_ceiling is "no".', unit: 'mm', allowed_values: 'positive number', example: 900 },
    { column: 'elevation_mm', meaning: 'How far off the floor the obstacle\'s bottom face starts. Only used when floor_to_ceiling is "no" — lets a preset like a mid-wall electrical panel start above the floor.', unit: 'mm', allowed_values: '0 or more', example: 0 },
    { column: 'delete', meaning: 'Type DELETE (any case) to remove this preset when you commit. Leave blank to keep/update it. Has no effect on a blank-id (new) row.', unit: '—', allowed_values: 'DELETE, or blank', example: '(blank)' },
  ];

  return buildWorkbookBlob([
    { name: SHEET_NAME, headers: [...HEADERS], rows: dataRows },
    { name: 'Instructions', headers: ['column', 'meaning', 'unit', 'allowed_values', 'example'], rows: instructionRows },
  ]);
}

export interface ParsedObstacleRow {
  rowNumber: number;
  isNew: boolean;
  markedForDeletion: boolean;
  data: ObstaclePreset;
  errors: string[];
}

export async function parseObstaclePresetsFile(
  file: File,
  existing: ObstaclePreset[]
): Promise<ParsedObstacleRow[]> {
  const rows = await readFirstSheetRows(file);
  return parseObstaclePresetsRows(rows, existing);
}

export function parseObstaclePresetsRows(
  rows: Record<string, string>[],
  existing: ObstaclePreset[]
): ParsedObstacleRow[] {
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

    const type = enumValue(row.type ?? '', 'type', OBSTACLE_TYPES);
    if (type.error) errors.push(type.error);

    const widthMm = positiveNumber(row.width_mm ?? '', 'width_mm');
    if (widthMm.error) errors.push(widthMm.error);

    const depthMm = positiveNumber(row.depth_mm ?? '', 'depth_mm');
    if (depthMm.error) errors.push(depthMm.error);

    const floorToCeiling = booleanValue(row.floor_to_ceiling ?? '', 'floor_to_ceiling');
    if (floorToCeiling.error) errors.push(floorToCeiling.error);

    const heightMm = positiveNumber(row.height_mm ?? '', 'height_mm');
    if (heightMm.error) errors.push(heightMm.error);

    const elevationMm = nonNegativeNumber(row.elevation_mm ?? '', 'elevation_mm');
    if (elevationMm.error) errors.push(elevationMm.error);

    const markedForDeletion = isMarkedForDeletion(row[DELETE_MARKER_HEADER] ?? '');

    const data: ObstaclePreset = {
      id,
      label: label.value,
      type: type.value ?? OBSTACLE_TYPES[0],
      widthMm: widthMm.value,
      depthMm: depthMm.value,
      floorToCeiling: floorToCeiling.value,
      heightMm: heightMm.value,
      elevationMm: elevationMm.value,
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

export { OBSTACLE_TYPES };
