import { useEffect, useState } from 'react';
import { onSyncStatus } from '../features/sync/flusher';

const LABEL = { synced: '● synced', pending: '◌ saving…', offline: '○ offline (saved)' };

export function SyncBadge() {
  const [status, setStatus] = useState<'synced' | 'pending' | 'offline'>('synced');
  useEffect(() => onSyncStatus(setStatus), []);
  return <span className={`sync-badge ${status}`}>{LABEL[status]}</span>;
}
