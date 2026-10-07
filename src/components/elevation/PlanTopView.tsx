// src/components/elevation/PlanTopView.tsx
//
// The elevation tab's "Top" drawing: the room from above as a clean line
// plan (lib/planDrawing.ts), the same drawing the image brief's sheet
// carries. Shows what four wall elevations can't — how the walls meet,
// and anything standing free of a wall, like an island.
//
// An <img> of the generated SVG rather than a Konva stage: the drawing is
// read-only, and this way the editor shows exactly the picture that gets
// exported, not a second rendering of it that could drift.

import { useRenderBriefInput } from '../../hooks/useRenderBriefInput';
import { buildRenderBrief } from '../../lib/renderBrief';
import { planSvg } from '../../lib/planDrawing';

export function PlanTopView({ maxWidthPx, maxHeightPx }: { maxWidthPx: number; maxHeightPx: number }) {
  const input = useRenderBriefInput();
  if (!input) return null;
  const brief = buildRenderBrief({ ...input, view: null, referenceImages: [], assetOrigin: '', generatedAt: '' });
  const width = Math.max(320, Math.round(maxWidthPx));
  const height = Math.max(320, Math.round(maxHeightPx));
  const src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(planSvg(brief, width, height))}`;
  return (
    <figure className="flex flex-col items-center gap-2">
      <img src={src} width={width} height={height} alt={`Plan of ${input.layout.name} from above`} className="rounded-xl border border-border bg-white" />
      <figcaption className="text-[13px] text-muted-foreground">
        From above, north at the top. Heavy edges are unit fronts; dashed outlines hang above the counter.
      </figcaption>
    </figure>
  );
}
