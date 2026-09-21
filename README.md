# Buggies

Procedurally generated islands, with roads worth driving — alone or with whoever else is on the
same server.

## Run it

```sh
pnpm install
pnpm dev
```

That starts everything: the Vite client on port 5173 and the game server on port 8787, both
reachable from other machines on the network. Open the client, pick **Online** in the menu, and
connect. The server field defaults to the game server next to whichever address the page was
opened on, so a second screen just opens the same URL and connects too.

The server chooses the island; set `SEED=42 pnpm --filter @buggies/server dev` for a particular
one. `PORT` and `HOST` are honoured as well.

**Free drive** and **Terrain preview** need no server.

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
