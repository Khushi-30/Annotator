import { useEffect, useRef, useState } from 'react';
import { Carousel } from '../features/carousel/Carousel';
import { SyncBadge } from './SyncBadge';
import { db } from '../data/db';
import { fetchImages, patchSession } from '../data/api';
import { ensureAnnotationsForPage, resetAnnotationPageCache } from '../data/annotationPageCache';
import type { ImageMeta } from '../../../shared/types';

// Fix C: images are fetched one page at a time instead of the whole session catalog.
// `images` is held at full `total` length with holes (undefined) for pages not yet
// fetched, so the carousel's index math and counter work the same as before while
// the network only ever pulls the current page plus its immediate neighbors.
const PAGE_SIZE = 50;
const pageOf = (index: number) => Math.floor(index / PAGE_SIZE) + 1;

interface Props {
  sessionId: string;
  sessionTitle: string;
  initialIndex: number;
  onBack: () => void;
}

export default function WorkspaceView({ sessionId, sessionTitle, initialIndex, onBack }: Props) {
  const [images, setImages] = useState<(ImageMeta | undefined)[] | null>(null);
  const requestedPages = useRef<Set<number>>(new Set());

  function placePage(
    prev: (ImageMeta | undefined)[] | null, page: number, items: ImageMeta[], total: number,
  ): (ImageMeta | undefined)[] {
    const next = prev && prev.length === total
      ? prev.slice()
      : new Array<ImageMeta | undefined>(total).fill(undefined);
    const start = (page - 1) * PAGE_SIZE;
    items.forEach((im, i) => { next[start + i] = im; });
    return next;
  }

  async function ensurePageLoaded(sid: string, page: number) {
    if (page < 1 || requestedPages.current.has(page)) return;
    requestedPages.current.add(page);
    try {
      const res = await fetchImages(sid, page, PAGE_SIZE);
      if (res.totalPages > 0 && page > res.totalPages) return;
      // Metadata is tiny (~ids + urls + dims) — keeping it in Dexie indefinitely costs
      // negligible space and is what lets session resume work offline. Only the heavy
      // stuff (decoded bitmaps via imagePreloader, annotation page fetches) is bounded.
      await db.images.bulkPut(res.items);
      setImages((prev) => placePage(prev, page, res.items, res.total));
      void ensureAnnotationsForPage(page, res.items);
    } catch {
      requestedPages.current.delete(page); // allow a retry on next navigation
    }
  }

  useEffect(() => {
    setImages(null);
    requestedPages.current = new Set();
    resetAnnotationPageCache();
    const startPage = pageOf(initialIndex);
    void ensurePageLoaded(sessionId, startPage);
    void ensurePageLoaded(sessionId, startPage - 1);
    void ensurePageLoaded(sessionId, startPage + 1);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // Fired immediately (not debounced) on every index change so the next/prev page's
  // annotations are already in Dexie by the time the user swipes into them.
  const handleIndexChange = (index: number) => {
    const page = pageOf(index);
    void ensurePageLoaded(sessionId, page);
    void ensurePageLoaded(sessionId, page - 1);
    void ensurePageLoaded(sessionId, page + 1);
  };

  const handlePositionChange = (imageId: string) => {
    void patchSession(sessionId, { lastViewedImageId: imageId });
  };

  if (images === null) return <div className="splash">Loading…</div>;

  return (
    <div className="app">
      <header className="topbar">
        <button className="back-btn" onClick={onBack} aria-label="Back to sessions">‹ Sessions</button>
        <span className="brand session-workspace-title">{sessionTitle}</span>
        <SyncBadge />
      </header>
      {images.length > 0
        ? (
          <Carousel
            images={images}
            initialIndex={initialIndex}
            onIndexChange={handleIndexChange}
            onPositionChange={handlePositionChange}
          />
        )
        : <p className="splash">No images in this session.</p>}
    </div>
  );
}
