import { useCallback, useEffect, useRef, useState } from 'react';
import { readTicketDraft, writeTicketDraft, deleteTicketDraft, isValidTicketDraft } from '@/lib/ticketDraft';
import { registerUnsavedWork } from '@/registerSW';

export function useTicketDraft<T>(key: string, value: T, dirty: boolean, restore: (value: T) => void) {
  const [ready, setReady] = useState(false);
  const [restoreError, setRestoreError] = useState(false);
  const [storageError, setStorageError] = useState(false);
  const restoreRef = useRef(restore); restoreRef.current = restore;
  const latest = useRef(value); latest.current = value;
  const cleared = useRef(false);
  const hadContent = useRef(false);
  const queue = useRef(Promise.resolve<unknown>(undefined));
  useEffect(() => {
    let active = true;
    cleared.current = false;
    void readTicketDraft<T>(key).then(draft => { if (active && draft) {
      if (!isValidTicketDraft(draft)) { setRestoreError(true); return; }
      hadContent.current = true; restoreRef.current(draft);
    } })
      .catch(() => { if (active) setStorageError(true); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key]);
  const save = useCallback(() => {
    if (cleared.current) return;
    const snapshot = latest.current;
    queue.current = queue.current.then(() => writeTicketDraft(key, snapshot)).catch(() => setStorageError(true));
  }, [key]);
  useEffect(() => {
    if (!ready) return;
    if (dirty) hadContent.current = true;
    if (!hadContent.current) return;
    // Immediate queued snapshots: a file picker/background transition must not beat a debounce.
    save();
  }, [ready, dirty, value, save]);
  useEffect(() => {
    if (!ready || !dirty) return;
    const release = registerUnsavedWork();
    const beforeUnload = (e: BeforeUnloadEvent) => { e.preventDefault(); e.returnValue = ''; save(); };
    const hidden = () => { if (document.visibilityState === 'hidden') save(); };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('visibilitychange', hidden);
    return () => { release(); window.removeEventListener('beforeunload', beforeUnload); document.removeEventListener('visibilitychange', hidden); };
  }, [ready, dirty, save]);
  const clear = useCallback(async () => {
    cleared.current = true;
    await queue.current;
    await deleteTicketDraft(key).catch(() => setStorageError(true));
  }, [key]);
  const resume = useCallback(() => { cleared.current = false; }, []);
  return { ready, storageError, restoreError, clear, resume };
}
