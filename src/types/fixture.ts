// src/types/fixture.ts
//
// Light fixtures the business places and sells — strips, spots, cove
// runs, pendants, plinth lights.
//
// REPLACES an automatic fake. lib/lighting3d.ts used to drop a warm
// point light under every elevated cabinet, derived from nothing and
// controllable by nobody: not data, not placeable, not editable, not
// priced. Every render approved before this was lit partly by that
// fiction. Fixtures are real rows now, so what lights the room is what
// appears on the quote.
//
// TWO IDEAS DO THE WORK HERE:
//
//   1. MOUNTS. A fixture is attached to a HOST — the ceiling, a wall, a
//      specific cabinet face — and positions itself relative to it,
//      rather than living at absolute coordinates. That's not tidiness:
//      an under-cabinet strip stored at absolute x/y stays behind when
//      the cabinet slides, which is a bug on every layout revision.
//   2. FIXED COLOUR TEMPERATURE. Warmth belongs to the CATALOGUE ROW,
//      not to the placement — you buy 3000K strip or 6500K strip as
//      different products at different rates. So there's no per-fixture
//      colour dial, and no tunable-white pricing tier to model.

import type { WallOrientation } from './layout';

// ---- What kind of light ----

export type FixtureKind =
  | 'strip'      // LED strip / profile, run along a length
  | 'spot'       // ceiling downlight
  | 'cove'       // indirect, bounced off the ceiling
  | 'pendant'    // hanging, with a visible body
  | 'plinth'     // at floor level, washes the floor
  | 'drawer';    // in-drawer sensor light

export const FIXTURE_KIND_LABELS: Record<FixtureKind, string> = {
  strip: 'LED strip / profile',
  spot: 'Ceiling spot',
  cove: 'Cove light',
  pendant: 'Pendant',
  plinth: 'Plinth / toe-kick',
  drawer: 'In-drawer sensor light',
};

// Which kinds are sold BY LENGTH rather than by piece. Same distinction
// gola handles needed, and it's the same trap: charging a 2.4m run as
// one unit is how a quote comes out badly short.
export const LINEAR_FIXTURE_KINDS: FixtureKind[] = ['strip', 'cove', 'plinth'];

export function isLinear(kind: FixtureKind): boolean {
  return LINEAR_FIXTURE_KINDS.includes(kind);
}

// Kinds with nothing to show in a still render.
//
// An in-drawer light is only visible with the drawer open, and drawers
// are always modelled shut. It's a genuine BOM item with zero visual —
// worth naming explicitly so its absence from the render doesn't get
// filed as a rendering bug.
export function isVisibleWhenClosed(kind: FixtureKind): boolean {
  return kind !== 'drawer';
}

// ---- Where it's mounted ----

// Which face of a cabinet a fixture is fixed to.
//
// 'inside' is DEFERRED, not forgotten: cabinets currently render as
// sealed boxes, so there is literally nothing in there to illuminate,
// and the interior would light up as the shutter finish (walnut) rather
// than as the white liner board a real carcass is lined with. It comes
// back with the five-panel carcass work.
export type CabinetFace = 'under' | 'top' | 'left' | 'right' | 'plinth' | 'drawer';

export const CABINET_FACE_LABELS: Record<CabinetFace, string> = {
  under: 'Underneath (task lighting)',
  top: 'On top (cove / uplight)',
  left: 'Left side',
  right: 'Right side',
  plinth: 'Plinth / toe-kick',
  // Inside the drawers. No geometry — you only see it with a drawer
  // open — but naming WHICH cabinet is the whole point: the electrician
  // needs to know where the sensor lights go, and the quantity comes
  // from that cabinet's own drawer count.
  drawer: 'Inside the drawers',
};

export type FixtureMount =
  // Anywhere on the ceiling plane.
  | { kind: 'ceiling'; x: number; y: number }
  // On a named wall, at a distance along it and a height off the floor.
  // Same "along the wall" convention openings use — see
  // openingToRoomRect in lib/openings.ts.
  | { kind: 'wall'; wallId: WallOrientation; offsetMm: number; heightMm: number }
  // Attached to a cabinet, so it MOVES WITH IT. This is the mount that
  // justifies the whole union.
  | { kind: 'cabinet'; cabinetId: string; face: CabinetFace }
  // The escape hatch, for anything the four above don't cover. Absolute
  // room coordinates plus a height, with no host — so nothing keeps it
  // in sync with anything, which is exactly the trade-off.
  | { kind: 'free'; x: number; y: number; zMm: number };

export const MOUNT_KIND_LABELS: Record<FixtureMount['kind'], string> = {
  ceiling: 'Ceiling',
  wall: 'Wall',
  cabinet: 'On a cabinet',
  free: 'Free position',
};

// Which way a fixture actually throws its light.
//
// This is a PER-PLACEMENT control rather than a property of the
// product, because the same strip does all three jobs depending on
// where it's stuck: under a wall unit it throws down at the counter,
// on top of one it throws up and bounces off the ceiling, in a plinth
// it grazes the floor. Before this existed, strip/cove/plinth were
// three catalogue names that rendered identically — the kind changed
// the price and nothing else, which is exactly the sort of control
// that lies.
//
// The kinds remain a real distinction, but a PRICING one: a cove strip
// and a plinth strip are different products at different rates. What
// they do optically is now said explicitly.
export type ThrowDirection = 'down' | 'up' | 'wash' | 'diffuse';

export const THROW_LABELS: Record<ThrowDirection, string> = {
  down: 'Down (task lighting)',
  up: 'Up (indirect / cove)',
  wash: 'Across (wash a surface)',
  diffuse: 'All directions (diffused)',
};

export const THROW_HINTS: Record<ThrowDirection, string> = {
  down: 'Lights the counter or floor below.',
  up: 'Bounces off the ceiling — soft, even, no hotspots.',
  wash: 'Grazes outward along the surface it is fixed to.',
  diffuse: 'Radiates evenly all round — a shaded pendant or opal fitting.',
};

// Whether a throw has a DIRECTION at all.
//
// 'diffuse' does not: a bare bulb, a fabric or opal shade, a frosted
// ceiling fitting all radiate in every direction, and the renderer
// gives them a point light rather than an aimed spot.
//
// This is a correction, not just an addition. Every fixture was
// switched from a point light to an aimed spot when throw direction
// arrived — right for a strip in an extrusion, wrong for a pendant,
// which is exactly the kind that radiates. Making it a per-placement
// choice is what lets both be true.
export function isDirectional(throwDirection: ThrowDirection): boolean {
  return throwDirection !== 'diffuse';
}

// What each kind does by default, so picking the product picks a
// sensible throw and most placements need no adjustment.
export function defaultThrowFor(kind: FixtureKind): ThrowDirection {
  switch (kind) {
    case 'cove':
      return 'up';
    case 'plinth':
      return 'wash';
    // A pendant hangs a shade in open air and throws light everywhere —
    // that's what distinguishes it from a downlight, and it's why one
    // read as working in the 3D view while the aimed strips did not.
    case 'pendant':
      return 'diffuse';
    case 'strip':
    case 'spot':
    case 'drawer':
    default:
      return 'down';
  }
}

// ---- The fixture ----

export interface LightFixture {
  id: string;
  layoutId: string;
  // FK -> FixtureCatalogItem.id. The catalogue row carries the colour
  // temperature, brightness and rate; this row carries only WHERE it is
  // and HOW MUCH of it. Resolved live at render time (like appliance
  // models, unlike cabinet fronts) because re-pricing a strip should
  // update every layout that uses it.
  catalogItemId: string;
  mount: FixtureMount;
  // Which way it throws. Absent falls back to defaultThrowFor(kind),
  // so existing fixtures keep behaving as their kind implies.
  throwDirection?: ThrowDirection;
  // Quarter-turn rotation of the RUN, for ceiling and free mounts only.
  //
  // Cabinet and wall mounts take their axis from the host — a strip
  // under a cabinet runs along that cabinet, and rotating it
  // independently would be meaningless. But a ceiling or free-standing
  // run had no way to be turned at all, so every one of them ran
  // east-west regardless of the kitchen's shape.
  //
  // Quarter turns rather than free angles, for the same reason cabinets
  // are: it keeps the run axis-aligned, which keeps the 2D readout and
  // the 3D geometry a single axis choice rather than a rotated bar.
  runRotationDeg?: 0 | 90;
  // Run length for a linear fixture, in mm. Ignored for spots and
  // pendants.
  //
  // Optional because a cabinet-mounted strip should DEFAULT to the
  // cabinet's own width — that's what "under-cabinet lighting" means,
  // and making the designer retype 597mm would be busywork that also
  // stops tracking the cabinet when it's resized. Set it only to
  // override.
  runLengthMm?: number;
  // Spots and pendants only.
  quantity: number;
  // Whether the fixture is switched ON in the render. Per-fixture, so a
  // single accent light can be shown off without changing the whole
  // scene — distinct from the layout-wide lightingMode below.
  enabled: boolean;
  // Free-text note that prints on the quote — "on the same circuit as
  // the hob", "dimmer at door". Electricians ask.
  note?: string;
}

// ---- Catalogue ----

export interface FixtureCatalogItem {
  id: string;
  label: string;
  kind: FixtureKind;
  // Fixed, per your buying reality: 3000K strip and 6500K strip are
  // different products at different rates, so warmth is a property of
  // the row and there is no per-placement dial.
  colorTempK: number;
  // Brightness. Used for two different things, which is why it's
  // lumens rather than an abstract 0-1: it sets how bright the light
  // renders, AND it decides which fixtures win a slot in the real-light
  // budget when a kitchen has more fixtures than the renderer can
  // afford (see lib/fixtures.ts).
  lumens: number;
  // Per running metre for strip/cove/plinth, per piece for spot/
  // pendant/drawer. Mirrors HandleSpec.pricingMode, and it's the same
  // hazard.
  pricingMode: 'per-unit' | 'per-metre';
  price: number;
  // Optional .glb/.gltf path, e.g. '/models/lighting/pendant-industrial.glb'.
  // Null/absent keeps the primitive body (a bar or disc, per kind) —
  // see FixtureInScene in Room3DCanvas.tsx. Mirrors
  // ApplianceCatalogItem.modelUrl exactly, including the fitting/
  // orientation conventions below.
  modelUrl?: string;
  // Fixed correction, in degrees, for a model that was exported facing
  // the wrong way — applied XYZ order about the model's own axes BEFORE
  // it gets measured and fitted. Same semantics as
  // ApplianceCatalogItem.modelRotation{X,Y,Z}Deg: a property of the
  // FILE, not the placement, so it's set once on the catalogue row.
  // Only ever multiples of 90° — see the fitting note in
  // ApplianceModel.tsx for why non-quarter-turns don't compose safely
  // with the per-axis scale.
  modelRotationXDeg?: number;
  modelRotationYDeg?: number;
  modelRotationZDeg?: number;
  createdAt: string;
  updatedAt: string;
}

export function findFixtureItem(
  catalog: FixtureCatalogItem[],
  id: string | undefined
): FixtureCatalogItem | undefined {
  if (!id) return undefined;
  return catalog.find((c) => c.id === id);
}

// ---- Lighting mode ----

// How the 3D view treats lighting, stored on the layout so it saves
// with the project.
//
// Three states rather than an on/off toggle, because "turn the lights
// off" turns out to be two different jobs:
//
//   designed      What the client is buying. Fixtures lit at their real
//                 colour temperatures, daylight as authored.
//   fixtures-off  Fixtures dark, daylight and ambient only. The
//                 lightest realistic load, which is what makes a
//                 walkthrough usable on a phone.
//   true-colour   Flat neutral white light, every colour cast removed
//                 — including the daylight's. This is the finish
//                 approval mode: a cool grey laminate looks beige under
//                 3000K, so signing a colour off under warm light is
//                 how the wrong finish gets ordered. Here the finishes
//                 read as themselves.
//
// 'fixtures-off' is NOT the same as 'true-colour': switching fixtures
// off still leaves a warm 3000K window throwing orange across the
// floor.
export type LightingMode = 'designed' | 'fixtures-off' | 'true-colour';

export const LIGHTING_MODE_LABELS: Record<LightingMode, string> = {
  designed: 'Lit as designed',
  'fixtures-off': 'Fixtures off',
  'true-colour': 'True colour (no tint)',
};

export const LIGHTING_MODE_HINTS: Record<LightingMode, string> = {
  designed: 'What the client is buying — fixtures at their real warmth.',
  'fixtures-off': 'Daylight only. Lightest load, best for sharing on a phone.',
  'true-colour': 'Flat neutral light so finishes read as their true colour.',
};

export const DEFAULT_LIGHTING_MODE: LightingMode = 'designed';

// ---- Creation ----

export function createFixture(
  layoutId: string,
  catalogItemId: string,
  mount: FixtureMount
): LightFixture {
  return {
    id: crypto.randomUUID(),
    layoutId,
    catalogItemId,
    mount,
    // runLengthMm deliberately unset — a cabinet-mounted linear fixture
    // takes the cabinet's width, and keeps taking it when the cabinet
    // is resized.
    quantity: 1,
    enabled: true,
  };
}
