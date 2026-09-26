# Buggies

Drive around procedurally generated islands, alone or with whoever else is on the same server.

## Run it

```sh
pnpm install
pnpm dev
```

This starts the Vite client on port 5173 and the game server on port 8787, both reachable from other machines on the network. Every game runs on the server. Open the client, choose **1 player** or **2 players**, then an island by its seed, then a vehicle for each player. Everyone who picks the same seed shares that island. Each seed is a room on the server, opened when the first player joins and closed when the last one leaves. To join from a second screen, open the same URL.

The client connects to a server on the same host it was loaded from. To use another server, set `VITE_SERVER_URL` when building or running the client (see `packages/client/.env.example`). The server honors `PORT` and `HOST`. Behind a reverse proxy, set `TRUST_PROXY=1` so the server tells players apart by the forwarded address.

## Keys

| | 1 player | 2 players, left | 2 players, right |
| --- | --- | --- | --- |
| Drive | arrows | `W` `A` `S` `D` | arrows |
| Handbrake | `Space` | `Z` | `,` |
| Fire the power-up | `F` | `X` | `.` |
| Active ability | `D` | `Shift` | `M` |
| Respawn on the road | `R` | `Q` | `Enter` |
| Menu | `Esc` | `Esc` | `Esc` |

In **2 players** mode, two people share one keyboard on a split screen, and each has their own seat on the server.

## Bananas

Bananas float around every island, turning slowly. Drive through one to collect it, and another appears somewhere else a little later. Once a car carrying nothing has three bananas, it spends them on a power-up immediately. The power-up is rolled like a slot machine and carried over the roof for everyone to see. Bananas collected while the car carries something are saved toward the next one. A wrecked car spills up to sixteen of its bananas around the wreck for anyone to collect. An island holds at most 256 loose items, and past that the oldest disappear.

Thirty-two health packs, red crosses on white discs, are scattered the same way. A damaged car that drives through one has half its damage mended, and another pack appears somewhere else a little later. A car with no damage passes through and leaves the pack for someone else, and a magnet does not pull health packs.

## Goals

The game is free play, but the trophy beside the speaker, in the top corner while a game is on, opens a panel for setting a goal to play for. A goal is one of three kinds:

- **Score** asks for a number of bananas collected from when the goal is set. Bananas spent on power-ups still count.
- **Kills** asks for a number of cars wrecked by the player's own weapons from when the goal is set: any hit that finishes a car, whether from a power-up or the vehicle's own ability.
- **Location** asks the player to drive to a spot picked on a map of the island. A gold beacon stands over it, and it shows on the mini-map. Coming within 20 m of it counts.

The HUD shows how the goal is going. Reaching it wins 100 bananas and returns to free play. In two-player mode the goal is set for both players, and each is paid for reaching it. Escape closes the panel.

## Power-ups

The fire key uses whatever the car carries.

- **Rocket** chases the nearest car ahead, turning no tighter than a 25 m circle, and takes a fifth of its health when it hits. A car that swerves late or close can make it miss.
- **Machine gun** aims at the nearest car ahead and fires while the key is held, for five seconds in total. Its full five seconds of hits takes a third of a car's health.
- **Bomb** drops behind the car and floats there until a car runs into it, taking a third of that car's health. Once it has landed, it goes off under the car that dropped it too.
- **Rocket engine** pushes the car forward while the key is held, for ten seconds in total.
- **Wings** lift the car into the air while the key is held, for ten seconds in total. In the air, the pedals drive the car and the steering banks it into a wide turn like a plane. A car carrying wings steers this way whenever it is airborne, whether or not the key is held.
- **Shockwave** stuns every other car within 30 meters for five seconds.
- **Siren** slows every other car within 30 meters by half while the key is held, for five seconds in total.
- **Repair** fully repairs the car immediately. It appears as a red cross on a white disc.
- **Oil slick** drops a pool of oil behind the car that lasts a minute. Any car that drives into it, including the one that dropped it once it has landed, keeps a fifth of its grip while in it and for five seconds after.
- **Shield** protects the car for ten seconds from weapon damage, stuns and slows, and from being shoved by a ram plow or dragged by a grappling hook.
- **Magnet** collects every banana within 50 meters for 30 seconds.
- **Triple rocket** fires three rockets in a fan, each with half the blast of a rocket. Each chases a different car ahead, nearest first, and any rocket left over chases the nearest.
- **Ram plow** mounts a blade on the front of the car for ten seconds. Cars and props in front of it are thrown forward, faster than the car is closing on them.
- **Grappling hook** catches the nearest car within 60 meters ahead and reels the two together for four seconds, pulling the car that fired it harder. With no car ahead, the line shoots out and back and the hook is spent.
- **Mine field** lays five mines on the ground in a spread behind the car. Each mine goes off with 30% of a bomb's blast.

## Vehicles

Each vehicle has an active ability on its own key, separate from any power-up it carries. Most are weaker forms of the power-ups, and only the tank's, the small car's and the pickup's have a cooldown. Active abilities are not mounted over the roof or shown in the HUD, and their shots and missiles come from the front of the car. Some vehicles also have a passive ability. The vehicle page of the menu describes both.

- **Tank** fires a missile from its gun with the blast of the rocket power-up, every eight seconds. Its rocket, triple rocket and machine gun power-ups also fire from its gun, with nothing mounted over its roof.
- **Go-kart** jumps into the air whenever it is on the ground.
- **Race car** boosts with the force of the rocket engine power-up while the key is held.
- **Sports car** fires a machine gun from its nose at the car ahead while the key is held, with the damage of the machine gun power-up.
- **Small car** drops an oil slick behind, as slippery as the oil slick power-up, every three seconds. Up to three can be out at once, and a fourth replaces the oldest.
- **Semi truck** honks its horn, stunning every car within 30 meters for five seconds, every five seconds.
- **Heavy pickup** drops a bomb behind with the blast of the bomb power-up, every five seconds. Up to five can be out at once, and a sixth replaces the oldest.
- **Dune buggy** rides on long, soft, lightly damped springs, so it bounces over whatever it meets. It fires three rockets in a fan, as the triple rocket power-up does, every thirty seconds.
- **Rocket ship** has no wheels: it hovers on thrusters, is faster than the race car, and turns wide. Holding its key lifts it off to fly, with the pedals driving it along and the steering banking it into turns, as the wings power-up does.
- **Police car, ambulance and fire truck** turn their lights on or off. While the lights are on, every car within 30 meters is slowed by half. As a passive ability, none of them is slowed by sirens or lights. The ambulance also repairs 1% of its health every five seconds, the fire truck takes a tenth of the damage from bombs, and the police car takes half damage from machine guns.

## Docker

The workflow in `.github/workflows/docker.yml` publishes the game server as an image at `ghcr.io/staab/buggies`. Every push to the default branch is tagged `latest` and with its commit, and a release tag such as `v1.2.0` is tagged with its version. The server listens on port 8787 and honors `HOST`, `PORT` and `TRUST_PROXY` as above.

```sh
docker run --rm -p 8787:8787 ghcr.io/staab/buggies
```

After the first publish, the package's visibility may need to be set in its GitHub settings. To build the image locally instead:

```sh
podman build -t buggies-server .
podman run --rm -p 8787:8787 buggies-server
```

## Packages

- `physics`: vectors, quaternions, a seeded RNG, the fixed timestep.
- `terrain`: one to eight islands from a seed, with their heightfield, rivers, lakes, districts, roads, bridges and tunnels.
- `vehicle`: the car, with its suspension, tires, air control, self-righting and water, on Rapier.
- `game`: the arena, a map with seats on it, stepped one fixed tick at a time.
- `net`: the protocol, the server and the client's prediction, with no DOM and no three.js.
- `server`: the authoritative arena, over WebSockets.
- `client`: the browser, with rendering, input, menus and the online mode.

## Terrain

`generateTerrain(seed)` in `packages/terrain` builds the whole map from a seed. The server builds it to run the arena, and each client builds it again in a web worker to draw it, so the output is deterministic: the same seed gives byte-identical terrain on every machine. A test checks this by hashing everything the physics reads. `pnpm --filter @buggies/terrain preview <seed>` prints an island as an ASCII map, with a summary of its roads and rivers.

The land is grown on a 1281 × 1281 grid of cells at a reference scale, then enlarged threefold to a map about 3.8 km across. The roads and everything built along them come afterward, at full size, so they keep their real widths and grades.

1. **Islands.** The seed picks one to eight islands, each anywhere from about 100 m across to the size of the largest island the map holds, and places them anywhere clear of the map's edge. Islands may overlap into one land mass. The first is drawn at least three quarters of the largest size, so every map has room for its cities.
2. **Mountains.** The seed picks one to twelve mountains. Each is a jittered triangle with a skirt around it, standing near the middle of an island picked in proportion to its area from those big enough to carry one. About half the mountains, and always at least one, get a river.
3. **Heightfield.** Each island's land is a radial falloff from its middle, warped by noise into bays and peninsulas and faded out before the map's edge. On it sit nearly flat plains of low noise, a gentle dome that drains water outward, and the mountains. Each mountain is full height inside its triangle and falls away over its skirt, roughened with ridged noise, and overlapping mountains reinforce each other only partly. Past the coast the sea floor drops away. Every land cell records which land mass it belongs to, numbered by size.
4. **Drainage.** A priority flood from the map's edges raises every cell to the level at which its water can escape to the sea and gives it a downhill neighbor. Wherever the flooded surface stands above the ground is a depression.
5. **Rivers.** Each river rises at a spring halfway down its mountain and follows the downhill neighbors to the sea, widening as it falls.
6. **Lakes.** A depression becomes a lake only if it is large enough, at least a meter deep and crossed by a river.
7. **Channels.** Each river's course is smoothed out of the grid's staircase and its surface is seated in the ground it runs through. The surface is held at a lake's level across and beside the lake, shared where two rivers run together, and never allowed to rise downstream. A bed and banks are then cut beneath it.
8. **Districts.** Dry, level ground clear of the coast and the water is scored by how much flat land surrounds it and how little the land around it rises and falls. The seed asks for three to five cities. Each goes to the land mass with the most level ground left per city, on its roomiest site at least 900 m from the others. A map without room for all of them has fewer, but always at least three. A city spreads over the gently rolling ground around its site and keeps only its largest piece. A band of suburb surrounds each city, and the rest is country.
9. **Scale.** The heights, mountains, rivers, lakes and districts are all enlarged threefold.
10. **Highway.** A closed loop visits exactly three cities: of every three, the ones it reaches most cheaply, with runs over the sea or high ground counting extra. It crosses the sea on bridges where those cities are on different land masses. The runs between cities are bowed outward and joined by a spline, so each city is met at a shallow angle. A layout too narrow for that gets a stadium around its two outermost cities instead, and one too sharp gets an offset that wraps each city at a constant radius. The deck aims for 3 m above the ground or 4 m above water, and is held to a 6% grade and a limit on how sharply that grade changes. Where it stays above water it is a bridge, and where the grade limit leaves it more than a meter underground it is a tunnel.
11. **Interchanges.** Interchanges are spaced every 300 m around the loop, wherever the cities are. Each slides along the loop to the nearest dry, drivable ground, but never within 220 m of another. Where no site nearby suits the ramps well, one that is merely drivable is taken, and its ramps come out steeper. At each one a cross road passes under the highway, the deck is raised to clear it, and four ramps join the two in a diamond. A site where the deck cannot clear the cross road, or the ramps would drop too far, is left out. Nothing else is built inside a diamond.
12. **Arterials.** The ends of every cross road, the middle of every city off the highway and an even grid of inland sites are the nodes of a network. Only Voronoi neighbors are linked, so no two links cross, and every node gets at least two links so none is a dead end. Spare links close extra loops. Each link is routed by A* over a grid that refuses grades over 8%, charges extra for water, which it crosses on a bridge, blocks the highway and avoids roads already built. The path is then smoothed into a spline, with hairpins at its sharpest corners. Any city or stretch of arterial the network does not reach, such as one on another island, is then linked to it by an arterial that may bridge the sea. That arterial ends at the first node or arterial of the network it meets, and a junction is cut into the arterial there. Whatever still cannot be reached is dropped.
13. **Streets.** Each city is filled with a grid of streets 48 m apart, aligned with the city's long axis and cut wherever it leaves the city, meets water or comes near the highway or an interchange.
14. **Junctions.** Road ends meeting at a node are paired off and bent to leave in opposite directions. A street running alongside an arterial rather than across it is cut back to meet it, and street ends are joined to the roads they reach. A grid cut off from the network gets a street to the nearest arterial or cross road, and any street nothing can reach is dropped.
15. **Climbs.** Each map has at most one mountain road. It leaves an arterial for the highest mountain the arterial comes near, winds up the slope at its grade with hairpins where the way is blocked, and ends in a level lot with a view.
16. **Road beds.** The ground is cut away beneath the highway so it never pokes through the deck, except where a surface road runs. Every other road lies on the ground itself. The ground is cut or filled to the road's profile across the roadway and blended back over the shoulders, two roads crossing share one level, and each road is held to its grade and curvature limits. Tunnels are not stored as geometry. The bore is derived from the road being marked as a tunnel, the same way for the drawn mesh and for the collider.
17. **What stands on the land.** Cities fill their blocks with lots, sidewalks, parks and buildings that grow taller toward the middle. Jump ramps stand on the shoulders of the country roads, and filling stations, roadworks, houses and gardens line the roads through the suburbs. The landmarks follow: an observatory on a peak, farms, orchards, a wind farm, standing stones, lighthouses, moored boats, a cable lift up a mountain, viewpoints, churches, water towers and camps. Last, woods and clearings spread over the country and up the foothills, and rocks over the bare heights. Everything is placed off the finished roads, clear of the interchanges, on ground that has already been settled.

## Check it

```sh
pnpm typecheck
pnpm test
```

The tests cover terrain, driving, the wire format, and a full session with two predicting clients connected to a server over a simulated network. They run in Node without a browser.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a [tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a [cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). The dune buggy and the rocket ship are built in code. See `CREDITS.md`.
