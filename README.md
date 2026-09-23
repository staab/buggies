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
