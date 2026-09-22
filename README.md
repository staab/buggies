# Buggies

Procedurally generated islands, with roads worth driving — alone or with whoever else is on the
same server.

## Run it

```sh
pnpm install
pnpm dev
```

That starts everything: the Vite client on port 5173 and the game server on port 8787, both
reachable from other machines on the network. Open the client, pick **Online** on the first page
of the menu, and connect. The server field defaults to the game server next to whichever address
the page was opened on, so a second screen just opens the same URL and connects too.

The server chooses the island; set `SEED=42 pnpm --filter @buggies/server dev` for a particular
one. `PORT` and `HOST` are honoured as well.

Bananas float about every island, turning slowly; drive through one for a point, and another
turns up somewhere else a little later. Bombs float about too, and one of those blows the car up.
Online, the server keeps the score.

**Free drive** needs no server: pick an island by its seed, looking it over from above while you
do, then a vehicle, and go. **Split screen** puts two of you on one keyboard, side by side: the
letters on the left (`W` `A` `S` `D`, `Space` handbrake, `Q` back to the road) and the arrows on
the right (left `Shift` handbrake, `?` back to the road).

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
