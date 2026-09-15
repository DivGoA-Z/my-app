// src/store/layoutStore.ts
//
// Zustand store for the active project, its layout, cabinets, and
// obstacles, plus Supabase save/load. Install with:
//   npm install zustand @supabase/supabase-js
//
// Why Zustand for this app: no boilerplate providers, plays well with
// frequent small updates from canvas drag events, and selectors let
// components (e.g. the BOM panel) subscribe to only the slice they need
// so dragging a cabinet or pillar doesn't re-render unrelated UI.
//
// Note on obstacles: RoomLayout.obstacles (types/layout.ts) is nested
// inside the layout, but here — same as cabinets — obstacles are kept
// as a flat array so ObstacleLayer can render/drag them without reaching
// into currentLayout on every update. setLayout() seeds this array from
// layout.obstacles; saveProject() reassembles { ...currentLayout,
// obstacles } before persisting (see lib/Persistence.ts).
//
// saveProject/loadProject delegate the actual Supabase calls to
// lib/Persistence.ts — the store just owns state and loading/error
// flags, it doesn't know about rows or the Supabase client directly.

import { create } from 'zustand';
import type { RoomLayout, RoomDimensions, Obstacle, Wall, WallOrientation } from '../types/layout';
import type { PlacedCabinetItem } from '../types/cabinet';
import type { PlacedApplianceItem } from '../types/appliance';
import type { CustomerProject } from '../types/customer';
import type { CatalogItem, ObstaclePreset, ApplianceCatalogItem } from '../types/Catalog';
import type { SurfaceFinish } from '../types/finish';
import type { CameraNode } from '../types/Camera';
import { calculateBOM } from '../lib/bom';
import { saveProjectBundle, loadProjectBundle } from '../lib/Persistence';
import { uploadPanorama, deletePanorama } from '../lib/panoramaStorage';
import {
  fetchCabinetCatalog,
  fetchObstaclePresets,
  fetchApplianceCatalog,
  saveCabinetCatalogItem,
  deleteCabinetCatalogItem,
  saveObstaclePreset,
  deleteObstaclePreset,
  saveApplianceCatalogItem,
  deleteApplianceCatalogItem,
} from '../lib/Inventory';
import { fetchFinishes, saveFinish, deleteFinish, uploadSwatch, deleteSwatch } from '../lib/finishes';
import { fetchHandles, saveHandle, deleteHandle } from '../lib/handles';
import {
  fetchFixtureCatalog,
  saveFixtureCatalogItem,
  deleteFixtureCatalogItem,
} from '../lib/fixtureCatalog';
import { fetchRateCard, saveRateCard } from '../lib/rates';
import { fetchQuotes, freezeQuote, fingerprintPricedInputs } from '../lib/quotes';
import type { FrozenQuote } from '../types/quote';
import { defaultRateCard, sanitizeRateCard, type RateCard } from '../types/rates';
import type { FixtureCatalogItem, LightFixture, LightingMode } from '../types/fixture';
import type { HandleSpec } from '../types/front';
import type { WallOpening } from '../types/opening';
import type { SelectableType, SelectionRef } from '../types/selection';
import { clampExposure } from '../lib/lighting3d';

// Clears the selection only when it is of the given TYPE. Used by the
// null-passing wrappers, so one layer's "deselect" can't silently wipe
// another type's selection.
function clearIfType(
  selection: SelectionRef | null,
  type: SelectableType
): SelectionRef | null {
  return selection?.type === type ? null : selection;
}

// Clears the selection when it points at exactly the item being
// deleted. Lives here rather than at each call site so it is
// impossible to delete something and leave an inspector pointing at
// it — the guard the five separate ids each had to repeat.
function clearIfMatch(
  selection: SelectionRef | null,
  type: SelectableType,
  id: string
): SelectionRef | null {
  return selection?.type === type && selection.id === id ? null : selection;
}

interface LayoutStore {
  currentProject: CustomerProject | null;
  currentLayout: RoomLayout | null;
  cabinets: PlacedCabinetItem[];
  obstacles: Obstacle[];
  // Placed appliances (stove/chimney/oven/OTG/toaster — types/
  // appliance.ts). Kept as a flat array alongside cabinets/obstacles
  // for the same reason both are: ApplianceLayer/quoting/collision can
  // read it without reaching into currentLayout. Stored as its own
  // top-level bundle field (not nested in currentLayout) — same
  // treatment as cabinets, since appliances carry a layoutId FK and
  // are priced the same way cabinets are. setLayout() does NOT seed
  // this (same reason it doesn't seed cabinets either) — loadProject()
  // sets it directly from the loaded bundle.
  appliances: PlacedApplianceItem[];
  // Phase 2 bridge — saved 360° viewpoint nodes (types/Camera.ts). Kept
  // as a flat array alongside cabinets/obstacles for the same reason
  // obstacles is: CameraLayer can render/drag/aim them without reaching
  // into currentLayout on every update. setLayout() seeds this from
  // layout.cameras; saveProject() reassembles it back into the layout
  // before persisting (see lib/Persistence.ts).
  cameras: CameraNode[];

  // What is selected, as ONE value — see types/selection.ts.
  //
  // Replaced five mutually-exclusive ids (cabinet / obstacle /
  // appliance / opening / fixture), each of which had to clear the
  // other four on every select. That was twenty lines saying one
  // thing, and the overlap picker cannot express "an item of some type
  // at this point" against five separate fields without a switch at
  // every call site.
  //
  // Components read it through the hooks in hooks/useSelection.ts, so
  // each one asks for the id of its own type and gets null when
  // something else is selected — exactly the shape they had before.
  selection: SelectionRef | null;

  // The business's own inventory — cabinet catalog items and obstacle
  // presets — read by CabinetToolbar/ObstacleToolbar to render "add"
  // buttons, and managed (added/renamed/edited/deleted) from
  // InventoryManager. Loaded once via loadInventory(); every other
  // action below keeps this array in sync with Supabase so nothing
  // needs to re-fetch after an edit.
  cabinetCatalog: CatalogItem[];
  obstaclePresets: ObstaclePreset[];
  applianceCatalog: ApplianceCatalogItem[];
  // The business's handle catalogue. A table like finishes rather than
  // a fixed list, so a business can price its own hardware — see
  // lib/handles.ts.
  handles: HandleSpec[];
  // The business's light fixture catalogue. A table like handles and
  // finishes — colour temperature and rate vary by supplier, so they
  // can't be a fixed list.
  fixtureCatalog: FixtureCatalogItem[];
  // The business's rate card: labour per sq ft and the four hardware
  // rates. NOT an array and NOT optional — a business always has rates,
  // even if they are the seeded placeholders, so this holds a value
  // from the first render rather than null. See types/rates.ts for why
  // that fallback is deliberate and where it could bite.
  rateCard: RateCard;
  // The business's finish catalogue (types/finish.ts). Read by the
  // 3D renderer, the inspector's finish picker and BOM costing.
  finishes: SurfaceFinish[];
  isInventoryLoading: boolean;
  inventoryError: string | null;

  // Frozen quotes for the OPEN project, newest version first. Empty
  // until loadQuotes runs; an empty array means "never quoted", which
  // is a real and common state rather than a loading artefact.
  quotes: FrozenQuote[];
  isFreezingQuote: boolean;
  quoteError: string | null;

  isSaving: boolean;
  isLoading: boolean;
  saveError: string | null;
  loadError: string | null;

  setProject: (project: CustomerProject) => void;
  setLayout: (layout: RoomLayout) => void;
  // Patches currentLayout.dimensions (width/depth/ceiling height) for
  // the room that's currently open — the room's L x B x H were fixed at
  // creation with no edit path until now (see RoomSettingsPanel.tsx).
  // A no-op when no layout is open. NOTE: resizing does not move or
  // clamp existing cabinets/obstacles/appliances/cameras that fall
  // outside the new bounds — same "you can create an overlap, the UI
  // just warns you" posture collision detection already takes
  // elsewhere in this app, not a hard constraint.
  updateRoomDimensions: (updates: Partial<RoomDimensions>) => void;
  // Floor/ceiling finish assignment on the open layout.
  updateRoomSurfaces: (
    updates: Partial<Pick<RoomLayout, 'floorFinishId' | 'floorConcealedFinishId' | 'ceilingFinishId'>>
  ) => void;
  // Per-wall finish assignment, addressed by orientation rather than
  // wall id — orientation is the stable identity here (walls are
  // regenerated from room dimensions on load, see normalizeWalls in
  // lib/Persistence.ts), and it's what the UI and costing both key on.
  updateWallFinish: (
    orientation: WallOrientation,
    updates: Partial<Pick<Wall, 'finishId' | 'concealedFinishId'>>
  ) => void;
  setCabinets: (cabinets: PlacedCabinetItem[]) => void;
  setObstacles: (obstacles: Obstacle[]) => void;
  setAppliances: (appliances: PlacedApplianceItem[]) => void;
  setCameras: (cameras: CameraNode[]) => void;

  // The one selection action. Pass null to clear.
  select: (ref: SelectionRef | null) => void;

  // Named wrappers, kept so every existing call site
  // (selectCabinet(id), selectOpening(null), ...) keeps working
  // unchanged — the refactor is in the state shape, not in the API
  // every layer and inspector already calls.
  selectCabinet: (id: string | null) => void;
  selectObstacle: (id: string | null) => void;
  selectAppliance: (id: string | null) => void;
  selectOpening: (id: string | null) => void;
  selectFixture: (id: string | null) => void;

  addFixture: (fixture: LightFixture) => void;
  updateFixture: (id: string, updates: Partial<LightFixture>) => void;
  removeFixture: (id: string) => void;
  setLightingMode: (mode: LightingMode) => void;
  setPriceElectrical: (priceElectrical: boolean) => void;
  setExposure: (exposure: number) => void;

  upsertFixtureCatalogItem: (item: FixtureCatalogItem) => Promise<void>;
  removeFixtureCatalogItem: (id: string) => Promise<void>;

  addOpening: (opening: WallOpening) => void;
  updateOpening: (id: string, updates: Partial<WallOpening>) => void;
  removeOpening: (id: string) => void;

  addCabinet: (item: PlacedCabinetItem) => void;
  updateCabinet: (id: string, updates: Partial<PlacedCabinetItem>) => void;
  removeCabinet: (id: string) => void;

  addObstacle: (obstacle: Obstacle) => void;
  updateObstacle: (id: string, updates: Partial<Obstacle>) => void;
  removeObstacle: (id: string) => void;

  addAppliance: (item: PlacedApplianceItem) => void;
  updateAppliance: (id: string, updates: Partial<PlacedApplianceItem>) => void;
  removeAppliance: (id: string) => void;

  addCamera: (camera: CameraNode) => void;
  updateCamera: (id: string, updates: Partial<CameraNode>) => void;
  removeCamera: (id: string) => void;
  // Uploads an already-rendered panorama Blob (Room3DCanvas.tsx does
  // the actual three.js capture, via lib/panoramaCapture.ts — this
  // action only knows about storage + updating the node) and patches
  // that Camera Node's panoramaUrl/panoramaCapturedAt in local state.
  // Lets errors propagate, same as the inventory upsert actions above,
  // so the "Capture 360°" button can show/roll back just that one
  // node on failure. NOTE: only updates in-memory state — like every
  // other layout edit in this app, persisting it to Supabase still
  // happens via the normal "Save Project" button (the upload itself
  // to Storage is immediate/unavoidable, but the layout row's JSONB
  // `cameras` column isn't rewritten until you save).
  capturePanoramaForCamera: (cameraId: string, blob: Blob) => Promise<void>;
  // Removes the panorama from Storage AND clears panoramaUrl/
  // panoramaCapturedAt on the node — so re-capturing later starts
  // clean and the "database [storage] keeps filling up" concern has an
  // actual way to shrink back down. A no-op if the camera has nothing
  // captured yet.
  deletePanoramaForCamera: (cameraId: string) => Promise<void>;

  loadInventory: () => Promise<void>;
  upsertCabinetCatalogItem: (item: CatalogItem) => Promise<void>;
  removeCabinetCatalogItem: (id: string) => Promise<void>;
  upsertObstaclePreset: (preset: ObstaclePreset) => Promise<void>;
  removeObstaclePreset: (id: string) => Promise<void>;
  upsertApplianceCatalogItem: (item: ApplianceCatalogItem) => Promise<void>;
  removeApplianceCatalogItem: (id: string) => Promise<void>;

  // No create and no delete: the rate card is a single row that is
  // edited, never added to or removed.
  updateRateCard: (card: RateCard) => Promise<void>;

  loadQuotes: () => Promise<void>;
  // Freezes what is on screen right now as the next version. Returns
  // the frozen row so the caller can show/print it immediately.
  freezeCurrentQuote: (note?: string) => Promise<FrozenQuote | null>;
  upsertHandle: (handle: HandleSpec) => Promise<void>;
  removeHandle: (id: string) => Promise<void>;
  upsertFinish: (finish: SurfaceFinish) => Promise<void>;
  removeFinish: (id: string) => Promise<void>;
  // Uploads a swatch photo and returns its public URL for the caller
  // to store on the finish being edited.
  uploadFinishSwatch: (finishId: string, file: File) => Promise<string>;

  saveProject: () => Promise<void>;
  loadProject: (projectId: string) => Promise<void>;
}

export const useLayoutStore = create<LayoutStore>((set, get) => ({
  currentProject: null,
  currentLayout: null,
  cabinets: [],
  obstacles: [],
  appliances: [],
  cameras: [],
  selection: null,

  cabinetCatalog: [],
  obstaclePresets: [],
  applianceCatalog: [],
  handles: [],
  fixtureCatalog: [],
  rateCard: defaultRateCard(),
  finishes: [],
  isInventoryLoading: false,
  inventoryError: null,

  quotes: [],
  isFreezingQuote: false,
  quoteError: null,

  isSaving: false,
  isLoading: false,
  saveError: null,
  loadError: null,

  setProject: (project) => set({ currentProject: project }),

  setLayout: (layout) =>
    set({ currentLayout: layout, obstacles: layout.obstacles, cameras: layout.cameras }),

  updateRoomDimensions: (updates) =>
    set((state) =>
      state.currentLayout
        ? {
            currentLayout: {
              ...state.currentLayout,
              dimensions: { ...state.currentLayout.dimensions, ...updates },
              updatedAt: new Date().toISOString(),
            },
          }
        : {}
    ),

  updateRoomSurfaces: (updates) =>
    set((state) =>
      state.currentLayout
        ? {
            currentLayout: {
              ...state.currentLayout,
              ...updates,
              updatedAt: new Date().toISOString(),
            },
          }
        : {}
    ),

  updateWallFinish: (orientation, updates) =>
    set((state) =>
      state.currentLayout
        ? {
            currentLayout: {
              ...state.currentLayout,
              walls: state.currentLayout.walls.map((wall) =>
                wall.orientation === orientation ? { ...wall, ...updates } : wall
              ),
              updatedAt: new Date().toISOString(),
            },
          }
        : {}
    ),

  setCabinets: (cabinets) => set({ cabinets }),

  setObstacles: (obstacles) => set({ obstacles }),

  setAppliances: (appliances) => set({ appliances }),

  setCameras: (cameras) => set({ cameras }),

  // One setter. Mutual exclusion is now structural — there is only one
  // slot — rather than something each action has to remember to
  // enforce against every other type.
  select: (ref) => set({ selection: ref }),

  // Wrappers. Passing null clears the selection ONLY if the selected
  // item is of that type: ObstacleLayer's background-click handler
  // calling selectObstacle(null) must not wipe a cabinet selection
  // made a moment earlier, which is the behaviour the old
  // "id === null ? keep : clear" dance was reaching for.
  selectCabinet: (id) =>
    set((state) => ({
      selection: id === null ? clearIfType(state.selection, 'cabinet') : { type: 'cabinet', id },
    })),

  selectObstacle: (id) =>
    set((state) => ({
      selection:
        id === null ? clearIfType(state.selection, 'obstacle') : { type: 'obstacle', id },
    })),

  selectAppliance: (id) =>
    set((state) => ({
      selection:
        id === null ? clearIfType(state.selection, 'appliance') : { type: 'appliance', id },
    })),

  selectOpening: (id) =>
    set((state) => ({
      selection: id === null ? clearIfType(state.selection, 'opening') : { type: 'opening', id },
    })),

  selectFixture: (id) =>
    set((state) => ({
      selection: id === null ? clearIfType(state.selection, 'fixture') : { type: 'fixture', id },
    })),

  // Fixtures live on currentLayout, like openings, so these rebuild
  // that object rather than a top-level array slice.
  addFixture: (fixture) =>
    set((state) => {
      if (!state.currentLayout) return {};
      return {
        currentLayout: {
          ...state.currentLayout,
          fixtures: [...(state.currentLayout.fixtures ?? []), fixture],
        },
        selection: { type: 'fixture', id: fixture.id },
      };
    }),

  updateFixture: (id, updates) =>
    set((state) => {
      if (!state.currentLayout) return {};
      return {
        currentLayout: {
          ...state.currentLayout,
          fixtures: (state.currentLayout.fixtures ?? []).map((f) =>
            f.id === id ? { ...f, ...updates } : f
          ),
        },
      };
    }),

  removeFixture: (id) =>
    set((state) => {
      if (!state.currentLayout) return {};
      return {
        currentLayout: {
          ...state.currentLayout,
          fixtures: (state.currentLayout.fixtures ?? []).filter((f) => f.id !== id),
        },
        selection: clearIfMatch(state.selection, 'fixture', id),
      };
    }),

  setLightingMode: (lightingMode) =>
    set((state) =>
      state.currentLayout
        ? { currentLayout: { ...state.currentLayout, lightingMode } }
        : {}
    ),

  setPriceElectrical: (priceElectrical) =>
    set((state) =>
      state.currentLayout
        ? { currentLayout: { ...state.currentLayout, priceElectrical } }
        : {}
    ),

  // Clamped in the store rather than only in the slider, so a value
  // typed straight into a saved layout, or restored from an older row,
  // can't put the renderer at an exposure of 0 or 400.
  setExposure: (exposure) =>
    set((state) =>
      state.currentLayout
        ? { currentLayout: { ...state.currentLayout, exposure: clampExposure(exposure) } }
        : {}
    ),

  upsertFixtureCatalogItem: async (item) => {
    await saveFixtureCatalogItem(item);
    set((state) => {
      const exists = state.fixtureCatalog.some((f) => f.id === item.id);
      return {
        fixtureCatalog: exists
          ? state.fixtureCatalog.map((f) => (f.id === item.id ? item : f))
          : [...state.fixtureCatalog, item],
      };
    });
  },

  removeFixtureCatalogItem: async (id) => {
    await deleteFixtureCatalogItem(id);
    set((state) => ({
      fixtureCatalog: state.fixtureCatalog.filter((f) => f.id !== id),
    }));
  },

  // Openings are nested inside currentLayout.walls, so all three
  // actions rebuild the walls array. Wall membership comes from
  // opening.wallId rather than from where it currently sits, which is
  // what lets updateOpening MOVE an opening to a different wall in the
  // same call that resizes it — remove from every wall, then insert
  // into the one the (possibly updated) wallId names.
  addOpening: (opening) =>
    set((state) => {
      if (!state.currentLayout) return {};
      return {
        currentLayout: {
          ...state.currentLayout,
          walls: state.currentLayout.walls.map((wall) =>
            wall.orientation === opening.wallId
              ? { ...wall, openings: [...(wall.openings ?? []), opening] }
              : wall
          ),
        },
        selection: { type: 'opening', id: opening.id },
      };
    }),

  updateOpening: (id, updates) =>
    set((state) => {
      if (!state.currentLayout) return {};

      const existing = state.currentLayout.walls
        .flatMap((w) => w.openings ?? [])
        .find((o) => o.id === id);
      if (!existing) return {};

      const next = { ...existing, ...updates };

      return {
        currentLayout: {
          ...state.currentLayout,
          walls: state.currentLayout.walls.map((wall) => {
            const without = (wall.openings ?? []).filter((o) => o.id !== id);
            return wall.orientation === next.wallId
              ? { ...wall, openings: [...without, next] }
              : { ...wall, openings: without };
          }),
        },
      };
    }),

  removeOpening: (id) =>
    set((state) => {
      if (!state.currentLayout) return {};
      return {
        currentLayout: {
          ...state.currentLayout,
          walls: state.currentLayout.walls.map((wall) => ({
            ...wall,
            openings: (wall.openings ?? []).filter((o) => o.id !== id),
          })),
        },
        // Same guard as removeCabinet — clear the selection here rather
        // than at each call site.
        selection: clearIfMatch(state.selection, 'opening', id),
      };
    }),

  addCabinet: (item) =>
    set((state) => ({ cabinets: [...state.cabinets, item] })),

  updateCabinet: (id, updates) =>
    set((state) => ({
      cabinets: state.cabinets.map((c) =>
        c.id === id ? { ...c, ...updates } : c
      ),
    })),

  // Clears the selection when the removed cabinet was the selected one —
  // otherwise the Inspector would keep trying to show a cabinet that no
  // longer exists. Belongs here, not in every call site, so it's
  // impossible to delete a cabinet and forget to deselect it.
  removeCabinet: (id) =>
    set((state) => ({
      cabinets: state.cabinets.filter((c) => c.id !== id),
      selection: clearIfMatch(state.selection, 'cabinet', id),
      // CASCADE to mounted fixtures. An under-cabinet strip has no
      // meaning without its cabinet — leaving it behind would put an
      // orphaned light in the middle of the room and, worse, keep
      // charging for a run of strip that has nothing to be fixed to.
      // resolveFixturePlacement still handles an orphan defensively
      // (it flags hostMissing), but that's a safety net for old data,
      // not the intended path.
      currentLayout: state.currentLayout
        ? {
            ...state.currentLayout,
            fixtures: (state.currentLayout.fixtures ?? []).filter(
              (f) => !(f.mount.kind === 'cabinet' && f.mount.cabinetId === id)
            ),
          }
        : state.currentLayout,
    })),

  addObstacle: (obstacle) =>
    set((state) => ({ obstacles: [...state.obstacles, obstacle] })),

  updateObstacle: (id, updates) =>
    set((state) => ({
      obstacles: state.obstacles.map((o) =>
        o.id === id ? { ...o, ...updates } : o
      ),
    })),

  // Same guard as removeCabinet — clears the selection when the
  // removed obstacle was the selected one, so ObstacleInspector can't
  // keep trying to show a deleted obstacle.
  removeObstacle: (id) =>
    set((state) => ({
      obstacles: state.obstacles.filter((o) => o.id !== id),
      selection: clearIfMatch(state.selection, 'obstacle', id),
    })),

  addAppliance: (item) =>
    set((state) => ({ appliances: [...state.appliances, item] })),

  updateAppliance: (id, updates) =>
    set((state) => ({
      appliances: state.appliances.map((a) => (a.id === id ? { ...a, ...updates } : a)),
    })),

  // Same guard as removeCabinet/removeObstacle — clearing the
  // selection here rather than at each call site is what makes it
  // impossible to delete an appliance and leave the inspector pointing
  // at something that no longer exists.
  removeAppliance: (id) =>
    set((state) => ({
      appliances: state.appliances.filter((a) => a.id !== id),
      selection: clearIfMatch(state.selection, 'appliance', id),
    })),

  addCamera: (camera) =>
    set((state) => ({ cameras: [...state.cameras, camera] })),

  updateCamera: (id, updates) =>
    set((state) => ({
      cameras: state.cameras.map((c) => (c.id === id ? { ...c, ...updates } : c)),
    })),

  removeCamera: (id) =>
    set((state) => ({
      cameras: state.cameras.filter((c) => c.id !== id),
    })),

  capturePanoramaForCamera: async (cameraId, blob) => {
    const camera = get().cameras.find((c) => c.id === cameraId);
    if (!camera) return;
    const panoramaUrl = await uploadPanorama(camera.layoutId, camera.id, blob);
    set((state) => ({
      cameras: state.cameras.map((c) =>
        c.id === cameraId
          ? { ...c, panoramaUrl, panoramaCapturedAt: new Date().toISOString() }
          : c
      ),
    }));
  },

  deletePanoramaForCamera: async (cameraId) => {
    const camera = get().cameras.find((c) => c.id === cameraId);
    if (!camera || !camera.panoramaUrl) return;
    await deletePanorama(camera.layoutId, camera.id);
    set((state) => ({
      cameras: state.cameras.map((c) =>
        c.id === cameraId ? { ...c, panoramaUrl: undefined, panoramaCapturedAt: undefined } : c
      ),
    }));
  },

  loadInventory: async () => {
    set({ isInventoryLoading: true, inventoryError: null });
    try {
      const [
        cabinetCatalog,
        obstaclePresets,
        applianceCatalog,
        finishes,
        handles,
        fixtureCatalog,
        rateCard,
      ] = await Promise.all([
        fetchCabinetCatalog(),
        fetchObstaclePresets(),
        fetchApplianceCatalog(),
        fetchFinishes(),
        fetchHandles(),
        fetchFixtureCatalog(),
        fetchRateCard(),
      ]);
      set({
        cabinetCatalog,
        obstaclePresets,
        applianceCatalog,
        finishes,
        handles,
        fixtureCatalog,
        rateCard,
        isInventoryLoading: false,
      });
    } catch (err) {
      set({
        isInventoryLoading: false,
        inventoryError: err instanceof Error ? err.message : 'Failed to load inventory.',
      });
    }
  },

  // These six intentionally let errors propagate (rather than
  // swallowing them into a store-level error field, the way
  // saveProject/loadProject do) — InventoryManager calls them per-row
  // and shows/rolls back that ONE row on failure, which doesn't fit a
  // single global inventoryError.
  upsertCabinetCatalogItem: async (item) => {
    await saveCabinetCatalogItem(item);
    set((state) => {
      const exists = state.cabinetCatalog.some((c) => c.id === item.id);
      return {
        cabinetCatalog: exists
          ? state.cabinetCatalog.map((c) => (c.id === item.id ? item : c))
          : [...state.cabinetCatalog, item],
      };
    });
  },

  removeCabinetCatalogItem: async (id) => {
    await deleteCabinetCatalogItem(id);
    set((state) => ({
      cabinetCatalog: state.cabinetCatalog.filter((c) => c.id !== id),
    }));
  },

  upsertObstaclePreset: async (preset) => {
    await saveObstaclePreset(preset);
    set((state) => {
      const exists = state.obstaclePresets.some((p) => p.id === preset.id);
      return {
        obstaclePresets: exists
          ? state.obstaclePresets.map((p) => (p.id === preset.id ? preset : p))
          : [...state.obstaclePresets, preset],
      };
    });
  },

  removeObstaclePreset: async (id) => {
    await deleteObstaclePreset(id);
    set((state) => ({
      obstaclePresets: state.obstaclePresets.filter((p) => p.id !== id),
    }));
  },

  upsertApplianceCatalogItem: async (item) => {
    await saveApplianceCatalogItem(item);
    set((state) => {
      const exists = state.applianceCatalog.some((a) => a.id === item.id);
      return {
        applianceCatalog: exists
          ? state.applianceCatalog.map((a) => (a.id === item.id ? item : a))
          : [...state.applianceCatalog, item],
      };
    });
  },

  loadQuotes: async () => {
    const { currentProject } = get();
    if (!currentProject) {
      set({ quotes: [] });
      return;
    }
    try {
      set({ quotes: await fetchQuotes(currentProject.id), quoteError: null });
    } catch (err) {
      set({ quoteError: err instanceof Error ? err.message : 'Failed to load quotes.' });
    }
  },

  freezeCurrentQuote: async (note) => {
    const {
      currentProject, currentLayout, cabinets, obstacles, appliances, cameras,
      finishes, handles, fixtureCatalog, rateCard,
    } = get();

    if (!currentProject || !currentLayout) {
      set({ quoteError: 'No active project/layout to quote.' });
      return null;
    }

    // The same reassembled layout saveProject uses, for the same
    // reason: currentLayout's obstacles array is stale by design, and
    // surface costing needs the real one. Freezing a quote off a
    // different layout than the one that gets saved is exactly the
    // sidebar-vs-database divergence this whole pass is about.
    const layoutForQuote: RoomLayout = { ...currentLayout, obstacles, cameras };
    const ctx = { finishes, handles, fixtureCatalog, rates: rateCard, layout: layoutForQuote };
    const summary = calculateBOM(cabinets, appliances, ctx);

    set({ isFreezingQuote: true, quoteError: null });
    try {
      const frozen = await freezeQuote({
        projectId: currentProject.id,
        summary,
        pricingContext: {
          rates: rateCard,
          finishes,
          handles,
          fixtureCatalog,
          layoutId: currentLayout.id,
          // Fingerprints the PRICED INPUTS, not the output — two
          // different designs can total the same rupee figure, and a
          // quote whose kitchen was rearranged still needs revising
          // even if the total happens not to have moved.
          fingerprint: fingerprintPricedInputs(cabinets, appliances, ctx),
        },
        note,
      });
      set((state) => ({
        isFreezingQuote: false,
        quotes: [frozen, ...state.quotes],
      }));
      return frozen;
    } catch (err) {
      set({
        isFreezingQuote: false,
        quoteError: err instanceof Error ? err.message : 'Failed to freeze quote.',
      });
      return null;
    }
  },

  // Writes THEN sets, deliberately — the opposite of an optimistic
  // update. Every open quote reprices the instant this lands, so
  // showing a new total that failed to persist would mean the sidebar
  // and the database disagree about what the business charges, which is
  // the exact class of bug the PricingContext refactor was for. A rate
  // edit is a once-a-quarter action; it can afford a round trip.
  updateRateCard: async (card) => {
    await saveRateCard(card);
    set({ rateCard: sanitizeRateCard(card) });
  },

  upsertHandle: async (handle) => {
    await saveHandle(handle);
    set((state) => {
      const exists = state.handles.some((h) => h.id === handle.id);
      return {
        handles: exists
          ? state.handles.map((h) => (h.id === handle.id ? handle : h))
          : [...state.handles, handle],
      };
    });
  },

  removeHandle: async (id) => {
    await deleteHandle(id);
    set((state) => ({ handles: state.handles.filter((h) => h.id !== id) }));
  },

  removeApplianceCatalogItem: async (id) => {
    await deleteApplianceCatalogItem(id);
    set((state) => ({
      applianceCatalog: state.applianceCatalog.filter((a) => a.id !== id),
    }));
  },

  upsertFinish: async (finish) => {
    await saveFinish(finish);
    set((state) => {
      const exists = state.finishes.some((f) => f.id === finish.id);
      return {
        finishes: exists
          ? state.finishes.map((f) => (f.id === finish.id ? finish : f))
          : [...state.finishes, finish],
      };
    });
  },

  removeFinish: async (id) => {
    // Clean up the uploaded swatch image too, or deleting finishes
    // slowly fills the bucket with files nothing references — the same
    // orphan problem panoramas had. Best-effort: a failed image delete
    // must not block removing the finish itself, since the row is the
    // thing the user asked to get rid of.
    const finish = get().finishes.find((f) => f.id === id);
    if (finish?.albedoUrl && finish.source === 'uploaded') {
      try {
        await deleteSwatch(finish.id, finish.albedoUrl);
      } catch {
        // ignored on purpose — see above
      }
    }
    await deleteFinish(id);
    set((state) => ({ finishes: state.finishes.filter((f) => f.id !== id) }));
  },

  uploadFinishSwatch: async (finishId, file) => uploadSwatch(finishId, file),

  saveProject: async () => {
    const { currentProject, currentLayout, cabinets, obstacles, appliances, cameras, finishes, handles, fixtureCatalog, rateCard } =
      get();

    if (!currentProject || !currentLayout) {
      set({ saveError: 'No active project/layout to save.' });
      return;
    }

    // Snapshot the live BOM total onto the project record at save time —
    // see the comment on CustomerProject.quoteTotal in types/customer.ts.
    // Includes appliances now too (calculateBOM's second argument), so
    // a quote sent right after adding a stove/chimney reflects them.
    // One assembled layout used for BOTH the quote total and the row
    // we persist. Surface costing needs the obstacles and per-wall
    // finish assignments, so it has to be the reassembled layout
    // rather than currentLayout (whose obstacles array is stale by
    // design — see the note at the top of this file).
    const layoutForQuote: RoomLayout = { ...currentLayout, obstacles, cameras };
    const { grandTotal } = calculateBOM(cabinets, appliances, {
      finishes,
      handles,
      fixtureCatalog,
      rates: rateCard,
      layout: layoutForQuote,
    });
    const projectWithQuote: CustomerProject = { ...currentProject, quoteTotal: grandTotal };

    set({ isSaving: true, saveError: null });
    try {
      await saveProjectBundle({
        project: projectWithQuote,
        layout: layoutForQuote,
        cabinets,
        appliances,
      });
      set({ isSaving: false, currentProject: projectWithQuote, currentLayout: layoutForQuote });
    } catch (err) {
      set({
        isSaving: false,
        saveError: err instanceof Error ? err.message : 'Failed to save project.',
      });
    }
  },

  loadProject: async (projectId) => {
    set({ isLoading: true, loadError: null });
    try {
      const { project, layout, cabinets, appliances } = await loadProjectBundle(projectId);
      set({
        currentProject: project,
        currentLayout: layout,
        cabinets,
        obstacles: layout.obstacles,
        appliances,
        cameras: layout.cameras,
        selection: null,
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        loadError: err instanceof Error ? err.message : 'Failed to load project.',
      });
    }
  },
}));
