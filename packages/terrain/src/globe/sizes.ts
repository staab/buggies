/**
 * The sizes, spacings and odds of everything that stands on a planet's land.
 */

export const BUILDING_SALT = 0x6b1d
/** Ground kept clear between a street's edge and the lots along it. */
export const SIDEWALK = 2
/** How far in from the street's edge the sidewalk reaches, under the fronts of the buildings. */
export const SIDEWALK_BAND = 2
/**
 * The most the ground under a sidewalk may rise or fall: across its band,
 * and from one sample to the next along it. A slab over steeper ground would
 * stand off it like a wall, so such a side is left out.
 */
export const SIDEWALK_CROSS_RELIEF = 0.35
export const SIDEWALK_ALONG_RELIEF = 0.5
export const SIDEWALK_SAMPLE = 4
/** No lot narrower than this: a block is cut into as many lots as leave each this wide. */
export const LOT_MIN = 9
/** A building stands this far inside its lot at most, on each side. */
export const LOT_INSET = { min: 0.5, max: 3.5 } as const
/** An open lot is this often a parking lot rather than a park. */
export const PARKING_LOT_ODDS = 0.35
/** Street trees along the sidewalks, this far apart, this big: the trunk on the sidewalk and the crown over the street. */
export const STREET_TREE_SPACING = 14
export const STREET_TREE_RADIUS = { min: 1.6, max: 2.2 } as const
export const STREET_TREE_HEIGHT = { min: 6, max: 8 } as const
/** Trees along the shoulder of the main roads through a city, this far from the road, this far apart. */
export const CITY_VERGE_SETBACK = 5.5
export const CITY_SHOULDER_SPACING = 12
/** How thickly the ground an interchange's ramps enclose is planted, per hundred square meters. */
export const INTERCHANGE_TREES = 0.6
export const INTERCHANGE_SHRUBS = 0.9
/** Lots left as parks, one in this many. */
export const PARK_LOT_ODDS = 7
/**
 * Props, the furniture a car can knock about, no more than this many to a
 * planet: barrels stacked this many deep beside a gas station's shop, and
 * crates this many along the strip outside a building site's fencing.
 */
export const PROPS_MOST = 250
export const PROP_SALT = 0x5a1d
export const STATION_BARRELS = 4
export const SITE_CRATES = 3
/**
 * The city square: the first open lot this near the heart of a city is
 * paved over, with a fountain in the middle, its basin this wide and this
 * high; one to a city. Statues stand on plinths this wide and this tall,
 * one in the middle of every park big enough to hold one this far in from
 * its edges, and one on the shoulder where an arterial comes into a city,
 * this far beyond the shoulder trees' line.
 */
export const SQUARE_CORE = 0.55
export const FOUNTAIN = { width: 8, height: 1 } as const
export const STATUE = { width: 2, height: 2.5, parkInset: 6, shoulderOut: 1.5 } as const
/**
 * The clock tower: one to a city, on the block lot nearest the city's
 * center within this reach of it, which it takes over: this wide, this
 * tall, and standing at least this far above every block within this.
 */
export const CLOCK_TOWER = { reach: 60, width: 10, height: 60, over: 10, lookout: 100 } as const
export const SITE_CORE = 0.45
export const SITE_ODDS = 0.35
export const SITES_MOST = 3
export const FENCE_INSET = 1
export const FENCE_HEIGHT = 2.5
export const CRANE_BASE = 3
export const CRANE_OVER = 12
export const CRANE_REACH = 50
export const CRANE_HEIGHT_LEAST = 30
/** Stories are this tall, and every building is a whole number of them. */
export const STORY = 3
/** A block's building is at least this tall, and this much taller again at random. */
export const BLOCK_HEIGHT = { min: 9, spread: 12 } as const
/**
 * The tallest a building rises over that at the heart of a city. It falls off
 * toward the edge, steeply, so the skyline is a cluster of towers in the
 * middle over a spread of mid-rise blocks.
 */
export const TOWER_HEIGHT = 96
/** A tower in the heart of a city is at least this fraction of its full rise. */
export const TOWER_FLOOR = 0.4
/** A footprint is buried this far below the lowest ground under it, so no corner hangs in the air. */
export const BURY = 1
/** Ground that rises more than this across a footprint is too steep to build on. */
export const BLOCK_RELIEF = 4
export const HOUSE_RELIEF = 2.5
/** Every building keeps this clear of any road. */
export const ROAD_MARGIN = 1.5
/**
 * And this far off a tunnel's centerline: the shell around a bore is built
 * far thicker than it is drawn, to roof over the ground cut away around the
 * bore, and near a portal it stands out of the hillside, so nothing is
 * planted where it would be buried in it.
 */
export const TUNNEL_KEEP_OUT = 20
/** And this clear of any other building. */
export const BUILDING_GAP = 1
/** Houses along a suburb's arterials: how far apart, how far from the road's edge, and how big. */
export const SUBURB_SPACING = { min: 15, max: 22 } as const
export const HOUSE_SETBACK = { min: 5, max: 9 } as const
export const HOUSE_WIDTH = { min: 8, max: 12 } as const
export const HOUSE_DEPTH = { min: 7, max: 10 } as const
export const HOUSE_HEIGHT = { min: 3.5, max: 6.5 } as const
/** A cottage is small and low under a steep roof; a villa is broad, and two stories. */
export const COTTAGE_WIDTH = { min: 6, max: 8.5 } as const
export const COTTAGE_DEPTH = { min: 5, max: 7 } as const
export const COTTAGE_HEIGHT = { min: 3, max: 3.6 } as const
export const VILLA_WIDTH = { min: 11, max: 14 } as const
export const VILLA_DEPTH = { min: 9, max: 12 } as const
export const VILLA_HEIGHT = { min: 6, max: 7.5 } as const
/** Which style a house is, by the luck of the draw: the plain one half the time, the others a quarter each. */
export const HOUSE_STYLES: readonly ('house' | 'cottage' | 'villa')[] = ['house', 'house', 'cottage', 'villa']
/**
 * As often as not a planet has an observatory, one at most, on a mountain
 * top: a round tower this wide and this tall over the peak, on ground no
 * more uneven than this across it.
 */
export const OBSERVATORY_ODDS = 0.5
export const OBSERVATORY_SALT = 0x0b5e_4a70
export const OBSERVATORY_SIZE = 12
export const OBSERVATORY_HEIGHT = 11
export const OBSERVATORY_RELIEF = 8
/**
 * The pyramid: tiers this tall, the first the tallest, each set this far in
 * from the edges of the one below and the top this wide, so the base is
 * as wide as all of it. A tunnel this wide and this high runs through the
 * first tier one way; the other way, a straight ramp this long runs up
 * either side from the ground to the top, over the ledges between. The ground is leveled under it and this far around,
 * blended back to the land over this much more, or this many times as
 * far as the land rises and falls across it if that is more, and the site is looked
 * for this many times, on country ground that rises and falls no more than
 * this across it, or failing that no more than this.
 */
export const PYRAMID = {
  tiers: [8, 5, 5, 5],
  ledge: 10,
  top: 16,
  tunnel: { width: 14, height: 6 },
  ramp: 60,
  apron: 36,
  blend: 12,
  tries: 400,
  relief: [8, 16],
  easing: 5,
} as const
export const FARMS_MOST = 5
export const FARM_TRIES = 150
/** Farms keep this far from one another, so they do not bunch up. */
export const FARM_APART = 200
/** How far apart two barns stand, at the least. */
export const BARNS_APART = 160
export const FIELDS_PER_FARM = { min: 2, max: 4 } as const
export const FIELD_LENGTH = { min: 45, max: 75 } as const
export const FIELD_WIDTH = { min: 28, max: 45 } as const
export const FIELD_GAP = 3
export const FIELD_RELIEF = 8
export const FIELD_ROAD_MARGIN = 4
export const HEDGE_SPACING = 3.5
/** How far outside the crop the hedge stands: a shrub's width, so it does not sit in the field it hedges. */
export const HEDGE_OUT = 1.9
export const BARN = { width: 14, depth: 9, height: 6.5 } as const
/** How far past the end of the row the barn stands: beyond the hedge, with room to walk around. */
export const BARN_OFF = 6
export const SILO = { radius: 2.4, height: 9 } as const
export const SILOS = { min: 1, max: 2 } as const
export const SILO_RELIEF = 5
/**
 * One wind farm a planet, if the open country has room for a line of
 * turbines this far apart, at least this many of them, each a tower this
 * wide and tall standing on ground no more uneven than this.
 */
export const WIND_FARM_TRIES = 120
export const TURBINES = { min: 5, max: 7 } as const
export const TURBINES_LEAST = 4
export const TURBINE_SPACING = 48
export const TURBINE = { radius: 1.3, height: 42 } as const
export const TURBINE_RELIEF = 6
export const TURBINE_ROAD_MARGIN = 6
export const TURBINE_GAP = 8
/**
 * One ring of standing stones a planet, on the highest open ground of
 * this many tries: this many stones around a ring this wide, each this big.
 */
export const STONES_TRIES = 120
export const STONES = 12
export const STONE_RING = 14
export const STONE = { width: 2.4, depth: 1.3, height: { min: 5.5, max: 8 } } as const
/** The altar in the middle of the ring: a slab lying this long, wide and high. */
export const ALTAR = { width: 4.5, depth: 2.2, height: 1.1 } as const
/**
 * A lintel across two stones side by side, as often as not: this thick and
 * tall, reaching this far past each, and let this far into their tops. The
 * two under it are made the same height to carry it.
 */
export const LINTEL_ODDS = 0.5
export const LINTEL = { depth: 1.2, height: 1.1, overhang: 0.5, seat: 0.15 } as const
export const STONES_RELIEF = 7
export const STONES_ROAD_MARGIN = 6
/**
 * A lighthouse on a headland, one at most: a tower this wide and tall on a
 * shore this far above the sea, where at least this much of the ground
 * within this reach is sea. Were there more, they would keep this far apart.
 */
export const LIGHTHOUSES_MOST = 1
export const LIGHTHOUSE = { radius: 4.5, height: 34 } as const
export const LIGHTHOUSE_APART = 400
export const SHORE = { over: 1.5, under: 14 } as const
export const HEADLAND_REACH = 30
export const HEADLAND_SAMPLES = 16
export const HEADLAND_SEA = 0.45
export const COAST_STEP = 3
export const LIGHTHOUSE_RELIEF = 7
export const LIGHTHOUSE_ROAD_MARGIN = 6
/**
 * Boats moored off the shore: a few, at random, in water deep enough and
 * with the shore not far off, each turned as it lies at anchor. They throw
 * their own dice, like the observatory, so a planet's boats stay put.
 */
export const BOATS_MOST = 8
export const BOAT_TRIES = 200
export const BOAT_SALT = 0x0b0a_7e5d
/** A boat's length and beam, how deep it sits and how high it stands over the water. */
export const BOAT = { length: { min: 7, max: 12 }, beam: { min: 2.6, max: 3.6 }, draft: 0.8, freeboard: 0.9 } as const
/** The water a boat lies in: this deep at least, with no land nearer than the one distance and some within the other. */
export const BOAT_WATER = { depth: 2, offshore: 25, nearShore: 120 } as const
export const BOATS_APART = 45
/** A boat keeps this far from any road: a bridge deck over the water is a road too. */
export const BOAT_ROAD_MARGIN = 6
export const BOAT_SWING = 110
/**
 * A chair lift up a mountainside: a station at the foot of the slope, one
 * near the crest, and a line of pylons between them for the cable and the
 * chairs. On a mountain without an observatory for choice, up the side
 * that faces the nearest city. One per planet at most.
 */
export const LIFTS_MOST = 1
export const PYLON = { size: 2, height: 14, spacing: 40, least: 2 } as const
export const LIFT_STATION = { width: 10, depth: 8, height: 6 } as const
/** The lift's line must climb this steeply at the least and at the most, rise over run: these mountains are steep. */
export const LIFT_GRADE = { min: 0.25, max: 1 } as const
/** The top station stands this far below the peak, and the bottom one this far short of the foot of the slope. */
export const LIFT_ENDS = { belowPeak: 15, aboveFoot: 10 } as const
/** The foot of the slope is where the ground has eased to this grade over a stretch, foothills and all. */
export const LIFT_FOOT = { grade: 0.12, stretch: 30, step: 5, mostDown: 500 } as const
export const LIFT_ROAD_MARGIN = 4
export const PYLON_RELIEF = 6
export const LIFT_STATION_RELIEF = 8
/** How far anything that stands about keeps from anything else that does. */
export const FURNITURE_GAP = 2
/** How far apart two of the same thing keep, farm from farm, camp from camp; water towers further. */
export const FEATURE_APART = 100
export const WATER_TOWERS_APART = 300
/**
 * An orchard: a field planted with fruit trees on a grid instead of a crop,
 * the last field of a farm this often, and a couple more on their own. The
 * trees stand this far apart along a row and the rows this far apart.
 */
export const ORCHARD_ODDS = 0.34
export const ORCHARDS_ALONE = 2
export const ORCHARD_TRIES = 60
export const ORCHARD_SIZE = { width: 42, depth: 30 } as const
export const ORCHARD_ALONG = 6
export const ORCHARD_ROW = 7
export const FRUIT_RADIUS = { min: 2, max: 2.8 } as const
export const FRUIT_HEIGHT = { min: 3.5, max: 4.5 } as const
/**
 * A church wherever the houses along a road are thick enough to be a
 * village: this many within this reach of one of them, no other church
 * nearer than this. The nave and its tower are this big, set this far
 * back from the road behind a green with a few trees on it.
 */
export const VILLAGE_HOUSES = 5
export const VILLAGE_REACH = 80
export const CHURCH_APART = 600
export const CHURCHES_MOST = 4
export const NAVE = { width: 26, depth: 12, height: 8 } as const
export const TOWER = { size: 6, height: 16 } as const
export const CHURCH_SETBACK = 14
export const GREEN_TREES = 4
/** A water tower at the edge of each suburb: a column this wide carrying a tank this wide, this tall. */
export const WATER_TOWER = { column: 2.4, tank: 8, height: 22 } as const
export const WATER_TOWER_TRIES = 24
export const WATER_TOWER_IN = 30
/**
 * A gas station every so far along the suburb stretches of the main
 * roads: a lot this big against the road, paved, with the shop at the back,
 * a canopy on posts over the pumps this high, and a sign by the road.
 */
export const STATION_APART = 700
export const STATION_LOT = { width: 30, depth: 20 } as const
export const STATION_RELIEF = 5
export const SHOP = { width: 10, depth: 6, height: 4 } as const
export const CANOPY = { width: 16, depth: 10, over: 4.5, thick: 0.5 } as const
export const POST = 0.4
export const SIGN = { width: 0.5, depth: 2, height: 7 } as const
/**
 * Camp sites, this many at most: a clearing this wide in the country near
 * a road but off it, tents on a ring around a fire, campers off to one side
 * and trees around the rim.
 */
export const CAMPS_MOST = 3
export const CAMP_TRIES = 80
export const CAMP_SALT = 0x0ca3_9e51
export const CAMP_NEAR_ROAD = { min: 28, max: 60 } as const
export const CLEARING_RADIUS = 20
export const TENTS = 6
export const TENT_RING = 11
export const TENT = { width: 3, depth: 2.5, height: 1.8 } as const
export const CAMPERS = 2
export const CAMPER = { width: 6, depth: 2.4, height: 2.6 } as const
export const FIRE_PIT = { size: 1.6, height: 0.4 } as const
export const RIM_TREES = 24
/** How far apart the ramps stand along a road, out of the cities. */
export const RAMP_SPACING = { min: 140, max: 300 } as const
/** A ramp's run and rise: an arc ending near a quarter grade, enough to fly off at speed. */
export const RAMP_LENGTH = 13
export const RAMP_RISE = 3
export const RAMP_WIDTH = 5
/** The shoulder past the lip is kept clear this far, for the car to come down on. */
export const RAMP_LANDING = 50
/** The ramp's near edge stands this far out from the road's edge, on the shoulder. */
export const RAMP_SHOULDER = 0.7
/** The ground under a ramp may not rise or fall more than this from foot to lip. */
export const RAMP_RELIEF = 0.6
/** Country: trees this far apart along the arterial, standing this far off it, and this big. */
export const TREE_SPACING = { min: 4, max: 9 } as const
export const TREE_SETBACK = { min: 4, max: 14 } as const
/** Behind the roadside trees a second row stands further back, at half the slots. */
export const TREE_BACK_SETBACK = { min: 14, max: 30 } as const
export const TREE_RADIUS = { min: 1.8, max: 3.5 } as const
export const TREE_HEIGHT = { min: 6, max: 12 } as const
/** Not every slot along the road gets a tree, one in this many stays open. */
export const TREE_GAP_ODDS = 4
/** A country house every so often along the road, with a clearing around it. */
export const COUNTRY_HOUSE_SPACING = { min: 70, max: 160 } as const
export const CLEARING = 12
/** Shrubs are this big. */
export const SHRUB_RADIUS = { min: 0.7, max: 1.6 } as const
export const SHRUB_HEIGHT = { min: 0.9, max: 2 } as const
/** A park gets this many trees and this many shrubs for every hundred square meters, at most. */
export const PARK_TREES = 1.2
export const PARK_SHRUBS = 1.8
/** How often a planting is tried before the park is called full. */
export const PARK_TRIES = 3
/** A garden: shrubs along the front of a house, and trees beside and behind it. */
export const GARDEN_SHRUBS = { min: 1, max: 3 } as const
export const GARDEN_TREES = { min: 0, max: 2 } as const
/** The wilds are tried at spots this far apart, each nudged about at random. */
export const WILD_SPACING = 5
/** Woods and clearings come from noise this coarse: features a few hundred meters across. */
export const WOOD_FREQUENCY = 0.004
/** Below this the noise is open ground, above it deep wood, and it thickens between. */
export const WOOD_EDGE = { open: 0.42, deep: 0.62 } as const
/** How likely a spot is to get a tree, or a shrub, in deep wood; scaled down toward open ground. */
export const WOOD_TREES = 0.14
export const WOOD_SHRUBS = 0.12
/** Open ground still gets the odd lone tree or bush. */
export const LONE_TREES = 0.006
export const LONE_SHRUBS = 0.012
/** The suburbs, between the gardens, get this fraction of the country's woods. */
export const SUBURB_WOODS = 0.3
/**
 * The foothills: how far a mountain's rise has come, from nothing at the
 * foot of its skirt to full on its crest. Trees thicken on the lower slopes
 * and thin out above them, to a treeline on the bare upper mountain.
 */
export const FOOTHILL = { from: 0.03, thickest: 0.3, treeline: 0.6 } as const
/** How much thicker than the woods the foothills are planted, at their thickest. */
export const FOOTHILL_BOOST = 2.2
/** Ground steeper than this is rock, whatever the noise says. */
export const WILD_MAX_SLOPE = 0.6
/** And nothing grows above this fraction of the way from the sea to the planet's highest ground. */
export const TREELINE = 0.65
export const WILD_SALT = 0x7e11
/**
 * Rocks, on the bare ground the wilds leave: boulders, come in fields from
 * noise this coarse (open ground below the lower mark, a field above the
 * upper), this likely at a spot in a field and this likely on open bare
 * ground, no steeper than this, and this big across; scree, lying thick on
 * the bare slopes steeper than this, this likely at a spot no boulder
 * takes, and this small. A rock stands this much of its size into the
 * ground, and keeps this far off a road.
 */
export const ROCK_FREQUENCY = 0.007
export const ROCK_FIELD = { open: 0.45, deep: 0.62 } as const
export const BOULDER_ODDS = { lone: 0.01, field: 0.12 } as const
export const BOULDER_MAX_SLOPE = 0.7
export const BOULDER_SIZE = { min: 2, max: 5 } as const
export const SCREE_SLOPE = 0.45
export const SCREE_ODDS = 0.4
export const SCREE_SIZE = { min: 0.5, max: 1.5 } as const
export const ROCK_BURY = 0.3
export const ROCK_ROAD_MARGIN = 1.5
export const ROCK_SALT = 0x2c9b
/** How far apart the spots a footprint is tried at are, across and along it. */
export const MOUNTAIN_PROBE = 8
/** How far in from an orchard's edge the outermost trees stand: a crown's width, clear of the hedge. */
export const ORCHARD_IN = 3.5
