import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bill,
  OfflineSyncConfig,
  ServerSyncStatus,
  SyncEntityType,
  SyncQueueItem,
  SystemNotificationSeverity,
} from '../types';
import {
  checkServerConnectivity,
  clearSyncedQueueItems,
  enqueueSyncOperation,
  flushPendingSyncQueue,
  getOfflineIndexedDbBillCount,
  getOfflineSyncConfig,
  getStoredSyncQueue,
  persistBillToIndexedDb,
  pullServerSnapshotToLocal,
  pushFullLocalSnapshotToServer,
  reconcileSyncedBillsInStorage,
  saveOfflineSyncConfig,
  syncAllBillsToIndexedDb,
} from '../utils/offlineSync';
import { getInventoryPersistenceHealth } from '../utils/inventoryDb';

export interface OfflineSyncNotificationEvent {
  severity: SystemNotificationSeverity;
  title: string;
  message: string;
}

interface UseOfflineSyncOptions {
  bills: Bill[];
  onBillsUpdated: (bills: Bill[]) => void;
  onFullDataReload: () => void;
  onNotificationEvent?: (event: OfflineSyncNotificationEvent) => void;
  enableAutoCloudSync?: boolean;
}

export function useOfflineSync({
  bills,
  onBillsUpdated,
  onFullDataReload,
  onNotificationEvent,
  enableAutoCloudSync = true,
}: UseOfflineSyncOptions) {
  const [isBrowserOnline, setIsBrowserOnline] = useState<boolean>(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  );
  const [config, setConfig] = useState<OfflineSyncConfig>(() => getOfflineSyncConfig());
  const [syncQueue, setSyncQueue] = useState<SyncQueueItem[]>(() => getStoredSyncQueue());
  const [isSyncing, setIsSyncing] = useState<boolean>(false);
  const [swOfflineReady, setSwOfflineReady] = useState<boolean>(false);
  const [indexedDbBillCount, setIndexedDbBillCount] = useState<number>(bills.length);
  const [indexedDbProductCount, setIndexedDbProductCount] = useState<number>(0);
  const [persistentStorageGranted, setPersistentStorageGranted] = useState<boolean>(false);
  const [syncNotice, setSyncNotice] = useState<string | null>(null);
  const [serverStatus, setServerStatus] = useState<ServerSyncStatus>({
    reachable: typeof navigator !== 'undefined' ? navigator.onLine : true,
    totalSyncedBills: 0,
    totalSyncedOperations: 0,
    revision: 0,
  });

  const syncingRef = useRef(false);
  const lastKnownRevisionRef = useRef<number | null>(null);
  const initialServerSyncedRef = useRef(false);
  const onNotificationEventRef = useRef(onNotificationEvent);
  useEffect(() => {
    onNotificationEventRef.current = onNotificationEvent;
  }, [onNotificationEvent]);
  const enableAutoCloudSyncRef = useRef(enableAutoCloudSync);
  useEffect(() => {
    enableAutoCloudSyncRef.current = enableAutoCloudSync;
  }, [enableAutoCloudSync]);

  const showNotice = useCallback(
    (
      msg: string,
      opts?: { severity?: SystemNotificationSeverity; title?: string; log?: boolean }
    ) => {
      setSyncNotice(msg);
      setTimeout(() => setSyncNotice(prev => (prev === msg ? null : prev)), 4000);
      if (opts?.log !== false) {
        onNotificationEventRef.current?.({
          severity: opts?.severity || 'info',
          title: opts?.title || 'Sync Status',
          message: msg,
        });
      }
    },
    []
  );

  const refreshServerStatus = useCallback(async () => {
    if (config.forceOfflineMode || (typeof navigator !== 'undefined' && !navigator.onLine)) {
      setServerStatus(prev => ({ ...prev, reachable: false }));
      return null;
    }
    const status = await checkServerConnectivity();
    setServerStatus(status);
    return status;
  }, [config.forceOfflineMode]);

  // Keep IndexedDB offline_bills & inventory vault counts up-to-date
  useEffect(() => {
    getInventoryPersistenceHealth()
      .then(health => {
        setIndexedDbProductCount(health.indexedDbProductCount);
        setPersistentStorageGranted(health.persistentStorageGranted);
      })
      .catch(() => {});

    if (!enableAutoCloudSync) {
      setIndexedDbBillCount(bills.length);
      return;
    }
    syncAllBillsToIndexedDb(bills).then(async () => {
      const count = await getOfflineIndexedDbBillCount();
      setIndexedDbBillCount(count);
    });
  }, [bills, enableAutoCloudSync]);

  const syncNow = useCallback(
    async (opts?: { targetItemId?: string; silent?: boolean }) => {
      if (syncingRef.current) return null;
      syncingRef.current = true;
      setIsSyncing(true);
      try {
        const result = await flushPendingSyncQueue({ targetItemId: opts?.targetItemId });
        setSyncQueue(result.queue);
        setConfig(getOfflineSyncConfig());
        if (result.updatedBills) {
          onBillsUpdated(result.updatedBills);
        }
        if (result.serverStatus) {
          lastKnownRevisionRef.current = result.serverStatus.revision;
          setServerStatus(result.serverStatus);
        } else {
          const refreshed = await refreshServerStatus();
          if (refreshed?.reachable) {
            lastKnownRevisionRef.current = refreshed.revision;
          }
        }
        if (!opts?.silent) {
          if (result.ok && result.syncedCount > 0) {
            showNotice(
              `Synced ${result.syncedCount} queued operation${result.syncedCount === 1 ? '' : 's'} to server`,
              { severity: 'success', title: 'Sync Completed' }
            );
          } else if (result.error) {
            showNotice(result.error, { severity: 'warning', title: 'Sync Warning' });
          } else if (result.ok) {
            showNotice('All local POS records are up to date', {
              severity: 'success',
              title: 'Records Up to Date',
            });
          }
        } else if (result.ok && result.syncedCount > 0) {
          onNotificationEventRef.current?.({
            severity: 'success',
            title: 'Auto-Sync Completed',
            message: `Synced ${result.syncedCount} queued operation${result.syncedCount === 1 ? '' : 's'} in background`,
          });
        } else if (result.error) {
          onNotificationEventRef.current?.({
            severity: 'warning',
            title: 'Background Sync Deferred',
            message: result.error,
          });
        }
        return result;
      } finally {
        syncingRef.current = false;
        setIsSyncing(false);
      }
    },
    [onBillsUpdated, refreshServerStatus, showNotice]
  );

  // Monitor browser online/offline events, Service Worker messages & background sync
  useEffect(() => {
    const handleOnline = () => {
      setIsBrowserOnline(true);
      if (!enableAutoCloudSyncRef.current) return;
      refreshServerStatus();
      const latestConfig = getOfflineSyncConfig();
      if (latestConfig.autoSyncOnReconnect && !latestConfig.forceOfflineMode) {
        syncNow({ silent: false });
      }
    };

    const handleOffline = () => {
      setIsBrowserOnline(false);
      setServerStatus(prev => ({ ...prev, reachable: false }));
      showNotice('Connection lost — Switched to Offline Mode. Bills saved locally.', {
        severity: 'warning',
        title: 'Offline Mode Active',
      });
    };

    const handleSwOfflineReady = () => {
      setSwOfflineReady(true);
    };

    const handleSwMessage = async (event: MessageEvent) => {
      if (event.data?.type === 'SQ_BG_SYNC_COMPLETE') {
        const syncedIds: string[] = event.data.syncedIds || [];
        const syncedAtIso: string = event.data.serverSyncedAt || new Date().toISOString();
        const syncedSet = new Set(syncedIds);
        const billIds: string[] = [];

        const nextQueue = getStoredSyncQueue().map(item => {
          if (!syncedSet.has(item.id)) return item;
          if (item.entityType === 'bill') billIds.push(item.entityId);
          return {
            ...item,
            status: 'synced' as const,
            syncedAt: syncedAtIso,
            errorMessage: undefined,
          };
        });
        setSyncQueue(nextQueue);
        const updatedBills = await reconcileSyncedBillsInStorage(billIds, syncedAtIso);
        onBillsUpdated(updatedBills);
        refreshServerStatus();
        if (syncedIds.length > 0) {
          showNotice(`Background Sync completed (${syncedIds.length} items)`, {
            severity: 'success',
            title: 'Background Sync Completed',
          });
        }
      }
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    window.addEventListener('sq-sw-offline-ready', handleSwOfflineReady);

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.addEventListener('message', handleSwMessage);
      navigator.serviceWorker.ready
        .then(() => setSwOfflineReady(true))
        .catch(() => {});
    }

    // Initial connectivity check, startup seed if server empty, or flush pending queue
    if (enableAutoCloudSyncRef.current) {
      refreshServerStatus().then(async status => {
        const latestConfig = getOfflineSyncConfig();
        const pending = getStoredSyncQueue().some(
          i => i.status === 'pending' || i.status === 'failed'
        );
        if (status?.reachable) {
          lastKnownRevisionRef.current = status.revision;
          if (
            !initialServerSyncedRef.current &&
            (status.totalSyncedProducts || 0) === 0 &&
            !latestConfig.forceOfflineMode
          ) {
            initialServerSyncedRef.current = true;
            const pushRes = await pushFullLocalSnapshotToServer();
            if (pushRes.ok) {
              const nextStatus = await refreshServerStatus();
              if (nextStatus?.reachable) {
                lastKnownRevisionRef.current = nextStatus.revision;
              }
            }
          }
          if (
            pending &&
            latestConfig.autoSyncOnReconnect &&
            !latestConfig.forceOfflineMode
          ) {
            syncNow({ silent: true });
          }
        }
      });
    }

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
      window.removeEventListener('sq-sw-offline-ready', handleSwOfflineReady);
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.removeEventListener('message', handleSwMessage);
      }
    };
  }, [onBillsUpdated, refreshServerStatus, showNotice, syncNow]);

  // Periodic background check: flush pending queue & pull external API updates when server revision advances
  useEffect(() => {
    if (!enableAutoCloudSync) return;
    const interval = setInterval(async () => {
      if (config.forceOfflineMode) return;
      if (typeof navigator !== 'undefined' && !navigator.onLine) return;
      const queue = getStoredSyncQueue();
      const hasPending = queue.some(
        i => i.status === 'pending' || i.status === 'failed'
      );
      if (hasPending && config.autoSyncOnReconnect) {
        await syncNow({ silent: true });
        return;
      }
      if (syncingRef.current) return;
      const latestStatus = await refreshServerStatus();
      if (
        latestStatus?.reachable &&
        lastKnownRevisionRef.current !== null &&
        latestStatus.revision > lastKnownRevisionRef.current
      ) {
        lastKnownRevisionRef.current = latestStatus.revision;
        const pullRes = await pullServerSnapshotToLocal();
        if (pullRes.ok) {
          onFullDataReload();
          onNotificationEventRef.current?.({
            severity: 'info',
            title: 'External Update Synced',
            message: `Loaded latest catalog, stock, and order updates from server (rev ${latestStatus.revision}).`,
          });
        }
      } else if (latestStatus?.reachable && lastKnownRevisionRef.current === null) {
        lastKnownRevisionRef.current = latestStatus.revision;
      }
    }, 20000);
    return () => clearInterval(interval);
  }, [config.autoSyncOnReconnect, config.forceOfflineMode, enableAutoCloudSync, onFullDataReload, refreshServerStatus, syncNow]);

  const isEffectivelyOffline =
    config.forceOfflineMode || !isBrowserOnline || !serverStatus.reachable;

  const enqueueAndSyncIfOnline = useCallback(
    async (params: {
      entityType: SyncEntityType;
      entityId: string;
      label: string;
      amount?: number;
      payload: Record<string, unknown>;
      billRecord?: Bill;
    }) => {
      if (params.billRecord) {
        await persistBillToIndexedDb(params.billRecord);
      }
      const updatedQueue = await enqueueSyncOperation(params);
      setSyncQueue(updatedQueue);

      const currentlyOnline =
        !config.forceOfflineMode &&
        (typeof navigator === 'undefined' ? true : navigator.onLine);

      if (enableAutoCloudSync && currentlyOnline && config.autoSyncOnReconnect) {
        await syncNow({ silent: true });
      }
    },
    [config.autoSyncOnReconnect, config.forceOfflineMode, enableAutoCloudSync, syncNow]
  );

  const toggleForceOfflineMode = useCallback(
    async (nextOffline?: boolean) => {
      const target = typeof nextOffline === 'boolean' ? nextOffline : !config.forceOfflineMode;
      const nextCfg: OfflineSyncConfig = {
        ...config,
        forceOfflineMode: target,
      };
      saveOfflineSyncConfig(nextCfg);
      setConfig(nextCfg);

      if (target) {
        setServerStatus(prev => ({ ...prev, reachable: false }));
        showNotice('Offline Mode enabled — New bills & updates will queue locally', {
          severity: 'warning',
          title: 'Offline Mode Enabled',
        });
      } else {
        const status = await checkServerConnectivity();
        setServerStatus(status);
        const pending = getStoredSyncQueue().some(
          i => i.status === 'pending' || i.status === 'failed'
        );
        if (status.reachable && pending && nextCfg.autoSyncOnReconnect) {
          await syncNow({ silent: false });
        } else if (status.reachable) {
          showNotice('Back Online — Connected to SQ POS Sync Server', {
            severity: 'success',
            title: 'Connected to Server',
          });
        }
      }
    },
    [config, showNotice, syncNow]
  );

  const toggleAutoSyncOnReconnect = useCallback(() => {
    const nextCfg: OfflineSyncConfig = {
      ...config,
      autoSyncOnReconnect: !config.autoSyncOnReconnect,
    };
    saveOfflineSyncConfig(nextCfg);
    setConfig(nextCfg);
  }, [config]);

  const handleClearSynced = useCallback(async () => {
    const next = await clearSyncedQueueItems();
    setSyncQueue(next);
  }, []);

  const handlePushFullBackup = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await pushFullLocalSnapshotToServer();
      setSyncQueue(getStoredSyncQueue());
      setConfig(getOfflineSyncConfig());
      onFullDataReload();
      const latest = await refreshServerStatus();
      if (latest?.reachable) {
        lastKnownRevisionRef.current = latest.revision;
      }
      if (res.ok) {
        showNotice(`Full snapshot backed up (${res.totalSyncedBills || 0} bills synced)`, {
          severity: 'success',
          title: 'Full Backup Completed',
        });
      } else if (res.error) {
        showNotice(res.error, { severity: 'critical', title: 'Backup Failed' });
      }
      return res;
    } finally {
      setIsSyncing(false);
    }
  }, [onFullDataReload, refreshServerStatus, showNotice]);

  const handlePullServerBackup = useCallback(async () => {
    setIsSyncing(true);
    try {
      const res = await pullServerSnapshotToLocal({ forceOverwrite: true });
      if (res.ok) {
        onFullDataReload();
        showNotice(`Restored ${res.restoredBills || 0} bills from server backup`, {
          severity: 'success',
          title: 'Server Restore Completed',
        });
      } else if (res.error) {
        showNotice(res.error, { severity: 'critical', title: 'Restore Failed' });
      }
      return res;
    } finally {
      setIsSyncing(false);
    }
  }, [onFullDataReload, showNotice]);

  const pendingCount = useMemo(
    () => syncQueue.filter(i => i.status === 'pending' || i.status === 'syncing').length,
    [syncQueue]
  );
  const failedCount = useMemo(
    () => syncQueue.filter(i => i.status === 'failed').length,
    [syncQueue]
  );
  const syncedCount = useMemo(
    () => syncQueue.filter(i => i.status === 'synced').length,
    [syncQueue]
  );
  const pendingBillsCount = useMemo(
    () => bills.filter(b => b.syncStatus === 'pending_offline' || b.syncStatus === 'failed').length,
    [bills]
  );

  return {
    isBrowserOnline,
    forceOfflineMode: config.forceOfflineMode,
    autoSyncOnReconnect: config.autoSyncOnReconnect,
    isEffectivelyOffline,
    swOfflineReady,
    syncQueue,
    pendingCount,
    failedCount,
    syncedCount,
    pendingBillsCount,
    indexedDbBillCount,
    indexedDbProductCount,
    persistentStorageGranted,
    isSyncing,
    serverStatus,
    lastSuccessfulSyncAt: config.lastSuccessfulSyncAt || serverStatus.lastSyncedAt,
    syncNotice,
    enqueueAndSyncIfOnline,
    syncNow,
    toggleForceOfflineMode,
    toggleAutoSyncOnReconnect,
    clearSyncedHistory: handleClearSynced,
    pushFullBackup: handlePushFullBackup,
    pullServerBackup: handlePullServerBackup,
    refreshServerStatus,
  };
}
