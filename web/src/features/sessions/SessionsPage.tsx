import { useEffect, useState } from 'react';
import { db } from '../../data/db';
import { fetchSessions, fetchImagePosition, deleteSession } from '../../data/api';
import { SyncBadge } from '../../app/SyncBadge';
import SessionCard from './SessionCard';
import ResumeDialog from './ResumeDialog';
import { Uploader } from '../upload/Uploader';
import type { Session, ImageMeta } from '../../../../shared/types';

interface Props {
  onOpenSession: (sessionId: string, sessionTitle: string, initialIndex: number) => void;
}

export default function SessionsPage({ onOpenSession }: Props) {
  const [sessions, setSessions] = useState<Session[] | null>(null);
  const [resumeState, setResumeState] = useState<{
    session: Session;
    lastIndex: number;
  } | null>(null);

  const loadSessions = async () => {
    try {
      const data = await fetchSessions();
      setSessions(data);
      await db.sessions.bulkPut(data);
    } catch {
      const cached = await db.sessions.orderBy('lastActivityAt').reverse().toArray();
      setSessions(cached);
    }
  };

  useEffect(() => { void loadSessions(); }, []);

  const handleUploaded = async (sessionId: string, sessionTitle: string, created: ImageMeta[]) => {
    await db.images.bulkPut(created);
    void loadSessions(); // refresh counts in background
    onOpenSession(sessionId, sessionTitle, 0);
  };

  const handleClickSession = async (session: Session) => {
    if (!session.lastViewedImageId || session.totalImages === 0) {
      onOpenSession(session.id, session.title, 0);
      return;
    }
    // Resolve the last-viewed image's position via a single indexed lookup instead of
    // downloading the whole image catalog just to find one index (Fix C).
    try {
      const { index } = await fetchImagePosition(session.lastViewedImageId);
      if (index > 0) {
        setResumeState({ session, lastIndex: index });
      } else {
        onOpenSession(session.id, session.title, 0);
      }
    } catch {
      onOpenSession(session.id, session.title, 0);
    }
  };

  const handleDeleteSession = async (sessionId: string) => {
    await deleteSession(sessionId);
    await db.images.where('sessionId').equals(sessionId).delete();
    await db.sessions.delete(sessionId);
    setSessions((prev) => prev?.filter((s) => s.id !== sessionId) ?? prev);
  };

  const totalImages = sessions?.reduce((n, s) => n + s.totalImages, 0) ?? 0;
  const totalAnnotated = sessions?.reduce((n, s) => n + s.completedImages, 0) ?? 0;
  const totalAnnotations = sessions?.reduce((n, s) => n + s.annotationCount, 0) ?? 0;

  return (
    <div className="app">
      <header className="topbar">
        <span className="brand">Annotator</span>
        <SyncBadge />
      </header>

      <div className="dashboard">
        {/* ── Section 1: Upload ── */}
        <section className="upload-section">
          <h2 className="section-heading">New Session</h2>
          <Uploader onDone={handleUploaded} />
        </section>

        {/* ── Section 2: Previous sessions ── */}
        {sessions === null && (
          <p className="dashboard-loading">Loading sessions…</p>
        )}

        {sessions !== null && sessions.length > 0 && (
          <section className="sessions-section">
            <div className="sessions-stats">
              <div className="stat">
                <span className="stat-value">{sessions.length}</span>
                <span className="stat-label">Sessions</span>
              </div>
              <div className="stat">
                <span className="stat-value">{totalImages}</span>
                <span className="stat-label">Total Images</span>
              </div>
              <div className="stat">
                <span className="stat-value">{totalAnnotated}</span>
                <span className="stat-label">Annotated Images</span>
              </div>
              <div className="stat">
                <span className="stat-value" style={{ color: '#16b04f' }}>
                  {totalAnnotations}
                </span>
                <span className="stat-label">Annotations</span>
              </div>
            </div>

            <h2 className="section-heading">Previous Sessions</h2>
            <div className="sessions-list">
              {sessions.map((session) => (
                <SessionCard
                  key={session.id}
                  session={session}
                  onClick={() => void handleClickSession(session)}
                  onDelete={() => void handleDeleteSession(session.id)}
                />
              ))}
            </div>
          </section>
        )}
      </div>

      {resumeState && (
        <ResumeDialog
          imageNumber={resumeState.lastIndex + 1}
          totalImages={resumeState.session.totalImages}
          onResume={() => {
            onOpenSession(resumeState.session.id, resumeState.session.title, resumeState.lastIndex);
            setResumeState(null);
          }}
          onStart={() => {
            onOpenSession(resumeState.session.id, resumeState.session.title, 0);
            setResumeState(null);
          }}
          onClose={() => setResumeState(null)}
        />
      )}
    </div>
  );
}
