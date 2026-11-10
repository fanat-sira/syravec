import { create } from "zustand";
import {
  persist,
  createJSONStorage,
  type StateStorage,
} from "zustand/middleware";
import {
  emptyScene,
  uid,
  type Asset,
  type Project,
  type Generation,
  type Scene,
} from "./model";
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open("syravec", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("state");
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
const storage: StateStorage = {
  getItem: async (k) => {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction("state", "readonly"),
        r = t.objectStore("state").get(k);
      r.onsuccess = () => resolve(r.result ?? null);
      r.onerror = () => reject(r.error);
      t.oncomplete = () => db.close();
    });
  },
  setItem: async (k, v) => {
    try {
      const db = await open();
      await new Promise<void>((resolve, reject) => {
        const t = db.transaction("state", "readwrite");
        t.objectStore("state").put(v, k);
        t.oncomplete = () => {
          db.close();
          resolve();
        };
        t.onabort = () => {
          db.close();
          reject(t.error);
        };
        t.onerror = () => {};
      });
    } catch {
      window.dispatchEvent(new Event("syravec-storage-error"));
    }
  },
  removeItem: async (k) => {
    const db = await open();
    const t = db.transaction("state", "readwrite");
    t.objectStore("state").delete(k);
    t.oncomplete = () => db.close();
  },
};
interface State {
  projects: Project[];
  current: string | null;
  customAssets: Asset[];
  selected: string | null;
  past: Scene[];
  future: Scene[];
  revision: number;
  hydrated: boolean;
  storageError: string;
  newProject: () => void;
  openProject: (id: string) => void;
  removeProject: (id: string) => void;
  setScene: (s: Scene, record?: boolean) => void;
  importProject: (data: {
    scene: Scene;
    customAssets: Asset[];
    title?: string;
    messages?: Project["messages"];
    generations?: Generation[];
  }) => void;
  recordGeneration: (projectId: string, entry: Generation) => void;
  message: (role: "user" | "assistant", text: string) => void;
  undo: () => void;
  redo: () => void;
  addAsset: (a: Asset) => void;
  select: (id: string | null) => void;
}
export const useStore = create<State>()(
  persist<State, [], [], Pick<State, "projects" | "current" | "customAssets">>(
    (set, get) => ({
      projects: [],
      current: null,
      customAssets: [],
      selected: null,
      past: [],
      future: [],
      revision: 0,
      hydrated: false,
      storageError: "",
      newProject: () =>
        set((s) => ({
          current: null,
          selected: null,
          past: [],
          future: [],
          revision: s.revision + 1,
        })),
      openProject: (id) =>
        set((s) => ({
          current: id,
          selected: null,
          past: [],
          future: [],
          revision: s.revision + 1,
        })),
      removeProject: (id) =>
        set((s) => ({
          projects: s.projects.filter((p) => p.id !== id),
          current: s.current === id ? null : s.current,
          revision: s.revision + 1,
        })),
      setScene: (scene, record = true) => {
        const s = get(),
          p = s.projects.find((p) => p.id === s.current);
        if (p)
          set({
            projects: s.projects.map((q) =>
              q.id === p.id ? { ...q, scene, updatedAt: Date.now() } : q,
            ),
            past: record ? [...s.past.slice(-39), p.scene] : s.past,
            future: record ? [] : s.future,
            revision: s.revision + 1,
          });
        else {
          const id = uid();
          set({
            current: id,
            projects: [
              {
                id,
                title: "новая композиция",
                scene,
                messages: [],
                updatedAt: Date.now(),
              },
              ...s.projects,
            ],
            revision: s.revision + 1,
          });
        }
      },
      importProject: (data) => {
        const id = uid();
        set((s) => ({
          current: id,
          selected: null,
          past: [],
          future: [],
          revision: s.revision + 1,
          customAssets: [
            ...s.customAssets,
            ...data.customAssets.filter(
              (a) => !s.customAssets.some((v) => v.id === a.id),
            ),
          ],
          projects: [
            {
              id,
              title: data.title || "импортированная композиция",
              scene: data.scene,
              messages: data.messages ?? [],
              generations: data.generations ?? [],
              updatedAt: Date.now(),
            },
            ...s.projects,
          ],
        }));
      },
      recordGeneration: (projectId, entry) =>
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === projectId
              ? {
                  ...p,
                  generations: [...(p.generations ?? []).slice(-29), entry],
                }
              : p,
          ),
        })),
      message: (role, text) => {
        if (!get().current) get().setScene(emptyScene());
        set((s) => ({
          projects: s.projects.map((p) =>
            p.id === s.current
              ? {
                  ...p,
                  title:
                    role === "user" && p.messages.length === 0
                      ? text.slice(0, 55)
                      : p.title,
                  messages: [...p.messages, { role, text }],
                }
              : p,
          ),
        }));
      },
      undo: () => {
        const s = get(),
          scene = s.projects.find((p) => p.id === s.current)?.scene;
        if (!scene || !s.past.length) return;
        const prev = s.past.at(-1)!;
        s.setScene(prev, false);
        set({
          past: s.past.slice(0, -1),
          future: [scene, ...s.future],
          selected: null,
        });
      },
      redo: () => {
        const s = get(),
          scene = s.projects.find((p) => p.id === s.current)?.scene;
        if (!scene || !s.future.length) return;
        s.setScene(s.future[0], false);
        set({
          future: s.future.slice(1),
          past: [...s.past, scene],
          selected: null,
        });
      },
      addAsset: (a) => set((s) => ({ customAssets: [...s.customAssets, a] })),
      select: (selected) => set({ selected }),
    }),
    {
      name: "projects",
      storage: createJSONStorage(() => storage),
      partialize: (s) => ({
        projects: s.projects,
        current: s.current,
        customAssets: s.customAssets,
      }),
      onRehydrateStorage: () => (_s, error) =>
        useStore.setState({
          hydrated: true,
          storageError: error
            ? "не удалось восстановить историю из браузера"
            : "",
        }),
    },
  ),
);
useStore.persist.onFinishHydration(() => useStore.setState({ hydrated: true }));
