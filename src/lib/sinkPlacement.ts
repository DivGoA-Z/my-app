// src/lib/sinkPlacement.ts
//
// Where a sink MODEL is drawn (§126): dropped into the counter, rim at
// the finished counter top, the way a real sink is fitted, instead of the
// whole basin sitting on the slab.
//
//   - A sink "rests on" a counter cabinet the same way the countertop's
//     cut-out decides it (centre over the cabinet, elevationMm within
//     100 mm of its top). Only then is it dropped; a sink placed at some
//     other height by hand is left exactly where it was put.
//   - For a sink, the catalogue height means the BOWL DEPTH: the base of
//     the model goes that far below the counter top (200 mm when unset).
//   - The model keeps its own proportions (fitted evenly inside the
//     footprint), so the tap stands upright instead of being squashed to
//     the bowl depth.
//
// History (DECISIONS "Sink cutout"): three earlier position offsets were
// reverted because the sink vanished. The real cause turned out to be a
// catalogue height of 0 (a zero-size box). Fitting now copes with that
// (fitModelToBox), and this was checked live, step by step.

import type { PlacedApplianceItem } from '../types/appliance';
import type { PlacedCabinetItem } from '../types/cabinet';
import { COUNTERTOP_THICKNESS_MM, hasCountertop } from './cabinetGeometry';
import { currentFootprintRect } from './footprint';
import { applianceFootprint } from './applianceGeometry';

export const DEFAULT_SINK_BOWL_DEPTH_MM = 200;
const RESTING_TOLERANCE_MM = 100;

// The counter cabinet a sink rests on, or null.
export function sinkHostCabinet(sink: PlacedApplianceItem, cabinets: PlacedCabinetItem[]): PlacedCabinetItem | null {
  if (sink.applianceType !== 'sink') return null;
  const f = applianceFootprint(sink);
  const cx = f.x + f.widthMm / 2;
  const cy = f.y + f.depthMm / 2;
  for (const c of cabinets) {
    if (!hasCountertop(c.moduleType)) continue;
    const top = c.elevationMm + c.heightMm;
    if (Math.abs(sink.elevationMm - top) > RESTING_TOLERANCE_MM) continue;
    const r = currentFootprintRect(c);
    if (cx >= r.x && cx <= r.x + r.widthMm && cy >= r.y && cy <= r.y + r.depthMm) return c;
  }
  return null;
}

// The height (mm) the sink model's base is drawn at: counter top minus
// bowl depth when it rests on a counter, else its own elevationMm.
export function sinkModelBaseMm(sink: PlacedApplianceItem, cabinets: PlacedCabinetItem[]): number {
  const host = sinkHostCabinet(sink, cabinets);
  if (!host) return sink.elevationMm;
  const counterTop = host.elevationMm + host.heightMm + COUNTERTOP_THICKNESS_MM;
  const bowl = sink.heightMm > 0 ? sink.heightMm : DEFAULT_SINK_BOWL_DEPTH_MM;
  return counterTop - bowl;
}
