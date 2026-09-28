// scripts/generate-starter-catalogues.ts
//
// One-off generator for a comprehensive STARTER catalogue per
// inventory type (cabinets, obstacles, appliances, handles, fixtures)
// — every id is left blank, so uploading any of these via Manage
// Inventory's "Bulk edit via Excel" panel always ADDS new rows; it
// never touches or overwrites what's already there.
//
// Deliberately reuses the app's own real exportXxxXlsx functions
// (src/lib/importExport/*.ts) rather than building workbooks by hand
// here — that's what guarantees the output is byte-for-byte the same
// format the app's own upload path expects, with no risk of drifting
// out of sync with it later.
//
// PRICES ARE PLACEHOLDERS, same status as PLACEHOLDER_RATES in
// src/types/rates.ts and the seed rows in supabase/schema.sql — right
// order of magnitude for Delhi NCR retail, not a price list. Check
// against real purchase invoices before quoting a customer on them.
//
// Run with: npx tsx scripts/generate-starter-catalogues.ts
// Output: starter-catalogues/*.xlsx at the repo root.

import { writeFileSync, mkdirSync } from 'fs';
import { exportCabinetCatalogXlsx } from '../src/lib/importExport/cabinetImportExport';
import { exportObstaclePresetsXlsx } from '../src/lib/importExport/obstacleImportExport';
import { exportApplianceCatalogXlsx } from '../src/lib/importExport/applianceImportExport';
import { exportHandlesXlsx } from '../src/lib/importExport/handleImportExport';
import { exportFixtureCatalogXlsx } from '../src/lib/importExport/fixtureImportExport';
import type { CatalogItem, ObstaclePreset, ApplianceCatalogItem } from '../src/types/Catalog';
import type { HandleSpec } from '../src/types/front';
import type { FixtureCatalogItem } from '../src/types/fixture';
import type { SurfaceFinish } from '../src/types/finish';

const now = new Date().toISOString();
const OUT_DIR = 'starter-catalogues';

// Only the fields exportCabinetCatalogXlsx actually reads (id, label,
// finish lookup by id) need to be real — the rest just need to be
// present to satisfy the type.
const SEEDED_FINISHES: SurfaceFinish[] = [
  'White Gloss', 'Ivory Satin', 'Natural Oak', 'Soft White', 'Teak Veneer',
].map((label, i) => ({
  id: `finish_seed_${i}`,
  label,
  finishTypeLabel: '',
  patternCategory: 'solid',
  reliefStrength: 0,
  roughness: 0.4,
  clearcoat: 0,
  clearcoatRoughness: 0,
  metalness: 0.05,
  swatchWidthMm: 300,
  swatchHeightMm: 300,
  tilingMode: 'mirror',
  pricePerSqM: 0,
  source: 'bundled',
  createdAt: now,
  updatedAt: now,
}));

function cabinet(
  label: string,
  category: string,
  moduleType: CatalogItem['moduleType'],
  widthMm: number,
  depthMm: number,
  heightMm: number,
  material: CatalogItem['material'],
  finishLabel: string,
  unitPrice: number
): CatalogItem {
  const finish = SEEDED_FINISHES.find((f) => f.label === finishLabel)!;
  return {
    id: '', // blank -> always imports as a new row
    label,
    category,
    moduleType,
    widthMm,
    depthMm,
    heightMm,
    material,
    finishId: finish.id,
    unitPrice,
    // frontLayout deliberately left unset, even for a row like the
    // pantry unit below whose whole point is a non-default front —
    // this generator's own export function drops frontLayout from the
    // sheet entirely (cabinetImportExport.ts's header comment), so
    // passing one here would silently vanish on upload. Get the right
    // front some other way — a dedicated moduleType (pantry-unit) —
    // not a field this format can't carry.
    createdAt: now,
    updatedAt: now,
  };
}

const CABINETS: CatalogItem[] = [
  // base-cabinet — 850mm counter height, 600mm standard depth
  cabinet('Base Cabinet 300', 'Base', 'base-cabinet', 300, 600, 850, 'MDF', 'Natural Oak', 6800),
  cabinet('Base Cabinet 450', 'Base', 'base-cabinet', 450, 600, 850, 'MDF', 'Natural Oak', 8200),
  cabinet('Base Cabinet 600', 'Base', 'base-cabinet', 600, 600, 850, 'HDMR', 'Natural Oak', 9500),
  cabinet('Base Cabinet 750', 'Base', 'base-cabinet', 750, 600, 850, 'HDMR', 'Ivory Satin', 11200),
  cabinet('Base Cabinet 900', 'Base', 'base-cabinet', 900, 600, 850, 'HDMR', 'White Gloss', 13500),
  cabinet('Base Cabinet 1200', 'Base', 'base-cabinet', 1200, 600, 850, 'HDMR', 'White Gloss', 17800),
  // wall-cabinet — 700mm tall, 300mm depth, hung above counter
  cabinet('Wall Cabinet 300', 'Wall', 'wall-cabinet', 300, 300, 700, 'MDF', 'Natural Oak', 5200),
  cabinet('Wall Cabinet 450', 'Wall', 'wall-cabinet', 450, 300, 700, 'MDF', 'Natural Oak', 6400),
  cabinet('Wall Cabinet 600', 'Wall', 'wall-cabinet', 600, 300, 700, 'MDF', 'Ivory Satin', 8200),
  cabinet('Wall Cabinet 750', 'Wall', 'wall-cabinet', 750, 300, 700, 'MDF', 'Ivory Satin', 9600),
  cabinet('Wall Cabinet 900', 'Wall', 'wall-cabinet', 900, 300, 700, 'MDF', 'White Gloss', 11800),
  // tall-unit — full height pantry/larder
  cabinet('Tall Unit 600', 'Tall', 'tall-unit', 600, 600, 2100, 'HDMR', 'Natural Oak', 24500),
  cabinet('Tall Larder Unit 900', 'Tall', 'tall-unit', 900, 600, 2100, 'HDMR', 'Ivory Satin', 32800),
  // sink-unit
  cabinet('Sink Unit 600', 'Base', 'sink-unit', 600, 600, 850, 'HDMR', 'White Gloss', 15200),
  cabinet('Sink Unit 900', 'Base', 'sink-unit', 900, 600, 850, 'HDMR', 'White Gloss', 18500),
  // cylinder-trolley — narrow pull-out for an LPG cylinder
  cabinet('Cylinder Trolley 300', 'Base', 'cylinder-trolley', 300, 600, 850, 'Plywood', 'Natural Oak', 7600),
  cabinet('Cylinder Trolley 450', 'Base', 'cylinder-trolley', 450, 600, 850, 'Plywood', 'Natural Oak', 9200),
  // drawer-unit
  cabinet('Drawer Unit 450', 'Base', 'drawer-unit', 450, 600, 850, 'MDF', 'Teak Veneer', 11200),
  cabinet('Drawer Unit 600', 'Base', 'drawer-unit', 600, 600, 850, 'MDF', 'Teak Veneer', 13800),
  cabinet('Drawer Unit 900', 'Base', 'drawer-unit', 900, 600, 850, 'MDF', 'Teak Veneer', 19500),
  // three corner solutions — square 900x900 footprint
  cabinet('Corner Blind Unit 900', 'Base', 'corner-blind', 900, 900, 850, 'HDMR', 'Natural Oak', 15800),
  cabinet('Corner Magic Unit 900', 'Base', 'corner-magic', 900, 900, 850, 'HDMR', 'Ivory Satin', 24000),
  cabinet('Corner Carousel Unit 900', 'Base', 'corner-carousel', 900, 900, 850, 'HDMR', 'White Gloss', 21500),
  // pantry pull-out — its own ModuleType ('pantry-unit', types/
  // cabinet.ts), whose default front IS a multi-tier wire-basket
  // TROLLEY (types/front.ts's defaultFrontLayout), not the plain
  // double-door 'tall-unit' gets. NOT passed as a frontLayout override
  // here on purpose — the Excel format this generator's own export
  // function produces deliberately excludes frontLayout (see
  // cabinetImportExport.ts's own header comment), so an override here
  // would silently vanish on upload and this row would import as a
  // plain double-door tall unit wearing a misleading name. Making it a
  // real moduleType instead means the correct front survives the round
  // trip, because module_type DOES travel through the sheet. Own
  // 'Pantry' category rather than folding into 'Tall', so it groups
  // separately in the toolbar from a plain larder unit.
  cabinet('Pantry Pull-out Unit 450', 'Pantry', 'pantry-unit', 450, 600, 2100, 'HDMR', 'Natural Oak', 38500),
  cabinet('Pantry Pull-out Unit 600', 'Pantry', 'pantry-unit', 600, 600, 2100, 'HDMR', 'Ivory Satin', 44000),
  // tandem drawer bank — 'drawer-unit' already defaults to a 'drawers'
  // front, and 'channel' is already priced as a tandem-box system
  // rather than a budget one (see PLACEHOLDER_RATES in
  // src/types/rates.ts) — so this isn't a mechanically different
  // product from the Drawer Unit rows above, just a genuinely new
  // WIDTH (1200mm — nothing above goes past 900) rather than a
  // same-size duplicate under a different name.
  cabinet('Tandem Drawer Bank 1200', 'Base', 'drawer-unit', 1200, 600, 850, 'MDF', 'Teak Veneer', 26500),
];

const OBSTACLES: ObstaclePreset[] = [
  { id: '', label: 'Small Column', type: 'pillar', widthMm: 300, depthMm: 300, floorToCeiling: true, heightMm: 900, elevationMm: 0, createdAt: now, updatedAt: now },
  { id: '', label: 'Large Column', type: 'pillar', widthMm: 450, depthMm: 450, floorToCeiling: true, heightMm: 900, elevationMm: 0, createdAt: now, updatedAt: now },
  { id: '', label: 'Standard Duct', type: 'shaft', widthMm: 300, depthMm: 150, floorToCeiling: true, heightMm: 900, elevationMm: 0, createdAt: now, updatedAt: now },
  { id: '', label: 'Wide Duct', type: 'shaft', widthMm: 450, depthMm: 200, floorToCeiling: true, heightMm: 900, elevationMm: 0, createdAt: now, updatedAt: now },
  { id: '', label: 'Exposed Pipe — Small', type: 'exposed-pipe', widthMm: 100, depthMm: 100, floorToCeiling: true, heightMm: 900, elevationMm: 0, createdAt: now, updatedAt: now },
  { id: '', label: 'Exposed Pipe — Medium', type: 'exposed-pipe', widthMm: 150, depthMm: 150, floorToCeiling: true, heightMm: 900, elevationMm: 0, createdAt: now, updatedAt: now },
  { id: '', label: 'Mid-Wall Electrical Panel', type: 'electrical-panel', widthMm: 400, depthMm: 150, floorToCeiling: false, heightMm: 300, elevationMm: 1200, createdAt: now, updatedAt: now },
  { id: '', label: 'Meter Box', type: 'electrical-panel', widthMm: 300, depthMm: 200, floorToCeiling: false, heightMm: 250, elevationMm: 900, createdAt: now, updatedAt: now },
];

const APPLIANCES: ApplianceCatalogItem[] = [
  { id: '', label: '2-Burner Hob', applianceType: 'stove', widthMm: 450, depthMm: 500, heightMm: 100, defaultElevationMm: 850, unitPrice: 12000, createdAt: now, updatedAt: now },
  { id: '', label: '3-Burner Hob', applianceType: 'stove', widthMm: 600, depthMm: 500, heightMm: 100, defaultElevationMm: 850, unitPrice: 18000, createdAt: now, updatedAt: now },
  { id: '', label: '4-Burner Hob', applianceType: 'stove', widthMm: 750, depthMm: 500, heightMm: 100, defaultElevationMm: 850, unitPrice: 26000, createdAt: now, updatedAt: now },
  { id: '', label: '5-Burner Hob', applianceType: 'stove', widthMm: 900, depthMm: 500, heightMm: 100, defaultElevationMm: 850, unitPrice: 34000, createdAt: now, updatedAt: now },
  { id: '', label: 'Slimline Chimney 600', applianceType: 'chimney', widthMm: 600, depthMm: 450, heightMm: 700, defaultElevationMm: 1500, unitPrice: 16000, createdAt: now, updatedAt: now },
  { id: '', label: 'Slimline Chimney 900', applianceType: 'chimney', widthMm: 900, depthMm: 450, heightMm: 700, defaultElevationMm: 1500, unitPrice: 22000, createdAt: now, updatedAt: now },
  { id: '', label: 'Built-In Oven 600', applianceType: 'oven', widthMm: 600, depthMm: 550, heightMm: 600, defaultElevationMm: 450, unitPrice: 28000, createdAt: now, updatedAt: now },
  { id: '', label: 'Countertop OTG 450', applianceType: 'otg', widthMm: 450, depthMm: 400, heightMm: 350, defaultElevationMm: 850, unitPrice: 9500, createdAt: now, updatedAt: now },
  { id: '', label: 'Compact Toaster', applianceType: 'toaster', widthMm: 300, depthMm: 250, heightMm: 250, defaultElevationMm: 850, unitPrice: 2200, createdAt: now, updatedAt: now },
  { id: '', label: 'Single Bowl Sink 600', applianceType: 'sink', widthMm: 600, depthMm: 450, heightMm: 200, defaultElevationMm: 850, sinkCutoutWidthMm: 540, sinkCutoutDepthMm: 400, unitPrice: 6500, createdAt: now, updatedAt: now },
  { id: '', label: 'Double Bowl Sink 900', applianceType: 'sink', widthMm: 900, depthMm: 500, heightMm: 200, defaultElevationMm: 850, sinkCutoutWidthMm: 820, sinkCutoutDepthMm: 430, unitPrice: 9800, createdAt: now, updatedAt: now },
  // Freestanding, floor-standing (elevationMm 0), same as the existing
  // appliances are customer-supplied more often than not in this
  // market — reserving a real footprint matters more than the model.
  { id: '', label: 'Single-Door Fridge 190L', applianceType: 'fridge', widthMm: 550, depthMm: 600, heightMm: 1450, defaultElevationMm: 0, unitPrice: 16000, createdAt: now, updatedAt: now },
  { id: '', label: 'Double-Door Fridge 300L', applianceType: 'fridge', widthMm: 700, depthMm: 700, heightMm: 1750, defaultElevationMm: 0, unitPrice: 32000, createdAt: now, updatedAt: now },
  { id: '', label: 'Countertop Microwave', applianceType: 'microwave', widthMm: 480, depthMm: 400, heightMm: 300, defaultElevationMm: 850, unitPrice: 8500, createdAt: now, updatedAt: now },
  { id: '', label: 'Built-In Dishwasher 600', applianceType: 'dishwasher', widthMm: 600, depthMm: 570, heightMm: 820, defaultElevationMm: 0, unitPrice: 34000, createdAt: now, updatedAt: now },
  { id: '', label: 'Under-Sink RO Purifier', applianceType: 'water-purifier', widthMm: 300, depthMm: 150, heightMm: 400, defaultElevationMm: 1000, unitPrice: 9500, createdAt: now, updatedAt: now },
];

const HANDLES: HandleSpec[] = [
  { id: '', label: 'Bar Handle 128mm — Brushed Steel', kind: 'bar', lengthMm: 128, colorHex: '#b8bcc0', metalness: 0.9, roughness: 0.35, pricingMode: 'per-unit', price: 180, createdAt: now, updatedAt: now },
  { id: '', label: 'Bar Handle 192mm — Matte Black', kind: 'bar', lengthMm: 192, colorHex: '#2a2a2c', metalness: 0.6, roughness: 0.55, pricingMode: 'per-unit', price: 240, createdAt: now, updatedAt: now },
  { id: '', label: 'Bar Handle 320mm — Brushed Steel', kind: 'bar', lengthMm: 320, colorHex: '#b8bcc0', metalness: 0.9, roughness: 0.35, pricingMode: 'per-unit', price: 320, createdAt: now, updatedAt: now },
  { id: '', label: 'Knob 32mm — Antique Brass', kind: 'knob', lengthMm: 32, colorHex: '#9a7b3f', metalness: 0.85, roughness: 0.4, pricingMode: 'per-unit', price: 150, createdAt: now, updatedAt: now },
  { id: '', label: 'Knob 30mm — Matte Steel', kind: 'knob', lengthMm: 30, colorHex: '#8f9296', metalness: 0.7, roughness: 0.5, pricingMode: 'per-unit', price: 130, createdAt: now, updatedAt: now },
  { id: '', label: 'Edge Profile — Champagne', kind: 'edge-profile', lengthMm: 0, colorHex: '#c9b79a', metalness: 0.75, roughness: 0.4, pricingMode: 'per-metre', price: 540, createdAt: now, updatedAt: now },
  { id: '', label: 'Edge Profile — Matte Black', kind: 'edge-profile', lengthMm: 0, colorHex: '#2a2a2c', metalness: 0.5, roughness: 0.6, pricingMode: 'per-metre', price: 560, createdAt: now, updatedAt: now },
  { id: '', label: 'Gola Profile — Anodised Aluminium', kind: 'gola', lengthMm: 0, colorHex: '#8f9296', metalness: 0.8, roughness: 0.45, pricingMode: 'per-metre', price: 620, createdAt: now, updatedAt: now },
  { id: '', label: 'Gola Profile — Matte Black', kind: 'gola', lengthMm: 0, colorHex: '#2a2a2c', metalness: 0.5, roughness: 0.6, pricingMode: 'per-metre', price: 640, createdAt: now, updatedAt: now },
  { id: '', label: 'Handleless (Push-to-Open)', kind: 'handleless', lengthMm: 0, colorHex: '#000000', metalness: 0, roughness: 1, pricingMode: 'per-unit', price: 0, createdAt: now, updatedAt: now },
];

const FIXTURES: FixtureCatalogItem[] = [
  { id: '', label: 'LED Strip 3000K Warm White', kind: 'strip', colorTempK: 3000, lumens: 900, pricingMode: 'per-metre', price: 340, createdAt: now, updatedAt: now },
  { id: '', label: 'LED Strip 4000K Neutral White', kind: 'strip', colorTempK: 4000, lumens: 1000, pricingMode: 'per-metre', price: 340, createdAt: now, updatedAt: now },
  { id: '', label: 'LED Strip 6500K Cool White', kind: 'strip', colorTempK: 6500, lumens: 1100, pricingMode: 'per-metre', price: 310, createdAt: now, updatedAt: now },
  { id: '', label: 'Ceiling Spot 8W 3000K', kind: 'spot', colorTempK: 3000, lumens: 700, pricingMode: 'per-unit', price: 480, createdAt: now, updatedAt: now },
  { id: '', label: 'Ceiling Spot 8W 6500K', kind: 'spot', colorTempK: 6500, lumens: 800, pricingMode: 'per-unit', price: 480, createdAt: now, updatedAt: now },
  { id: '', label: 'Cove Strip 2700K', kind: 'cove', colorTempK: 2700, lumens: 700, pricingMode: 'per-metre', price: 380, createdAt: now, updatedAt: now },
  { id: '', label: 'Cove Strip 3000K', kind: 'cove', colorTempK: 3000, lumens: 750, pricingMode: 'per-metre', price: 380, createdAt: now, updatedAt: now },
  { id: '', label: 'Pendant Light (Shade Excluded)', kind: 'pendant', colorTempK: 3000, lumens: 600, pricingMode: 'per-unit', price: 1850, createdAt: now, updatedAt: now },
  { id: '', label: 'Pendant Light — Industrial', kind: 'pendant', colorTempK: 3000, lumens: 650, pricingMode: 'per-unit', price: 2600, createdAt: now, updatedAt: now },
  { id: '', label: 'Plinth Strip 3000K', kind: 'plinth', colorTempK: 3000, lumens: 450, pricingMode: 'per-metre', price: 300, createdAt: now, updatedAt: now },
  { id: '', label: 'Plinth Strip 4000K', kind: 'plinth', colorTempK: 4000, lumens: 500, pricingMode: 'per-metre', price: 300, createdAt: now, updatedAt: now },
  { id: '', label: 'In-Drawer Sensor Light', kind: 'drawer', colorTempK: 4000, lumens: 200, pricingMode: 'per-unit', price: 760, createdAt: now, updatedAt: now },
];

async function writeBlob(blob: Blob, filename: string): Promise<void> {
  const buffer = Buffer.from(await blob.arrayBuffer());
  writeFileSync(`${OUT_DIR}/${filename}`, buffer);
  console.log(`Wrote ${OUT_DIR}/${filename}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  await writeBlob(exportCabinetCatalogXlsx(CABINETS, SEEDED_FINISHES), 'cabinets-starter.xlsx');
  await writeBlob(exportObstaclePresetsXlsx(OBSTACLES), 'obstacles-starter.xlsx');
  await writeBlob(exportApplianceCatalogXlsx(APPLIANCES), 'appliances-starter.xlsx');
  await writeBlob(exportHandlesXlsx(HANDLES), 'handles-starter.xlsx');
  await writeBlob(exportFixtureCatalogXlsx(FIXTURES), 'fixtures-starter.xlsx');

  console.log(`\n${CABINETS.length} cabinets, ${OBSTACLES.length} obstacles, ${APPLIANCES.length} appliances, ${HANDLES.length} handles, ${FIXTURES.length} fixtures.`);
}

main();
