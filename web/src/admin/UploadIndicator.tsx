import { useEffect } from 'react';
import { hasActiveUploads, useUploads } from './uploadStore';

/** "Uploading 2 files…" in the admin nav, and a leave-page warning while uploads run. */
export default function UploadIndicator() {
  const active = useUploads((s) => s.items.filter((i) => i.state === 'queued' || i.state === 'uploading').length);
  const busy = useUploads((s) => hasActiveUploads(s.items));

  useEffect(() => {
    if (!busy) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [busy]);

  if (!active) return null;
  return (
    <p role="status" className="px-3 pt-2 text-xs text-primary">
      Uploading {active} {active === 1 ? 'file' : 'files'}…
    </p>
  );
}
