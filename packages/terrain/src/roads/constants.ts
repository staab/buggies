import type { Road } from '../types.ts'

/**
 * The numbers the road generator runs on: widths, grades, clearances, costs and
 * counts, gathered here so that every stage reads the same ones.
 */

/**
 * How far the carriageway sits above the centreline a road is recorded on.
 * Both the mesh that gets drawn and the surface that gets driven on have to
 * agree about this, or vehicles ride buried in the road or float over it.
 */
export const ROAD_SURFACE = 0.2

/**
 * How far past the carriageway the shoulder reaches as it falls back to the
 * ground. Shared for the same reason: an edge the mesh ramps over and the
 * surface treats as a step is a step vehicles get thrown off.
 */
export const ROAD_SKIRT = 3

/** Road structure codes stored in a road's `structure` array. */
export const ROAD_GRADE = 0

export const ROAD_BRIDGE = 1

export const ROAD_TUNNEL = 2

/** Internal classification of a highway sample before it becomes a structure code. */
export const KIND_BRIDGE = 1

export const KIND_TUNNEL = 2

/** Highway carriageway width, in world units. */
export const ROAD_WIDTH = 16

/** Control points are strung together with this spacing between samples. */
export const SAMPLE_STEP = 6

/** Steepest the finished surface may be, vertical units per horizontal unit. */
export const MAX_ROAD_GRADE = 0.06

/**
 * How sharply a road's grade may change, per metre travelled: the vertical
 * curve at every crest and sag. A car at speed feels a grade change as
 * acceleration, `speed² × curvature`, and an abrupt one bottoms the
 * suspension in a sag or throws the car off the road at a crest. Six percent
 * over ten metres is 0.4g at 90km/h; a ramp, driven slower, may bend twice
 * as hard.
 */
export const MAX_ROAD_CURVATURE = 0.006

export const MAX_RAMP_CURVATURE = 0.012

/** Ramps are short and may climb more steeply than the highway they serve. */
export const MAX_RAMP_GRADE = 0.15

/** The deck rides this far above the ground on an embankment. */
export const DECK_HEIGHT = 3

/** Bridges clear the water surface by this much. */
export const BRIDGE_CLEARANCE = 4

/** A surface this far below the ground is a tunnel rather than a shallow cutting. */
export const TUNNEL_DEPTH = 1

/** World units around a sample probed for water, wide enough to catch a river ribbon. */
export const WATER_PROBE_RADIUS = 3

/** Points on the ring road drawn around a lone city. */
export const RING_POINTS = 8

/** A city-loop corner wider than this can be bowed; sharper needs a stadium or offset. */
export const BOW_ANGLE = 30

/** How far the run between two cities bows outward, as a fraction of its length. */
export const BOW_FRACTION = 0.3

/** The rebuilt loop turns on at least this fraction of the smallest city radius. */
export const TURN_RADIUS_FRACTION = 0.8

/** Points used to trace each stadium end. */
export const STADIUM_SEGMENTS = 8

/** One-lane ramp width, in world units. */
export const RAMP_WIDTH = 8

/** Cross road width at an interchange, in world units. */
export const CROSS_WIDTH = 12

/** Distance along the highway between interchanges, in world units. */
export const INTERCHANGE_SPACING = 800

/** How far either way a candidate may slide to find dry, water-free ground. */
export const INTERCHANGE_SEARCH = 150

/** Most the ground may rise or fall across a crossing before it is rejected. */
export const CROSS_RELIEF = 10

/** Distance along the highway from the underpass to each ramp's highway end. */
export const RAMP_ALONG = 80

/** Distance along the cross road from the underpass to each ramp's far end. */
export const RAMP_REACH = 40

/**
 * The radius of the one bend a ramp makes: from under the deck's edge it
 * turns out through this arc and then runs straight to the cross road, so
 * it is never steeper across than the diagonal itself, where a curve that
 * swung out and back square to the cross road would have to be.
 */
export const RAMP_TURN_RADIUS = 40

/**
 * A ramp's surface runs this far below the deck's where it lies under the
 * deck, so the deck is drawn over it and a car rolls off the deck's edge
 * onto it without the two fighting for the same height.
 */
export const RAMP_UNDER_DECK = 0.05

/** How far along a ramp its lane may still lie under or against the deck it leaves. */
export const RAMP_LANE_REACH = 45

/**
 * Half-length of the cross road either side of the underpass: past the
 * ramps' landings, out to where the arterials take over. Held where it was
 * when the ramps landed further out, since the sites judged fit for an
 * interchange and the arterial network are both laid out from it.
 */
export const CROSS_REACH = 56

/** Highway length either side of an underpass drawn as bridge deck. */
export const UNDERPASS_SPAN = 30

/**
 * Two interchanges closer than this along the highway would run their ramps and
 * bridge decks into each other, so no two are ever placed within it.
 */
export const INTERCHANGE_CLEAR = 2 * (RAMP_ALONG + UNDERPASS_SPAN)

/** The bridge deck clears the cross road by at least this much. */
export const UNDERPASS_CLEARANCE = 2.5

/** Most a ramp may drop from the deck to the cross road, so it stays drivable. */
export const RAMP_DROP = 7

/**
 * Headroom a site is chosen with. The deck a site is judged against is the one
 * the highway comes to before any crossing has had a say; raising a neighbour
 * for its own underpass can lift this one a little further through the grade
 * limit, and a site picked right on the limit would then fail to be built.
 */
export const RAMP_DROP_HEADROOM = 1

/** Terrain is cut this far below an at-grade road so the ribbon stays clear. */
export const CUT_CLEARANCE = 0.6

/** A cut slope rises this much per horizontal unit away from the road edge. */
export const CUT_SLOPE = 0.4

/** Points used to trace each ramp curve. */
export const RAMP_SEGMENTS = 24

/**
 * A ramp holds the deck's level for this far before it starts down: long
 * enough for its lane to have come right out from under the deck's edge,
 * so a car leaves the deck onto ground level with it, and the ramp only
 * descends once it has pulled clear of the highway.
 */
export const RAMP_PLATEAU = 26

/**
 * How far back from a ramp's highway end the deck must stand on the ground
 * for an interchange to be sited there: the plateau and then some, so the
 * ramp has a shoulder to leave onto however long it runs level.
 */
export const RAMP_MOUTH_GROUND = 28

/** Arterial road width, in world units. */
export const ARTERIAL_WIDTH = 10

/** Arterials climb more than highways but must never feel very steep. */
export const MAX_ARTERIAL_GRADE = 0.08

/**
 * A mountain road: a winding climb from an arterial up a mountainside,
 * traversing the slope at this grade and held to the steeper one. Where the way is barred the road turns back in a
 * hairpin: half an ellipse this far up the slope, carrying on along it
 * as far as lets the road climb the difference at grade, from these
 * choices, allowing the ground to stand this much above or below the
 * road where the loop ends, and refusing any that would stand it further
 * than this.
 */
export const CLIMBS_MOST = 1
export const CLIMB_WIDTH = 8
export const CLIMB_GRADE = 0.13
export const MAX_CLIMB_GRADE = 0.15
export const CLIMB_STEP = 6
export const CLIMB_HAIRPIN = {
  up: 20,
  outs: [12, 16, 20, 25, 30, 36],
  samples: 10,
  mismatch: 3,
  misfit: 6,
} as const
/**
 * Where a climb ends: this far below the peak, or wherever it can go no
 * further having risen at least this much, cut back to the highest point
 * where the ground (read this far across) falls away at least this
 * steeply, for the view, and no more than this, for the parking, and no
 * other road is within this.
 */
export const CLIMB_END = { belowPeak: 25, rise: 50, steepLeast: 0.15, steep: 0.45, across: 15, roadKeep: 30 } as const
/**
 * The lot a climb ends in: the road runs this far into it along its width
 * and this far in from its uphill edge, level from where it enters, and
 * the ground is blended back to the lot's level this far out from its
 * edges. Its valley side is whichever side of the road's end the ground,
 * this far out, has fallen at least this far below the road: the view. No
 * earlier turn of the road may lie within it, but for its last stretch,
 * this long.
 */
export const CLIMB_LOT = { width: 30, depth: 20, roadAlong: 15, roadIn: 5, blend: 8, look: 30, drop: 3, approach: 30 } as const
/** Ground no steeper than this many times the grade is climbed straight up rather than traversed, and ground steeper than this is a cliff no road goes on. */
export const CLIMB_STRAIGHT = 1.4
export const CLIMB_STEEPEST = 2.2
/** How far across the ground its lie is read for the road's direction, so that the road pays no mind to bumps smaller than this. */
export const CLIMB_LOOK = 12
/** How much of the road's parting from the ground a leg makes up each step, never turning down the slope past this share of the step to do so. */
export const CLIMB_STEER = 0.3
export const CLIMB_DIP = 0
/** The turns tried, in order, to get round something in the way on gentle ground. */
export const CLIMB_TURNS = [Math.PI / 6, -Math.PI / 6, Math.PI / 3, -Math.PI / 3, Math.PI / 2, -Math.PI / 2] as const
/** How far a climb keeps from its own earlier legs, all but the stretch this far behind it, and the last hairpin with the stretch this far into it until this far past it. */
export const CLIMB_SELF_KEEP = { apart: 12, behind: 40, into: 12, after: 60 } as const
/** The climb is given up past this length or this many hairpins. */
export const CLIMB_MOST_LENGTH = 3000
export const CLIMB_MOST_HAIRPINS = 20
/**
 * Where a climb may start: arterial points this near the peak and this far
 * below it, trying this many, this far apart, and each metre the bank
 * rises off the arterial counting as this many metres further off. The
 * road is level with the arterial until this far out, pays other roads no
 * mind until this far, and leaves the arterial at least this angle off it
 * for this long.
 */
export const CLIMB_START = {
  reach: 400,
  below: 50,
  tries: 4,
  apart: 80,
  level: 14,
  clear: 100,
  leave: 20,
  cos: Math.cos((35 * Math.PI) / 180),
  sin: Math.sin((35 * Math.PI) / 180),
  bankCost: 20,
} as const
/** A stream is crossed straight over where its far bank is within this many steps. */
export const CLIMB_FORD = { steps: 6 } as const
/** How far a climb keeps from every other road once it has left the arterial it starts from. */
export const CLIMB_ROAD_KEEP = 24

/** Water steps may rise a little faster than the road, as a bridge approach does. */
export const ARTERIAL_BRIDGE_GRADE = 0.16

/** Bridge deck clears the water by this much. */
export const ARTERIAL_BRIDGE_CLEARANCE = 2

/** Spacing of the navigation grid arterials are routed on, in world units. */
export const ARTERIAL_GRID = 32

/** How close a road may come before routing treats the cell as blocked. */
export const ARTERIAL_HIGHWAY_AVOID = 30

/** Narrower berth for ramps and cross roads, so arterials can leave their ends. */
export const ARTERIAL_ACCESS_AVOID = 16

/** Cost weights for the arterial routing search. */
export const ARTERIAL_SLOPE_COST = 24

export const ARTERIAL_WATER_COST = 8

/** Open sea costs far more than a river, so bridges stay rare. */
export const ARTERIAL_SEA_COST = 400

/** Cap on cells a single A* may expand, so a bad map can never hang. */
export const ARTERIAL_MAX_EXPANSIONS = 40000

/** Charged per road already occupying a cell, so roads repel each other. */
export const ARTERIAL_DENSITY_COST = 50

/** Charged for leaving the lens when a dead-end repair needs a detour. */
export const ARTERIAL_LENS_COST = 80

/** Effectively blocks a cell when a route has to be retried around a clash. */
export const ARTERIAL_BLOCK_COST = 1e6

/** Spacing of the field nodes the network links, in world units. */
export const ARTERIAL_FIELD_SPACING = 300

/** How many nearest neighbours each node links to before loop filling. */
export const ARTERIAL_NEIGHBOURS = 2

/** Most arterial roads drawn per map. */
export const ARTERIAL_MAX_COUNT = 40

/** Distance between finished arterial samples, in world units. */
export const ARTERIAL_STEP = 24

/** Route cells between spline waypoints; larger means longer, smoother curves. */
export const ARTERIAL_WAYPOINT_STRIDE = 4

/** Sharpest corner left in a finished arterial, and the fillet used to round it. */
export const ARTERIAL_MAX_TURN = (12 * Math.PI) / 180

export const ARTERIAL_MIN_RADIUS = 40

/**
 * Two arterials leaving one junction closer together than this run side by side
 * instead of parting, and their carriageways smear into a single blob.
 */
export const ARTERIAL_MIN_JUNCTION_ANGLE = Math.PI / 4

/** Within this of its own ends an arterial is joining a junction and may touch it. */
export const ARTERIAL_MERGE_REACH = CROSS_REACH

/** A road still turning sharper than this after smoothing is dropped entirely. */
export const ARTERIAL_PRUNE_TURN = (30 * Math.PI) / 180

/**
 * Junction alignment is reverted if it leaves a bend sharper than this, over
 * the window turns are judged in: as sharp as a road is allowed to be at all.
 */
export const ARTERIAL_JUNCTION_TURN = (30 * Math.PI) / 180

/** Cap on samples in one arterial, so fillets cannot explode the geometry. */
export const ARTERIAL_MAX_POINTS = 400

export const ARTERIAL_SALT = 0x51a2

/** The ground is shaped to a surface road over this much beyond its carriageway. */
export const SURFACE_SHOULDER = 9

/** Turn is judged between samples at least this far apart, so dense fillet samples cannot hide a hairpin. */
export const TURN_WINDOW = 3

/** City street width, in world units. */
export const STREET_WIDTH = 10

/**
 * How far from a city street's centreline the blocks' lots begin, and what a
 * block keeps clear of the street: the kerb of the narrow street the blocks
 * were laid out against. The street has since been widened over the old
 * pavement, and the sidewalk now runs from the carriageway's edge in under
 * the buildings' fronts, so nothing in a block has had to move.
 */
export const STREET_KERB = 3

/** Spacing between city streets and the step along them, in world units. */
export const STREET_SPACING = 48

export const STREET_STEP = 12

/** Clear ground kept between a street and the edge of a highway or ramp. */
export const STREET_CLEARANCE = ROAD_WIDTH

/** A street has to span a block to be worth drawing, so runs are this long. */
export const STREET_MIN_POINTS = Math.round(STREET_SPACING / STREET_STEP) + 1

/**
 * A street that runs into an arterial shallower than this does not read as a
 * junction: the two ribbons overlap along their length and smear into a single
 * road. Anything squarer than this is a normal crossing and is left alone.
 */
export const STREET_ARTERIAL_ANGLE = Math.PI / 4

/**
 * How close a street may come to an arterial's centreline: any nearer and the
 * two carriageways overlap, which is the smear itself. Trimming back to exactly
 * here leaves the street touching the arterial, so a shallow meeting still
 * reads — and still counts — as a junction onto it.
 */
export const STREET_ARTERIAL_TOUCH = (ARTERIAL_WIDTH + STREET_WIDTH) / 2

/** Cell size of the grid road segments are bucketed into, in world units. */
export const SEGMENT_CELL = 32

/**
 * A bridge deck gets shoulders like an embankment where the ground beside it
 * comes within this of its surface: a ramp leaves the deck across them. Less
 * than an underpass's clearance, so a deck over a cross road never hangs its
 * shoulders down across the road beneath.
 */
export const BRIDGE_SHOULDER_DROP = 1

/**
 * Make the ground and the surface roads agree. The ground is shaped to the
 * roads, the roads are read back off it, and their grade limits are imposed
 * again: where two roads cross at different heights the ground takes the mean,
 * and the limit then spreads the difference back along each road instead of
 * leaving it as a step. A few times round is enough for the two to settle;
 * each round leaves a smaller kink where roads cross.
 */
export const SETTLE_PASSES = 4
