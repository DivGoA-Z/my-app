// src/lib/boardUsage.ts
//
// "Is anything cut from this board line?" — asked before a board line
// is removed from the rate card. Your rule (2 Oct 2026): if it's used
// anywhere, don't delete it; say which project uses it.
//
// "Used" means a cabinet's INCLUDED panel resolves to this line — by an
// explicit choice (PanelSpec.boardId) OR by default (the thickest line
// of the cabinet's material, or the default back board). The default
// case matters most: deleting "HDMR 18mm" would otherwise silently turn
// every HDMR cabinet's carcass into the next-thickest HDMR line. Uses
// lib/panels.ts's resolvePanels, the same function the price and the
// cutting list use, so "in use" can't mean something different here.
//
// Scope: each project's latest saved layout (same "latest wins" rule as
// loadProjectBundle), the project open right now from memory (so an
// unsaved cabinet still counts), and the catalogue. Frozen quotes are
// NOT checked — they carry their own copy of the rate card and never
// re-read it, so deleting a line can't change one.

import { supabase } from './Supabaseclient';
import { resolvePanels } from './panels';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { CatalogItem } from '../types/Catalog';
import type { RateCard } from '../types/rates';

export interface BoardUsage {
  projectNames: string[];
  catalogueLabels: string[];
}

function usesBoard(
  item: Pick<PlacedCabinetItem, 'material' | 'panels' | 'carcassBoardId'>,
  boardId: string,
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>
): boolean {
  const resolved = resolvePanels(item, rates);
  return Object.values(resolved).some((p) => p.included && p.board?.id === boardId);
}

export async function findBoardUsage(
  boardId: string,
  rates: Pick<RateCard, 'boards' | 'defaultBackBoardId'>,
  catalogue: CatalogItem[],
  openProject: { id: string; name: string; cabinets: PlacedCabinetItem[] } | null
): Promise<BoardUsage> {
  const [layoutsRes, projectsRes] = await Promise.all([
    supabase.from('layouts').select('project_id, cabinets, updated_at').order('updated_at', { ascending: false }),
    supabase.from('projects').select('id, client_name'),
  ]);
  if (layoutsRes.error) throw new Error(`Couldn't check where this board is used: ${layoutsRes.error.message}`);
  if (projectsRes.error) throw new Error(`Couldn't check where this board is used: ${projectsRes.error.message}`);

  const names = new Map(
    (projectsRes.data as { id: string; client_name: string }[]).map((p) => [p.id, p.client_name])
  );
  const cabinetsByProject = new Map<string, PlacedCabinetItem[]>();
  for (const row of layoutsRes.data as { project_id: string; cabinets: PlacedCabinetItem[] | null }[]) {
    if (!cabinetsByProject.has(row.project_id)) cabinetsByProject.set(row.project_id, row.cabinets ?? []);
  }
  // The open project's in-memory cabinets win over its saved row.
  if (openProject) {
    cabinetsByProject.set(openProject.id, openProject.cabinets);
    names.set(openProject.id, openProject.name);
  }

  const projectNames = [...cabinetsByProject.entries()]
    .filter(([, cabinets]) => cabinets.some((c) => usesBoard(c, boardId, rates)))
    .map(([id]) => names.get(id) ?? 'Unnamed project');
  const catalogueLabels = catalogue.filter((c) => usesBoard(c, boardId, rates)).map((c) => c.label);
  return { projectNames, catalogueLabels };
}
