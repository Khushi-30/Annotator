import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Stage, Layer, Image as KonvaImage, Line, Group, Circle, Text } from 'react-konva';
import type Konva from 'konva';
import { Toolbar, COLORS } from './Toolbar';
import { NotesField } from './NotesField';
import { useImage } from '../../hooks/useImage';
import { useDebouncedCallback } from '../../hooks/useDebouncedCallback';
import { getAnnotation, getAnnotationOffset, saveDrawing, saveNotes } from '../../data/annotationsRepo';
import { globalAnnotationNumber } from './numbering';
import { flush } from '../sync/flusher';
import type { ColorIndex, DrawingData, ImageMeta, Stroke } from '../../../../shared/types';

const STROKE_W = 0.006; // normalized to image width

// fit (contain) an image of given aspect ratio inside a box
function contain(boxW: number, boxH: number, ar: number) {
  let w = boxW, h = boxW / ar;
  if (h > boxH) { h = boxH; w = boxH * ar; }
  return { w, h };
}

export function AnnotationEditor({ image }: { image: ImageMeta }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const img = useImage(image.mobileUrl);

  const [color, setColor] = useState<ColorIndex>(0);
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [draft, setDraft] = useState<Stroke | null>(null);
  const [notes, setNotes] = useState('');
  const [numberOffset, setNumberOffset] = useState(0);
  const drawing = useRef(false);

  // measure available area
  useLayoutEffect(() => {
    if (!boxRef.current) return;
    const ro = new ResizeObserver(([e]) => {
      setBox({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(boxRef.current);
    return () => ro.disconnect();
  }, []);

  // load annotation from local store whenever the image changes (instant: IndexedDB)
  useEffect(() => {
    let alive = true;
    getAnnotation(image.id).then((a) => {
      if (!alive) return;
      setStrokes(a.drawingData.strokes);
      setNotes(a.notes);
      setDraft(null);
      drawing.current = false;
    });
    return () => { alive = false; };
  }, [image.id]);

  // global annotation numbering: how many strokes exist on earlier images in this
  // task, so this image's strokes continue the sequence instead of restarting at 1.
  useEffect(() => {
    let alive = true;
    getAnnotationOffset(image.sessionId, image.sortIndex).then((o) => {
      if (alive) setNumberOffset(o);
    });
    return () => { alive = false; };
  }, [image.id, image.sessionId, image.sortIndex]);

  const ar = image.height ? image.width / image.height : 1;
  const { w: dw, h: dh } = contain(box.w, box.h, ar);

  const persist = useCallback((next: Stroke[]) => {
    const data: DrawingData = { v: 1, strokes: next };
    void saveDrawing(image.id, data);
    debouncedFlush();
  }, [image.id]);

  const debouncedFlush = useDebouncedCallback(() => { void flush(); }, 1500);
  const debouncedNotes = useDebouncedCallback((v: string) => {
    void saveNotes(image.id, v);
    void flush();
  }, 400);

  const norm = (stage: Konva.Stage): [number, number] => {
    const p = stage.getPointerPosition()!;
    return [p.x / dw, p.y / dh];
  };

  const onDown = (e: Konva.KonvaEventObject<PointerEvent>) => {
    drawing.current = true;
    const [x, y] = norm(e.target.getStage()!);
    setDraft({ c: color, w: STROKE_W, p: [x, y] });
  };
  const onMove = (e: Konva.KonvaEventObject<PointerEvent>) => {
    if (!drawing.current) return;
    const [x, y] = norm(e.target.getStage()!);
    setDraft((d) => (d ? { ...d, p: [...d.p, x, y] } : d));
  };
  const onUp = () => {
    if (!drawing.current) return;
    drawing.current = false;
    setDraft((d) => {
      if (!d || d.p.length < 4) return null;
      const next = [...strokes, d];
      setStrokes(next);
      persist(next);
      return null;
    });
  };

  const undo = () => { const next = strokes.slice(0, -1); setStrokes(next); persist(next); };
  const clear = () => { setStrokes([]); persist([]); };

  const toLine = (s: Stroke) => {
    const pts: number[] = [];
    for (let i = 0; i < s.p.length; i += 2) { pts.push(s.p[i] * dw, s.p[i + 1] * dh); }
    return pts;
  };

  return (
    <div className="editor">
      <div className="stage-box" ref={boxRef}>
        {dw > 0 && (
          <Stage
            width={dw}
            height={dh}
            style={{ touchAction: 'none' }}
            onPointerDown={onDown}
            onPointerMove={onMove}
            onPointerUp={onUp}
            onPointerLeave={onUp}
          >
            <Layer listening={false}>
              {img && <KonvaImage image={img} width={dw} height={dh} />}
            </Layer>
            <Layer>
              {strokes.map((s, i) => (
                <Line key={i} points={toLine(s)} stroke={COLORS[s.c]}
                  strokeWidth={s.w * dw} lineCap="round" lineJoin="round"
                  tension={0.4} perfectDrawEnabled={false} />
              ))}
              {draft && (
                <Line points={toLine(draft)} stroke={COLORS[draft.c]}
                  strokeWidth={draft.w * dw} lineCap="round" lineJoin="round"
                  tension={0.4} perfectDrawEnabled={false} />
              )}
              {strokes.map((s, i) => {
                const num = globalAnnotationNumber(numberOffset, i);
                const r = Math.max(9, dw * 0.016); // clamp so badges stay legible at small sizes
                return (
                  <Group key={`n${i}`} x={s.p[0] * dw} y={s.p[1] * dh} listening={false}>
                    <Circle radius={r} fill="#fff" stroke="#111" strokeWidth={1.5} />
                    <Text text={String(num)} fontSize={r * 1.15} fontStyle="bold" fill="#111"
                      width={r * 2} height={r * 2} offsetX={r} offsetY={r}
                      align="center" verticalAlign="middle" />
                  </Group>
                );
              })}
            </Layer>
          </Stage>
        )}
      </div>

      <NotesField value={notes} onChange={(v) => { setNotes(v); debouncedNotes(v); }} />
      <Toolbar color={color} onColor={setColor} onUndo={undo} onClear={clear} canUndo={strokes.length > 0} />
    </div>
  );
}
