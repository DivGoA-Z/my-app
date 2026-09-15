// src/lib/lighting3d.ts
//
// The numbers that make the room "look right", kept next to the
// reasoning for each one rather than scattered through Room3DCanvas as
// unexplained magic values.
//
// The room's light now comes from three real sources: an ambient fill,
// a directional "sun", and whatever the designer actually PLACED —
// window daylight (types/opening.ts) and light fixtures
// (types/fixture.ts). There is no longer any automatic lighting; see
// the note where the old under-cabinet fake used to live.

// Kept low — most of the room's illumination should come from the
// directional "sun" and the placed fixtures, not a flat fill.
// Too much ambient washes out the shadows that make the geometry read
// as a real room rather than a flat rendering.
export const AMBIENT_INTENSITY = 0.35;

// VIEWING LIGHT, not a sun — and the rename matters.
//
// This was a directional light at 1.6 intensity that CAST SHADOWS,
// standing in for daylight nobody had placed. It was the same fiction
// as the automatic under-cabinet lights: a room with no windows and no
// fixtures still had a hard-shadowed sun raking across it, and there
// was no way to switch it off because it wasn't data.
//
// It stays, because a physically dark room is useless to review — but
// it stays honestly, as an even viewing light that casts NO shadows.
// Shadows imply a real directional source, so they now come only from
// window daylight and (budget permitting) placed fixtures. The
// practical consequence is the one you'd expect: an empty room with no
// openings and no fixtures looks the same in all three lighting modes.
export const VIEW_LIGHT_INTENSITY = 1.15;
export const VIEW_LIGHT_COLOR = '#fdfaf5'; // near-neutral; warmth should come from real sources

// How far the base viewing light drops once real fixtures exist.
//
// Not zero: a kitchen lit only by four under-cabinet strips would be a
// dramatic photograph and a useless design review, with the whole
// upper half of the room in darkness. A quarter leaves enough to read
// the geometry while making the placed fixtures unmistakably the
// source of the light.
export const BASE_LIGHT_RECESSION = 0.25;
// Shadow map resolution — 1024 is plenty for a single small room and
// keeps this affordable on modest hardware; bump to 2048 only if
// shadow edges look visibly blocky on a large kitchen.
// Kept for the window daylight, which IS a real directional source and
// does cast.
export const SUN_SHADOW_MAP_SIZE = 1024;

// REMOVED: LED_COLOR / LED_INTENSITY / LED_DISTANCE_M and
// getLedStripPlacements(), which put a warm point light under EVERY
// elevated cabinet automatically.
//
// It looked like a feature and behaved like a bug. The light was
// derived from cabinet elevation rather than from any decision anyone
// made: it could not be moved, switched off, recoloured, or priced, and
// it appeared on cabinets nobody had specified lighting for. Every
// render approved before this was lit partly by hardware that did not
// exist and would never be installed — a quote-versus-render mismatch
// of exactly the kind this project keeps working to eliminate.
//
// Under-cabinet lighting is now a real LightFixture with a cabinet
// mount (types/fixture.ts, lib/fixtures.ts). It renders because someone
// placed it, and it costs money because it's real.

// ---- Daylight through openings ----

// Base intensity a window's daylight is multiplied against (its own
// `intensity` field is a multiplier on this). Deliberately stronger
// than VIEW_LIGHT_INTENSITY above: that light is a general even fill,
// while this one has to read as a bright source seen THROUGH a hole in
// a wall, competing with everything already lighting the room.
export const DAYLIGHT_BASE_INTENSITY = 3.2;

// How far behind the wall the view image sits, and how much larger than
// the opening it is drawn.
//
// Both matter, and getting either wrong looks like a different bug.
// Set the plane AT the wall and you lose all parallax — the view slides
// with your head like a sticker. Size it to the opening exactly and you
// see its edges the moment you look through at an angle, which reads as
// the image "peeling". A little depth plus generous overscan gives a
// convincing sense of a world outside for two triangles.
export const BACKDROP_DISTANCE_M = 0.6;
export const BACKDROP_OVERSIZE = 2.6;

// Black-body colour for a light's temperature in Kelvin, as an
// approximation good enough over the 2000-7000K range interiors
// actually use.
//
// This exists because colour temperature is not a cosmetic slider: it
// shifts how a finish READS. A cool grey laminate under 6500K studio
// light looks beige under 3000K, so a client who approves a colour in
// the render and gets a warmer kitchen on site sees the wrong colour —
// and that's a dispute, not a preference. Carrying the real temperature
// into the approval render is what avoids it.
//
// Piecewise linear rather than the full Planckian locus: three anchor
// points (warm incandescent, neutral, cool daylight) interpolated in
// RGB. Visually indistinguishable at these ranges and it needs no
// colour-science tables.
export function kelvinToColor(kelvin: number): string {
  const k = Math.max(2000, Math.min(7000, kelvin));

  // Anchors, hand-picked to look right under ACES tone mapping rather
  // than to be colorimetrically exact.
  const anchors: { k: number; rgb: [number, number, number] }[] = [
    { k: 2000, rgb: [255, 147, 41] },
    { k: 2700, rgb: [255, 197, 143] },
    { k: 4000, rgb: [255, 228, 206] },
    { k: 5000, rgb: [255, 244, 242] },
    { k: 6500, rgb: [227, 233, 255] },
    { k: 7000, rgb: [214, 225, 255] },
  ];

  let lo = anchors[0];
  let hi = anchors[anchors.length - 1];
  for (let i = 0; i < anchors.length - 1; i++) {
    if (k >= anchors[i].k && k <= anchors[i + 1].k) {
      lo = anchors[i];
      hi = anchors[i + 1];
      break;
    }
  }

  const span = hi.k - lo.k;
  const t = span === 0 ? 0 : (k - lo.k) / span;
  const channel = (index: 0 | 1 | 2) =>
    Math.round(lo.rgb[index] + (hi.rgb[index] - lo.rgb[index]) * t);

  const hex = (n: number) => n.toString(16).padStart(2, '0');
  return `#${hex(channel(0))}${hex(channel(1))}${hex(channel(2))}`;
}

// How far OUTSIDE the wall a window's light sits, and how far INSIDE
// the room it aims.
//
// The aim point matters more than it looks. Targeting the wall plane
// itself converges the cone on the wall and almost nothing reaches the
// floor — which reads as the opening glowing rather than as light
// entering. Aiming several metres into the room throws the cone across
// the floor, which is what a window actually does.
export const DAYLIGHT_STANDOFF_MM = 250;
export const DAYLIGHT_THROW_MM = 3500;

// Wide enough that the cone covers the whole opening from just outside
// it, rather than showing a visible circular pool on the floor.
export const DAYLIGHT_CONE_ANGLE_RAD = Math.PI / 2.4;

// How far a door handle stands off the leaf.
export const DOOR_HANDLE_PROJECTION_MM = 55;

// Door handles sit at about a metre off the floor — waist height —
// not at the middle of the leaf. On a standard 2100mm door the two are
// close enough that centring looks passable, but on a shorter or
// taller opening it doesn't, so it's placed from the floor.
export const DOOR_HANDLE_HEIGHT_MM = 1000;

// In from the swinging edge.
export const DOOR_HANDLE_EDGE_INSET_MM = 70;

// ---- Lighting mode ----

// The scene settings each LightingMode implies.
//
// Computed in one place so the 3D view can't apply "true colour"
// half-way — with fixtures neutralised but a warm window still casting
// orange across the floor, which was the exact failure that made three
// modes necessary instead of an on/off toggle.
export interface LightingEnvironment {
  ambientIntensity: number;
  viewLightIntensity: number;
  viewLightColor: string;
  // Whether placed fixtures emit light at all.
  fixtureLightsOn: boolean;
  // Whether fixture bodies GLOW. Off in 'fixtures-off' so the fitting
  // is still visible but visibly unlit — a switched-off light should
  // look switched off, not absent.
  fixtureEmissiveOn: boolean;
  // Whether a window's own colour temperature is honoured. In true
  // colour it is not: daylight goes white, because the point of the
  // mode is that nothing tints the finishes.
  daylightTinted: boolean;
  // Multiplier on window daylight, so true colour can flatten the
  // strong directional sun that would otherwise blow out one wall.
  daylightScale: number;
  // Whether REAL sources (window daylight, and fixtures if ever
  // promoted) cast shadows. The viewing light never does, whatever
  // this says.
  //
  // Shadows are what make a room read as real — and what makes a
  // finish hard to judge, since half of it ends up in shade.
  shadowsEnabled: boolean;

  // ---- Image-based environment ----
  //
  // These two were missing, and their absence was a real bug rather
  // than an omission. The <Environment> Lightformer panels in
  // Room3DCanvas were hardcoded and ungated, so they rendered
  // IDENTICALLY in all three modes while ambient and the viewing light
  // dutifully receded around them. Three consequences, all reported
  // from the app:
  //
  //   - An environment map is not occluded by geometry. The panels sit
  //     outside the walls, above the ceiling and below the floor, and
  //     light straight through all of them. Nothing shadows them.
  //   - They are asymmetric on purpose (a cool "window" on one side, a
  //     warm bounce on the other), which put a brightness and colour
  //     gradient across the ceiling that corresponds to nothing the
  //     designer placed.
  //   - Two of the four are TINTED, which meant 'true colour' — the
  //     mode whose entire purpose is that nothing tints the finishes —
  //     was tinting the finishes.

  // Multiplier on every Lightformer's intensity, so the environment
  // recedes alongside ambient and the viewing light once real fixtures
  // are doing the work.
  envIntensityScale: number;
  // Whether the panels keep their colours. False forces them white, so
  // true colour means true colour.
  envTinted: boolean;
}

// `hasPlacedLight` is the fix for the biggest complaint about this
// whole feature: placing lights didn't visibly light the room.
//
// The cause was simple arithmetic. Base ambient (0.35) plus a
// directional viewing light (1.15) plus the Environment's image-based
// lighting already illuminated everything, so a fixture adding a couple
// of units on top changed almost nothing you could see. The fixture's
// own body glowed — it's emissive and tone-mapping-exempt — which made
// it look like the light was working while the room stayed the same.
// "Lit up in itself but not lighting the room" was an exact
// description of the bug.
//
// So the base light now RECEDES once real sources exist. That's
// consistent with what it's for: it's a viewing floor for a room with
// nothing in it, not a light anyone specified. With no fixtures and no
// daylight it stays bright and flat — which is also what keeps all
// three modes looking the same on an empty room. Add a fixture and the
// base drops out of the way so the fixture is what you see.
export function lightingEnvironmentFor(
  mode: string,
  hasPlacedLight = false
): LightingEnvironment {
  switch (mode) {
    case 'fixtures-off':
      // Daylight only. The cheapest realistic configuration, which is
      // the point: it's what makes a walkthrough usable on a phone.
      return {
        ambientIntensity: AMBIENT_INTENSITY,
        viewLightIntensity: VIEW_LIGHT_INTENSITY,
        viewLightColor: VIEW_LIGHT_COLOR,
        fixtureLightsOn: false,
        fixtureEmissiveOn: false,
        daylightTinted: true,
        daylightScale: 1,
        shadowsEnabled: true,
        // Reduced, but not as far as true colour.
        //
        // My first pass left this at full strength on the reasoning
        // that with fixtures off the environment and the viewing light
        // are all there is. That reasoning was about ILLUMINATION and
        // missed the actual complaint, which was about REFLECTION: a
        // highlight visible on the ceiling in the one mode where
        // nothing is supposed to be switched on. Leaving it at 1 would
        // have fixed the other two modes and left the reported one
        // untouched.
        //
        // 0.6 keeps the room comfortably lit (ambient and the viewing
        // light are both at full strength here) while roughly halving
        // what glossy surfaces mirror. Raise it back toward 1 if an
        // unlit walkthrough now reads too flat.
        envIntensityScale: 0.6,
        envTinted: true,
      };

    case 'true-colour':
      // A flat, even, WHITE wash. High ambient, weak neutral sun, no
      // shadows, no tint from anywhere.
      //
      // This is a measurement mode, not a pretty one, and it should
      // look deliberately flat — anything atmospheric here would be
      // reintroducing the very bias it exists to remove. A cool grey
      // laminate signed off under 3000K gets ordered wrong; this is
      // where you check the colour.
      return {
        ambientIntensity: 1.15,
        viewLightIntensity: 0.55,
        viewLightColor: '#ffffff',
        fixtureLightsOn: false,
        fixtureEmissiveOn: false,
        daylightTinted: false,
        daylightScale: 0.35,
        shadowsEnabled: false,
        // Dim AND untinted. Not zero: with no environment at all,
        // gloss and matte become indistinguishable, and telling a
        // high-gloss acrylic from a matte laminate is half of what this
        // mode is for. Low enough that the panels no longer paint a
        // gradient, present enough that a sheen still reads.
        envIntensityScale: 0.3,
        envTinted: false,
      };

    case 'designed':
    default:
      return {
        // Dimmed hard when the designer has placed real light, so
        // their fixtures are the thing doing the lighting. Left bright
        // when they haven't, so an unlit room is still reviewable.
        ambientIntensity: hasPlacedLight
          ? AMBIENT_INTENSITY * BASE_LIGHT_RECESSION
          : AMBIENT_INTENSITY,
        viewLightIntensity: hasPlacedLight
          ? VIEW_LIGHT_INTENSITY * BASE_LIGHT_RECESSION
          : VIEW_LIGHT_INTENSITY,
        viewLightColor: VIEW_LIGHT_COLOR,
        fixtureLightsOn: true,
        fixtureEmissiveOn: true,
        daylightTinted: true,
        daylightScale: 1,
        shadowsEnabled: true,
        // Recedes with everything else once real light is placed. This
        // is the line that was missing: ambient and the viewing light
        // already stepped back for placed fixtures, the environment did
        // not, so it became the dominant source by default and a
        // pendant appeared to light nothing.
        envIntensityScale: hasPlacedLight ? BASE_LIGHT_RECESSION : 1,
        envTinted: true,
      };
  }
}

// ---- Placed fixtures ----

// Base intensity a fixture's lumens are scaled against.
//
// Lumens are a real photometric unit and three.js intensity is not, so
// this is a conversion factor chosen by eye rather than by physics: a
// 1000-lumen strip should light a counter convincingly without blowing
// out the countertop's specular highlight.
// Lumens -> three.js intensity, calibrated for INVERSE-SQUARE falloff.
//
// Recalibrated when fixtures stopped using decay=0 (see
// FIXTURE_LIGHT_DECAY below). With real falloff the number means
// something different: it's now candela-like, divided by distance
// squared at the surface being lit. A 1000lm strip 500mm above a
// counter lands at roughly 3 in linear terms against a receded base of
// about 0.375 — call it eight times the ambient, which is what a task
// light actually looks like.
// Raised from 1/400, PAIRED with the emissive drop below — the two
// belong together and moving either alone is what made this constant
// churn before.
//
// The request behind it: "make its brightness low but throwing light
// out higher." That is not one dial, it is two, and they had been
// conflated. A real fitting's diffuser is only modestly bright to look
// at; what it does is put light on things. Rendering it the other way
// round — a blazing bar that lit almost nothing — is why placed
// fixtures kept reading as decals.
export const FIXTURE_LUMEN_SCALE = 1 / 240;

// Physical inverse-square falloff for placed fixtures.
//
// This was 0, and that was the single reason placing a light never
// appeared to light anything.
//
// decay=0 removes distance attenuation entirely, so every surface
// within a light's reach receives IDENTICAL illumination. The room came
// out perfectly flat: no pool under a strip, no falloff from a pendant,
// no gradient anywhere — and with a ceiling pendant flooding the whole
// room at constant intensity, an additional flat contribution from a
// strip was arithmetically invisible. The fixture's emissive body
// glowed, so it looked like a working light that lit nothing, which is
// exactly what it was.
//
// I chose 0 to make intensity independent of the renderer's
// physically-correct-lights setting. That was the wrong trade: it
// bought predictable numbers at the cost of light having any shape at
// all.
export const FIXTURE_LIGHT_DECAY = 2;

// Window daylight KEEPS decay=0, and the difference is principled
// rather than an oversight.
//
// Sunlight has no meaningful inverse-square falloff across a four-metre
// room — the source is 150 million kilometres away, so the far wall and
// the near wall receive the same irradiance. A 5-watt LED strip 300mm
// from a counter is the opposite case. Giving them the same falloff
// model would make one of them wrong.
export const DAYLIGHT_DECAY = 0;

// How many point samples a LINEAR fixture is rendered with.
//
// One light at the midpoint of a 2.4m run was tolerable while nothing
// fell off; with real falloff it hotspots in the middle and leaves the
// ends dark, because a strip is a LINE source being faked with a point.
// Sampling along the run fixes that, and the count scales with the
// device budget rather than being fixed — a phone gets one, a laptop
// three. Intensity is divided between samples so total output is
// unchanged.
export const LINEAR_SAMPLES_BY_QUALITY: Record<string, number> = {
  low: 1,
  auto: 3,
  all: 6,
};

// How far a DIFFUSE fixture's light origin stands off the surface it is
// fixed to, in millimetres. The body does not move — only the sampled
// light origins do.
//
// This is the fix for "three light sources inside one strip". The cause
// was geometric rather than a bad sample count: a point light 60mm from
// a wall (WALL_STANDOFF_MM in lib/fixtures.ts) lights a pool about 60mm
// across, because illuminance falls as 1/r² and r is dominated by that
// 60mm. Samples 430mm apart along a 2.4m run therefore land as
// discrete, obviously separate blobs, and NO affordable number of them
// closes the gap — merging pools 60mm wide across 2.4m would take forty
// lights.
//
// Standing the origins off the surface widens each pool to roughly the
// standoff distance, so at 350mm they overlap at the ~430mm spacing six
// samples give and read as one continuous band.
//
// The same trick, for the same reason, as FIXTURE_ORIGIN_STANDOFF_M
// below — that one exists because an AIMED light at its own body has
// nowhere to throw. Both are approximations of an area source using
// point primitives.
//
// The honest alternative is three.js RectAreaLight, which IS a
// rectangular emitter and would need no sampling at all. It is not used
// here because it requires RectAreaLightUniformsLib.init() at startup
// and renders BLACK without it, and that is not a change to make
// untested.
export const DIFFUSE_ORIGIN_STANDOFF_MM = 350;

// Below this length a run is a point for all practical purposes and
// sampling it twice just costs a light.
export const LINEAR_SAMPLE_MIN_LENGTH_MM = 700;

// How far a fixture's light reaches. Deliberately short for task
// lighting — an under-cabinet strip that lit the whole room would read
// as a ceiling light in the wrong place.
export const FIXTURE_LIGHT_DISTANCE_MM = 3200;

// Emissive brightness of the fixture body itself. Enough to read as
// "this is lit" under ACES tone mapping without becoming a white blob
// that hides the profile it's mounted in.
// The fixture body's glow.
//
// Raised, but the important change is at the call site: the body is now
// TONE MAPPED like everything else. It was rendering with
// toneMapped={false}, which exempted it from the scene's exposure curve
// — so it displayed at full brightness no matter how dark or bright the
// room was. That is the mechanical reason a fixture could look
// blazing while contributing nothing: the body bypassed the same
// exposure the light it cast had to pass through.
//
// Tone mapped, an emissive of 2.6 still reads clearly as a source
// against a lit room, and — the point — reads DIMMER when the light is
// off or the room is bright, which is the honest behaviour.
// Dropped from 2.6. At that value the body clipped to flat white under
// ACES, which destroyed the profile it is mounted in and made three
// sampled point lights read as three separate lamps rather than one
// strip — a blown highlight has no shape for the eye to join up.
export const FIXTURE_EMISSIVE_INTENSITY = 1.0;

// How far AHEAD of its own body an aimed fixture's light sits, in
// metres.
//
// A spot light at the fixture's exact position has nowhere to throw:
// an under-cabinet strip is 12mm from the carcass and a plinth strip
// 60mm off the floor, so the cone hits geometry before it can open and
// lights a patch too small to see. That is precisely why those two
// looked like they glowed without illuminating anything while a pendant
// hanging in mid-air worked — the pendant had two metres of clear air.
//
// 220mm is enough for the cone to spread across a counter or a floor
// without the light visibly detaching from the fitting it belongs to.
export const FIXTURE_ORIGIN_STANDOFF_M = 0.22;

// ---- Scene exposure ----

// A viewing brightness control, applied as the renderer's tone-mapping
// exposure.
//
// This exists because the wrong thing kept being used as a brightness
// dial. Lumens is the obvious candidate and is exactly the wrong one:
// it is SPEC DATA that prints on the quote, so typing 3000lm to make a
// render look right leaves a schedule describing a product nobody is
// buying. And FIXTURE_LUMEN_SCALE is a renderer calibration constant
// that should be set once and left — the fact that it moved three
// times was a symptom of it absorbing feedback that belonged elsewhere.
//
// Exposure is neither. It changes NO design data: no lumens, no colour
// temperature, no price, nothing that reaches the quote. It just says
// how bright the picture should be — which genuinely varies by room, by
// screen and by taste, and so genuinely belongs to the person looking.
export const DEFAULT_EXPOSURE = 1.1;

// Roughly -1.5 to +1.2 stops around the default. Wide enough to rescue
// a dark render or tame a blown-out one, narrow enough that neither end
// is useless.
export const MIN_EXPOSURE = 0.4;
export const MAX_EXPOSURE = 2.5;

export function clampExposure(value: number): number {
  if (!Number.isFinite(value)) return DEFAULT_EXPOSURE;
  return Math.min(MAX_EXPOSURE, Math.max(MIN_EXPOSURE, value));
}

// Exposure expressed in stops relative to the default, for display.
// Photographers think in stops and it reads better than "1.37" — each
// stop is a doubling, so +1.0 is twice the light.
export function exposureToStops(exposure: number): number {
  return Math.log2(clampExposure(exposure) / DEFAULT_EXPOSURE);
}
