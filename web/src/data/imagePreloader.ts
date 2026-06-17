// Warms the browser's decode cache for neighbor images so swiping is instant.
//
// Fix B: this used to be an unbounded Map that never evicted, so every image visited
// in a session stayed referenced (and its decoded bitmap un-collectable) for the life
// of the tab — the dominant long-session memory leak. It's now a bounded LRU: once
// the cache exceeds maxSize, the least-recently-used entry's `src` is cleared (so the
// decoded bitmap has no remaining reference and the GC can reclaim it) before the
// entry itself is dropped.
const DEFAULT_CACHE_SIZE = 50;

class LRUImageCache {
  private readonly cache = new Map<string, HTMLImageElement>();
  private maxSize: number;

  constructor(maxSize = DEFAULT_CACHE_SIZE) {
    this.maxSize = maxSize;
  }

  has(url: string): boolean {
    return this.cache.has(url);
  }

  // Marks an existing entry as recently used (Map preserves insertion order, so
  // re-inserting moves it to the "most recent" end).
  touch(url: string): void {
    const img = this.cache.get(url);
    if (!img) return;
    this.cache.delete(url);
    this.cache.set(url, img);
  }

  set(url: string, img: HTMLImageElement): void {
    this.cache.delete(url);
    this.cache.set(url, img);
    this.evictOverflow();
  }

  setMaxSize(n: number): void {
    this.maxSize = Math.max(1, n);
    this.evictOverflow();
  }

  get size(): number {
    return this.cache.size;
  }

  private evictOverflow(): void {
    while (this.cache.size > this.maxSize) {
      const oldestUrl = this.cache.keys().next().value as string;
      const oldest = this.cache.get(oldestUrl);
      if (oldest) oldest.src = ''; // release the decode so it can be garbage collected
      this.cache.delete(oldestUrl);
    }
  }
}

const cache = new LRUImageCache(DEFAULT_CACHE_SIZE);

// Lets callers tune cache size (e.g. lower it on memory-constrained devices).
export function configureImageCacheSize(maxSize: number): void {
  cache.setMaxSize(maxSize);
}

export function preload(url?: string): void {
  if (!url) return;
  if (cache.has(url)) { cache.touch(url); return; }
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  cache.set(url, img);
}

// Given the full ordered list and current index, warm i+1, i-1, i+2. Already aligned
// to the current page window: callers only ever pass the small set of URLs adjacent
// to the visible image, so this never preloads outside the current/adjacent pages.
export function preloadNeighbors(urls: (string | undefined)[], index: number): void {
  preload(urls[index + 1]);
  preload(urls[index - 1]);
  preload(urls[index + 2]);
}
