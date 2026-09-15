// src/lib/fixtures.ts
//
// Turns a fixture's MOUNT into an actual place in the room, and decides
// which fixtures get to be real three.js lights.
//
// Those are the two hard parts of lighting. Everything else — the
// catalogue, the inspector, the quote lines — is bookkeeping around
// them.
//
// COORDINATES: room millimetres throughout, matching cabinets. x/y is
// the floor plan, zMm is height off the floor. The 3D renderer converts
// at the last moment, so nothing here knows about metres or three.js.

import type { PlacedCabinetItem } from '../types/cabinet';
import type { RoomLayout, WallOrientation } from '../types/layout';
import type {
  CabinetFace,
  FixtureCatalogItem,
  FixtureKind,
  LightFixture,
} from '../types/fixture';
import { findFixtureItem, isLinear, defaultThrowFor } from '../types/fixture';
import type { ThrowDirection } from '../types/fixture';
import { defaultFrontLayout, clampCount } from '../types/front';
import { currentFootprintRect } from './footprint';
import { hasCountertop } from './cabinetGeometry';

const DEFAULT_CEILING_HEIGHT_MM = 2700;

// How far a pendant hangs below whatever it's suspended from.
//
// There is no longer a ceiling INSET: a surface-mounted fixture sits
// flush against the slab. The old 20mm inset left every ceiling
// fixture floating visibly below the ceiling, and made two fixtures at
// different insets read as being at different heights for no reason a
// designer could see.
const PENDANT_DROP_MM = 700;

// Plinth lights sit just above the floor, tucked into the toe recess.
const PLINTH_HEIGHT_MM = 60;

// A side-mounted strip runs vertically down the cabinet's edge, so its
// default length is the cabinet's height rather than its width.
const SIDE_STRIP_INSET_MM = 40;

// How far in from the cabinet's FRONT edge an under/top/plinth fixture
// sits.
//
// This offset is why those three were invisible before: they were
// placed at the footprint's CENTRE, which is inside the carcass, so the
// glowing body was buried behind the shutter. It's also where they
// actually go — an under-cabinet strip is fitted at the front underside
// so it lights the counter rather than the wall behind, and a plinth
// light is in the toe recess at the front. Correct placement and
// visible placement turn out to be the same thing.
const FRONT_FACE_INSET_MM = 45;

// How far a wall-mounted fixture stands proud of the wall.
//
// Without it the fixture sits exactly on the wall plane, which in 3D
// means INSIDE the 50mm-thick wall geometry — so it rendered as
// nothing. Anything mounted on a wall is in front of it, not in it.
const WALL_STANDOFF_MM = 60;

// Clearance between a fixture body and the surface it's fixed to.
//
// Nothing may sit EXACTLY on a host surface. Coplanar geometry
// z-fights, and worse, a body coincident with a cabinet face renders
// half-inside it — which is a large part of why several faces looked
// like they produced nothing at all.
const SURFACE_CLEARANCE_MM = 12;

// Extra lift for a fixture on the TOP of a unit that carries a
// countertop.
//
// The reason 'top' on a base cabinet appeared to do nothing: the top
// face is at elevation + height, which is exactly where the countertop
// slab sits. The fixture was rendering inside 40mm of stone. There is
// genuinely nowhere to fit a light there in reality either — a cove
// light belongs on top of a WALL unit — so it's lifted clear of the
// slab and the inspector says so rather than silently doing nothing.
const COUNTERTOP_CLEARANCE_MM = 40 + SURFACE_CLEARANCE_MM;

// A fixture whose length isn't derivable from a host and wasn't set by
// hand. 1m is a plausible run and, more importantly, is obviously a
// placeholder rather than looking like a measurement.
const FALLBACK_RUN_LENGTH_MM = 1000;

export interface FixturePlacement {
  fixture: LightFixture;
  item: FixtureCatalogItem;
  // Centre of the fixture, in room millimetres.
  xMm: number;
  yMm: number;
  zMm: number;
  // Which way the light throws. Unit vector in room space, +z up.
  dirX: number;
  dirY: number;
  dirZ: number;
  // For linear fixtures: how long the run is, and which axis it runs
  // along. 'vertical' is a side-mounted strip running down a cabinet
  // edge.
  runLengthMm: number;
  runAxis: 'x' | 'y' | 'vertical';
  // Height the fixture is SUSPENDED FROM, when it hangs. Only pendants
  // set it, and it's what lets the renderer draw a cord back up to the
  // ceiling — without which a pendant reads as floating in mid-air
  // rather than hanging from anything.
  suspendedFromMm?: number;
  // Outward normal of the SURFACE the fixture is fixed to, in room x/y.
  // Zero for mounts with no host surface (ceiling, free).
  //
  // Separate from dirX/dirY, which is the THROW. The two coincide for a
  // 'wash' fixture and diverge for every other throw — notably
  // 'diffuse', where throwVector deliberately discards the host normal
  // because a diffuse source has no direction. But the SURFACE still
  // has one, and the renderer needs it: a diffuse strip 60mm from a
  // wall needs its light sampled slightly off that wall or each sample
  // burns a 60mm-wide hole in it. See DIFFUSE_ORIGIN_STANDOFF_MM.
  hostNormalX: number;
  hostNormalY: number;
  // TRUE when the mount named a host that no longer exists — a cabinet
  // that was deleted. The fixture still resolves (to the room centre,
  // so it's findable rather than invisible) and is flagged so the UI can
  // say so. Silently dropping it would lose a priced line item.
  hostMissing: boolean;
}

function ceilingHeight(layout: RoomLayout): number {
  return layout.dimensions.ceilingHeightMm ?? DEFAULT_CEILING_HEIGHT_MM;
}

// Where on a wall, in room x/y, a given distance along it lands.
// North/south run along +x from x=0; west/east run along +y from y=0 —
// the identical convention lib/openings.ts uses, so "600mm along the
// north wall" means the same thing to a window and to a light.
function wallPoint(
  wallId: WallOrientation,
  offsetMm: number,
  roomWidthMm: number,
  roomDepthMm: number
): { xMm: number; yMm: number; dirX: number; dirY: number; axis: 'x' | 'y' } {
  switch (wallId) {
    case 'north':
      return { xMm: offsetMm, yMm: 0, dirX: 0, dirY: 1, axis: 'x' };
    case 'south':
      return { xMm: offsetMm, yMm: roomDepthMm, dirX: 0, dirY: -1, axis: 'x' };
    case 'west':
      return { xMm: 0, yMm: offsetMm, dirX: 1, dirY: 0, axis: 'y' };
    case 'east':
      return { xMm: roomWidthMm, yMm: offsetMm, dirX: -1, dirY: 0, axis: 'y' };
  }
}

// Which way a cabinet's front faces, in room x/y, given its rotation.
//
// Konva rotation is CLOCKWISE in a y-down coordinate system, so a
// vector (x, y) turns to (x cos - y sin, x sin + y cos). An unrotated
// cabinet fronts toward +y (a unit against the north wall faces into
// the room), and each quarter turn walks that around.
//
// Needed because "the front edge" is where under/top/plinth fixtures
// belong, and a rotated cabinet's front is not the same side of its
// axis-aligned footprint.
function cabinetFrontNormal(rotationDeg: number): { nx: number; ny: number } {
  const turns = (((Math.round(rotationDeg / 90) % 4) + 4) % 4) as 0 | 1 | 2 | 3;
  switch (turns) {
    case 0:
      return { nx: 0, ny: 1 };
    case 1:
      return { nx: -1, ny: 0 };
    case 2:
      return { nx: 0, ny: -1 };
    case 3:
      return { nx: 1, ny: 0 };
  }
}

// A fixture on a cabinet face. The whole point of the cabinet mount:
// every number here is derived from the cabinet, so moving or resizing
// it carries the light along.
function cabinetFacePlacement(
  cabinet: PlacedCabinetItem,
  face: CabinetFace
): {
  xMm: number;
  yMm: number;
  zMm: number;
  runLengthMm: number;
  runAxis: 'x' | 'y' | 'vertical';
} {
  // The ROTATED rectangle, so a turned cabinet's strip runs along the
  // edge it actually presents.
  const rect = currentFootprintRect(cabinet);
  const centreX = rect.x + rect.widthMm / 2;
  const centreY = rect.y + rect.depthMm / 2;

  const { nx, ny } = cabinetFrontNormal(cabinet.rotationDeg);
  // Half the footprint measured along the front normal's own axis, so
  // the offset reaches the front edge whichever way the cabinet is
  // turned.
  const halfToFront = nx !== 0 ? rect.widthMm / 2 : rect.depthMm / 2;
  const frontShift = Math.max(0, halfToFront - FRONT_FACE_INSET_MM);
  // A run lies along the edge PERPENDICULAR to the front, which is the
  // width of the face you're looking at.
  const alongAxis: 'x' | 'y' = nx !== 0 ? 'y' : 'x';
  const alongLength = nx !== 0 ? rect.depthMm : rect.widthMm;

  // At the front edge, at a given height, and standing clear of the
  // surface rather than coplanar with it.
  const atFront = (zMm: number) => ({
    xMm: centreX + nx * frontShift,
    yMm: centreY + ny * frontShift,
    zMm,
    runLengthMm: alongLength,
    runAxis: alongAxis,
  });

  switch (face) {
    case 'under':
      // Task lighting at the front underside — the position that lights
      // the counter instead of the wall behind, and the most common
      // fixture in a kitchen. Dropped clear of the carcass so it isn't
      // coplanar with it.
      return atFront(cabinet.elevationMm - SURFACE_CLEARANCE_MM);

    case 'top':
      // Lifted clear of the unit, and clear of its COUNTERTOP if it has
      // one — otherwise the fixture renders inside 40mm of stone, which
      // is why 'top' on a base cabinet looked like it produced nothing.
      return atFront(
        cabinet.elevationMm +
          cabinet.heightMm +
          (hasCountertop(cabinet.moduleType)
            ? COUNTERTOP_CLEARANCE_MM
            : SURFACE_CLEARANCE_MM)
      );

    case 'plinth':
      return atFront(PLINTH_HEIGHT_MM);

    case 'drawer':
      // No geometry — you only see it with a drawer open. Resolved to
      // the cabinet's centre so it has a defined position for the plan
      // readout; nothing renders it.
      return {
        xMm: centreX,
        yMm: centreY,
        zMm: cabinet.elevationMm + cabinet.heightMm / 2,
        runLengthMm: 0,
        runAxis: alongAxis,
      };

    case 'left':
    case 'right': {
      // On the cabinet's END, running VERTICALLY down the edge — so its
      // natural length is the cabinet's height, not its width.
      const sign = face === 'right' ? 1 : -1;
      const alongIsX = alongAxis === 'x';
      const half = alongIsX ? rect.widthMm / 2 : rect.depthMm / 2;
      const shift = Math.max(0, half - SIDE_STRIP_INSET_MM);
      return {
        xMm: alongIsX ? centreX + sign * shift : centreX,
        yMm: alongIsX ? centreY : centreY + sign * shift,
        zMm: cabinet.elevationMm + cabinet.heightMm / 2,
        runLengthMm: cabinet.heightMm,
        runAxis: 'vertical',
      };
    }
  }
}

// Which way the fixture throws, as a unit vector in room space (+z up).
//
// Derived from the placement's THROW DIRECTION plus, for 'wash', the
// direction its host faces. That's the fix for three catalogue kinds
// that rendered identically: the kind no longer decides the optics, the
// throw does, and it's a control the designer can see and set.
function throwVector(
  throwDirection: ThrowDirection,
  hostNormal: { nx: number; ny: number } | null,
  runAxis: 'x' | 'y' | 'vertical'
): { dirX: number; dirY: number; dirZ: number } {
  if (throwDirection === 'down') return { dirX: 0, dirY: 0, dirZ: -1 };
  if (throwDirection === 'up') return { dirX: 0, dirY: 0, dirZ: 1 };

  // 'diffuse' has no direction — it radiates. A nominal downward vector
  // is returned so callers that only want a number get something sane,
  // but the renderer checks isDirectional() first and gives it a point
  // light instead of aiming anything.
  if (throwDirection === 'diffuse') return { dirX: 0, dirY: 0, dirZ: -1 };

  // 'wash' — horizontal, outward from whatever it's fixed to. With no
  // host (a ceiling or free mount) there's no outward, so it grazes
  // perpendicular to its own run, which is the only meaningful
  // horizontal direction a bare strip has.
  if (hostNormal) return { dirX: hostNormal.nx, dirY: hostNormal.ny, dirZ: 0 };
  return runAxis === 'x'
    ? { dirX: 0, dirY: 1, dirZ: 0 }
    : { dirX: 1, dirY: 0, dirZ: 0 };
}

export function resolveFixturePlacement(
  fixture: LightFixture,
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  catalog: FixtureCatalogItem[]
): FixturePlacement | null {
  const item = findFixtureItem(catalog, fixture.catalogItemId);
  // No catalogue row means no colour temperature, no brightness and no
  // rate — nothing to render or price. Returning null (rather than
  // guessing) keeps the renderer and the quote consistent about it.
  if (!item) return null;

  const { widthMm: roomWidthMm, depthMm: roomDepthMm } = layout.dimensions;
  // Switched on a LOCAL rather than on `fixture.mount` directly.
  //
  // TypeScript narrows a property access inside a case body, but that
  // narrowing does NOT survive into a callback — the compiler has to
  // assume `fixture` could be reassigned before the callback runs, so
  // inside `cabinets.find(...)` it widens back to the whole
  // FixtureMount union and rejects `.cabinetId`. Narrowing a `const`
  // variable does survive, because nothing can reassign it.
  const mount = fixture.mount;
  const throwDirection = fixture.throwDirection ?? defaultThrowFor(item.kind);
  // Ceiling and free mounts have no host to take an axis from, so their
  // run is turned explicitly. Cabinet and wall mounts ignore this and
  // follow their host instead.
  const chosenAxis: 'x' | 'y' = (fixture.runRotationDeg ?? 0) === 90 ? 'y' : 'x';

  const base = {
    fixture,
    item,
    hostMissing: false,
    // Zero unless the mount has a real surface behind it. Ceiling and
    // free mounts hang in space, so there is nothing to stand off from.
    hostNormalX: 0,
    hostNormalY: 0,
  };

  // Keeps a run inside the room. A 3m strip centred 400mm from a wall
  // used to hang straight through it — the drag clamped the centre
  // point and nothing clamped the ENDS.
  const clampRun = (
    requested: number,
    centreMm: number,
    axis: 'x' | 'y' | 'vertical'
  ): number => {
    if (axis === 'vertical') return requested;
    const roomExtent = axis === 'x' ? roomWidthMm : roomDepthMm;
    const room = Math.max(0, roomExtent);
    // Symmetric about the centre, so the run shrinks rather than
    // sliding — moving the fixture is the designer's job, not ours.
    const maxHalf = Math.min(centreMm, room - centreMm);
    return Math.max(0, Math.min(requested, Math.max(0, maxHalf) * 2));
  };

  switch (mount.kind) {
    case 'ceiling': {
      const isPendant = item.kind === 'pendant';
      const requested = fixture.runLengthMm ?? FALLBACK_RUN_LENGTH_MM;
      const centreAlong = chosenAxis === 'x' ? mount.x : mount.y;
      const ceilingMm = ceilingHeight(layout);
      return {
        ...base,
        xMm: mount.x,
        yMm: mount.y,
        // A surface-mounted fixture sits FLUSH against the slab — the
        // old 20mm inset left every ceiling fixture floating visibly
        // below the ceiling, and two fixtures at different insets read
        // as being at different heights for no reason. A pendant is the
        // one that genuinely hangs, and it gets a stem drawn up to the
        // slab so it reads as suspended rather than levitating.
        zMm: isPendant ? ceilingMm - PENDANT_DROP_MM : ceilingMm,
        suspendedFromMm: isPendant ? ceilingMm : undefined,
        ...throwVector(throwDirection, null, chosenAxis),
        runLengthMm: clampRun(requested, centreAlong, chosenAxis),
        runAxis: chosenAxis,
      };
    }

    case 'wall': {
      const p = wallPoint(mount.wallId, mount.offsetMm, roomWidthMm, roomDepthMm);
      // Stood off the wall plane, or it renders INSIDE the wall
      // geometry and is invisible — which is exactly what happened to a
      // wall-mounted plinth strip.
      const standoff = mmTowardRoom(WALL_STANDOFF_MM, p.dirX, p.dirY);
      const requested = fixture.runLengthMm ?? FALLBACK_RUN_LENGTH_MM;
      const centreAlong = p.axis === 'x' ? p.xMm : p.yMm;
      const isPendant = item.kind === 'pendant';
      return {
        ...base,
        xMm: p.xMm + standoff.dx,
        yMm: p.yMm + standoff.dy,
        // A wall-mounted pendant HANGS from its bracket rather than
        // sitting at it — otherwise it's a wall light, not a pendant.
        // The stem is drawn back up to the mount height.
        zMm: isPendant ? mount.heightMm - PENDANT_DROP_MM / 2 : mount.heightMm,
        suspendedFromMm: isPendant ? mount.heightMm : undefined,
        // A wall IS the host, so 'wash' grazes outward along it.
        ...throwVector(throwDirection, { nx: p.dirX, ny: p.dirY }, p.axis),
        // Kept SEPARATELY from the throw, because throwVector throws
        // this away for 'diffuse' and the renderer still needs it.
        hostNormalX: p.dirX,
        hostNormalY: p.dirY,
        runLengthMm: clampRun(requested, centreAlong, p.axis),
        runAxis: p.axis,
      };
    }

    case 'cabinet': {
      const cabinet = cabinets.find((c) => c.id === mount.cabinetId);
      if (!cabinet) {
        // Host deleted. Resolve to the middle of the room and FLAG it,
        // rather than dropping the fixture: it's still a priced line
        // item, and a light that silently vanished from both the render
        // and the quote is worse than one that's visibly misplaced.
        return {
          ...base,
          xMm: roomWidthMm / 2,
          yMm: roomDepthMm / 2,
          zMm: ceilingHeight(layout) / 2,
          dirX: 0,
          dirY: 0,
          dirZ: -1,
          runLengthMm: fixture.runLengthMm ?? FALLBACK_RUN_LENGTH_MM,
          runAxis: 'x',
          hostMissing: true,
        };
      }

      const placed = cabinetFacePlacement(cabinet, mount.face);
      const hostNormal = cabinetFrontNormal(cabinet.rotationDeg);
      return {
        ...base,
        ...placed,
        ...throwVector(throwDirection, hostNormal, placed.runAxis),
        hostNormalX: hostNormal.nx,
        hostNormalY: hostNormal.ny,
        // An explicit run length still wins — the default tracks the
        // cabinet, but a designer who typed a number meant it.
        runLengthMm: fixture.runLengthMm ?? placed.runLengthMm,
      };
    }

    case 'free': {
      const requested = fixture.runLengthMm ?? FALLBACK_RUN_LENGTH_MM;
      const centreAlong = chosenAxis === 'x' ? mount.x : mount.y;
      return {
        ...base,
        xMm: mount.x,
        yMm: mount.y,
        zMm: mount.zMm,
        ...throwVector(throwDirection, null, chosenAxis),
        runLengthMm: clampRun(requested, centreAlong, chosenAxis),
        runAxis: chosenAxis,
      };
    }
  }
}

// A standoff distance turned into an x/y offset along a wall's inward
// normal.
function mmTowardRoom(distanceMm: number, dirX: number, dirY: number) {
  return { dx: dirX * distanceMm, dy: dirY * distanceMm };
}

export function resolveAllFixtures(
  layout: RoomLayout,
  cabinets: PlacedCabinetItem[],
  catalog: FixtureCatalogItem[]
): FixturePlacement[] {
  return (layout.fixtures ?? [])
    .map((f) => resolveFixturePlacement(f, layout, cabinets, catalog))
    .filter((p): p is FixturePlacement => p !== null);
}

// ---- The real-light budget ----

// How many fixtures may become actual three.js lights.
//
// This is the hard constraint of the whole feature, not a tuning knob.
// A realistic kitchen is six spots plus three metres of strip plus two
// cove runs — a dozen fixtures — and a dozen dynamic lights will not
// render at an acceptable frame rate on a mid-range Android phone,
// which this app is explicitly meant to work on.
//
// So EVERY fixture always gets emissive geometry (free: it's just a
// glowing surface, no lighting calculation), and only the brightest few
// also get a real light. The result is that you always SEE every
// fixture you placed and paid for, while the room is lit by the ones
// that actually matter.
export const MAX_REAL_FIXTURE_LIGHTS = 4;

// How many real lights the viewer is willing to pay for.
//
// A DEVICE choice, not a design choice — which is why it is
// deliberately NOT stored on the layout. On a laptop you want every
// fixture lit; on a phone four is already generous. If this saved with
// the project, a design reviewed on a desktop would open on a phone
// with a setting that makes it unusable, and a shared link would carry
// the wrong one.
export type LightQuality = 'auto' | 'all' | 'low';

export const LIGHT_QUALITY_LABELS: Record<LightQuality, string> = {
  auto: `Auto (${MAX_REAL_FIXTURE_LIGHTS} lights)`,
  all: 'All lights',
  low: 'Low (2 lights)',
};

export const LIGHT_QUALITY_HINTS: Record<LightQuality, string> = {
  auto: 'Balanced — safe on a phone, close to the full effect.',
  all: 'Every fixture lights the room. Best on a laptop or tablet.',
  low: 'Fewest lights, smoothest walkthrough on older phones.',
};

export function maxLightsFor(quality: LightQuality): number {
  switch (quality) {
    case 'all':
      return Number.POSITIVE_INFINITY;
    case 'low':
      return 2;
    case 'auto':
    default:
      return MAX_REAL_FIXTURE_LIGHTS;
  }
}

// Chosen by LUMENS, descending — brightest wins.
//
// Deliberately not "whichever was added first": placement order is
// arbitrary, and it would mean adding a small accent light early could
// starve the main ceiling run of a slot. Brightness is the honest
// proxy for how much a fixture contributes, and it's stable, so the
// selection doesn't flicker between frames as unrelated state changes.
//
// Ties break on id so the ordering is fully deterministic — two
// identical strips must not swap slots on re-render.
export function selectRealLights(
  placements: FixturePlacement[],
  maxLights: number = MAX_REAL_FIXTURE_LIGHTS
): {
  lit: FixturePlacement[];
  emissiveOnly: FixturePlacement[];
} {
  const eligible = placements.filter((p) => p.fixture.enabled);

  const ranked = eligible.slice().sort((a, b) => {
    const byLumens = b.item.lumens - a.item.lumens;
    if (byLumens !== 0) return byLumens;
    return a.fixture.id.localeCompare(b.fixture.id);
  });

  // Infinity is a legitimate value here ('all lights'), and slice
  // handles it — no special case needed.
  return {
    lit: ranked.slice(0, maxLights),
    emissiveOnly: ranked.slice(maxLights),
  };
}

// ---- Quantities, for pricing ----

// How much of this fixture there is, in its OWN pricing unit: running
// metres for a strip, pieces for a spot.
//
// The one place that conversion happens, so bom.ts and the inspector
// can't disagree about whether a 2.4m run is "2.4" or "1".
export function fixtureQuantity(
  placement: FixturePlacement
): { amount: number; unit: 'm' | 'pcs' } {
  if (isLinear(placement.item.kind)) {
    return { amount: (placement.runLengthMm / 1000) * placement.fixture.quantity, unit: 'm' };
  }
  return { amount: placement.fixture.quantity, unit: 'pcs' };
}

// How many drawers a cabinet has, from its front layout.
//
// Used so an in-drawer sensor light doesn't need its quantity typed:
// the cabinet already knows it has three drawers, and "3 sensor lights
// — drawer unit 600mm" is a schedule an electrician can work from,
// where a bare "1" is not.
export function cabinetDrawerCount(cabinet: PlacedCabinetItem): number {
  const layout = cabinet.frontLayout ?? defaultFrontLayout(cabinet.moduleType, cabinet.widthMm);
  if (layout.kind === 'drawers') return clampCount(layout.count);
  // A trolley's tiers are pull-outs and take a light each in practice.
  if (layout.kind === 'trolley') return clampCount(layout.count);
  return 0;
}

// The quantity a drawer light should default to, given where it's
// mounted. Zero when it isn't on a cabinet with drawers — which is a
// real signal, not a bug: a sensor light on a door unit lights nothing.
export function defaultDrawerLightQuantity(
  fixture: LightFixture,
  cabinets: PlacedCabinetItem[]
): number {
  // Pulled into a local BEFORE the guard, deliberately.
  //
  // Narrowing `fixture.mount` with an early return doesn't survive into
  // the .find() callback: inside a closure TypeScript re-reads the
  // property and sees the full FixtureMount union again, because
  // nothing stops `fixture` being mutated between the check and the
  // call. A const captures the narrowed type and the callback keeps it.
  //
  // Same reason the cascade in layoutStore's removeCabinet narrows
  // inline within one expression rather than across a statement
  // boundary.
  const mount = fixture.mount;
  if (mount.kind !== 'cabinet') return 0;

  const cabinet = cabinets.find((c) => c.id === mount.cabinetId);
  return cabinet ? cabinetDrawerCount(cabinet) : 0;
}

export function fixtureCost(placement: FixturePlacement): number {
  const { amount } = fixtureQuantity(placement);
  return amount * placement.item.price;
}

// Sensible default mount for a newly added fixture of a given kind, so
// clicking "add spot" puts it somewhere plausible rather than at the
// origin.
export function defaultMountFor(
  kind: FixtureKind,
  layout: RoomLayout
): { kind: 'ceiling'; x: number; y: number } | { kind: 'free'; x: number; y: number; zMm: number } {
  const { widthMm, depthMm } = layout.dimensions;

  // Spots, pendants and cove runs belong on the ceiling; strips and
  // plinth lights normally go on a cabinet, but the designer picks
  // which one, so they start as a free position at counter height and
  // get reassigned in the inspector.
  if (kind === 'spot' || kind === 'pendant' || kind === 'cove') {
    return { kind: 'ceiling', x: widthMm / 2, y: depthMm / 2 };
  }
  return { kind: 'free', x: widthMm / 2, y: depthMm / 2, zMm: 1450 };
}
