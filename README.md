# Buggies

Race through procedurally generated worlds on a small planet, or drive them freely, with whoever else is on the same server.

## Run it

```sh
pnpm install
pnpm dev
```

This starts the Vite client on port 5173 and the game server on port 8787, both reachable from other machines on the network. Every game runs on the server. Open the client, give a name if it does not know one yet, and the start screen lists the games on the server, to join or to watch, with a race of bots playing behind it. **Host a game** above the list makes a race of one's own. Games and races describes the screens and the driving.

The address bar names the game being played as `/{gameId}`, so opening the same URL joins it from a second screen. A game cut off from the server joins it again by itself, with each car back where it was and holding what it held, if the server still has it; in a race it comes back at the last gate it passed. Players left on the start screen see the games come and go as they are made, joined and played.

The game server also serves the built client (`pnpm build`) on its own port, answering any path that names no file, such as `/{gameId}`, with `index.html`. A built client joins the server that served it, and the Vite client joins the server on port 8787 of the host it was loaded from. To use another server, set `VITE_SERVER_URL` when building or running the client (see `packages/client/.env.example`). The server honors `PORT` and `HOST`, and `CLIENT_DIR` to serve the client from somewhere other than `packages/client/dist`. Behind a reverse proxy, set `TRUST_PROXY=1` so the server tells players apart by the forwarded address.

## Keys

| | |
| --- | --- |
| Drive | arrows |
| Handbrake | `Space` |
| Select a weapon | `1`–`9` |
| Clear the weapon | `0` |
| Fire | `F` |
| Siren or horn | `D` |
| Respawn | `R` |
| Leave | `Esc` |

`D` is for show: on the police car, the ambulance and the fire truck it turns the siren on or off, flashing the roof lights and wailing, and on every other vehicle it blows the horn. Everyone nearby sees and hears it, and nothing else comes of it.

`R` puts the car back on the nearest road in a free drive, and in a race at the last gate it passed, facing the next one. `Esc` in the game room leaves the game for the start screen, in a free drive lets go of the world back into the room, and in a race leaves the race for good.

## The planet

Every island is wrapped round a planet about 612 m in radius, and you can drive, float or fly all the way round it. Gravity pulls toward the planet's middle, and the chase camera stands over wherever your car is. The planet turns under the sun once every ten minutes of game time, so day and night go round it: the side facing the sun is lit and the night side is dark, under a dark sky. Clouds float about 180 m up, carried slowly round the planet by the wind, and nothing driven or flown can go more than 10 m above them. Around your car the world is drawn as though the planet were eight times bigger, which puts the horizon nearly three times as far off; only the drawing is bent, not the game. Islands lie anywhere on it, the poles included.

## Portals

Three to five portals stand in the open country of every planet: glowing rings wide enough for a truck, with a clear run through them. Every planet has six other worlds, all made from its seed, and in a free drive each time a car drives through a portal it goes to one of the worlds it isn't on, picked at random, coming out of that world's first portal. A portal that leads back to the planet comes out at the portal you left the planet by. Each world of each game is a room of its own on the server, so everyone in the same game who goes through meets there. A race starts on the planet, so the game room shows the island of the game's seed, its other worlds a click away for a look alone; the start screen draws each game's island.

In a race the course decides where a portal leads: the world keeps the portals the course runs through and no others, and the portal at the end of a world's run of checkpoints is the way on to the next world, coming out at its paired portal. The last world has no portal on the course: its finish line is the end of the race.

- **The moon** is half the planet's size, gray and airless under a black sky, with craters, mountain ranges and valleys, a flag beside the lander that brought it, and two portals on it.
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

An island has 128 bananas, floating around it and turning slowly. Drive through one to collect it, and another appears somewhere else a little later. Bananas are the fuel every weapon runs on. A wrecked car spills all of its bananas around the wreck for anyone to collect, and they lie there until someone does. Each spilled banana takes one of the island's 128: the ones waiting to reappear first, then ones out on the island, which vanish from where they were. An island holds at most 256 bombs, mines and rockets at once, and past that the oldest disappear.

Thirty-two health packs, red crosses on white discs, are scattered the same way. A damaged car that drives through one has half its damage mended, and another pack appears somewhere else a little later. A car with no damage passes through and leaves the pack for someone else, and a magnet does not pull health packs.

## Robots

Two robots patrol the arterials of every island, rolling slowly along one road and turning off onto another at each junction. A robot burns the nearest car its eyes can see within 70 m with a laser beam for a second, then takes four seconds to charge. They are shown in red on the mini-map. Nothing stops a robot: it rolls through whatever is in its way, and a car that runs into it hits a wall. A robot takes damage from guns, lasers, rockets, bombs, mines and a ram plow driven into it, though it is five times tougher than the sports car, and it sets off any bomb or mine it rolls onto. It smokes when badly hurt, and when brought down it blows up, spills ten bananas about where it fell, and comes back whole on another arterial. A saucer or spider brought down spills ten bananas too.

## Flying saucer

A flying saucer cruises high over every island, shown in green on the mini-map. Every forty seconds or so it goes after the nearest car within 250 m, comes down over it, and lifts it up a green beam for three seconds. It then carries the car off across the island at 40 m/s and lowers it onto a road there. A car that gets clear of the beam while it is being lifted is let go. The saucer can be shot down as a robot can, and comes back high over somewhere else.

## Spider

A giant spider, its body ten meters up on legs nearly twenty meters long, walks slowly across every moon from one spot to the next, high enough for a car to drive under it between its legs. Every thirty seconds a bomb falls from its belly. It is shown in purple on the mini-map, and can be shot down as a robot can, coming back somewhere else.

## Traffic

Twenty cars nobody drives potter slowly around the arterials of every island in the seats players leave empty: small cars, sports cars, pickups, semis, police cars, ambulances and fire trucks. They are shown in gray on the mini-map, and one gives up its seat whenever the island is full and someone else wants to join. They keep to the right-hand lane, carry no weapons, take no bananas or health packs, and set off any bomb or mine they drive onto. They are fragile: a weapon takes three times as much of one as of any other car, and so does a crash. Wrecked, one comes back on the road nearby like anyone else, and it is put back a little further along its road if it goes nowhere for six seconds.

## Games and races

The first screen asks for the player's name if it does not know one yet, and the browser remembers it for next time. The start screen then lists the games on the server as they are now, each with a picture of its island, its seed, whether it is a race or a free drive, who hosts it, how many players it has of the slots it has, and whether it is waiting for players, preparing its course, starting, under way or finished. A game that can be joined has **Join**; a race that is under way has **Watch** in its place; one still preparing or already finished has neither. Behind the list a race plays out, the camera chasing its leader: the server's demo, four bots through two worlds with every rule on, made when somebody comes to the start screen and replaced by a fresh one once it is over. The demo is not itself in the list.

**Host a game** sits above the list and makes a race of one's own to be its host in. A new game has four slots: the host's and three bots'. Anyone may join a game that is waiting with a bot's slot left to take, and a player who leaves turns their slot back into a bot.

The game room fills the screen: down the left, in the start screen's own panel, are the game's slots; down the right, wider, the game's options over the world being looked at. Down the left are the game's title, a line naming who hosts it and what it waits for, and a row for each slot: its name, with a crown for the host and a robot for a bot, the vehicle it drives and whether it is ready. A player's own row has a **Ready** box, or a **Drive** button in a free drive, and a **Car** button that opens the car modal on their vehicle. A bot's row has **Car** and a cross to take its slot away, for the host alone, and **Add a bot** sits under them, up to eight slots. Down the right is the card of options: whether the game is a race or a free drive, its seed with a die to roll another, for a race how many of the seed's worlds it runs through, from two to four, and whether weapons and bananas are on. The host sets them, and only while the game may still be set up; everyone else sees them, and the card says only the host sets the game. Under it is a stage with the seed's seven worlds over it. A race always starts on the island, which is the world shown, and any player may click another of the seed's worlds to look over it, which changes nothing for anyone else.

The car modal is a dialog over the room: the vehicle on the showroom's turntable, an arrow either side of it or the arrow keys to flick along the line, its name, a line on what it is like to drive, any ability of its own, its top speed, grip and toughness against the best of them, and a pip for each vehicle. **Choose** takes it, for one's own slot or for a bot's, and **Cancel**, Escape or a click outside leaves it as it was. Everyone sees each change at once.

Start prepares the course and puts every racer on a starting grid in the island's world, bots included. Once everyone is there and driving, it counts down from three and they are off: there is no intro, and the controls are locked from the grid to the go, so nobody drives or fires and nothing that hits a car on the grid hurts it. A race is a course through the seed's worlds, the island first and then the others, every kind at most once. On each world a run of checkpoints leads from where a racer starts or arrives to the portal on to the next world, along the roads where the world has them; that portal is itself a checkpoint. The last world's run ends at a finish line. The course is worked out from the game's seed and length, so a race on one seed always runs the same course.

Bots race as anyone does. They line up on the grid, follow the course from gate to gate, go through the portal to the next world and finish, and stand in the standings with a robot before their names. They differ a little in pace, so they spread out, and they never fire a weapon. A bot stuck for three seconds, or wrecked, is put back at the last gate it passed.

Each gate has to be passed in order, within 14 m of it, and a wrecked car passes nothing. A gate is a glowing gold arch across the road, wide enough to drive through, with a sign on top giving its number, or PORTAL or FINISH for the last, and a beam of light above it, the next one bright and the one after it faint; the radar shows each of the world's gates by number, the next one large, with a line from the car to it, and a compass under the car always points the way to the next gate, saying which gate it is and how far. The HUD reads the race off as it goes: "2nd of 5", "gate 3 of 6", "world 1 of 3" and the time. `R` puts the car back at the last gate it passed, facing the next one, never on the gate it has still to pass.

The first over the finish line wins, and everyone else has a minute more to finish, or less if everyone is home before that. A racer who is home is taken off the controls, the car braking to a stop past the line, and a celebration goes up over it: the place huge in falling confetti, whether that is a win, a podium or just home, the time, who else is home so far, and then the race's standings in their place, with **Back to lobby** under it, focused, as Escape is too. The camera keeps chasing the car while the others come in behind the celebration, and the drive is let go when the server closes the finished game's rooms, the demo playing on behind it. A racer still out when time runs out sees the standings on their own, and leaves with the same button. A racer who leaves mid-race is out of it; one whose connection drops keeps its place and its gates, and comes back to them.

Anyone may look on at a race that is under way, without taking a seat: **Watch** on its card puts it behind the start screen in the demo's place, the camera following its leader from world to world, and pressing **Watch** again goes back to the demo. A watcher holds no slot and sends nothing, and the race is unaffected by it.

A free drive is never under way: it is joinable while it has room, and pressing Drive in its room puts the player in the world, Escape taking them back to the room. Its bots potter about the world like traffic does, under their names, and its portals lead about the planet's worlds as they always have.

The host can turn weapons or bananas off for a game. A game without weapons has nothing to fire and no engine, wings or plow to switch on. A game without bananas has nothing to collect and nothing to spill, and weapons then cost nothing to fire, however many bananas the car holds. Traffic, robots, meteors, the spider and the flying saucer stay in every game, in both modes, and so do health packs.

While the cars line up the screen says to get ready; then 3, 2, 1 and Go! cross the middle of the screen. Its end names the winner, as in "Ada in an ambulance", with confetti for the winner and a rain cloud and a sad trombone for everyone else.

## Achievements

Ninety-seven achievements are there to be had, each paid once ever to a player's key, for collecting and holding bananas, wrecking cars with weapons (other players' and traffic alike), bringing down robots, winning races, time in the air, top speed, using each weapon and all nine, driving up to landmarks such as the observatory, the lighthouse, a pyramid or the moon's flag, going through portals, driving into the sea and climbing over the clouds. Each pays its bananas, and they come through a portal with the car. They are earned and kept in every mode: in a race they are recorded against the player's key just the same, and what they pay goes into the race's own bananas, which are lost with it. The server pays one at a time, three seconds apart, and the player's screen shows a card for it at the top with what it took and what it paid, over a show of its own: confetti, raining bananas, fireworks, balloons, a burst of stars, or its icon bouncing across the screen or spinning up big.

## Players' keys

On a player's first visit the page makes them a nostr key and keeps it in the browser. It is used for nothing but proving to the server which seat is theirs. Every time a player opens a game, the server's welcome carries a fresh challenge. The page answers with a nostr event naming it, signed by the key, the way a client authenticates to a relay (NIP-42). The server believes the key only if the signature checks out and the event is less than ten minutes off its own clock. A player who comes through a portal, or rejoins after a dropped connection, keeps the key already proved. The server pays achievements only to a proved key, pays each achievement to a key once ever, and in a free drive remembers the bananas a key holds: a free-drive player joining afresh starts with the bananas they held when they last left one, saved every ten seconds while they play and whenever they go. A race is not a free drive: a racer starts it with no bananas, and whatever they hold at the end is thrown away, leaving the balance the key keeps untouched. It keeps all of this in `data/players.json`, or wherever `PLAYERS_FILE` says. In the Docker image that is `/app/data`, a volume to mount so it outlasts the container. A browser that has its storage cleared gets a new key, and starts again.

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

The vehicles differ in how they drive and what they can take, not in their weapons. Each has its own armor, which sets how much it takes from crashes and weapons alike. Against a weapon, the tank takes under half of what the sports car takes, and the go-kart takes a little more. Some vehicles also have a passive ability, below.

- **Tank** fires its rockets, machine gun and laser from its own gun, with nothing mounted over its roof for them.
- **Dune buggy** rides on long, soft, lightly damped springs, so it bounces over whatever it meets.
- **Amphibian** is a boat's hull on four wheels: slow on the road, but it floats, and in the water its throttle and steering drive it like a boat. It is never put back on shore.
- **Ambulance** repairs 1% of its health every five seconds.
- **Fire truck** takes a tenth of the damage from bombs, mines and meteors.
- **Police car** takes half damage from machine guns.

## Docker

The workflow in `.github/workflows/docker.yml` publishes the game server, with the client built in, as an image at `ghcr.io/staab/buggies`. Every push to the default branch is tagged `latest` and with its commit, and a release tag such as `v1.2.0` is tagged with its version. The server listens on port 8787, serving both the page and its WebSockets there, and honors `HOST`, `PORT` and `TRUST_PROXY` as above. It keeps players' achievements and bananas in `/app/data/players.json`: mount a volume at `/app/data`, such as `-v buggies-data:/app/data` or a `volumes:` entry in docker compose, or they are lost with the container. Nothing is baked in at build time: the page joins whatever address it is served from, so a reverse proxy in front only needs to pass WebSocket upgrades through to the same port.

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
- `client`: the browser, with rendering, input, the screens and the online mode.

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

The tests cover terrain, driving, the course, the wire format, and full sessions with several predicting clients connected to a server over a simulated network, through the lobby, the game room, races across worlds with bots in them, and a watcher looking on. They run in Node without a browser.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a [tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a [cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). The dune buggy and the amphibian are built in code. See `CREDITS.md`.
