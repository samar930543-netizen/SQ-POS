import {
  Bill,
  OfflineSyncConfig,
  ServerSyncStatus,
  SyncEntityType,
  SyncQueueItem,
} from '../types';
import {
  getStoredAttendanceRecords,
  getStoredBills,
  getStoredCashFlowEntries,
  getStoredCustomers,
  getStoredKhata,
  getStoredLoyaltyTransactions,
  getStoredOpeningCashMap,
  getStoredProducts,
  getStoredPurchaseOrders,
  getStoredStaffMembers,
  getStoredStoreProfile,
  getStoredSuppliers,
  saveAttendanceRecords,
  saveBills,
  saveCashFlowEntries,
  saveCustomers,
  saveKhata,
  saveLoyaltyTransactions,
  saveOpeningCashMap,
  saveProducts,
  savePurchaseOrders,
  saveStaffMembers,
  saveStoreProfile,
  saveSuppliers,
} from './storage';
import { getLocalInventoryManifest, normalizeProductList } from './inventoryDb';

const SQ_DB_NAME = 'sq_enterprises_offline_db';
const SQ_DB_VERSION = 1;
const SQ_OUTBOX_STORE = 'sync_outbox';
const SQ_BILLS_STORE = 'offline_bills';
export const SQ_BG_SYNC_TAG = 'sync-sq-pos-queue';

const QUEUE_STORAGE_KEY = 'sq_offline_sync_queue_v1';
const CONFIG_STORAGE_KEY = 'sq_offline_sync_config_v1';

const DEFAULT_CONFIG: OfflineSyncConfig = {
  forceOfflineMode: false,
  autoSyncOnReconnect: true,
};

export function getOfflineSyncConfig(): OfflineSyncConfig {
  try {
    const raw = localStorage.getItem(CONFIG_STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    return { ...DEFAULT_CONFIG, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveOfflineSyncConfig(config: OfflineSyncConfig): void {
  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config));
  } catch (err) {
    console.error('Failed to save offline sync config:', err);
  }
}

export function getStoredSyncQueue(): SyncQueueItem[] {
  try {
    const raw = localStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSyncQueueToLocalStorage(items: SyncQueueItem[]): void {
  try {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(items));
  } catch (err) {
    console.error('Failed to save sync queue:', err);
  }
}

function openOfflineDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(SQ_DB_NAME, SQ_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(SQ_BILLS_STORE)) {
          db.createObjectStore(SQ_BILLS_STORE, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(SQ_OUTBOX_STORE)) {
          db.createObjectStore(SQ_OUTBOX_STORE, { keyPath: 'id' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

async function mirrorOutboxToIndexedDb(items: SyncQueueItem[]): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(SQ_OUTBOX_STORE, 'readwrite');
      const store = tx.objectStore(SQ_OUTBOX_STORE);
      store.clear();
      for (const item of items) {
        store.put(item);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function persistBillToIndexedDb(bill: Bill): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(SQ_BILLS_STORE, 'readwrite');
      tx.objectStore(SQ_BILLS_STORE).put(bill);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function syncAllBillsToIndexedDb(bills: Bill[]): Promise<void> {
  const db = await openOfflineDb();
  if (!db) return;
  await new Promise<void>(resolve => {
    try {
      const tx = db.transaction(SQ_BILLS_STORE, 'readwrite');
      const store = tx.objectStore(SQ_BILLS_STORE);
      for (const bill of bills) {
        store.put(bill);
      }
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

export async function getOfflineIndexedDbBillCount(): Promise<number> {
  const db = await openOfflineDb();
  if (!db) return getStoredBills().length;
  return new Promise<number>(resolve => {
    try {
      const tx = db.transaction(SQ_BILLS_STORE, 'readonly');
      const req = tx.objectStore(SQ_BILLS_STORE).count();
      req.onsuccess = () => resolve(req.result || 0);
      req.onerror = () => resolve(getStoredBills().length);
    } catch {
      resolve(getStoredBills().length);
    }
  });
}

export async function registerBackgroundSyncTag(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return false;
  }
  try {
    const registration = await navigator.serviceWorker.ready;
    const syncReg = registration as ServiceWorkerRegistration & {
      sync?: { register: (tag: string) => Promise<void> };
    };
    if (syncReg?.sync) {
      await syncReg.sync.register(SQ_BG_SYNC_TAG);
      return true;
    }
  } catch {
    // Background Sync API not supported in this browser; fallback timer handles sync
  }
  return false;
}

export async function enqueueSyncOperation(params: {
  entityType: SyncEntityType;
  entityId: string;
  label: string;
  amount?: number;
  payload: Record<string, unknown>;
}): Promise<SyncQueueItem[]> {
  const newItem: SyncQueueItem = {
    id: `sync_${params.entityType}_${params.entityId}_${Date.now()}`,
    entityType: params.entityType,
    entityId: params.entityId,
    label: params.label,
    amount: params.amount,
    payload: params.payload,
    createdAt: new Date().toISOString(),
    status: 'pending',
    attempts: 0,
  };

  const current = getStoredSyncQueue();
  const updated = [newItem, ...current];
  saveSyncQueueToLocalStorage(updated);
  await mirrorOutboxToIndexedDb(updated);
  await registerBackgroundSyncTag();
  return updated;
}

export async function checkServerConnectivity(): Promise<ServerSyncStatus> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 3500);
  try {
    const res = await fetch('/api/sync/status', {
      method: 'GET',
      cache: 'no-store',
      signal: controller.signal,
    });
    if (!res.ok) {
      return {
        reachable: false,
        totalSyncedBills: 0,
        totalSyncedOperations: 0,
        revision: 0,
      };
    }
    const data = await res.json();
    return {
      reachable: Boolean(data?.reachable),
      serverTime: data?.serverTime,
      totalSyncedBills: Number(data?.totalSyncedBills) || 0,
      totalSyncedOperations: Number(data?.totalSyncedOperations) || 0,
      totalSyncedProducts:
        data?.totalSyncedProducts !== undefined ? Number(data.totalSyncedProducts) : undefined,
      totalSyncedCustomers:
        data?.totalSyncedCustomers !== undefined ? Number(data.totalSyncedCustomers) : undefined,
      externalApiAuthConfigured: Boolean(data?.externalApiAuthConfigured),
      externalApiEnabled: data?.externalApiEnabled !== false,
      lastSyncedAt: data?.lastSyncedAt,
      revision: Number(data?.revision) || 0,
    };
  } catch {
    return {
      reachable: false,
      totalSyncedBills: 0,
      totalSyncedOperations: 0,
      revision: 0,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function reconcileSyncedBillsInStorage(
  syncedEntityIds: string[],
  syncedAtIso: string
): Promise<Bill[]> {
  const currentBills = getStoredBills();
  const entitySet = new Set(syncedEntityIds);
  let changed = false;

  const updatedBills = currentBills.map(bill => {
    if (entitySet.has(bill.id) && bill.syncStatus !== 'synced') {
      changed = true;
      return {
        ...bill,
        syncStatus: 'synced' as const,
        syncedAt: syncedAtIso,
      };
    }
    return bill;
  });

  if (changed) {
    saveBills(updatedBills);
    await syncAllBillsToIndexedDb(updatedBills);
  }
  return updatedBills;
}

export async function flushPendingSyncQueue(
  options: { targetItemId?: string } = {}
): Promise<{
  ok: boolean;
  syncedCount: number;
  failedCount: number;
  queue: SyncQueueItem[];
  updatedBills: Bill[];
  serverStatus?: ServerSyncStatus;
  error?: string;
}> {
  const config = getOfflineSyncConfig();
  if (config.forceOfflineMode) {
    return {
      ok: false,
      syncedCount: 0,
      failedCount: 0,
      queue: getStoredSyncQueue(),
      updatedBills: getStoredBills(),
      error: 'Manual Offline Mode is enabled. Switch to Online to synchronize.',
    };
  }

  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return {
      ok: false,
      syncedCount: 0,
      failedCount: 0,
      queue: getStoredSyncQueue(),
      updatedBills: getStoredBills(),
      error: 'Device is offline. Queued items will synchronize automatically once reconnected.',
    };
  }

  const queue = getStoredSyncQueue();
  const candidates = queue.filter(item => {
    if (options.targetItemId && item.id !== options.targetItemId) return false;
    return item.status === 'pending' || item.status === 'failed';
  });

  if (candidates.length === 0) {
    const status = await checkServerConnectivity();
    return {
      ok: status.reachable,
      syncedCount: 0,
      failedCount: 0,
      queue,
      updatedBills: getStoredBills(),
      serverStatus: status,
    };
  }

  // Mark candidates as syncing
  const syncingSet = new Set(candidates.map(c => c.id));
  const nowAttemptIso = new Date().toISOString();
  const markedSyncing = queue.map(item =>
    syncingSet.has(item.id)
      ? { ...item, status: 'syncing' as const, lastAttemptAt: nowAttemptIso }
      : item
  );
  saveSyncQueueToLocalStorage(markedSyncing);

  try {
    const res = await fetch('/api/sync/batch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items: candidates }),
    });

    if (!res.ok) {
      throw new Error(`Server returned HTTP ${res.status}`);
    }

    const data = await res.json();
    const syncedSet = new Set<string>(Array.isArray(data?.syncedIds) ? data.syncedIds : []);
    const failedMap = new Map<string, string>();
    if (Array.isArray(data?.failedIds)) {
      for (const f of data.failedIds) {
        if (f?.id) failedMap.set(f.id, f.error || 'Sync failed');
      }
    }

    const syncedAtIso: string = data?.serverSyncedAt || new Date().toISOString();
    const syncedBillIds: string[] = [];

    const nextQueue: SyncQueueItem[] = queue.map(item => {
      if (!syncingSet.has(item.id)) return item;
      if (syncedSet.has(item.id)) {
        if (item.entityType === 'bill') {
          syncedBillIds.push(item.entityId);
        }
        return {
          ...item,
          status: 'synced',
          syncedAt: syncedAtIso,
          lastAttemptAt: syncedAtIso,
          attempts: item.attempts + 1,
          errorMessage: undefined,
        };
      }
      return {
        ...item,
        status: 'failed',
        lastAttemptAt: syncedAtIso,
        attempts: item.attempts + 1,
        errorMessage: failedMap.get(item.id) || 'Sync did not complete',
      };
    });

    saveSyncQueueToLocalStorage(nextQueue);
    await mirrorOutboxToIndexedDb(nextQueue);

    const updatedBills = await reconcileSyncedBillsInStorage(syncedBillIds, syncedAtIso);

    saveOfflineSyncConfig({
      ...config,
      lastSuccessfulSyncAt: syncedSet.size > 0 ? syncedAtIso : config.lastSuccessfulSyncAt,
      lastSyncError: failedMap.size > 0 ? 'Some items failed to sync.' : undefined,
    });

    return {
      ok: true,
      syncedCount: syncedSet.size,
      failedCount: failedMap.size,
      queue: nextQueue,
      updatedBills,
      serverStatus: {
        reachable: true,
        serverTime: syncedAtIso,
        totalSyncedBills: Number(data?.totalSyncedBills) || 0,
        totalSyncedOperations: Number(data?.totalSyncedOperations) || 0,
        totalSyncedProducts:
          data?.totalSyncedProducts !== undefined ? Number(data.totalSyncedProducts) : undefined,
        totalSyncedCustomers:
          data?.totalSyncedCustomers !== undefined ? Number(data.totalSyncedCustomers) : undefined,
        externalApiAuthConfigured: Boolean(data?.externalApiAuthConfigured),
        externalApiEnabled: data?.externalApiEnabled !== false,
        lastSyncedAt: syncedAtIso,
        revision: Number(data?.revision) || 0,
      },
    };
  } catch (err: any) {
    const errMsg = err?.message || 'Network unreachable during sync';
    const failedQueue: SyncQueueItem[] = queue.map(item =>
      syncingSet.has(item.id)
        ? {
            ...item,
            status: 'failed',
            attempts: item.attempts + 1,
            lastAttemptAt: new Date().toISOString(),
            errorMessage: errMsg,
          }
        : item
    );
    saveSyncQueueToLocalStorage(failedQueue);
    await mirrorOutboxToIndexedDb(failedQueue);

    saveOfflineSyncConfig({
      ...config,
      lastSyncError: errMsg,
    });

    return {
      ok: false,
      syncedCount: 0,
      failedCount: candidates.length,
      queue: failedQueue,
      updatedBills: getStoredBills(),
      error: errMsg,
    };
  }
}

export async function clearSyncedQueueItems(): Promise<SyncQueueItem[]> {
  const next = getStoredSyncQueue().filter(item => item.status !== 'synced');
  saveSyncQueueToLocalStorage(next);
  await mirrorOutboxToIndexedDb(next);
  return next;
}

export async function pushFullLocalSnapshotToServer(): Promise<{
  ok: boolean;
  serverSyncedAt?: string;
  totalSyncedBills?: number;
  error?: string;
}> {
  const config = getOfflineSyncConfig();
  if (config.forceOfflineMode) {
    return { ok: false, error: 'Disable Manual Offline Mode to push backup to server.' };
  }

  try {
    const res = await fetch('/api/sync/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        products: getStoredProducts(),
        customers: getStoredCustomers(),
        bills: getStoredBills(),
        khata: getStoredKhata(),
        suppliers: getStoredSuppliers(),
        purchaseOrders: getStoredPurchaseOrders(),
        cashFlowEntries: getStoredCashFlowEntries(),
        openingCashMap: getStoredOpeningCashMap(),
        loyaltyTransactions: getStoredLoyaltyTransactions(),
        staffMembers: getStoredStaffMembers(),
        attendanceRecords: getStoredAttendanceRecords(),
        storeProfile: getStoredStoreProfile(),
      }),
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const syncedAt = data.serverSyncedAt || new Date().toISOString();

    // Mark all local bills and pending items as synced
    const bills = getStoredBills().map(b => ({
      ...b,
      syncStatus: 'synced' as const,
      syncedAt: b.syncedAt || syncedAt,
    }));
    saveBills(bills);
    await syncAllBillsToIndexedDb(bills);

    const queue = getStoredSyncQueue().map(q =>
      q.status === 'pending' || q.status === 'failed'
        ? { ...q, status: 'synced' as const, syncedAt, errorMessage: undefined }
        : q
    );
    saveSyncQueueToLocalStorage(queue);
    await mirrorOutboxToIndexedDb(queue);

    saveOfflineSyncConfig({
      ...config,
      lastSuccessfulSyncAt: syncedAt,
      lastSyncError: undefined,
    });

    return {
      ok: true,
      serverSyncedAt: syncedAt,
      totalSyncedBills: Number(data.totalSyncedBills) || bills.length,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to upload snapshot',
    };
  }
}

function getLatestUpdatedAtMs(items: Array<{ updatedAt?: string }>): number {
  let maxMs = 0;
  for (const item of items) {
    if (typeof item?.updatedAt === 'string') {
      const ms = Date.parse(item.updatedAt);
      if (Number.isFinite(ms) && ms > maxMs) {
        maxMs = ms;
      }
    }
  }
  return maxMs;
}

export async function pullServerSnapshotToLocal(options?: {
  forceOverwrite?: boolean;
}): Promise<{
  ok: boolean;
  restoredBills?: number;
  error?: string;
}> {
  try {
    const res = await fetch('/api/sync/snapshot', { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const snap = data?.snapshot;
    if (!snap) throw new Error('Empty snapshot');

    if (Array.isArray(snap.products) && snap.products.length > 0) {
      const serverProducts = normalizeProductList(snap.products);
      const localProducts = getStoredProducts();
      const localManifest = getLocalInventoryManifest();
      const localLatestMs = Math.max(
        getLatestUpdatedAtMs(localProducts),
        localManifest?.updatedAt ? Date.parse(localManifest.updatedAt) || 0 : 0
      );
      const serverLatestMs = getLatestUpdatedAtMs(serverProducts);

      const allowOverwrite =
        Boolean(options?.forceOverwrite) ||
        !localManifest?.userCustomized ||
        serverLatestMs > localLatestMs;

      if (allowOverwrite && serverProducts.length > 0) {
        saveProducts(serverProducts, { markCustomized: true });
      }
    }
    if (Array.isArray(snap.customers) && snap.customers.length > 0) saveCustomers(snap.customers);
    if (Array.isArray(snap.bills) && snap.bills.length > 0) {
      saveBills(snap.bills);
      await syncAllBillsToIndexedDb(snap.bills);
    }
    if (Array.isArray(snap.khata)) saveKhata(snap.khata);
    if (Array.isArray(snap.suppliers) && snap.suppliers.length > 0) saveSuppliers(snap.suppliers);
    if (Array.isArray(snap.purchaseOrders) && snap.purchaseOrders.length > 0) {
      savePurchaseOrders(snap.purchaseOrders);
    }
    if (Array.isArray(snap.cashFlowEntries) && snap.cashFlowEntries.length > 0) {
      saveCashFlowEntries(snap.cashFlowEntries);
    }
    if (snap.openingCashMap && typeof snap.openingCashMap === 'object') {
      saveOpeningCashMap(snap.openingCashMap);
    }
    if (Array.isArray(snap.loyaltyTransactions) && snap.loyaltyTransactions.length > 0) {
      saveLoyaltyTransactions(snap.loyaltyTransactions);
    }
    if (Array.isArray(snap.staffMembers) && snap.staffMembers.length > 0) {
      saveStaffMembers(snap.staffMembers);
    }
    if (Array.isArray(snap.attendanceRecords) && snap.attendanceRecords.length > 0) {
      saveAttendanceRecords(snap.attendanceRecords);
    }
    if (snap.storeProfile && typeof snap.storeProfile === 'object') {
      saveStoreProfile(snap.storeProfile);
    }

    return {
      ok: true,
      restoredBills: Array.isArray(snap.bills) ? snap.bills.length : 0,
    };
  } catch (err: any) {
    return {
      ok: false,
      error: err?.message || 'Failed to pull server snapshot',
    };
  }
}
