// src/lib/designFinishes.ts
//
// The picture for a design card (§73, Premium A: designs show their
// material). A design's "main finish" is the finish most of its cabinets
// use; its picture is that finish's photo, else its generated texture's
// colour map, else its flat colour.

import { supabase } from './Supabaseclient';
import { GENERATED_TEXTURE_FILES } from './textureManifest';
import type { SurfaceFinish } from '../types/finish';

export function dominantFinishId(cabinets: { finishId?: string; quantity?: number }[]): string | undefined {
  const tally = new Map<string, number>();
  for (const c of cabinets) {
    if (!c.finishId || c.finishId === 'none') continue;
    tally.set(c.finishId, (tally.get(c.finishId) ?? 0) + (c.quantity ?? 1));
  }
  let best: string | undefined;
  let most = 0;
  for (const [id, n] of tally) if (n > most) [best, most] = [id, n];
  return best;
}

export interface Swatch {
  image?: string;
  color?: string;
  label: string;
}

export function finishSwatch(
  finish: Pick<SurfaceFinish, 'label' | 'albedoUrl' | 'proceduralKind' | 'solidColor'> | undefined
): Swatch | undefined {
  if (!finish) return undefined;
  if (finish.albedoUrl) return { image: finish.albedoUrl, label: finish.label };
  if (finish.proceduralKind) {
    const files = GENERATED_TEXTURE_FILES[finish.proceduralKind];
    if (files) return { image: files.map, label: finish.label };
  }
  if (finish.solidColor) return { color: finish.solidColor, label: finish.label };
  return undefined;
}

// projectId → its main finish id, for a handful of projects (Home's
// "Continue designing"). Best-effort: the caller shows a plain card on
// failure.
export async function fetchMainFinishIds(projectIds: string[]): Promise<Record<string, string>> {
  if (projectIds.length === 0) return {};
  const { data, error } = await supabase.from('layouts').select('project_id, cabinets').in('project_id', projectIds);
  if (error) throw new Error(error.message);
  const out: Record<string, string> = {};
  for (const row of (data ?? []) as { project_id: string; cabinets: { finishId?: string; quantity?: number }[] }[]) {
    const id = dominantFinishId(row.cabinets ?? []);
    if (id) out[row.project_id] = id;
  }
  return out;
}
