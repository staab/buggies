# Buggies

Drive around procedurally generated islands on a small planet, alone or with whoever else is on the same server.

## Run it

```sh
pnpm install
pnpm dev
```

This starts the Vite client on port 5173 and the game server on port 8787, both reachable from other machines on the network. Every game runs on the server. Open the client, choose **1 player** or **2 players**, then an island by its seed, then a vehicle for each player. Everyone who picks the same seed shares that island. While choosing, a beacon stands over every car on the island, driven or not, as the server has them. Each seed is a room on the server with 32 seats, opened when the first player joins and closed when the last one leaves. The address bar names the island being played as `/{seed}`: to join from a second screen, open the same URL. A game cut off from the server joins it again by itself, with each car back where it was and holding what it held, if the server still has it, and a car that can't reach the world on the other side of a portal keeps trying until it gets there. The menu comes back up only when a game can't be joined from it, or the server has been updated, and says why until you move on.

The game server also serves the built client (`pnpm build`) on its own port, answering any path that names no file, such as `/{seed}`, with `index.html`. A built client joins the server that served it, and the Vite client joins the server on port 8787 of the host it was loaded from. To use another server, set `VITE_SERVER_URL` when building or running the client (see `packages/client/.env.example`). The server honors `PORT` and `HOST`, and `CLIENT_DIR` to serve the client from somewhere other than `packages/client/dist`. Behind a reverse proxy, set `TRUST_PROXY=1` so the server tells players apart by the forwarded address.

## Keys

| | |
| --- | --- |
| Drive | arrows |
| Handbrake | `Space` |
| Select a weapon | `1`–`9` |
| Clear the weapon | `0` |
| Fire | `F` |
| Siren or horn | `D` |
| Respawn on the road | `R` |
| Menu | `Esc` |

`D` is for show: on the police car, the ambulance and the fire truck it turns the siren on or off, flashing the roof lights and wailing, and on every other vehicle it blows the horn. Everyone nearby sees and hears it, and nothing else comes of it.

## The planet

Every island is wrapped round a planet about 612 m in radius, and you can drive, float or fly all the way round it. Gravity pulls toward the planet's middle, and the chase camera stands over wherever your car is. The planet turns under the sun once every ten minutes of game time, so day and night go round it: the side facing the sun is lit and the night side is dark, under a dark sky. Clouds float about 180 m up, carried slowly round the planet by the wind, and nothing driven or flown can go more than 10 m above them. Around your car the world is drawn as though the planet were eight times bigger, which puts the horizon nearly three times as far off; only the drawing is bent, not the game. Islands lie anywhere on it, the poles included.

## Portals

Three to five portals stand in the open country of every planet: glowing rings wide enough for a truck, with a clear run through them. Every planet has six other worlds, all made from its seed, and each time a car drives through a portal it goes to one of the worlds it isn't on, picked at random, coming out of that world's first portal. A portal that leads back to the planet comes out at the portal you left the planet by. Each world is a room of its own on the server, so everyone who goes through meets there. The menu offers only planets: anyone on another world is counted on its planet among the popular islands, and a link to another world opens its planet.

- **The moon** is half the planet's size, gray and airless under a black sky, with craters, mountain ranges and valleys, and a flag beside the lander that brought it.
- **Mars** is red rock under a thin pink sky. Its mountains are twice a planet's, and its pull is weaker. Its cities stand under great glass bubbles, with green ground and trees inside. Each bubble has a tunnel out through its foot for every other city, and an arterial road runs from each tunnel to the one facing it, so every city has a road to every other. There are no other roads.
- **Neptune** is all sea. Glass stations stand on the sea floor, each a town under a great dome some 200 m across, with towers, domed halls, tanks and trees under the glass. They are joined by tunnels three times as wide as a planet's road tunnels and oval across, each with a road along its floor. Everything closed in is dry, and there is nothing above the water. Two or three of the stations have a portal.
- **Jupiter** is a sky over amber cloud. Its cities stand on floating platforms, joined by highways out over the drop with no guard rails. Smaller platforms float at their own heights, joined to nothing. Anything that goes over an edge falls into the cloud and is put back on a road.
- **Venus** is jungle under yellow cloud, with giant trees to drive among. It has no cities, only small villages, joined by roads that run straight, wide and flat, the ground stamped level under them, with a stone arch over the middle of each. Out in the jungle stand the works of whoever was there first. Three screw towers each have a railed ramp wound round them from the jungle floor up to their top, 55 to 85 m up, and a bridge on from there to a platform floating beside them. More platforms float higher still, joined to nothing. Two mines are each a pit dug some 60 m deep, with a road wound down its wall to the floor and a cliff from each turn of it down to the next.
- **Mercury** is all underground: five to seven huge caverns, 220 to 320 m across and up to 80 m high, in solid rock, joined by smooth round tunnels that rise and fall, none crossing another. Each tunnel leaves a cavern through a horn in its wall, flush with the cavern's floor and its ceiling, that narrows into the rock and becomes the round tube. Its pull is weak, but a car holds on to whatever its wheels are on, so it can drive up a tunnel's wall and along its roof upside down, or along a cavern's ceiling and on into a tunnel's. Let go, and it falls toward the floor. Two or three of the caverns have a portal.

Each world has furniture of its own:

- **Mars:** solar arrays, radio dishes, parked rovers and greenhouses outside each bubble, and tanks of air inside it; hoodoos of banded red rock out on the open ground, and landing pads with a rocket standing on each.
- **Neptune:** beds of tall kelp swaying in the current out on the sea floor, strands of it between them, coral heads in four shapes (mounds, branches, fans and clusters of tubes), anemones, giant clams with a pearl in each, starfish, sea urchins, and anchors and amphorae lying where they sank.
- **Jupiter:** red beacons round every platform's edge; wind turbines, gas tanks, balloons tethered at the edges, wind socks and landing pads marked with an H on the cities; and a flag on each loose platform.
- **Venus:** stepped temple pyramids deep in the jungle, steep spires of dark stone capped in gold, black monoliths standing up out of the crowns, a monolith ringed with glowing crystals on each tower's platform, broken columns round the temples and standing in ruins about the jungle, stone idols round the villages, giant mushrooms with room to drive under their caps, giant fallen trees to jump, pitcher plants, and a headframe over each mine's rim with ore glowing on its floor.
- **Mercury:** pillars of rock from the cavern floors to their ceilings, giant crystals and clusters of smaller ones glowing across the floors, glowing fungus, pools of lava, stalactites hanging from the ceilings, and mine carts left on short stretches of track.

Three worlds have life of their own, which each player's page draws for itself. Nothing runs into it, but the world's seed and the game's time put it where it is, so everyone sees it about the same:

- **Neptune:** schools of fish swimming loops over the sea floor, glowing jellyfish bobbing and pulsing, two whales swimming slowly right round the world over the stations, and dark vents in the floor with bubbles streaming up from them to the surface.
- **Mercury:** will-o'-the-wisps drifting and flickering about the caverns, under ceilings that fade to dark brown overhead.
- **Venus:** lightning coming down out of the cloud every few seconds onto a monolith, a spire or a screw tower, lighting everything as it flashes.

Saucers fly only where there is a sky, so not on Neptune or Mercury.

## Meteors

Every six seconds while anyone is driving on the moon, a meteor comes down somewhere on it at random. It glows as it falls for three seconds on a slanting line from high overhead, trailing smoke. It blows up where it lands: a car at the middle takes half again a bomb's damage and is thrown out and up, less the further out, and nothing past 18 m is touched. A spider standing in the blast is hurt too.

## Bananas

An island has 256 bananas, floating around it and turning slowly. Drive through one to collect it, and another appears somewhere else a little later. Bananas are the fuel every weapon runs on. A wrecked car spills all of its bananas around the wreck for anyone to collect, and they lie there until someone does. Each spilled banana takes one of the island's 256: the ones waiting to reappear first, then ones out on the island, which vanish from where they were. An island holds at most 256 bombs, mines and rockets at once, and past that the oldest disappear.

Thirty-two health packs, red crosses on white discs, are scattered the same way. A damaged car that drives through one has half its damage mended, and another pack appears somewhere else a little later. A car with no damage passes through and leaves the pack for someone else, and a magnet does not pull health packs.

## Robots

Two robots patrol the arterials of every island, rolling slowly along one road and turning off onto another at each junction. A robot burns the nearest car its eyes can see within 70 m with a laser beam for a second, then takes four seconds to charge. They are shown in red on the mini-map. Nothing stops a robot: it rolls through whatever is in its way, and a car that runs into it hits a wall. A robot takes damage from guns, lasers, rockets, bombs, mines and a ram plow driven into it, though it is five times tougher than the sports car, and it sets off any bomb or mine it rolls onto. It smokes when badly hurt, and when brought down it blows up, spills ten bananas about where it fell, and comes back whole on another arterial. A saucer or spider brought down spills ten bananas too.

## Flying saucer

A flying saucer cruises high over every island, shown in green on the mini-map. Every forty seconds or so it goes after the nearest car within 250 m, comes down over it, and lifts it up a green beam for three seconds. It then carries the car off across the island at 40 m/s and lowers it onto a road there. A car that gets clear of the beam while it is being lifted is let go. The saucer can be shot down as a robot can, and comes back high over somewhere else.

## Spider

A giant spider, its body ten meters up on legs nearly twenty meters long, walks slowly across every moon from one spot to the next, high enough for a car to drive under it between its legs. Every thirty seconds a bomb falls from its belly. It is shown in purple on the mini-map, and can be shot down as a robot can, coming back somewhere else.

## Traffic

Twenty cars nobody drives potter slowly around the arterials of every island in the seats players leave empty: small cars, sports cars, pickups, semis, police cars, ambulances and fire trucks. They are shown in gray on the mini-map, and one gives up its seat whenever the island is full and someone else wants to join. They keep to the right-hand lane, carry no weapons, take no bananas or health packs, and set off any bomb or mine they drive onto. They are fragile: a weapon takes three times as much of one as of any other car, and so does a crash. Wrecked, one comes back on the road nearby like anyone else, and it is put back a little further along its road if it goes nowhere for six seconds.

## Games

The first page of the menu asks for the player's name, which everyone else on the island knows them by. The browser remembers it for next time. While an island is being played, a button beside the trophy in the top corner opens a list of the players on it, with what each drives, the gems each has won, the bananas each holds and the game each is playing.

The game is free play, but the trophy beside the speaker opens a list of the games on the island: those waiting for players and those being played. **Start game** opens the picker. A game picked there is offered to everyone on the island for a minute. Each of them hears a chime, and the HUD and a dot on the trophy show how long is left to join. Anyone can join the game from the list, or leave it, and a player is in one waiting game at a time. When the minute is up, the game starts for everyone who joined. A game everyone has left is dropped. With nobody else on the island, a game starts at once. A game is one of four kinds:

- **Score** asks for a number of bananas collected from when the game is set. Bananas spent on weapons still count.
- **Kills** asks for a number of other players' cars wrecked by the player's own weapons from when the game is set: any weapon hit that finishes a car. Cars nobody drives don't count.
- **Robots** asks for a number of robots brought down by the player's own weapons from when the game is set.
- **Race** is played by everyone who joins it. The player picks a course on a map of it: a start, one or more checkpoints and a finish, each mark on land and at least 200 m from the one before it, and a number of laps from 1 to 9. One lap runs from the start to the finish. More make a circuit: from the finish the course runs back round by the start, and the race is won over the finish on the last lap. Starting the race puts every racer on a starting grid at the start, facing the first checkpoint. Each mark has to be passed in order, within 20 m, and a wreck passes nothing. A gold beacon stands over each racer's next mark, which also shows on the mini-map. The first over the finish wins. Only one race runs or waits for players at a time. A race is called off after five minutes with no winner, or when the player who started it stops it.

A new game puts its name across the middle of the screen, says what it asks for, and counts down from three. Its players can pick a weapon during the countdown, but can't drive or fire until it ends. Each player goes by their name, shown in the HUD, or by a tag of seven letters and digits if they gave none. When a game is over, the screen names the winner, as in "Ada in an ambulance", with the gem it paid and how many the winner has now. The winner gets confetti, and the game's other players get a rain cloud and a sad trombone.

The HUD shows how each game is going. Winning a game or a race pays a gem, not bananas. Gems are points: the HUD shows them beside the bananas, and the server keeps them against the player's key, so they carry over from one visit to the next. The first to reach a count wins it, and the game then ends for everyone who played it, as a race does. Escape closes the panel.

## Achievements

A hundred achievements are there to be had, each paid once ever to a player's key, for collecting and holding bananas, wrecking cars with weapons (other players' and traffic alike), bringing down robots, winning races and games, time in the air, top speed, using each weapon and all nine, driving up to landmarks such as the observatory, the lighthouse, a pyramid or the moon's flag, going through portals, driving into the sea and climbing over the clouds. Each pays its bananas, and they come through a portal with the car. The server pays one at a time, three seconds apart, and the player's screen shows a card for it at the top with what it took and what it paid, over a show of its own: confetti, raining bananas, fireworks, balloons, a burst of stars, or its icon bouncing across the screen or spinning up big.

## Players' keys

On a player's first visit the page makes them a nostr key and keeps it in the browser. It is used for nothing but proving to the server which seat is theirs. Every time a player joins an island, the server's welcome carries a fresh challenge. The page answers with a nostr event naming it, signed by the key, the way a client authenticates to a relay (NIP-42). The server believes the key only if the signature checks out and the event is less than ten minutes off its own clock. A player who comes through a portal, or rejoins after a dropped connection, keeps the key already proved. The server pays achievements and gems only to a proved key, pays each achievement to a key once ever, and remembers the bananas a key holds: a player joining afresh starts with the bananas they held when they last left, saved every ten seconds while they play and whenever they go. It keeps all of this in `data/players.json`, or wherever `PLAYERS_FILE` says. In the Docker image that is `/app/data`, a volume to mount so it outlasts the container. A browser that has its storage cleared gets a new key, and starts again.

## Weapons

Every car has all nine weapons, each selected with its own number key, and pays for them in bananas. The selected weapon rides over the roof for everyone to see, at half opacity while the car can't pay for it, and `0` clears it. `F` fires it. A weapon that goes all at once costs its price on each press, and only if the car has that many bananas. A weapon that lasts burns its price every second `F` is held, a banana at a time, and stops when the bananas run out. What is left of a banana broken into keeps for the next lasting weapon. The selection stays with the player through a portal.

| Key | Weapon | Cost |
| --- | --- | --- |
| `1` | Rocket | 2 a shot |
| `2` | Machine gun | 1 a second |
| `3` | Mine field | 3 a field |
| `4` | Rocket engine | 1 a second |
| `5` | Wings | 1 a second |
| `6` | Magnet | 2 |
| `7` | Ram plow | 3 |
| `8` | Laser | 2 a second |
| `9` | Shockwave | 3 |

- **Rocket** chases the nearest car ahead, turning no tighter than a 25 m circle, and takes a fifth of its health when it hits. A car that swerves late or close can make it miss.
- **Machine gun** aims at the nearest car ahead and fires ten shots a second while `F` is held. Five seconds of hits take a third of a car's health.
- **Mine field** lays five mines on the ground in a spread behind the car. Each mine goes off with 30% of a bomb's blast on the first car to reach it, the one that laid it too once it has landed.
- **Rocket engine** pushes the car forward while `F` is held.
- **Wings** lift the car into the air while `F` is held. In the air, the pedals drive the car and the steering banks it into a wide turn like a plane. With wings selected and bananas to fly on, a car steers this way whenever it is airborne, whether or not `F` is held. A car on wings flies no faster than nine tenths of its own top speed, and the air slows one that comes up faster, so flying a race is no shortcut.
- **Magnet** collects every banana within 50 meters for 30 seconds.
- **Ram plow** mounts a blade on the front of the car for ten seconds. Cars and props in front of it are thrown forward, faster than the car is closing on them.
- **Laser** burns the nearest car ahead within 100 m for as long as `F` is held. Its beam is steadier than the machine gun's, and four seconds of it take about half of a car's health.
- **Shockwave** stuns every other car within 30 meters for five seconds.

## Vehicles

The vehicles differ in how they drive and what they can take, not in their weapons. Each has its own armor, which sets how much it takes from crashes and weapons alike. Against a weapon, the tank takes under half of what the sports car takes, and the go-kart takes a little more. Some vehicles also have a passive ability, which the vehicle page of the menu describes.

- **Tank** fires its rockets, machine gun and laser from its own gun, with nothing mounted over its roof for them.
- **Dune buggy** rides on long, soft, lightly damped springs, so it bounces over whatever it meets.
- **Amphibian** is a boat's hull on four wheels: slow on the road, but it floats, and in the water its throttle and steering drive it like a boat. It is never put back on shore.
- **Ambulance** repairs 1% of its health every five seconds.
- **Fire truck** takes a tenth of the damage from bombs, mines and meteors.
- **Police car** takes half damage from machine guns.

## Docker

The workflow in `.github/workflows/docker.yml` publishes the game server, with the client built in, as an image at `ghcr.io/staab/buggies`. Every push to the default branch is tagged `latest` and with its commit, and a release tag such as `v1.2.0` is tagged with its version. The server listens on port 8787, serving both the page and its WebSockets there, and honors `HOST`, `PORT` and `TRUST_PROXY` as above. It keeps players' achievements, gems and bananas in `/app/data/players.json`: mount a volume at `/app/data`, such as `-v buggies-data:/app/data` or a `volumes:` entry in docker compose, or they are lost with the container. Nothing is baked in at build time: the page joins whatever address it is served from, so a reverse proxy in front only needs to pass WebSocket upgrades through to the same port.

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
12. **What stands on the land.** Cities fill their blocks with lots, sidewalks, parks and buildings that grow taller toward the middle. Jump ramps stand on the shoulders of the country roads, and filling stations, roadworks, houses and gardens line the roads through the suburbs. The landmarks follow: a pyramid, an observatory on a peak, farms, orchards, a wind farm, standing stones, a lighthouse, boats about their moorings, lifeguard towers and beach umbrellas on the beaches, a chair lift, churches, water towers and camps. Last, woods and clearings spread over the country and up the foothills, and rocks over the bare heights. Each is laid out in a frame of its own spot, off the finished roads, clear of the interchanges and of everything placed before it.

## Check it

```sh
pnpm typecheck
pnpm test
```

The tests cover terrain, driving, the wire format, and a full session with two predicting clients connected to a server over a simulated network. They run in Node without a browser.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a [tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a [cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). The dune buggy and the amphibian are built in code. See `CREDITS.md`.
