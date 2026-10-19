/**
 * Project persistence: restores the latest locally saved project on boot and
 * autosaves every design change with a short debounce.
 *
 * Everything stays in this browser (IndexedDB) - no accounts, no backend, no
 * cloud sync. The manual Save / Load buttons in the Export panel keep working
 * and write/read the same local project slot.
 */

import { useEffect } from 'react';
import { useAppStore } from './store';
import { getStorage } from '../storage/types';
import {
  AUTOSAVE_DEBOUNCE_MS,
  LOCAL_PROJECT_ID,
  buildStoredProject,
  hasDesignContent,
  persistedSliceOf,
  samePersistedState,
  storedToLoadPayload,
  type PersistedProjectState,
} from '../storage/autosave';

export function useProjectPersistence(): void {
  useEffect(() => {
    let disposed = false;
    /** Last saved/restored design; `null` means "save the next change right away" */
    let baseline: PersistedProjectState | null = persistedSliceOf(useAppStore.getState());
    let timer: ReturnType<typeof setTimeout> | null = null;
    let saving = false;
    let hydrated = false;
    let createdAt: number | null = null;

    const sliceOf = () => persistedSliceOf(useAppStore.getState());

    const schedule = (delay = AUTOSAVE_DEBOUNCE_MS) => {
      if (disposed) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void save();
      }, delay);
    };

    const save = async () => {
      if (disposed) return;
      if (saving) return; // the write in flight schedules the newer state itself
      const before = sliceOf();
      saving = true;
      useAppStore.getState().setSaveStatus('saving');
      let ok = false;
      try {
        const storage = await getStorage();
        if (createdAt === null) {
          const existing = await storage.getProject(LOCAL_PROJECT_ID);
          createdAt = existing?.createdAt ?? Date.now();
        }
        const record = buildStoredProject(before, { id: LOCAL_PROJECT_ID, createdAt });
        await storage.saveProject(record);
        if (disposed) return;
        baseline = before;
        const store = useAppStore.getState();
        store.markSaved();
        store.setSaveStatus('saved');
        ok = true;
      } catch (e) {
        if (!disposed) {
          // Storage can be unavailable (private browsing, blocked, quota):
          // the app keeps running in memory and the status says so.
          console.error('Autosave failed:', e);
          useAppStore
            .getState()
            .setSaveStatus('error', e instanceof Error ? e.message : 'browser storage unavailable');
        }
      } finally {
        saving = false;
        // Anything that changed while the write ran goes out right away. A
        // failed write is not retried by itself - the next edit tries again.
        if (ok && !disposed && !samePersistedState(baseline, sliceOf())) schedule(0);
      }
    };

    // Watch every store change; only design slices trigger a save
    const unsubscribe = useAppStore.subscribe(() => {
      if (!hydrated || disposed) return;
      const current = sliceOf();
      if (baseline && samePersistedState(baseline, current)) return;
      schedule();
    });

    // Restore the newest locally saved project (refresh / new visit)
    void (async () => {
      let restored = false;
      try {
        const storage = await getStorage();
        const projects = await storage.getAllProjects();
        const latest = projects.sort((a, b) => b.updatedAt - a.updatedAt)[0];
        if (!disposed && latest) {
          const store = useAppStore.getState();
          // Never clobber work the user already started in this session
          if (!store.isDirty && !hasDesignContent(store)) {
            store.loadProject(storedToLoadPayload(latest));
            if (!disposed) {
              restored = true;
              createdAt = latest.createdAt ?? null;
              useAppStore.getState().setSaveStatus('saved');
            }
          }
        }
      } catch (e) {
        // No usable storage: keep the empty project, autosave will report it
        console.error('Restoring the saved project failed:', e);
        if (!disposed) useAppStore.getState().setSaveStatus('error', 'browser storage unavailable');
      } finally {
        if (!disposed) {
          hydrated = true;
          // The initial (empty) state must never overwrite a saved project: the
          // baseline is the restored design and an untouched session saves
          // nothing. If real work is already here, save it immediately.
          const store = useAppStore.getState();
          if (!restored && (store.isDirty || hasDesignContent(store))) {
            baseline = null;
            schedule(0);
          } else {
            baseline = sliceOf();
          }
        }
      }
    })();

    // Make the pending write as timely as possible when the tab goes away
    const flush = () => {
      if (!disposed && timer) {
        clearTimeout(timer);
        timer = null;
        void save();
      }
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', flush);

    return () => {
      disposed = true;
      if (timer) clearTimeout(timer);
      unsubscribe();
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', flush);
    };
  }, []);
}
