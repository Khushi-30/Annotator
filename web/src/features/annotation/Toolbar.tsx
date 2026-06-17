import type { ColorIndex } from '../../../../shared/types';

export const COLORS = ['#ef4444', '#22c55e', '#3b82f6']; // 3 classes
export const COLOR_LABELS = ['Class 1', 'Class 2', 'Class 3'];

interface Props {
  color: ColorIndex;
  onColor: (c: ColorIndex) => void;
  onUndo: () => void;
  onClear: () => void;
  canUndo: boolean;
}

export function Toolbar({ color, onColor, onUndo, onClear, canUndo }: Props) {
  return (
    <div className="toolbar">
      <div className="swatches">
        {COLORS.map((hex, i) => (
          <button
            key={i}
            className={'swatch' + (color === i ? ' active' : '')}
            style={{ background: hex }}
            aria-label={COLOR_LABELS[i]}
            onClick={() => onColor(i as ColorIndex)}
          />
        ))}
      </div>
      <div className="actions">
        <button className="tool-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo">↶</button>
        <button className="tool-btn danger" onClick={onClear} aria-label="Clear">
          <svg
            xmlns="http://www.w3.org/2000/svg"
            width="22"
            height="22"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            stroke-width="2"
            stroke-linecap="round"
            stroke-linejoin="round"
          >
            <path d="M3 6h18" />
            <path d="M8 6V4h8v2" />
            <path d="M19 6l-1 14H6L5 6" />
            <path d="M10 11v6" />
            <path d="M14 11v6" />
          </svg>
        </button>
      </div>
    </div>
  );
}
