// Uses Node 24's built-in SQLite (no native build step). Same shape as better-sqlite3
// (prepare/run/get/all), so swapping to better-sqlite3 or Postgres later is mechanical.
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const DB_PATH = resolve(process.cwd(), 'data', 'app.db');
mkdirSync(dirname(DB_PATH), { recursive: true });

export const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = ON;');

// Base schema — session_id is omitted here so the CREATE TABLE is compatible with
// both a fresh DB and an existing one (migration adds the column below).
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id                   TEXT PRIMARY KEY,
    title                TEXT NOT NULL,
    created_at           TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at           TEXT NOT NULL DEFAULT (datetime('now')),
    last_viewed_image_id TEXT,
    last_activity_at     TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS images (
    id           TEXT PRIMARY KEY,
    original_url TEXT NOT NULL,
    mobile_url   TEXT NOT NULL,
    thumb_url    TEXT NOT NULL,
    width        INTEGER NOT NULL,
    height       INTEGER NOT NULL,
    bytes        INTEGER NOT NULL,
    sort_index   INTEGER NOT NULL,
    upload_date  TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_images_sort ON images(sort_index);

  CREATE TABLE IF NOT EXISTS annotations (
    image_id     TEXT PRIMARY KEY REFERENCES images(id) ON DELETE CASCADE,
    drawing_data TEXT NOT NULL DEFAULT '{"v":1,"strokes":[]}',
    notes        TEXT NOT NULL DEFAULT '',
    updated_at   INTEGER NOT NULL DEFAULT 0,
    client_rev   INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_annotations_updated ON annotations(updated_at);
`);

// ── migration: add session_id column if this is an existing database ──
const imgCols = db.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>;
if (!imgCols.some((c) => c.name === 'session_id')) {
  db.exec('ALTER TABLE images ADD COLUMN session_id TEXT;');
}
// Composite index backs both the paginated images list and the annotation-offset
// aggregate (WHERE session_id = ? AND sort_index < ?) — both need session+order range
// scans that the separate single-column indexes below can't satisfy as efficiently.
db.exec('CREATE INDEX IF NOT EXISTS idx_images_session_sort ON images(session_id, sort_index);');
// Create the index after the column is guaranteed to exist (safe to run repeatedly).
db.exec('CREATE INDEX IF NOT EXISTS idx_images_session ON images(session_id);');

// ── migration: add stroke_count column, used to compute global annotation numbering
// offsets via SQL SUM() instead of loading every prior image's annotations into the
// client. Backfilled once from existing drawing_data so old rows stay correct. ──
const annoCols = db.prepare('PRAGMA table_info(annotations)').all() as Array<{ name: string }>;
if (!annoCols.some((c) => c.name === 'stroke_count')) {
  db.exec('ALTER TABLE annotations ADD COLUMN stroke_count INTEGER NOT NULL DEFAULT 0;');
  const rows = db.prepare('SELECT image_id, drawing_data FROM annotations').all() as Array<{
    image_id: string; drawing_data: string;
  }>;
  const backfill = db.prepare('UPDATE annotations SET stroke_count = ? WHERE image_id = ?');
  for (const r of rows) {
    const parsed = JSON.parse(r.drawing_data) as { strokes?: unknown[] };
    backfill.run(parsed.strokes?.length ?? 0, r.image_id);
  }
}
// Note: annotations.image_id is already the PRIMARY KEY, so the offset aggregate's
// JOIN from images down to annotations is already indexed — no extra index needed.

// ── migration: S3 storage metadata. storage_provider defaults to 'local' so every
// pre-existing row (written before S3 support existed) keeps resolving its image
// bytes from local disk; only newly-uploaded rows get storage_provider = 's3'. ──
const storageCols = db.prepare('PRAGMA table_info(images)').all() as Array<{ name: string }>;
if (!storageCols.some((c) => c.name === 'storage_provider')) {
  db.exec("ALTER TABLE images ADD COLUMN storage_provider TEXT NOT NULL DEFAULT 'local';");
}
if (!storageCols.some((c) => c.name === 's3_key_prefix')) {
  // Prefix only (e.g. "uploads/{sessionId}/{imageId}") — the three variant keys live
  // under it, so a single prefix delete on cleanup removes original/mobile/thumb together.
  db.exec('ALTER TABLE images ADD COLUMN s3_key_prefix TEXT;');
}
if (!storageCols.some((c) => c.name === 'mime_type')) {
  db.exec("ALTER TABLE images ADD COLUMN mime_type TEXT NOT NULL DEFAULT 'image/webp';");
}

// Migrate orphaned images (no session_id) into a legacy session.
const orphans = (
  db.prepare('SELECT COUNT(*) AS n FROM images WHERE session_id IS NULL').get() as { n: number }
).n;
if (orphans > 0) {
  db.prepare(
    `INSERT OR IGNORE INTO sessions (id, title, created_at, updated_at, last_activity_at)
     VALUES ('legacy', 'Imported Images', datetime('now'), datetime('now'), datetime('now'))`
  ).run();
  db.prepare('UPDATE images SET session_id = ? WHERE session_id IS NULL').run('legacy');
}

export function nextSortIndex(sessionId: string): number {
  const row = db.prepare(
    'SELECT COALESCE(MAX(sort_index), -1) + 1 AS n FROM images WHERE session_id = ?'
  ).get(sessionId) as { n: number };
  return row.n;
}
