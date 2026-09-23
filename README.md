# Buggies

Procedurally generated islands, with roads worth driving — alone or with whoever else is on the
same server.

## Run it

```sh
pnpm install
pnpm dev
```

That starts everything: the Vite client on port 5173 and the game server on port 8787, both
reachable from other machines on the network. Every game is on the server: open the client, pick
**1 player** or **2 players** on the first page of the menu, an island by its seed (looking it
over from above while you choose), a vehicle each, and play. Everyone who picks the same seed
shares that island; each seed is a room of its own on the server, made when the first player
asks for it and closed when the last leaves. A second screen just opens the same URL.

The page joins the server next to whichever address it was opened on; to point it elsewhere, set
`VITE_SERVER_URL` when building or running the client (see `packages/client/.env.example`). The
server honours `PORT` and `HOST`, and `TRUST_PROXY=1` behind a reverse proxy, so that it tells
players apart by the address the proxy forwards rather than the proxy's own.

**2 players** puts two of you on one keyboard, side by side, each with their own seat on the
server: the letters on the left (`W` `A` `S` `D`, `Space` handbrake, `Q` back to the road) and
the arrows on the right (left `Shift` handbrake, `?` back to the road).

Bananas float about every island, turning slowly; drive through one for a point, and another
turns up somewhere else a little later. A car wrecked spills its bananas about the wreck for
anyone to come and take.

Every tenth banana wins a power-up, rolled for like a fruit machine and carried over the roof for
everyone to see: a rocket, which goes after the nearest car ahead when fired; a machine gun with
ten seconds of ammunition, which trains itself on the nearest car ahead and fires as long as the key
is held; a bomb, dropped behind the car to float there until a car runs into it, the one that dropped
it included once it has landed; a rocket
engine, which shoves the car along while the key is held, for ten seconds in all; or wings, which
lift the car into the air while the key is held, for ten seconds in all, and let it turn up there.
The tank fires its rockets and shots from its own gun, with nothing over its roof for them.
A wreck spills at most sixteen bananas, and only so much lies loose on an island at once: past 256 things,
the oldest go. `F` fires (or right `Shift`;
on a split screen the arrows player has right `Shift` and the letters player `F`). Both hurt.

## Packages

- `physics` — vectors, quaternions, a seeded RNG, the fixed timestep.
- `terrain` — an island from a seed: heightfield, rivers, lakes, districts, roads, tunnels.
- `vehicle` — the car: suspension, tyres, air control, self-righting, water, on Rapier.
- `game` — an arena: a map with seats on it, stepped one fixed tick at a time.
- `net` — the protocol, the server, and the client's prediction. No DOM, no three.js.
- `server` — the arena that counts, over WebSockets.
- `client` — the browser: rendering, input, menus, and the online mode.

## Check it

```sh
pnpm typecheck
pnpm test
```

The tests cover terrain, driving, the wire format, and a whole session — two clients on a
server over a simulated wire, with prediction — all in Node, no browser needed.

## Credits

The vehicles are drawn with Kenney's [Car Kit](https://kenney.nl/assets/car-kit) (CC0), a
[tank](https://poly.pizza/m/Dc4k4CooN3) by Quaternius (CC0) and a
[cargo truck](https://poly.pizza/m/Fy3WI3uXNQ) by J-Toastie (CC BY 3.0). See `CREDITS.md`.
