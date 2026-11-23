import { describe, expect, it } from 'vitest';
import { parseApplianceCatalogRows } from './applianceImportExport';
import type { ApplianceCatalogItem } from '../../types/Catalog';

const stored: ApplianceCatalogItem = {
  id: 'app_cat_sink_single',
  label: 'Single Bowl Sink',
  applianceType: 'sink',
  widthMm: 600,
  depthMm: 450,
  heightMm: 200,
  defaultElevationMm: 850,
  unitPrice: 8500,
  appearance: 'black granite single-bowl sink with a matte black tap',
  createdAt: '2026-01-01',
  updatedAt: '2026-01-01',
};

const row = (extra: Record<string, string> = {}): Record<string, string> => ({
  id: stored.id,
  label: stored.label,
  appliance_type: 'sink',
  width_mm: '600',
  depth_mm: '450',
  height_mm: '200',
  default_elevation_mm: '850',
  unit_price: '8500',
  ...extra,
});

describe('appliance sheet: appearance (§141)', () => {
  it('a sheet from before the column keeps the stored description (§54)', () => {
    const [r] = parseApplianceCatalogRows([row()], [stored]);
    expect(r.errors).toEqual([]);
    expect(r.data.appearance).toBe(stored.appearance);
  });

  it('a filled cell replaces it, a blank cell clears it', () => {
    expect(parseApplianceCatalogRows([row({ appearance: ' steel sink ' })], [stored])[0].data.appearance).toBe('steel sink');
    expect(parseApplianceCatalogRows([row({ appearance: '' })], [stored])[0].data.appearance).toBeUndefined();
  });
});
