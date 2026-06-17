// Background sync: pushes dirty annotations to the server opportunistically.
// The user-visible "save" already happened locally (IndexedDB); this is just backup,
// so failures are harmless — rows stay dirty and retry later.

import { db } from '../../data/db';
import { syncAnnotations } from '../../data/api';
import type { AnnotationDTO } from '../../../../shared/types';

type Status = 'synced' | 'pending' | 'offline';
const listeners = new Set<(s: Status) => void>();
export function onSyncStatus(cb: (s: Status) => void) {
  listeners.add(cb);
  return () => { listeners.delete(cb); };
}
function emit(s: Status) { listeners.forEach((l) => l(s)); }

let flushing = false;

export async function flush(): Promise<void> {
  if (flushing) return;
  if (!navigator.onLine) { emit('offline'); return; }
  flushing = true;
  try {
    const dirty = await db.annotations.where('dirty').equals(1).toArray();
    if (dirty.length === 0) { emit('synced'); return; }
    emit('pending');
    const items: AnnotationDTO[] = dirty.map(({ dirty: _d, ...rest }) => rest);
    const res = await syncAnnotations(items);
    await db.transaction('rw', db.annotations, async () => {
      for (const id of res.accepted) {
        const row = await db.annotations.get(id);
        // only clear dirty if it wasn't edited again during the request
        if (row && row.clientRev === items.find((i) => i.imageId === id)!.clientRev) {
          await db.annotations.update(id, { dirty: 0 });
        }
      }
    });
    const remaining = await db.annotations.where('dirty').equals(1).count();
    emit(remaining ? 'pending' : 'synced');
  } catch {
    emit(navigator.onLine ? 'pending' : 'offline');
  } finally {
    flushing = false;
  }
}

// sendBeacon survives tab close / app backgrounding where fetch would be killed.
async function beaconFlush() {
  const dirty = await db.annotations.where('dirty').equals(1).toArray();
  if (dirty.length === 0) return;
  const items: AnnotationDTO[] = dirty.map(({ dirty: _d, ...rest }) => rest);
  const blob = new Blob([JSON.stringify({ items })], { type: 'application/json' });
  navigator.sendBeacon('/api/annotations/sync', blob);
}

let started = false;
export function startSyncEngine() {
  if (started) return;
  started = true;

  setInterval(() => { void flush(); }, 10_000);     // periodic
  window.addEventListener('online', () => { void flush(); }); // reconnect
  window.addEventListener('offline', () => emit('offline'));

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') void beaconFlush(); // tab close / background
  });
  window.addEventListener('pagehide', () => { void beaconFlush(); });

  void flush();
}
