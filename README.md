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

Bananas float around every island, turning slowly. Drive through one to collect it, and another appears somewhere else a little later. Once a car carrying nothing has five bananas, it spends them on a power-up immediately. The power-up is rolled like a slot machine and carried over the roof for everyone to see. Bananas collected while the car carries something are saved toward the next one. A wrecked car spills up to sixteen of its bananas around the wreck for anyone to collect. An island holds at most 256 loose items, and past that the oldest disappear.

## Power-ups

The fire key uses whatever the car carries.

- **Rocket** chases the nearest car ahead and takes most of its health when it hits.
- **Machine gun** aims at the nearest car ahead and fires while the key is held, for five seconds in total. A few seconds of hits destroys a car.
- **Bomb** drops behind the car and floats there until a car runs into it and is wrecked. Once it has landed, it wrecks the car that dropped it too.
- **Rocket engine** pushes the car forward while the key is held, for ten seconds in total.
- **Wings** lift the car into the air while the key is held, for ten seconds in total. In the air, the pedals drive the car and the steering banks it into a wide turn like a plane. A car carrying wings steers this way whenever it is airborne, whether or not the key is held.
- **Shockwave** stuns every other car within 30 meters for five seconds.
- **Siren** slows every other car within 30 meters by half while the key is held, for five seconds in total.
- **Repair** fully repairs the car immediately. It appears as a red cross on a white disc.
- **Oil slick** drops a pool of oil behind the car that lasts a minute. Any car that drives into it, including the one that dropped it once it has landed, keeps a fifth of its grip while in it and for five seconds after.
- **Shield** protects the car for ten seconds from weapon damage, stuns and slows, and from being shoved by a ram plow or dragged by a grappling hook.
- **Magnet** collects every banana within 25 meters for 30 seconds.
- **Triple rocket** fires three rockets in a fan, each with half the blast of a rocket. Each chases a different car ahead, nearest first, and any rocket left over chases the nearest.
- **Ram plow** mounts a blade on the front of the car for ten seconds. Cars and props in front of it are thrown forward, faster than the car is closing on them.
- **Grappling hook** catches the nearest car within 60 meters ahead and reels the two together for four seconds, pulling the car that fired it harder. With no car ahead, the line shoots out and back and the hook is spent.
- **Mine field** lays five mines on the ground in a spread behind the car. Each mine goes off with 30% of a bomb's blast.

## Vehicles

Each vehicle has an active ability on its own key, separate from any power-up it carries. Most are weaker forms of the power-ups, and only the tank's, the small car's and the pickup's have a cooldown. Active abilities are not mounted over the roof or shown in the HUD, and their shots and missiles come from the front of the car. Some vehicles also have a passive ability. The vehicle page of the menu describes both.

- **Tank** fires a missile from its gun with half the blast of the rocket power-up, every three seconds. Its rocket, triple rocket and machine gun power-ups also fire from its gun, with nothing mounted over its roof.
- **Go-kart** jumps into the air whenever it is on the ground.
- **Race car** boosts with half the force of the rocket engine power-up while the key is held.
- **Sports car** fires a machine gun from its nose at the car ahead while the key is held, with a quarter of the damage of the machine gun power-up.
- **Small car** drops an oil slick behind with half the slip of the oil slick power-up, every three seconds. Up to three can be out at once, and a fourth replaces the oldest.
- **Semi truck** honks its horn, stunning every car within 10 meters for a second.
- **Heavy pickup** drops a bomb behind with a quarter of the blast of the bomb power-up, every five seconds. Up to five can be out at once, and a sixth replaces the oldest.
- **Police car, ambulance and fire truck** turn their lights on or off. While the lights are on, every car within 30 meters is slowed by 20%. As a passive ability, none of them is slowed by sirens or lights. The ambulance also repairs 1% of its health every five seconds, the fire truck takes a tenth of the damage from bombs, and the police car takes half damage from machine guns.

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
- `terrain`: an island from a seed, with its heightfield, rivers, lakes, districts, roads and tunnels.
- `vehicle`: the car, with its suspension, tires, air control, self-righting and water, on Rapier.
- `game`: the arena, a map with seats on it, stepped one fixed tick at a time.
- `net`: the protocol, the server and the client's prediction, with no DOM and no three.js.
- `server`: the authoritative arena, over WebSockets.
- `client`: the browser, with rendering, input, menus and the online mode.

## Check it

```sh
pnpm typecheck
pnpm test
```

The tests cover terrain, driving, the wire format, and a full session with two predicting clients connected to a server over a simulated network. They run in Node without a browser.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a [tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a [cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). See `CREDITS.md`.
