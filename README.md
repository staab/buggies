# Buggies

Procedurally generated islands, with roads worth driving, alone or with whoever else is on the same server.

## Run it

```sh
pnpm install
pnpm dev
```

That starts the Vite client on port 5173 and the game server on port 8787, both reachable from other machines on the network. Every game is on the server. Open the client, pick **1 player** or **2 players** on the first page of the menu, then an island by its seed, then a vehicle each, and play. Everyone who picks the same seed shares that island. Each seed is a room of its own on the server, made when the first player asks for it and closed when the last leaves. A second screen opens the same URL.

The page joins the server next to whichever address it was opened on. To point it elsewhere, set `VITE_SERVER_URL` when building or running the client (see `packages/client/.env.example`). The server honors `PORT` and `HOST`, and `TRUST_PROXY=1` behind a reverse proxy, so that it tells players apart by the address the proxy forwards.

## Keys

Alone, the arrows drive, `Space` is the handbrake, `F` fires whatever the car carries, `D` does what the car does of its own, `R` puts the car back on the road and `Esc` opens the menu. **2 players** puts two of you on one keyboard, side by side, each with a seat of their own on the server. The player on the left has `W` `A` `S` `D` to drive, `Z` for the handbrake, `X` to fire, `Shift` for the car's own and `Q` for the road. The player on the right has the arrows, `,`, `.`, `M` and `Enter`.

## Bananas

Bananas float about every island, turning slowly. Drive through one to take it, and another turns up somewhere else a little later. A car carrying nothing spends a banana on a power-up at once, rolled for like a fruit machine and carried over the roof for everyone to see. Bananas taken while it carries something are kept for the next one. A wrecked car spills its bananas, sixteen at most, about the wreck for anyone to take. Only so much lies loose on an island at once: past 256 things, the oldest go.

## Power-ups

The fire key uses whatever the car carries.

- **Rocket** goes after the nearest car ahead and takes most of its life when it reaches it.
- **Machine gun** trains itself on the nearest car ahead and fires as long as the key is held, for ten seconds in all. A few seconds of hits blows a car up.
- **Bomb** is dropped behind the car and floats there until a car runs into it and is wrecked, the one that dropped it included once it has landed.
- **Rocket engine** shoves the car along while the key is held, for ten seconds in all.
- **Wings** lift the car into the air while the key is held, for ten seconds in all. Up there the pedals drive it and the steering banks it around a wide turn like a plane.
- **Shockwave** stuns every other car within thirty meters for five seconds.
- **Siren** slows every other car within thirty meters by half while the key is held, for ten seconds in all.
- **Repair** is a red cross on a white disc that mends the car whole at once.

## Vehicles

Each vehicle does something of its own on its own key, whatever it carries. Most are lesser forms of the power-ups, and only the tank's and the pickup's have a wait before they go again. Nothing is mounted over the roof for them, the power-up slot leaves them out, and their shots and missiles come from the front of the car. The vehicle page of the menu says what the chosen car does and what it is by nature.

- **Tank** fires a missile from its gun with half a rocket's blast, every three seconds. Its rockets and shots always come from its own gun, with nothing over its roof.
- **Go-kart** hops off the ground, whenever it is on it.
- **Race car** boosts with half a rocket engine as long as the key is held.
- **Sports car** fires a machine gun from its nose with a quarter of the bite, as long as the key is held.
- **Small car** flies on wings with a tenth of the lift, as long as the key is held.
- **Semi truck** honks on every press, stunning every car within ten meters for a second.
- **Heavy pickup** drops a bomb with a quarter of the blast every five seconds, five out at once at most, the oldest going for the next.
- **Police car, ambulance and fire truck** flash their lights on and off, slowing every car within thirty meters by a fifth while on. None of them is slowed by any siren or lights. The ambulance mends itself, a hundredth of its life every five seconds. The fire truck takes a tenth of a bomb's blast. The police car takes half the bite of a machine gun.

## Docker

The game server is published as an image at `ghcr.io/staab/buggies` by the workflow in `.github/workflows/docker.yml`: on every push to the default branch as `latest` and by commit, and on a release tag such as `v1.2.0` by version. It listens on port 8787 and honors `HOST`, `PORT` and `TRUST_PROXY` as above.

```sh
docker run --rm -p 8787:8787 ghcr.io/staab/buggies
```

The first publish may need the package's visibility set in its settings on GitHub. To build the image here instead:

```sh
podman build -t buggies-server .
podman run --rm -p 8787:8787 buggies-server
```

## Packages

- `physics`: vectors, quaternions, a seeded RNG, the fixed timestep.
- `terrain`: an island from a seed, with its heightfield, rivers, lakes, districts, roads and tunnels.
- `vehicle`: the car, with its suspension, tires, air control, self-righting and water, on Rapier.
- `game`: an arena, a map with seats on it, stepped one fixed tick at a time.
- `net`: the protocol, the server and the client's prediction, with no DOM and no three.js.
- `server`: the arena that counts, over WebSockets.
- `client`: the browser, with rendering, input, menus and the online mode.

## Check it

```sh
pnpm typecheck
pnpm test
```

The tests cover terrain, driving, the wire format and a whole session, with two clients on a server over a simulated wire and prediction. They run in Node without a browser.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a [tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a [cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). See `CREDITS.md`.
