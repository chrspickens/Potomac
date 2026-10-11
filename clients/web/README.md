# Potomac web foundation demo

React/Vite client for the foundation localhost host. One character renderer reads module supplied stat, resource, section, and action definitions. GM and player select separate bearer-token projections. The dashboard includes live encounter context, activity events, and compact party character bricks that dispatch the same action request as the full view.

## Start

Run the host from the repository root with `node server/host/index.mjs` (Node 22.5+). In this directory, run `npm run dev` after dependencies are available. The Vite proxy forwards `/api` and `/health` to `http://127.0.0.1:4177`, avoiding cross-origin preflight with the current localhost host. Set `VITE_POTAMAC_HOST=/` in a local `.env.local` file to enable host mode. Credentials default to the host's `local-gm` and `local-player`; override them with `VITE_POTOMAC_GM_TOKEN` and `VITE_POTOMAC_PLAYER_TOKEN` as needed.

The host loads the bundled module manifests, schemas, views, and typed rules from `modules/` at startup. On the first GM load against an empty host, the client creates one example actor per module through `POST /api/actors`. The host validates each actor against its system schema; the sample GM note is marked under `visibility.gmOnly`. Host mode reads `GET /api/state`, posts action envelopes to `POST /api/actions`, updates active encounter through `POST /api/context`, and consumes authenticated SSE from `GET /api/stream?since=<cursor>`. It uses `fetch` streaming to attach the required bearer header, then refreshes `/api/state` after each authorized event.

Without `VITE_POTOMAC_HOST`, a labeled in-memory preview runs locally. Preview rolls and changes are illustrative only. The host action contract currently does not provide verified dice results, so host mode does not present preview rolls as authoritative outcomes. Offline queue/review/conflict workflows and schema/rules validation are outside this web-only slice.
