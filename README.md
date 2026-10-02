# Buggies

Drive around procedurally generated islands on a small planet, alone or with whoever else is on the same server.

## Run it

```sh
pnpm install
pnpm dev
```

This starts the Vite client on port 5173 and the game server on port 8787, both reachable from other machines on the network. Every game runs on the server. Open the client, choose **1 player** or **2 players**, then an island by its seed, then a vehicle for each player. Everyone who picks the same seed shares that island. While choosing, a beacon stands over every car on the island, driven or not, as the server has them. Each seed is a room on the server with 32 seats, opened when the first player joins and closed when the last one leaves. The address bar names the island being played as `/{seed}`: to join from a second screen, open the same URL. A game cut off from the server joins it again by itself, with each car back where it was and holding what it held, if the server still has it.

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

## The planet

Every island is wrapped round a planet about 612 m in radius, and you can drive, float or fly all the way round it. Gravity pulls toward the planet's middle, and the chase camera stands over wherever your car is. The planet turns under the sun once every ten minutes of game time, so day and night go round it: the side facing the sun is lit and the night side is dark, under a dark sky. Clouds float about 180 m up, carried slowly round the planet by the wind, and nothing driven or flown can go more than 10 m above them. Around your car the world is drawn as though the planet were eight times bigger, which puts the horizon nearly three times as far off; only the drawing is bent, not the game. Islands lie anywhere on it, the poles included.

## Portals

Three to five portals stand in the open country of every planet: glowing rings wide enough for a truck, with a clear run through them. Drive through one and everyone on your screen goes to the planet's moon, coming out of its one portal. The moon is half the planet's size, gray and airless under a black sky, with craters, mountain ranges and valleys, and a flag beside the lander that brought it. Its portal leads back to the planet, out of the portal you left by. The moon is a room of its own on the server, so everyone who goes through meets there.

## Bananas

An island has 256 bananas, floating around it and turning slowly. Drive through one to collect it, and another appears somewhere else a little later. Once a car carrying nothing has three bananas, it spends them on a power-up immediately. The power-up is rolled like a slot machine and carried over the roof for everyone to see. Bananas collected while the car carries something are saved toward the next one. A wrecked car spills all of its bananas around the wreck for anyone to collect, and they lie there until someone does. Each spilled banana takes one of the island's 256: the ones waiting to reappear first, then ones out on the island, which vanish from where they were. An island holds at most 256 bombs, mines, oil slicks and rockets at once, and past that the oldest disappear.

Thirty-two health packs, red crosses on white discs, are scattered the same way. A damaged car that drives through one has half its damage mended, and another pack appears somewhere else a little later. A car with no damage passes through and leaves the pack for someone else, and a magnet does not pull health packs.

## Robots

Two robots patrol the arterials of every island, rolling slowly along one road and turning off onto another at each junction. A robot burns the nearest car its eyes can see within 70 m with a laser beam for a second, then takes four seconds to charge. They are shown in red on the mini-map. Nothing stops a robot: it rolls through whatever is in its way, and a car that runs into it hits a wall. A robot takes damage from guns, lasers, rockets, bombs, mines and a ram plow driven into it, though it is five times tougher than the sports car, and it sets off any bomb or mine it rolls onto. It smokes when badly hurt, and when brought down it blows up, spills ten bananas about where it fell, and comes back whole on another arterial. A saucer or spider brought down spills ten bananas too.

## Flying saucer

A flying saucer cruises high over every island, shown in green on the mini-map. Every forty seconds or so it goes after the nearest car within 250 m, comes down over it, and lifts it up a green beam for three seconds. It then carries the car off across the island at 40 m/s and lowers it onto a road there. A car that gets clear of the beam while it is being lifted, or has its shield up, is let go. The saucer can be shot down as a robot can, and comes back high over somewhere else.

## Spider

A giant spider, its body ten meters up on legs nearly twenty meters long, walks slowly across every moon from one spot to the next, high enough for a car to drive under it between its legs. Every thirty seconds a bomb falls from its belly. It is shown in purple on the mini-map, and can be shot down as a robot can, coming back somewhere else.

## Traffic

Twenty cars nobody drives potter slowly around the arterials of every island in the seats players leave empty: small cars, sports cars, pickups, semis, police cars, ambulances and fire trucks. They are shown in gray on the mini-map, and one gives up its seat whenever the island is full and someone else wants to join. They keep to the right-hand lane, carry no weapons, take no bananas or health packs, and set off any bomb or mine they drive onto. They are fragile: a weapon takes three times as much of one as of any other car, and so does a crash. Wrecked, one comes back on the road nearby like anyone else, and it is put back a little further along its road if it goes nowhere for six seconds.

## Games

The game is free play, but the trophy beside the speaker, in the top corner while an island is being played, opens a panel of games to play. A game is one of four kinds:

- **Score** asks for a number of bananas collected from when the game is set. Bananas spent on power-ups still count.
- **Kills** asks for a number of other players' cars wrecked by the player's own weapons from when the game is set: any hit that finishes a car, whether from a power-up or the vehicle's own ability. Cars nobody drives don't count.
- **Robots** asks for a number of robots brought down by the player's own weapons from when the game is set.
- **Race** is played by everyone on the island. The player picks a course on a map of it: a start, one or more checkpoints and a finish, each mark on land and at least 200 m from the one before it. Starting the race puts every player on the island on a starting grid at the start, facing the first checkpoint. Each checkpoint has to be passed in order, within 20 m, and a wreck passes nothing. A gold beacon stands over each racer's next mark, which also shows on the mini-map. The first over the finish wins. Only one race runs at a time. A race is called off after five minutes with no winner, or when the player who started it stops it.

The HUD shows how each game is going. Winning one pays 100 bananas. A count then returns to free play, and a race ends for everyone. In two-player mode a count is set for both players, and each is paid for reaching it. Escape closes the panel.

## Power-ups

The fire key uses whatever the car carries.

- **Rocket** chases the nearest car ahead, turning no tighter than a 25 m circle, and takes a fifth of its health when it hits. A car that swerves late or close can make it miss.
- **Machine gun** aims at the nearest car ahead and fires while the key is held, for five seconds in total. Its full five seconds of hits takes a third of a car's health.
- **Bomb** drops behind the car and floats there until a car runs into it, taking a third of that car's health. Once it has landed, it goes off under the car that dropped it too.
- **Rocket engine** pushes the car forward while the key is held, for ten seconds in total.
- **Wings** lift the car into the air while the key is held, for twenty seconds in total. In the air, the pedals drive the car and the steering banks it into a wide turn like a plane. A car carrying wings steers this way whenever it is airborne, whether or not the key is held.
- **Shockwave** stuns every other car within 30 meters for five seconds.
- **Siren** slows every other car within 30 meters by half while the key is held, for five seconds in total.
- **Oil slick** drops a pool of oil behind the car that lasts a minute. Any car that drives into it, including the one that dropped it once it has landed, keeps a fifth of its grip while in it and for five seconds after.
- **Shield** protects the car for ten seconds from weapon damage, stuns and slows, and from being shoved by a ram plow or dragged by a grappling hook.
- **Magnet** collects every banana within 50 meters for 30 seconds.
- **Triple rocket** fires three rockets in a fan, each with half the blast of a rocket. Each chases a different car ahead, nearest first, and any rocket left over chases the nearest.
- **Ram plow** mounts a blade on the front of the car for ten seconds. Cars and props in front of it are thrown forward, faster than the car is closing on them.
- **Grappling hook** catches the nearest car within 60 meters ahead and reels the two together for four seconds, pulling the car that fired it harder. With no car ahead, the line shoots out and back and the hook is spent.
- **Mine field** lays five mines on the ground in a spread behind the car. Each mine goes off with 30% of a bomb's blast.
- **Laser** burns the nearest car ahead within 100 m for as long as the key is held, for four seconds in total. Its beam is steadier than the machine gun's, and its four seconds take about half of a car's health.

## Vehicles

Each vehicle has an active ability on its own key, separate from any power-up it carries. Most are weaker forms of the power-ups, and only the tank's, the small car's and the pickup's have a cooldown. Active abilities are not mounted over the roof or shown in the HUD, and their shots and missiles come from the front of the car. Some vehicles also have a passive ability. The vehicle page of the menu describes both.

Each vehicle has its own armor, which sets how much it takes from crashes and weapons alike. Against a weapon, the tank takes under half of what the sports car takes, and the go-kart takes a little more.

- **Tank** fires a missile from its gun with the blast of the rocket power-up, every eight seconds. Its rocket, triple rocket and machine gun power-ups also fire from its gun, with nothing mounted over its roof.
- **Go-kart** jumps into the air whenever it is on the ground.
- **Race car** boosts with the force of the rocket engine power-up while the key is held.
- **Sports car** drops an oil slick behind, as slippery as the oil slick power-up, every three seconds. Up to three can be out at once, and a fourth replaces the oldest.
- **Small car** fires a machine gun from its nose at the car ahead while the key is held, with the damage of the machine gun power-up.
- **Semi truck** honks its horn, stunning every car within 30 meters for five seconds, every five seconds.
- **Heavy pickup** drops a bomb behind with the blast of the bomb power-up, every five seconds. Up to five can be out at once, and a sixth replaces the oldest.
- **Dune buggy** rides on long, soft, lightly damped springs, so it bounces over whatever it meets. It fires three rockets in a fan, as the triple rocket power-up does, every thirty seconds.
- **Amphibian** is a boat's hull on four wheels: slow on the road, but it floats, and in the water its throttle and steering drive it like a boat. It is never put back on shore. Its own key burns the car ahead with a laser while held, with the bite of the laser power-up, so it is never given the laser.
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
- `terrain`: a planet from a seed, with its islands, rivers, lakes, cities, roads, bridges, tunnels and everything standing on its land.
- `vehicle`: the car, with its suspension, tires, air control, self-righting and water, on Rapier.
- `game`: the arena, a map with seats on it, stepped one fixed tick at a time.
- `net`: the protocol, the server and the client's prediction, with no DOM and no three.js.
- `server`: the authoritative arena, over WebSockets.
- `client`: the browser, with rendering, input, menus and the online mode.

## Terrain

`generatePlanet(seed)` in `packages/terrain` builds the whole planet from a seed. The server builds it to run the arena, and each client builds it again in a web worker to draw it, so the output is deterministic: the same seed gives a bit-identical planet on every machine. A test checks this by hashing everything the physics reads. `pnpm --filter @buggies/terrain preview <seed>` prints the planet as an ASCII map, with a summary of what is on it.

A planet is about 612 m in radius. Its ground is a cube-sphere of six faces, each 320 cells a side, some 3 m a cell. Everything on it is generated on the sphere: every position is a point in 3D, and the only flat frames are the small ones a single interchange, lot or landmark is laid out in, touching the planet at its middle.

1. **Islands.** The seed picks eight to fifteen islands, caps on the sphere anywhere from a speck to about 660 m in radius. Islands may overlap into one land mass. The first is at least three quarters of the largest size, so every planet has room for its cities.
2. **Mountains.** The seed picks two to four mountain ranges, each on an island picked in proportion to its area, near its middle. A range is two to four peaks clustered close enough to run together. Each peak is a jittered triangle with a steep skirt around it and a wide, gentle apron of foothills beyond that. Where peaks overlap they build on each other, eased off so no summit nears the clouds. About half the ranges, and always at least one, get a river.
3. **Ground.** Each island's land falls away from its middle, its coast warped by 3D noise into bays and peninsulas. On it sit nearly flat plains of low noise, a gentle dome that drains water outward, and the mountains, full height inside their triangles, falling away steeply over their skirts and then gently over their foothills. Past the coast the sea floor drops away.
4. **Rivers and lakes.** A priority flood raises every grid point to the level its water can escape to the sea at, and gives it a downhill neighbor across the faces. Each river rises halfway down its mountain and follows that way to the sea, widening as it falls. A depression becomes a lake only if it is large, at least 3 m deep and crossed by a river.
5. **Channels.** Each river's course is smoothed and its surface seated in the ground it runs through: held at a lake's level across and beside the lake, shared where two rivers run together, and never rising downstream. A bed and banks are then cut beneath it.
6. **Districts.** Dry, level ground clear of the coast and the water is scored by how much flat land surrounds it. The seed asks for three to five cities, each on the land mass with the most level ground left per city, at least 900 m from the others. A band of suburb surrounds each city, and the rest is country.
7. **Highway.** A closed loop runs through three cities: of every three, the ones it reaches most cheaply. It curves round the cities' middle, pulled inland off the sea and eased to a 100 m turning radius. The deck is held to a 6% grade: where it stays above water it is a bridge, and where the grade leaves it underground it is a tunnel.
8. **Interchanges.** Every 300 m or so round the loop, on dry, drivable ground clear of tunnels, a cross road passes under the highway and four ramps join the two in a diamond. Each is laid out in a frame of its own and stood on the planet.
9. **Arterials.** The ends of every cross road, the middle of every city off the highway and points spread over the land about 300 m apart are the nodes of a network, each linked to its nearest neighbors. Each link is routed by A* over a coarse grid of the planet, within the ground nearer its two nodes than any other, refusing grades over 8% and bridging water. Dead ends are dropped, and whatever cannot reach the highway's network is joined to it, over the sea if it must, or dropped. Last, each mountain range gets a spur from the nearest part of the network up its foothills, winding up at grades of up to 12%. This is a dead end, where traffic turns back.
10. **Streets.** Each city's streets run 48 m apart on circles about its middle, turned to the city's long axis, and are cut where they leave the city, meet water or come near the highway. A street running alongside an arterial is cut back to meet it, street ends run on to the roads just ahead of them, a grid cut off from the network gets a street to the nearest arterial or cross road, and a scrap of street going nowhere is dropped.
11. **Road beds.** The ground is cut away beneath the highway so it never pokes through the deck. Every other road is the ground itself, cut or filled to its profile across the roadway and blended back over the shoulders, and held to its grade. A tunnel's bore is derived from the road being marked as a tunnel, the same way for the drawn ground and for the collider.
12. **What stands on the land.** Cities fill their blocks with lots, sidewalks, parks and buildings that grow taller toward the middle. Jump ramps stand on the shoulders of the country roads, and filling stations, roadworks, houses and gardens line the roads through the suburbs. The landmarks follow: a pyramid, an observatory on a peak, farms, orchards, a wind farm, standing stones, a lighthouse, boats about their moorings, a chair lift, churches, water towers and camps. Last, woods and clearings spread over the country and up the foothills, and rocks over the bare heights. Each is laid out in a frame of its own spot, off the finished roads, clear of the interchanges and of everything placed before it.

## Check it

```sh
pnpm typecheck
pnpm test
```

The tests cover terrain, driving, the wire format, and a full session with two predicting clients connected to a server over a simulated network. They run in Node without a browser.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a [tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a [cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). The dune buggy and the amphibian are built in code. See `CREDITS.md`.
