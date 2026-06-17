import { useEffect, useRef, useState } from 'react';
import { AnnotationEditor } from '../annotation/AnnotationEditor';
import { preloadNeighbors } from '../../data/imagePreloader';
import { flush } from '../sync/flusher';
import type { ImageMeta } from '../../../../shared/types';

const SWIPE_THRESHOLD = 50;

interface Props {
  // Sparse: index slots for pages not yet fetched are `undefined` (Fix C). Length is
  // always the session's total image count once known, so counter/bounds math is
  // unaffected by how much has actually loaded.
  images: (ImageMeta | undefined)[];
  initialIndex?: number;
  onPositionChange?: (imageId: string) => void;
  // Fired synchronously on every index change (unlike onPositionChange, which is
  // debounced) so the host can kick off page/annotation loads for the new position
  // without waiting for the user to settle.
  onIndexChange?: (index: number) => void;
}

export function Carousel({ images, initialIndex = 0, onPositionChange, onIndexChange }: Props) {
  const [index, setIndex] = useState(initialIndex);
  const i = Math.min(index, images.length - 1);
  const urls = images.map((im) => im?.mobileUrl);

  const posTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const go = (delta: number) => {
    setIndex((cur) => Math.max(0, Math.min(images.length - 1, cur + delta)));
  };

  // On image change: warm neighbors, push local edits, report position.
  useEffect(() => {
    preloadNeighbors(urls, i);
    void flush();
    onIndexChange?.(i);

    if (images[i] && onPositionChange) {
      if (posTimer.current) clearTimeout(posTimer.current);
      posTimer.current = setTimeout(() => onPositionChange(images[i]!.id), 1500);
    }
    return () => {
      if (posTimer.current) clearTimeout(posTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i]);

  // keyboard nav (desktop)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [images.length]);

  // edge-gutter swipe (keeps the center free for drawing)
  const start = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { start.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (start.current == null) return;
    const dx = e.changedTouches[0].clientX - start.current;
    if (Math.abs(dx) > SWIPE_THRESHOLD) go(dx < 0 ? 1 : -1);
    start.current = null;
  };

  const prev = images[i - 1];
  const next = images[i + 1];

  return (
    <div className="carousel" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* 3-node window: only prev/current/next exist in the DOM */}
      {prev && <img className="neighbor" src={prev.mobileUrl} alt="" aria-hidden decoding="async" />}
      {images[i]
        ? <AnnotationEditor key={images[i]!.id} image={images[i]!} />
        : <div className="splash">Loading…</div>}
      {next && <img className="neighbor" src={next.mobileUrl} alt="" aria-hidden decoding="async" />}

      {/* counter */}
      <div className="carousel-counter">{i + 1} / {images.length}</div>

      {/* edge gutters + arrows */}
      <button className="gutter left" onClick={() => go(-1)} disabled={i === 0} aria-label="Previous">‹</button>
      <button className="gutter right" onClick={() => go(1)} disabled={i >= images.length - 1} aria-label="Next">›</button>
    </div>
  );
}
