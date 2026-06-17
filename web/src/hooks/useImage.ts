import { useEffect, useState } from 'react';

export function useImage(url: string): HTMLImageElement | null {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  useEffect(() => {
    const image = new Image();
    image.decoding = 'async';
    image.src = url;
    let alive = true;
    const done = () => { if (alive) setImg(image); };
    if (image.complete) done();
    else image.onload = done;
    return () => { alive = false; image.onload = null; };
  }, [url]);
  return img;
}
