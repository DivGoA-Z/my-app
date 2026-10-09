// A sink model drops into its counter (§126).
import { describe, expect, it } from 'vitest';
import { DEFAULT_SINK_BOWL_DEPTH_MM, sinkHostCabinet, sinkModelBaseMm } from './sinkPlacement';
import { COUNTERTOP_THICKNESS_MM } from './cabinetGeometry';
import { cabinet } from '../test/fixtures';
import type { PlacedApplianceItem } from '../types/appliance';

const sinkUnit = cabinet('sink-unit', 900, 600, 850, { x: 0, y: 0 });
const sink = (extra: Partial<PlacedApplianceItem> = {}): PlacedApplianceItem =>
  ({
    id: 's', layoutId: 'l', applianceType: 'sink', x: 150, y: 50, widthMm: 600, depthMm: 450, heightMm: 200,
    elevationMm: 850, rotationDeg: 0, quantity: 1, unitPrice: 0, ...extra,
  }) as PlacedApplianceItem;

describe('sink placement', () => {
  it('drops a sink resting on its counter so the rim sits at the counter top', () => {
    expect(sinkHostCabinet(sink(), [sinkUnit])).toBe(sinkUnit);
    // 850 cabinet + slab − 200 bowl.
    expect(sinkModelBaseMm(sink(), [sinkUnit])).toBe(850 + COUNTERTOP_THICKNESS_MM - 200);
  });

  it('uses a standard bowl depth when the catalogue height is 0', () => {
    expect(sinkModelBaseMm(sink({ heightMm: 0 }), [sinkUnit])).toBe(850 + COUNTERTOP_THICKNESS_MM - DEFAULT_SINK_BOWL_DEPTH_MM);
  });

  it('leaves a sink placed elsewhere, or set by hand, where it was put', () => {
    expect(sinkModelBaseMm(sink({ elevationMm: 690 }), [sinkUnit])).toBe(690);
    expect(sinkModelBaseMm(sink({ x: 2000 }), [sinkUnit])).toBe(850);
    expect(sinkModelBaseMm(sink(), [])).toBe(850);
  });
});
