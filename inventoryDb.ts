import { Product, PurchaseOrder, Supplier } from '../types';

export const INVENTORY_DB_NAME = 'sq_pos_inventory_db';
export const INVENTORY_DB_VERSION = 1;
export const INVENTORY_SCHEMA_VERSION = 2;

export const INVENTORY_STORES = {
  PRODUCTS: 'products',
  SUPPLIERS: 'suppliers',
  PURCHASE_ORDERS: 'purchase_orders',
  META: 'inventory_meta',
} as const;

export const LOCAL_INVENTORY_MANIFEST_KEY = 'sq_pos_inventory_manifest_v1';

export interface InventoryManifest {
  schemaVersion: number;
  revision: number;
  userCustomized: boolean;
  productCount: number;
  totalStockPieces: number;
  updatedAt: string;
}

export interface InventoryPersistenceHealth {
  indexedDbSupported: boolean;
  persistentStorageGranted: boolean;
  revision: number;
  userCustomized: boolean;
  indexedDbProductCount: number;
  localStorageProductCount: number;
  totalStockPieces: number;
  lastSavedAt?: string;
}

export interface IndexedDbInventorySnapshot {
  products: Product[] | null;
  manifest: InventoryManifest | null;
  categories: string[] | null;
  favoriteProductIds: string[] | null;
  suppliers: Supplier[] | null;
  purchaseOrders: PurchaseOrder[] | null;
}

let cachedPersistentStorageGranted: boolean | null = null;
let inventoryWriteQueue: Promise<unknown> = Promise.resolve();

function enqueueInventoryWrite<T>(task: () => Promise<T>): Promise<T> {
  const run = inventoryWriteQueue.then(task, task);
  inventoryWriteQueue = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

/**
 * Safely normalize any Product record across app updates without discarding user edits.
 */
export function normalizeProductRecord(raw: any): Product | null {
  if (!raw || typeof raw !== 'object') return null;
  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  const name = typeof raw.name === 'string' && raw.name.trim() ? raw.name.trim() : '';
  if (!id || !name) return null;

  const bundlePiecesRaw = Number(raw.bundlePieces);
  const bundlePieces =
    Number.isFinite(bundlePiecesRaw) && bundlePiecesRaw >= 1 ? Math.round(bundlePiecesRaw) : 1;

  const bundlePriceRaw = Number(raw.bundlePrice);
  const bundlePrice =
    Number.isFinite(bundlePriceRaw) && bundlePriceRaw >= 0 ? bundlePriceRaw : 0;

  const piecePriceRaw = Number(raw.piecePrice);
  const piecePrice =
    Number.isFinite(piecePriceRaw) && piecePriceRaw >= 0 ? piecePriceRaw : 0;

  const stockPiecesRaw = Number(raw.stockPieces);
  const stockPieces = Number.isFinite(stockPiecesRaw) ? stockPiecesRaw : 0;

  const lowStockRaw = Number(raw.lowStockThreshold);
  const lowStockThreshold =
    Number.isFinite(lowStockRaw) && lowStockRaw >= 0 ? lowStockRaw : 10;

  const normalized: Product = {
    id,
    name,
    category:
      typeof raw.category === 'string' && raw.category.trim()
        ? raw.category.trim()
        : 'General FMCG',
    bundleUnitName:
      typeof raw.bundleUnitName === 'string' && raw.bundleUnitName.trim()
        ? raw.bundleUnitName.trim()
        : 'Bundle',
    bundlePieces,
    bundlePrice,
    piecePrice,
    stockPieces,
    lowStockThreshold,
    emoji: typeof raw.emoji === 'string' && raw.emoji.trim() ? raw.emoji : '📦',
    color:
      typeof raw.color === 'string' && raw.color.trim()
        ? raw.color
        : 'from-blue-600 to-indigo-700',
  };

  if (typeof raw.barcode === 'string' && raw.barcode.trim()) {
    normalized.barcode = raw.barcode.trim();
  }
  if (typeof raw.pieceBarcode === 'string' && raw.pieceBarcode.trim()) {
    normalized.pieceBarcode = raw.pieceBarcode.trim();
  }
  if (typeof raw.imageUrl === 'string' && raw.imageUrl.trim()) {
    normalized.imageUrl = raw.imageUrl;
  }
  if (typeof raw.isFavorite === 'boolean') {
    normalized.isFavorite = raw.isFavorite;
  }
  if (typeof raw.updatedAt === 'string' && raw.updatedAt.trim()) {
    normalized.updatedAt = raw.updatedAt;
  }

  return normalized;
}

export function normalizeProductList(rawList: unknown): Product[] {
  if (!Array.isArray(rawList)) return [];
  const seen = new Set<string>();
  const result: Product[] = [];
  for (const item of rawList) {
    const clean = normalizeProductRecord(item);
    if (clean && !seen.has(clean.id)) {
      seen.add(clean.id);
      result.push(clean);
    }
  }
  return result;
}

export function computeInventoryDigest(products: Product[]): {
  productCount: number;
  totalStockPieces: number;
} {
  let totalStockPieces = 0;
  for (const p of products) {
    totalStockPieces += Number(p.stockPieces) || 0;
  }
  return {
    productCount: products.length,
    totalStockPieces,
  };
}

export function getLocalInventoryManifest(): InventoryManifest | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    const raw = localStorage.getItem(LOCAL_INVENTORY_MANIFEST_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      schemaVersion: Number(parsed.schemaVersion) || INVENTORY_SCHEMA_VERSION,
      revision: Number(parsed.revision) || 0,
      userCustomized: Boolean(parsed.userCustomized),
      productCount: Number(parsed.productCount) || 0,
      totalStockPieces: Number(parsed.totalStockPieces) || 0,
      updatedAt:
        typeof parsed.updatedAt === 'string' ? parsed.updatedAt : new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

export function saveLocalInventoryManifest(manifest: InventoryManifest): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(LOCAL_INVENTORY_MANIFEST_KEY, JSON.stringify(manifest));
  } catch (e) {
    console.error('Failed to save inventory manifest', e);
  }
}

/**
 * If localStorage quota is exceeded (e.g., many base64 product photos), strip large inline data URIs
 * ONLY from the localStorage mirror while preserving full images in IndexedDB.
 */
export function compactProductsForLocalStorageQuota(products: Product[]): Product[] {
  return products.map(p => {
    if (p.imageUrl && p.imageUrl.startsWith('data:') && p.imageUrl.length > 4096) {
      const { imageUrl: _omitted, ...rest } = p;
      return rest;
    }
    return p;
  });
}

/**
 * Restore any full-fidelity imageUrl from IndexedDB back onto products loaded from compacted localStorage.
 */
export function mergeImageUrlsFromBackup(
  primaryProducts: Product[],
  backupProducts: Product[] | null
): Product[] {
  if (!backupProducts || backupProducts.length === 0) return primaryProducts;
  const imageById = new Map<string, string>();
  for (const bp of backupProducts) {
    if (bp.imageUrl) {
      imageById.set(bp.id, bp.imageUrl);
    }
  }
  if (imageById.size === 0) return primaryProducts;
  return primaryProducts.map(p =>
    p.imageUrl || !imageById.has(p.id) ? p : { ...p, imageUrl: imageById.get(p.id) }
  );
}

export function openInventoryDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null);
  return new Promise(resolve => {
    try {
      const req = indexedDB.open(INVENTORY_DB_NAME, INVENTORY_DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(INVENTORY_STORES.PRODUCTS)) {
          db.createObjectStore(INVENTORY_STORES.PRODUCTS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(INVENTORY_STORES.SUPPLIERS)) {
          db.createObjectStore(INVENTORY_STORES.SUPPLIERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(INVENTORY_STORES.PURCHASE_ORDERS)) {
          db.createObjectStore(INVENTORY_STORES.PURCHASE_ORDERS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(INVENTORY_STORES.META)) {
          db.createObjectStore(INVENTORY_STORES.META, { keyPath: 'key' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function requestBrowserPersistentStorage(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.storage) return false;
  try {
    if (typeof navigator.storage.persisted === 'function') {
      const already = await navigator.storage.persisted();
      if (already) {
        cachedPersistentStorageGranted = true;
        return true;
      }
    }
    if (typeof navigator.storage.persist === 'function') {
      const granted = await navigator.storage.persist();
      cachedPersistentStorageGranted = Boolean(granted);
      return cachedPersistentStorageGranted;
    }
  } catch {
    // Ignore unsupported storage.persist in restricted iframes
  }
  return Boolean(cachedPersistentStorageGranted);
}

export async function mirrorProductsToIndexedDb(
  products: Product[],
  manifest: InventoryManifest
): Promise<void> {
  await enqueueInventoryWrite(async () => {
    const db = await openInventoryDb();
    if (!db) return;
    const cleanProducts = normalizeProductList(products);
    const nowIso = manifest.updatedAt || new Date().toISOString();

    await new Promise<void>(resolve => {
      try {
        const tx = db.transaction(
          [INVENTORY_STORES.PRODUCTS, INVENTORY_STORES.META],
          'readwrite'
        );
        const productStore = tx.objectStore(INVENTORY_STORES.PRODUCTS);
        const metaStore = tx.objectStore(INVENTORY_STORES.META);

        productStore.clear();
        for (const prod of cleanProducts) {
          productStore.put(prod);
        }

        metaStore.put({
          key: 'inventory_manifest',
          value: manifest,
          updatedAt: nowIso,
        });
        metaStore.put({
          key: 'products_snapshot_backup',
          value: cleanProducts,
          updatedAt: nowIso,
        });

        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
        tx.onabort = () => {
          db.close();
          resolve();
        };
      } catch {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve();
      }
    });
  });
}

export async function mirrorMetaKeyToIndexedDb(
  key: 'categories' | 'favorite_product_ids',
  value: unknown
): Promise<void> {
  await enqueueInventoryWrite(async () => {
    const db = await openInventoryDb();
    if (!db) return;
    await new Promise<void>(resolve => {
      try {
        const tx = db.transaction(INVENTORY_STORES.META, 'readwrite');
        tx.objectStore(INVENTORY_STORES.META).put({
          key,
          value,
          updatedAt: new Date().toISOString(),
        });
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve();
      }
    });
  });
}

export async function mirrorSuppliersToIndexedDb(suppliers: Supplier[]): Promise<void> {
  await enqueueInventoryWrite(async () => {
    const db = await openInventoryDb();
    if (!db) return;
    await new Promise<void>(resolve => {
      try {
        const tx = db.transaction(INVENTORY_STORES.SUPPLIERS, 'readwrite');
        const store = tx.objectStore(INVENTORY_STORES.SUPPLIERS);
        store.clear();
        for (const sup of suppliers) {
          if (sup?.id) store.put(sup);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve();
      }
    });
  });
}

export async function mirrorPurchaseOrdersToIndexedDb(orders: PurchaseOrder[]): Promise<void> {
  await enqueueInventoryWrite(async () => {
    const db = await openInventoryDb();
    if (!db) return;
    await new Promise<void>(resolve => {
      try {
        const tx = db.transaction(INVENTORY_STORES.PURCHASE_ORDERS, 'readwrite');
        const store = tx.objectStore(INVENTORY_STORES.PURCHASE_ORDERS);
        store.clear();
        for (const po of orders) {
          if (po?.id) store.put(po);
        }
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => {
          db.close();
          resolve();
        };
      } catch {
        try {
          db.close();
        } catch {
          // ignore
        }
        resolve();
      }
    });
  });
}

export async function readInventorySnapshotFromIndexedDb(): Promise<IndexedDbInventorySnapshot> {
  const empty: IndexedDbInventorySnapshot = {
    products: null,
    manifest: null,
    categories: null,
    favoriteProductIds: null,
    suppliers: null,
    purchaseOrders: null,
  };

  const db = await openInventoryDb();
  if (!db) return empty;

  return new Promise<IndexedDbInventorySnapshot>(resolve => {
    try {
      const tx = db.transaction(
        [
          INVENTORY_STORES.PRODUCTS,
          INVENTORY_STORES.META,
          INVENTORY_STORES.SUPPLIERS,
          INVENTORY_STORES.PURCHASE_ORDERS,
        ],
        'readonly'
      );

      const prodReq = tx.objectStore(INVENTORY_STORES.PRODUCTS).getAll();
      const supReq = tx.objectStore(INVENTORY_STORES.SUPPLIERS).getAll();
      const poReq = tx.objectStore(INVENTORY_STORES.PURCHASE_ORDERS).getAll();
      const metaStore = tx.objectStore(INVENTORY_STORES.META);
      const manifestReq = metaStore.get('inventory_manifest');
      const backupReq = metaStore.get('products_snapshot_backup');
      const catsReq = metaStore.get('categories');
      const favsReq = metaStore.get('favorite_product_ids');

      tx.oncomplete = () => {
        const manifest: InventoryManifest | null = manifestReq.result?.value || null;
        const primaryProds = normalizeProductList(prodReq.result);
        const backupProds = normalizeProductList(backupReq.result?.value);

        // Choose products if present in IDB or explicitly saved as customized empty list
        let products: Product[] | null = null;
        if (primaryProds.length > 0) {
          products = mergeImageUrlsFromBackup(primaryProds, backupProds);
        } else if (backupProds.length > 0) {
          products = backupProds;
        } else if (manifest?.userCustomized) {
          products = [];
        }

        const categories: string[] | null = Array.isArray(catsReq.result?.value)
          ? catsReq.result.value
          : null;
        const favoriteProductIds: string[] | null = Array.isArray(favsReq.result?.value)
          ? favsReq.result.value
          : null;
        const suppliers: Supplier[] | null =
          Array.isArray(supReq.result) && supReq.result.length > 0 ? supReq.result : null;
        const purchaseOrders: PurchaseOrder[] | null =
          Array.isArray(poReq.result) && poReq.result.length > 0 ? poReq.result : null;

        db.close();
        resolve({
          products,
          manifest,
          categories,
          favoriteProductIds,
          suppliers,
          purchaseOrders,
        });
      };

      tx.onerror = () => {
        db.close();
        resolve(empty);
      };
    } catch {
      try {
        db.close();
      } catch {
        // ignore
      }
      resolve(empty);
    }
  });
}

export async function getInventoryPersistenceHealth(
  localStorageProductCount = 0
): Promise<InventoryPersistenceHealth> {
  const indexedDbSupported = typeof indexedDB !== 'undefined';
  let persistentStorageGranted = Boolean(cachedPersistentStorageGranted);
  if (typeof navigator !== 'undefined' && navigator.storage?.persisted) {
    try {
      persistentStorageGranted = await navigator.storage.persisted();
      cachedPersistentStorageGranted = persistentStorageGranted;
    } catch {
      // ignore
    }
  }

  const idbSnap = await readInventorySnapshotFromIndexedDb();
  const lsManifest = getLocalInventoryManifest();
  const effectiveManifest =
    idbSnap.manifest &&
    (!lsManifest || idbSnap.manifest.revision >= lsManifest.revision)
      ? idbSnap.manifest
      : lsManifest;

  const idbProds = idbSnap.products || [];
  const totalStockPieces =
    effectiveManifest?.totalStockPieces ?? computeInventoryDigest(idbProds).totalStockPieces;

  return {
    indexedDbSupported,
    persistentStorageGranted,
    revision: effectiveManifest?.revision ?? 0,
    userCustomized: Boolean(effectiveManifest?.userCustomized),
    indexedDbProductCount: idbProds.length,
    localStorageProductCount,
    totalStockPieces,
    lastSavedAt: effectiveManifest?.updatedAt,
  };
}
