/**
 * Storage types for IndexedDB persistence
 */

import { ProjectFile } from '../exporters/types';

export interface StorageConfig {
  dbName: string;
  version: number;
  stores: StorageStoreConfig[];
}

export interface StorageStoreConfig {
  name: string;
  keyPath: string;
  indexes: StorageIndexConfig[];
}

export interface StorageIndexConfig {
  name: string;
  keyPath: string;
  unique: boolean;
}

export const STORAGE_CONFIG: StorageConfig = {
  dbName: 'ZeroPCBStudio',
  version: 1,
  stores: [
    {
      name: 'projects',
      keyPath: 'id',
      indexes: [
        { name: 'name', keyPath: 'metadata.name', unique: false },
        { name: 'updatedAt', keyPath: 'updatedAt', unique: false },
        { name: 'createdAt', keyPath: 'createdAt', unique: false },
      ],
    },
    {
      name: 'footprints',
      keyPath: 'id',
      indexes: [
        { name: 'category', keyPath: 'category', unique: false },
        { name: 'name', keyPath: 'name', unique: false },
      ],
    },
    {
      name: 'settings',
      keyPath: 'key',
      indexes: [],
    },
  ],
};

export interface StoredProject extends ProjectFile {
  id: string;
  thumbnail?: string; // base64 encoded PNG
}

export interface StoredFootprint {
  id: string;
  name: string;
  category: string;
  data: unknown; // Footprint object
  isBuiltIn: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface StoredSetting {
  key: string;
  value: unknown;
  updatedAt: number;
}

export interface StorageError extends Error {
  code?: string;
  storeName?: string;
}

export class IndexedDBStorage {
  private db: IDBDatabase | null = null;
  private config: StorageConfig;
  
  constructor(config: StorageConfig = STORAGE_CONFIG) {
    this.config = config;
  }
  
  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.config.dbName, this.config.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };
      
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        
        for (const storeConfig of this.config.stores) {
          if (!db.objectStoreNames.contains(storeConfig.name)) {
            const store = db.createObjectStore(storeConfig.name, { keyPath: storeConfig.keyPath });
            
            for (const indexConfig of storeConfig.indexes) {
              store.createIndex(indexConfig.name, indexConfig.keyPath, { unique: indexConfig.unique });
            }
          }
        }
      };
    });
  }
  
  async close(): Promise<void> {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
  
  private getStore(storeName: string, mode: IDBTransactionMode): IDBObjectStore {
    if (!this.db) throw new Error('Database not initialized');
    const transaction = this.db.transaction(storeName, mode);
    return transaction.objectStore(storeName);
  }
  
  // Project operations
  async saveProject(project: StoredProject): Promise<void> {
    const store = this.getStore('projects', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(project);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getProject(id: string): Promise<StoredProject | null> {
    const store = this.getStore('projects', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getAllProjects(): Promise<StoredProject[]> {
    const store = this.getStore('projects', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteProject(id: string): Promise<void> {
    const store = this.getStore('projects', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getProjectsByName(name: string): Promise<StoredProject[]> {
    const store = this.getStore('projects', 'readonly');
    const index = store.index('name');
    return new Promise((resolve, reject) => {
      const request = index.getAll(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getRecentProjects(limit: number = 10): Promise<StoredProject[]> {
    const store = this.getStore('projects', 'readonly');
    const index = store.index('updatedAt');
    return new Promise((resolve, reject) => {
      const request = index.openCursor(null, 'prev');
      const results: StoredProject[] = [];
      
      request.onsuccess = (event) => {
        const cursor = (event.target as IDBRequest).result;
        if (cursor && results.length < limit) {
          results.push(cursor.value);
          cursor.continue();
        } else {
          resolve(results);
        }
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  // Footprint operations
  async saveFootprint(footprint: StoredFootprint): Promise<void> {
    const store = this.getStore('footprints', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.put(footprint);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getFootprint(id: string): Promise<StoredFootprint | null> {
    const store = this.getStore('footprints', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(id);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getAllFootprints(): Promise<StoredFootprint[]> {
    const store = this.getStore('footprints', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async getFootprintsByCategory(category: string): Promise<StoredFootprint[]> {
    const store = this.getStore('footprints', 'readonly');
    const index = store.index('category');
    return new Promise((resolve, reject) => {
      const request = index.getAll(category);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteFootprint(id: string): Promise<void> {
    const store = this.getStore('footprints', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(id);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  // Settings operations
  async setSetting(key: string, value: unknown): Promise<void> {
    const store = this.getStore('settings', 'readwrite');
    const setting: StoredSetting = { key, value, updatedAt: Date.now() };
    return new Promise((resolve, reject) => {
      const request = store.put(setting);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getSetting<T>(key: string, defaultValue: T): Promise<T> {
    const store = this.getStore('settings', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => {
        const result = request.result as StoredSetting | undefined;
        resolve(result ? result.value as T : defaultValue);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  async deleteSetting(key: string): Promise<void> {
    const store = this.getStore('settings', 'readwrite');
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }
  
  async getAllSettings(): Promise<Record<string, unknown>> {
    const store = this.getStore('settings', 'readonly');
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => {
        const settings: Record<string, unknown> = {};
        for (const setting of request.result as StoredSetting[]) {
          settings[setting.key] = setting.value;
        }
        resolve(settings);
      };
      request.onerror = () => reject(request.error);
    });
  }
  
  // Utility
  async clearAll(): Promise<void> {
    for (const storeConfig of this.config.stores) {
      const store = this.getStore(storeConfig.name, 'readwrite');
      await new Promise<void>((resolve, reject) => {
        const request = store.clear();
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
      });
    }
  }
  
  async exportAll(): Promise<{ projects: StoredProject[]; footprints: StoredFootprint[]; settings: Record<string, unknown> }> {
    return {
      projects: await this.getAllProjects(),
      footprints: await this.getAllFootprints(),
      settings: await this.getAllSettings(),
    };
  }
  
  async importAll(data: { projects?: StoredProject[]; footprints?: StoredFootprint[]; settings?: Record<string, unknown> }): Promise<void> {
    if (data.projects) {
      for (const project of data.projects) {
        await this.saveProject(project);
      }
    }
    
    if (data.footprints) {
      for (const footprint of data.footprints) {
        await this.saveFootprint(footprint);
      }
    }
    
    if (data.settings) {
      for (const [key, value] of Object.entries(data.settings)) {
        await this.setSetting(key, value);
      }
    }
  }
}

// Singleton instance. The promise is shared so concurrent callers (React
// StrictMode mounts the app twice in development) never receive a storage
// object whose database is not open yet.
let storageInstance: IndexedDBStorage | null = null;
let storageInit: Promise<IndexedDBStorage> | null = null;

export function getStorage(): Promise<IndexedDBStorage> {
  if (!storageInit) {
    const instance = new IndexedDBStorage();
    storageInstance = instance;
    storageInit = instance.init().then(() => instance);
    // A failed open must not be cached, otherwise every later call reports
    // "Database not initialized" instead of retrying.
    storageInit.catch(() => {
      storageInit = null;
      storageInstance = null;
    });
  }
  return storageInit;
}

export async function closeStorage(): Promise<void> {
  const instance = storageInstance;
  storageInit = null;
  storageInstance = null;
  if (instance) {
    await instance.close();
  }
}

// Settings keys
export const SETTINGS_KEYS = {
  THEME: 'theme',
  BOARD_DEFAULTS: 'boardDefaults',
  PLACEMENT_CONFIG: 'placementConfig',
  ROUTING_CONFIG: 'routingConfig',
  EXPORT_OPTIONS: 'exportOptions',
  RECENT_PROJECTS: 'recentProjects',
  WINDOW_STATE: 'windowState',
  KEYBOARD_SHORTCUTS: 'keyboardShortcuts',
} as const;

export type SettingsKey = typeof SETTINGS_KEYS[keyof typeof SETTINGS_KEYS];

export interface ThemeSettings {
  mode: 'light' | 'dark' | 'system';
}

export interface BoardDefaults {
  rows: number;
  cols: number;
  holePitchMm: number;
  type: 'perfboard' | 'stripboard' | 'custom';
  stripDirection?: 'horizontal' | 'vertical';
}

export interface WindowState {
  width: number;
  height: number;
  maximized: boolean;
  sidebarWidth: number;
  panelHeights: Record<string, number>;
}

export type { ProjectFile } from '../exporters/types';