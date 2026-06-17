// Single source of truth for turning (offset, in-image index) into the displayed
// global annotation number. Any component rendering strokes should call this rather
// than computing numbers itself, so the formula only lives in one place.
export function globalAnnotationNumber(offset: number, indexInImage: number): number {
  return offset + indexInImage + 1;
}
