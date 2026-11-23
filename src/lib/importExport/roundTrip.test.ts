// §142: a downloaded sheet must upload unchanged with no errors. A stored
// row the app itself accepts (an old "public/models/…" address, a ₹0
// appliance) once made its own download fail on upload.
import { describe, expect, it } from 'vitest';
import { readFirstSheetRows } from './xlsxHelpers';
import { exportApplianceCatalogXlsx, parseApplianceCatalogRows } from './applianceImportExport';
import { exportFixtureCatalogXlsx, parseFixtureCatalogRows } from './fixtureImportExport';
import { exportHandlesXlsx, parseHandlesRows } from './handleImportExport';
import { exportObstaclePresetsXlsx, parseObstaclePresetsRows } from './obstacleImportExport';
import { exportCabinetCatalogXlsx, parseCabinetCatalogRows } from './cabinetImportExport';
import type { ApplianceCatalogItem, CatalogItem, ObstaclePreset } from '../../types/Catalog';
import type { FixtureCatalogItem } from '../../types/fixture';
import type { HandleSpec } from '../../types/front';
import type { SurfaceFinish } from '../../types/finish';

const rowsOf = async (blob: Blob) => readFirstSheetRows(new File([blob], 'sheet.xlsx'));
const t = { createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' };
const errorsOf = (parsed: { errors: string[] }[]) => parsed.flatMap((p, i) => p.errors.map((e) => `row ${i + 2}: ${e}`));

describe('every sheet uploads exactly as downloaded (§142)', () => {
  it('appliances: an old public/ model address, a ₹0 appliance, an appearance', async () => {
    const items: ApplianceCatalogItem[] = [
      { id: 'a1', label: 'Double Sink', applianceType: 'sink', widthMm: 1000, depthMm: 500, heightMm: 200, defaultElevationMm: 850, modelUrl: 'public/models/appliances/sink.glb', sinkCutoutWidthMm: 950, sinkCutoutDepthMm: 450, appearance: 'black granite double-bowl sink', unitPrice: 9000, ...t },
      { id: 'a2', label: "Customer's own fridge", applianceType: 'fridge', widthMm: 700, depthMm: 700, heightMm: 1700, defaultElevationMm: 0, unitPrice: 0, ...t },
      { id: 'a3', label: 'Chimney', applianceType: 'chimney', widthMm: 900, depthMm: 500, heightMm: 600, defaultElevationMm: 1650, modelUrl: ' /public/models/range-hood.glb ', modelRotationXDeg: -90, unitPrice: 21000, ...t },
    ];
    const parsed = parseApplianceCatalogRows(await rowsOf(exportApplianceCatalogXlsx(items)), items);
    expect(errorsOf(parsed)).toEqual([]);
    expect(parsed.map((p) => p.data.modelUrl)).toEqual(['/models/appliances/sink.glb', undefined, '/models/range-hood.glb']);
    expect(parsed[0].data.appearance).toBe('black granite double-bowl sink');
    expect(parsed[1].data.unitPrice).toBe(0);
  });

  it('light fixtures: an old public/ model address and a ₹0 fixture', async () => {
    const items: FixtureCatalogItem[] = [
      { id: 'f1', label: 'Pendant', kind: 'pendant', colorTempK: 2700, lumens: 800, pricingMode: 'per-unit', price: 0, modelUrl: 'public/models/lighting/pendant.glb', ...t } as FixtureCatalogItem,
      { id: 'f2', label: 'Strip', kind: 'strip', colorTempK: 4000, lumens: 900, pricingMode: 'per-metre', price: 450, ...t } as FixtureCatalogItem,
    ];
    const parsed = parseFixtureCatalogRows(await rowsOf(exportFixtureCatalogXlsx(items)), items);
    expect(errorsOf(parsed)).toEqual([]);
    expect(parsed[0].data.modelUrl).toBe('/models/lighting/pendant.glb');
  });

  it('handles', async () => {
    const items: HandleSpec[] = [
      { id: 'h1', label: 'Knob 30mm', kind: 'knob', lengthMm: 30, colorHex: '#8a8a8a', metalness: 0.9, roughness: 0.4, pricingMode: 'per-unit', price: 0, ...t },
      { id: 'h2', label: 'Gola', kind: 'gola', lengthMm: 600, colorHex: '#222222', metalness: 0.6, roughness: 0.5, pricingMode: 'per-metre', price: 900, ...t },
    ];
    expect(errorsOf(parseHandlesRows(await rowsOf(exportHandlesXlsx(items)), items))).toEqual([]);
  });

  it('pillars & shafts: floor to ceiling, and one off the floor', async () => {
    const items: ObstaclePreset[] = [
      { id: 'o1', label: 'Column', type: 'pillar', widthMm: 300, depthMm: 300, floorToCeiling: true, heightMm: 2700, elevationMm: 0, ...t } as ObstaclePreset,
      { id: 'o2', label: 'Panel', type: 'electrical-panel', widthMm: 400, depthMm: 100, floorToCeiling: false, heightMm: 500, elevationMm: 1500, ...t } as ObstaclePreset,
    ];
    expect(errorsOf(parseObstaclePresetsRows(await rowsOf(exportObstaclePresetsXlsx(items)), items))).toEqual([]);
  });

  it('cabinets: a ₹0 reference price, a finish found by its name', async () => {
    const finishes = [{ id: 'fin1', label: 'White Gloss' }, { id: 'fin2', label: 'Sage Acrylic' }] as SurfaceFinish[];
    const items = [
      { id: 'c1', category: 'Base', label: 'Base 600', moduleType: 'base-cabinet', widthMm: 600, depthMm: 560, heightMm: 720, material: 'HDMR', finishId: 'fin2', unitPrice: 0, sizeException: true, ...t },
      { id: 'c2', category: 'Wall', label: 'Wall 800', moduleType: 'wall-cabinet', widthMm: 800, depthMm: 350, heightMm: 720, material: 'Plywood', finishId: 'fin1', unitPrice: 5000, ...t },
    ] as CatalogItem[];
    const parsed = parseCabinetCatalogRows(await rowsOf(exportCabinetCatalogXlsx(items, finishes)), items, finishes);
    expect(errorsOf(parsed)).toEqual([]);
    expect(parsed.map((p) => p.data.finishId)).toEqual(['fin2', 'fin1']);
    // §147: not a sheet column, so it must survive the re-import.
    expect(parsed[0].data.sizeException).toBe(true);
  });
});
