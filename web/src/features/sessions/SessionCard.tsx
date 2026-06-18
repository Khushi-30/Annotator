import type { Session } from '../../../../shared/types';

function formatDate(isoDate: string): string {
  const d = new Date(isoDate);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / 86_400_000);
  const time = d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  if (diffDays === 0) return `Today, ${time}`;
  if (diffDays === 1) return `Yesterday, ${time}`;
  return d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
}

interface Props {
  session: Session;
  onClick: () => void;
  onDelete: () => void;
}

export default function SessionCard({ session, onClick, onDelete }: Props) {
  const pct = session.totalImages > 0
    ? Math.round((session.completedImages / session.totalImages) * 100)
    : 0;
  const done = session.totalImages > 0 && session.completedImages === session.totalImages;

  return (
    <div className={`session-card${done ? ' done' : ''}`} onClick={onClick} role="button" tabIndex={0}
      onKeyDown={(e) => e.key === 'Enter' && onClick()}>
      {session.previewThumbUrl && (
        <img className="session-thumb" src={session.previewThumbUrl} alt="" loading="lazy" />
      )}
      <div className="session-info">
        <div className="session-title">{session.title}</div>
        <div className="session-meta">Uploaded: {formatDate(session.createdAt)}</div>
        <div className="session-meta">Images: {session.totalImages}</div>
        <div className="session-progress-row">
          <span className="session-meta">
            Annotated: {session.completedImages}/{session.totalImages}
          </span>
          {done && <span className="session-done-badge">✓ Complete</span>}
        </div>
        <div className="session-progress-bar">
          <div className="session-progress-fill" style={{ width: `${pct}%` }} />
        </div>
        <div className="session-meta muted">
          Last activity: {formatDate(session.lastActivityAt)}
        </div>
      </div>
      <button
        className="session-delete-btn"
        onClick={(e) => { e.stopPropagation(); onDelete(); }}
        aria-label="Delete session"
        title="Delete session"
      >
        ×
      </button>
    </div>
  );
}
