interface Props {
  imageNumber: number;
  totalImages: number;
  onResume: () => void;
  onStart: () => void;
  onClose: () => void;
}

export default function ResumeDialog({ imageNumber, totalImages, onResume, onStart, onClose }: Props) {
  return (
    <div className="dialog-overlay" onClick={onClose}>
      <div className="dialog" onClick={(e) => e.stopPropagation()}>
        <h2 className="dialog-title">Resume Session</h2>
        <p className="dialog-body">
          Resume from image {imageNumber} of {totalImages} where you left off?
        </p>
        <div className="dialog-actions">
          <button className="dialog-btn primary" onClick={onResume}>Resume</button>
          <button className="dialog-btn" onClick={onStart}>Start from beginning</button>
        </div>
      </div>
    </div>
  );
}
