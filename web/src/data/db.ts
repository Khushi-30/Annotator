import Dexie, { type Table } from 'dexie';
import type { DrawingData, ImageMeta, Session } from '../../../shared/types';

export interface LocalAnnotation {
  imageId: string;
  drawingData: DrawingData;
  notes: string;
  updatedAt: number;
  clientRev: number;
  dirty: 0 | 1; // 1 = needs push to server. Indexed -> powers the sync queue.
}

class AppDB extends Dexie {
  images!: Table<ImageMeta, string>;
  annotations!: Table<LocalAnnotation, string>;
  sessions!: Table<Session, string>;

  constructor() {
    super('annotator');
    this.version(1).stores({
      images: 'id, sortIndex',
      annotations: 'imageId, dirty, updatedAt',
    });
    // v2: images gain sessionId index; sessions table added
    this.version(2).stores({
      images: 'id, sortIndex, sessionId',
      annotations: 'imageId, dirty, updatedAt',
      sessions: 'id, lastActivityAt',
    });
  }
}

export const db = new AppDB();
