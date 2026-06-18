import { useState } from 'react';
import { createSession, uploadImages } from '../../data/api';
import type { ImageMeta, UploadFailure } from '../../../../shared/types';

interface Props {
  onDone: (sessionId: string, sessionTitle: string, created: ImageMeta[]) => void;
}

export function Uploader({ onDone }: Props) {
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');

  const handle = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setBusy(true);
    setProgress('Creating session…');
    try {
      const session = await createSession();
      const all = Array.from(files);
      const created: ImageMeta[] = [];
      const failed: UploadFailure[] = [];
      const CHUNK = 20;
      for (let i = 0; i < all.length; i += CHUNK) {
        setProgress(`Processing ${Math.min(i + CHUNK, all.length)} / ${all.length}…`);
        const part = await uploadImages(all.slice(i, i + CHUNK), session.id);
        created.push(...part.created);
        failed.push(...part.failed);
      }
      if (failed.length > 0) {
        console.warn(`${failed.length} image(s) failed to upload`, failed);
        setProgress(`${failed.length} image(s) failed — see console`);
      }
      onDone(session.id, session.title, created);
    } finally {
      setBusy(false);
      setProgress('');
    }
  };

  return (
    <div className="uploader-inline">
      <label className="upload-btn">
        {busy ? progress || 'Working…' : 'Upload New Images'}
        <input
          type="file"
          accept="image/*"
          multiple
          hidden
          disabled={busy}
          onChange={(e) => handle(e.target.files)}
        />
      </label>
      {!busy && (
        <p className="upload-hint">Select 1–150 images to start a new annotation session</p>
      )}
    </div>
  );
}
