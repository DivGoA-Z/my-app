// src/hooks/useRenderBriefInput.ts
//
// Everything lib/renderBrief.ts needs from the store, in one place, so
// the 3D view's "Image brief" download and the editor's Top drawing
// (lib/planDrawing.ts) are built from the same inputs. Cabinets are the
// PHYSICAL ones (§61): the brief describes what is drawn.
//
// The caller adds what only it knows: the camera (`view`), the images
// it saves, and the timestamp.

import { useLayoutStore } from '../store/layoutStore';
import { usePhysicalCabinets } from './usePhysicalCabinets';
import type { RenderBriefInput } from '../lib/renderBrief';

export type RenderBriefBase = Omit<RenderBriefInput, 'view' | 'referenceImages' | 'generatedAt' | 'assetOrigin'>;

export function useRenderBriefInput(): RenderBriefBase | null {
  const layout = useLayoutStore((s) => s.currentLayout);
  const cabinets = usePhysicalCabinets();
  const appliances = useLayoutStore((s) => s.appliances);
  const obstacles = useLayoutStore((s) => s.obstacles);
  const finishes = useLayoutStore((s) => s.finishes);
  const handles = useLayoutStore((s) => s.handles);
  const applianceCatalog = useLayoutStore((s) => s.applianceCatalog);
  const fixtureCatalog = useLayoutStore((s) => s.fixtureCatalog);
  const hardwareRates = useLayoutStore((s) => s.rateCard.hardware);
  if (!layout) return null;
  return { layout, cabinets, appliances, obstacles, finishes, handles, applianceCatalog, fixtureCatalog, hardwareRates };
}
