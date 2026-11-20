/* Background Sync handler for SQ ENTERPRISES POS */
const SQ_DB_NAME = 'sq_enterprises_offline_db';
const SQ_DB_VERSION = 1;
const SQ_OUTBOX_STORE = 'sync_outbox';
const SQ_SYNC_TAG = 'sync-sq-pos-queue';

function openSqOfflineDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(SQ_DB_NAME, SQ_DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = event.target.result;
      if (!db.objectStoreNames.contains('offline_bills')) {
        db.createObjectStore('offline_bills', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains(SQ_OUTBOX_STORE)) {
        db.createObjectStore(SQ_OUTBOX_STORE, { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function flushOutboxFromWorker() {
  const db = await openSqOfflineDb();
  const items = await new Promise((resolve, reject) => {
    const tx = db.transaction(SQ_OUTBOX_STORE, 'readonly');
    const store = tx.objectStore(SQ_OUTBOX_STORE);
    const req = store.getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });

  const pending = items.filter((i) => i.status === 'pending' || i.status === 'failed');
  if (pending.length === 0) {
    return { syncedIds: [] };
  }

  const response = await fetch('/api/sync/batch', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ items: pending }),
  });

  if (!response.ok) {
    throw new Error('Sync HTTP ' + response.status);
  }

  const data = await response.json();
  const syncedSet = new Set(data.syncedIds || []);
  const nowIso = data.serverSyncedAt || new Date().toISOString();

  await new Promise((resolve, reject) => {
    const tx = db.transaction(SQ_OUTBOX_STORE, 'readwrite');
    const store = tx.objectStore(SQ_OUTBOX_STORE);
    for (const item of pending) {
      if (syncedSet.has(item.id)) {
        store.put({
          ...item,
          status: 'synced',
          syncedAt: nowIso,
          lastAttemptAt: nowIso,
          attempts: (item.attempts || 0) + 1,
          errorMessage: undefined,
        });
      }
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });

  const clientList = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const client of clientList) {
    client.postMessage({
      type: 'SQ_BG_SYNC_COMPLETE',
      syncedIds: Array.from(syncedSet),
      serverSyncedAt: nowIso,
    });
  }

  return data;
}

self.addEventListener('sync', (event) => {
  if (event.tag === SQ_SYNC_TAG) {
    event.waitUntil(flushOutboxFromWorker());
  }
});
