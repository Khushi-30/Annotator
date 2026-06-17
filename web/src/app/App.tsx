import { useEffect, useState } from 'react';
import { startSyncEngine } from '../features/sync/flusher';
import SessionsPage from '../features/sessions/SessionsPage';
import WorkspaceView from './WorkspaceView';

type AppView =
  | { page: 'home' }
  | { page: 'annotating'; sessionId: string; sessionTitle: string; initialIndex: number };

export default function App() {
  const [view, setView] = useState<AppView>({ page: 'home' });

  useEffect(() => { startSyncEngine(); }, []);

  if (view.page === 'annotating') {
    return (
      <WorkspaceView
        sessionId={view.sessionId}
        sessionTitle={view.sessionTitle}
        initialIndex={view.initialIndex}
        onBack={() => setView({ page: 'home' })}
      />
    );
  }

  return (
    <SessionsPage
      onOpenSession={(sessionId, sessionTitle, initialIndex) =>
        setView({ page: 'annotating', sessionId, sessionTitle, initialIndex })
      }
    />
  );
}
