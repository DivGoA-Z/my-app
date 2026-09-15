// src/types/opening.ts
//
// Doors and windows, as openings that belong to a wall.
//
// WHY THEY MATTER BEYOND THE PICTURE — three reasons, in order of how
// much money they move:
//
//   1. AREA. An opening isn't hidden wall, it's ABSENT wall. A 900x2100
//      door is 1.89 m² of tile that will never be laid. Until now every
//      quote charged for it. That's the VOID category in
//      lib/surfaceAreas.ts, alongside exposed/concealed/occupied.
//   2. CLEARANCE. An in-swinging door sweeps floor no cabinet can
//      occupy. In a 7x9 Delhi kitchen that arc is routinely the only
//      place a cylinder trolley fits, and getting it wrong is a rework
//      on site, not a cosmetic slip.
//   3. LAYOUT. A window means no wall units on that stretch, and its
//      sill caps how deep the counter below can be.
//
// WHO SUPPLIES THEM. Kitchen doors and windows almost always already
// exist — they're the builder's, not the kitchen vendor's. So
// suppliedByUs defaults to false: the opening subtracts tile area but
// adds nothing to the quote. It still PRINTS, as a specification line,
// so nobody on site can claim a door was promised in the price.
//
// STORAGE. Openings live on Wall, which is already a JSONB column on
// `layouts` — so this whole feature needs no migration.

import type { WallOrientation } from './layout';

export type OpeningKind = 'door' | 'window' | 'pass-through';

export const OPENING_KIND_LABELS: Record<OpeningKind, string> = {
  door: 'Door',
  window: 'Window',
  'pass-through': 'Pass-through / hatch',
};

// How a door moves. Only the two in-swinging values create a clearance
// zone — and that's the point of modelling this at all rather than
// assuming the worst case. An out-swinging or sliding door frees up the
// floor inside, which is a real design lever in a small kitchen, not a
// detail.
export type DoorSwing = 'in-left' | 'in-right' | 'out' | 'sliding' | 'none';

export const DOOR_SWING_LABELS: Record<DoorSwing, string> = {
  'in-left': 'Swings in — hinge left',
  'in-right': 'Swings in — hinge right',
  out: 'Swings out (away from kitchen)',
  sliding: 'Sliding',
  none: 'No door leaf (open doorway)',
};

export function swingBlocksFloor(swing: DoorSwing): boolean {
  return swing === 'in-left' || swing === 'in-right';
}

// What a closed door leaf is doing visually.
//
// A closed door is NOT a hole — it's a surface, and it takes a finish
// from the catalogue like anything else. Modelling it as an empty
// aperture is why a rendered kitchen with a door in it looks like it
// opens onto a void.
export type DoorState = 'closed' | 'open' | 'doorway';

export const DOOR_STATE_LABELS: Record<DoorState, string> = {
  closed: 'Closed (shows the door leaf)',
  open: 'Open (shows through)',
  doorway: 'No door — open doorway',
};

// What's beyond the opening. Two INDEPENDENT axes, mirroring the
// appearance/optics split the finish system already uses:
//
//   backdropUrl  what you SEE through it — a photo of the actual view,
//                or a generic sky/balcony.
//   daylight     what it EMITS into the room.
//
// Most real openings want both: the image for the view, the light so
// the room brightens toward the window. A grey void reads as a
// rendering bug; a balcony photo reads as an actual flat, and it's the
// cheapest realism win available.
export type DaylightMode = 'sunlight' | 'diffuse' | 'artificial';

export const DAYLIGHT_MODE_LABELS: Record<DaylightMode, string> = {
  sunlight: 'Direct sunlight',
  diffuse: 'Diffuse daylight',
  artificial: 'Night / artificial outside',
};

export interface OpeningDaylight {
  enabled: boolean;
  mode: DaylightMode;
  // Multiplier on the mode's base intensity, so a shaded north window
  // and a blazing south one can share a mode.
  intensity: number;
  // Kelvin. This is not decoration: colour temperature shifts PERCEIVED
  // finish colour. A cool grey laminate signed off under 6500K studio
  // light looks beige under a warm 3000K interior, and that's a dispute
  // on site. Making the approval render carry the real temperature is
  // what prevents it.
  colorTempK: number;
}

export interface WallOpening {
  id: string;
  // Which wall it belongs to. WallOrientation doubles as the wall's
  // stable id because the room is a rectangle with exactly four walls
  // (see the room-shape decision recorded in lib/footprint.ts). If
  // skewed rooms ever arrive, walls gain real ids and this becomes one.
  wallId: WallOrientation;
  kind: OpeningKind;

  // Distance from the wall's START to the opening's near edge, measured
  // ALONG the wall.
  //
  // "Start" is the low-coordinate end, consistently: north and south
  // walls run along +x from x=0, east and west run along +y from y=0.
  // Same axis convention extentAlongWall uses in lib/surfaceAreas.ts,
  // deliberately — one rule for "along the wall" everywhere.
  offsetMm: number;
  widthMm: number;
  heightMm: number;
  // Height of the opening's BOTTOM edge off the floor. 0 for a door.
  // Same "bottom face off the floor" convention as elevationMm on
  // cabinets and appliances, so all four heights read the same way.
  sillMm: number;

  // Doors only.
  swing?: DoorSwing;
  doorState?: DoorState;
  // FK -> SurfaceFinish.id for a CLOSED door leaf. A flush laminated
  // door is a real finished surface; without this it renders as a grey
  // slab in an otherwise finished kitchen.
  leafFinishId?: string;
  // Per-door colour tweak on top of the finish, exactly as
  // PlacedCabinetItem.colorOverride works — for a SOLID finish it
  // replaces the colour, for a TEXTURED one it tints the image. Needed
  // for the same reason cabinets have it: a kitchen door is usually
  // painted to match the passage, not the kitchen, so it wants a
  // one-off colour rather than a whole catalogue row of its own.
  leafColorOverride?: string;
  // FK -> HandleSpec.id (types/front.ts) for the leaf's handle or knob.
  //
  // Reuses the CABINET handle catalogue on purpose. A door knob and a
  // cabinet knob are the same class of object bought from the same
  // supplier, and giving doors a parallel catalogue would mean
  // maintaining two lists of the same hardware.
  //
  // Not separately priced: when suppliedByUs is false the door is the
  // builder's, handle included, and when it's true unitPrice covers
  // the whole assembly. It's here to be SEEN.
  leafHandleId?: string;

  // Appearance beyond the opening.
  backdropUrl?: string;
  daylight?: OpeningDaylight;

  // Whether the kitchen business supplies this opening. Default FALSE:
  // the door and window are the builder's, already in place. False
  // means it subtracts tile area but adds nothing to the quote, and
  // prints as a specification line instead of a charge.
  suppliedByUs: boolean;
  unitPrice?: number; // ₹, only meaningful when suppliedByUs
}

// Standard sizes, so adding a door doesn't start as a 0x0. Indian
// residential norms: a 900x2100 kitchen door, and a window sill at
// counter height because that's where kitchen windows sit — above the
// worktop, which is exactly why they conflict with wall units.
export const DEFAULT_DOOR: Pick<WallOpening, 'widthMm' | 'heightMm' | 'sillMm'> = {
  widthMm: 900,
  heightMm: 2100,
  sillMm: 0,
};

export const DEFAULT_WINDOW: Pick<WallOpening, 'widthMm' | 'heightMm' | 'sillMm'> = {
  widthMm: 1200,
  heightMm: 1200,
  sillMm: 900,
};

export const DEFAULT_PASS_THROUGH: Pick<WallOpening, 'widthMm' | 'heightMm' | 'sillMm'> = {
  widthMm: 900,
  heightMm: 700,
  sillMm: 1000,
};

export function defaultSizeFor(kind: OpeningKind) {
  switch (kind) {
    case 'door':
      return DEFAULT_DOOR;
    case 'window':
      return DEFAULT_WINDOW;
    case 'pass-through':
      return DEFAULT_PASS_THROUGH;
  }
}

// Sensible daylight for a new opening, by which way the wall faces.
//
// This is where WallOrientation being a real compass point finally
// earns its keep rather than just being an id: in Delhi a south-facing
// window takes hard direct sun most of the year, a north one gets cool
// indirect light, and east/west swing through the day. Doors get no
// daylight by default — a kitchen door opens onto a passage, not
// outside.
export function defaultDaylightFor(
  kind: OpeningKind,
  wallId: WallOrientation
): OpeningDaylight {
  if (kind === 'door') {
    return { enabled: false, mode: 'diffuse', intensity: 0.6, colorTempK: 4000 };
  }

  switch (wallId) {
    case 'south':
      return { enabled: true, mode: 'sunlight', intensity: 1, colorTempK: 5200 };
    case 'north':
      return { enabled: true, mode: 'diffuse', intensity: 0.7, colorTempK: 6500 };
    case 'east':
    case 'west':
      return { enabled: true, mode: 'sunlight', intensity: 0.8, colorTempK: 4800 };
  }
}

export function createOpening(
  kind: OpeningKind,
  wallId: WallOrientation,
  offsetMm: number
): WallOpening {
  const size = defaultSizeFor(kind);
  return {
    id: crypto.randomUUID(),
    wallId,
    kind,
    offsetMm,
    ...size,
    // Sliding rather than in-swinging would be the kinder default for
    // clearance, but it would also hide a real constraint. An
    // in-swinging door is the common case in Indian flats, so it's the
    // honest default even though it's the one that produces warnings.
    swing: kind === 'door' ? 'in-right' : undefined,
    doorState: kind === 'door' ? 'closed' : undefined,
    daylight: defaultDaylightFor(kind, wallId),
    suppliedByUs: false,
  };
}
