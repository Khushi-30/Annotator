// Shared contract between web and api. Kept dependency-free so both can import a copy.

export interface Session {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  totalImages: number;
  completedImages: number;
  annotationCount: number;
  lastViewedImageId: string | null;
  lastActivityAt: string;
  previewThumbUrl: string | null;
}

export interface ImageMeta {
  id: string;
  sessionId: string;
  originalUrl: string;
  mobileUrl: string;   // carousel image (<=1600px webp)
  thumbUrl: string;    // ~240px webp
  width: number;       // intrinsic px of the mobile variant
  height: number;
  bytes: number;
  sortIndex: number;
  uploadDate: string;
  mimeType: string;
}

export interface UploadFailure {
  filename: string;
  error: string;
}

// POST /api/images/upload response: per-batch results, since a single failed file
// (corrupt image, transient S3 error) shouldn't fail the other 19+ files in the chunk.
export interface UploadResponse {
  created: ImageMeta[];
  failed: UploadFailure[];
}

// 3 annotation "classes" -> 3 colors. Index maps to COLORS on the client.
export type ColorIndex = 0 | 1 | 2;

export interface Stroke {
  c: ColorIndex;   // class/color index
  w: number;       // stroke width, normalized to image width (0..1)
  p: number[];     // flat [x0,y0,x1,y1,...], each normalized 0..1
}

export interface DrawingData {
  v: 1;
  strokes: Stroke[];
}

export interface AnnotationDTO {
  imageId: string;
  drawingData: DrawingData;
  notes: string;
  updatedAt: number;   // epoch ms (last-write-wins key)
  clientRev: number;   // monotonic per client
}

export interface SyncRequest {
  items: AnnotationDTO[];
}
export interface SyncResponse {
  accepted: string[];
  conflicts: string[];
}

// Generic page envelope used by paginated list endpoints (currently GET /api/images).
export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  totalPages: number;
}

// GET /api/annotations/bulk response: imageId -> 0-or-1-length array of its annotation
// row. Array shape (rather than a single nullable DTO) matches the documented contract
// and leaves room for a future move to one-row-per-stroke without a breaking change.
export type AnnotationsBulkResponse = Record<string, AnnotationDTO[]>;

export interface AnnotationOffsetResponse {
  offset: number;
}

export interface ImagePositionResponse {
  index: number;       // 0-based position within the session, ordered by sortIndex
  sortIndex: number;
}

export const emptyDrawing = (): DrawingData => ({ v: 1, strokes: [] });
