# Annotator — mobile image annotation (local-first)

Single-user image annotation PWA. Vector strokes + IndexedDB local-first auto-save.

## Stack
- **web/** — React + Vite + TS PWA, Konva canvas, Dexie (IndexedDB), 3-node windowed carousel
- **api/** — Fastify + TS, `sharp` image pipeline (original/mobile/thumb), SQLite, local-disk storage (R2-swappable)

## Run (two terminals)

```bash
# terminal 1
cd api
npm install
npm run dev          # http://localhost:8787

# terminal 2
cd web
npm install
npm run dev          # http://localhost:5173  (proxies /api -> 8787)
```

Open the web URL on your phone (same Wi-Fi: use the machine LAN IP printed by Vite).

## Architecture in one line
Edits write to **IndexedDB instantly** (never lose work, instant load), a background
queue syncs `dirty` rows to the server on nav / interval / reconnect / tab-close (`sendBeacon`).
Drawings are stored as **normalized vector strokes** (0..1), not flattened pixels.

## Swapping storage to Cloudflare R2
Implement the same interface in `api/src/services/storage.ts` (S3 client → R2 endpoint).
Everything else (URLs in DB) stays the same.
