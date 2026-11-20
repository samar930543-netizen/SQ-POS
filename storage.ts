import {
  Product,
  Customer,
  Bill,
  KhataTransaction,
  DailyReportSummary,
  ReceiptSettings,
  Supplier,
  PurchaseOrder,
  CashFlowEntry,
  LoyaltyTransaction,
  StaffMember,
  AttendanceRecord,
  StoreProfile,
  StoreModuleVisibility,
  PosUiVisibility,
  HeaderIconVisibility,
  PosDisplayMode,
  RolePermissionMatrix,
  StaffActivityLog,
  WhatsAppAutomationConfig,
  WhatsAppInboundMessage,
  ExternalApiConfig,
  PerformanceSettings,
  PrinterConnectionsConfig,
  ThermalPaperRollConfig,
  StoreBranch,
  MultiBranchSyncConfig,
  BranchStockTransfer,
  BranchWorkspaceSnapshot,
  AppLockSettings,
} from '../types';
import { formatDateTime } from './formatters';
import { createDefaultRecoveryConfig } from './appLock';
import {
  DEFAULT_ROLE_PERMISSIONS,
  normalizeRolePermissionMatrix,
} from './staffRbac';
import {
  INVENTORY_SCHEMA_VERSION,
  InventoryManifest,
  compactProductsForLocalStorageQuota,
  computeInventoryDigest,
  getLocalInventoryManifest,
  mergeImageUrlsFromBackup,
  mirrorMetaKeyToIndexedDb,
  mirrorProductsToIndexedDb,
  mirrorPurchaseOrdersToIndexedDb,
  mirrorSuppliersToIndexedDb,
  normalizeProductList,
  readInventorySnapshotFromIndexedDb,
  requestBrowserPersistentStorage,
  saveLocalInventoryManifest,
} from './inventoryDb';

const STORAGE_KEYS = {
  PRODUCTS: 'sq_pos_products_v2',
  CUSTOMERS: 'sq_pos_customers_v2',
  BILLS: 'sq_pos_bills_v2',
  KHATA: 'sq_pos_khata_v2',
  SUPPLIERS: 'sq_pos_suppliers_v1',
  PURCHASE_ORDERS: 'sq_pos_purchase_orders_v1',
  CASHFLOW_ENTRIES: 'sq_pos_cashflow_entries_v1',
  OPENING_CASH: 'sq_pos_opening_cash_v1',
  LOYALTY_TX: 'sq_pos_loyalty_tx_v1',
  STAFF: 'sq_pos_staff_v1',
  ATTENDANCE: 'sq_pos_attendance_v1',
  ROLE_PERMISSIONS: 'sq_pos_role_permissions_v1',
  STAFF_ACTIVITY_LOGS: 'sq_pos_staff_activity_v1',
  ACTIVE_STAFF_ID: 'sq_pos_active_staff_id_v1',
  STORE_PROFILE: 'sq_store_profile_v1',
  DISPLAY_MODE: 'sq_pos_display_mode_v1',
  FAVORITE_PRODUCT_IDS: 'sq_pos_favorite_ids_v1',
  PRODUCT_CATEGORIES: 'sq_pos_categories_v1',
  WHATSAPP_MESSAGES: 'sq_pos_whatsapp_messages_v1',
  MULTI_STORE_BRANCHES: 'sq_multi_store_branches_v1',
  MULTI_BRANCH_SYNC_CONFIG: 'sq_multi_branch_sync_config_v1',
  BRANCH_TRANSFERS: 'sq_multi_branch_transfers_v1',
  BRANCH_VAULT_PREFIX: 'sq_branch_vault_v1_',
  APP_LOCK_SETTINGS: 'sq_pos_app_lock_v1',
};

// Initial Authentic FMCG Wholesale Catalog
const INITIAL_PRODUCTS: Product[] = [
  {
    id: 'prod_goldflake',
    name: 'Gold Flake King',
    category: 'Tobacco / Cigarettes',
    barcode: '8901234001',
    bundleUnitName: 'Bundle',
    bundlePieces: 50,
    bundlePrice: 4350,
    piecePrice: 80,
    stockPieces: 350, // 7 bundles
    lowStockThreshold: 10,
    emoji: '🚬',
    color: 'from-amber-600 to-yellow-600',
  },
  {
    id: 'prod_classic',
    name: 'Classic Regular',
    category: 'Tobacco / Cigarettes',
    barcode: '8901234002',
    bundleUnitName: 'Bundle',
    bundlePieces: 50,
    bundlePrice: 4600,
    piecePrice: 85,
    stockPieces: 250, // 5 bundles
    lowStockThreshold: 10,
    emoji: '🍂',
    color: 'from-blue-700 to-indigo-800',
  },
  {
    id: 'prod_flake_blue',
    name: 'Flake Blue',
    category: 'Tobacco / Cigarettes',
    barcode: '8901234003',
    bundleUnitName: 'Bundle',
    bundlePieces: 50,
    bundlePrice: 2900,
    piecePrice: 55,
    stockPieces: 8, // < 10 pieces -> SHOWCASES LOW STOCK ALERT!
    lowStockThreshold: 10,
    emoji: '🔷',
    color: 'from-sky-600 to-blue-700',
  },
  {
    id: 'prod_dettol',
    name: 'Dettol Original Soap 75g',
    category: 'Soaps & Personal Care',
    barcode: '8901234004',
    bundleUnitName: 'Carton',
    bundlePieces: 48,
    bundlePrice: 1820,
    piecePrice: 42,
    stockPieces: 192, // 4 cartons
    lowStockThreshold: 15,
    emoji: '🧼',
    color: 'from-emerald-600 to-green-700',
  },
  {
    id: 'prod_lifebuoy',
    name: 'Lifebuoy Total 100g',
    category: 'Soaps & Personal Care',
    barcode: '8901234005',
    bundleUnitName: 'Carton',
    bundlePieces: 72,
    bundlePrice: 1800,
    piecePrice: 28,
    stockPieces: 144, // 2 cartons
    lowStockThreshold: 15,
    emoji: '🧴',
    color: 'from-rose-600 to-red-700',
  },
  {
    id: 'prod_surf_excel',
    name: 'Surf Excel Easy Wash 500g',
    category: 'Detergents',
    barcode: '8901234006',
    bundleUnitName: 'Peti',
    bundlePieces: 24,
    bundlePrice: 1560,
    piecePrice: 70,
    stockPieces: 72, // 3 petis
    lowStockThreshold: 12,
    emoji: '🫧',
    color: 'from-cyan-600 to-blue-600',
  },
  {
    id: 'prod_rin_bar',
    name: 'Rin Detergent Bar 250g',
    category: 'Detergents',
    barcode: '8901234007',
    bundleUnitName: 'Carton',
    bundlePieces: 60,
    bundlePrice: 1050,
    piecePrice: 20,
    stockPieces: 5, // < 10 pieces -> LOW STOCK WARNING!
    lowStockThreshold: 10,
    emoji: '🧺',
    color: 'from-indigo-600 to-purple-700',
  },
  {
    id: 'prod_parle_g',
    name: 'Parle-G Gold Pack',
    category: 'Biscuits & Snacks',
    barcode: '8901234008',
    bundleUnitName: 'Carton',
    bundlePieces: 96,
    bundlePrice: 860,
    piecePrice: 10,
    stockPieces: 288, // 3 cartons
    lowStockThreshold: 20,
    emoji: '🍪',
    color: 'from-amber-500 to-orange-600',
  },
  {
    id: 'prod_good_day',
    name: 'Good Day Butter 100g',
    category: 'Biscuits & Snacks',
    barcode: '8901234009',
    bundleUnitName: 'Box',
    bundlePieces: 48,
    bundlePrice: 1350,
    piecePrice: 30,
    stockPieces: 144, // 3 boxes
    lowStockThreshold: 15,
    emoji: '🧈',
    color: 'from-yellow-500 to-amber-600',
  },
  {
    id: 'prod_tata_tea',
    name: 'Tata Tea Gold 250g',
    category: 'Beverages & Spices',
    barcode: '8901234010',
    bundleUnitName: 'Carton',
    bundlePieces: 20,
    bundlePrice: 2800,
    piecePrice: 150,
    stockPieces: 60, // 3 cartons
    lowStockThreshold: 10,
    emoji: '☕',
    color: 'from-emerald-700 to-teal-800',
  },
  {
    id: 'prod_fortune_oil',
    name: 'Fortune Mustard Oil 1L',
    category: 'Edible Oils',
    barcode: '8901234011',
    bundleUnitName: 'Carton',
    bundlePieces: 16,
    bundlePrice: 2240,
    piecePrice: 148,
    stockPieces: 48, // 3 cartons
    lowStockThreshold: 10,
    emoji: '🛢️',
    color: 'from-yellow-600 to-amber-700',
  },
  {
    id: 'prod_coke_can',
    name: 'Coca-Cola 250ml Can',
    category: 'Beverages & Spices',
    barcode: '8901234012',
    bundleUnitName: 'Tray',
    bundlePieces: 24,
    bundlePrice: 840,
    piecePrice: 40,
    stockPieces: 96, // 4 trays
    lowStockThreshold: 12,
    emoji: '🥤',
    color: 'from-red-600 to-rose-700',
  },
];

// Seed Wholesale Customers with initial Udhar (Pending Due), Pricing Tiers & Loyalty Points
const INITIAL_CUSTOMERS: Customer[] = [
  {
    id: 'cust_ramesh',
    name: 'Ramesh Kirana Store',
    phone: '9876543210',
    address: 'Main Bazaar, Shop #14',
    currentBalance: 1250, // Existing pending due
    creditLimit: 5000,
    creditWarningPct: 80,
    pricingTier: 'wholesale_a',
    loyaltyPoints: 640,
    lifetimeLoyaltyPoints: 2240,
    claimedMilestoneIds: ['ms_500'],
    createdAt: new Date(Date.now() - 7 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust_gupta',
    name: 'Gupta General Store',
    phone: '9823456789',
    address: 'Station Road Market',
    currentBalance: 450,
    creditLimit: 2000,
    creditWarningPct: 80,
    pricingTier: 'standard',
    loyaltyPoints: 280,
    lifetimeLoyaltyPoints: 780,
    claimedMilestoneIds: [],
    createdAt: new Date(Date.now() - 5 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust_ali',
    name: 'Ali Tea & Pan Stall',
    phone: '9712345678',
    address: 'Bus Stand Corner',
    currentBalance: 800,
    creditLimit: 1000,
    creditWarningPct: 80,
    pricingTier: 'custom',
    customDiscountPct: 2,
    customProductRates: {
      prod_tata_tea: { bundlePrice: 2680 },
      prod_parle_g: { bundlePrice: 820 },
    },
    loyaltyPoints: 160,
    lifetimeLoyaltyPoints: 320,
    claimedMilestoneIds: [],
    createdAt: new Date(Date.now() - 3 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'cust_suresh',
    name: 'Suresh Kirana',
    phone: '9988776655',
    address: 'Sector 4 Colony',
    currentBalance: 0,
    creditLimit: 10000,
    creditWarningPct: 80,
    pricingTier: 'vip_distributor',
    loyaltyPoints: 1250,
    lifetimeLoyaltyPoints: 5400,
    claimedMilestoneIds: ['ms_500', 'ms_1500', 'ms_3000'],
    createdAt: new Date(Date.now() - 10 * 86400000).toISOString(),
    updatedAt: new Date().toISOString(),
  },
];

const LEGACY_PRODUCT_STORAGE_KEYS = [
  'sq_pos_products_v1',
  'sq_pos_products',
  'sq_products',
];

function writeProductsToLocalStorage(products: Product[]): void {
  const serialized = JSON.stringify(products);
  try {
    localStorage.setItem(STORAGE_KEYS.PRODUCTS, serialized);
  } catch (err) {
    // Quota fallback: keep slim record in localStorage while IndexedDB retains full base64 images
    try {
      const compacted = compactProductsForLocalStorageQuota(products);
      localStorage.setItem(STORAGE_KEYS.PRODUCTS, JSON.stringify(compacted));
    } catch (compactErr) {
      console.error('Failed to save products to localStorage even after compaction', compactErr, err);
    }
  }
}

function tryRecoverLegacyProducts(): Product[] | null {
  for (const legacyKey of LEGACY_PRODUCT_STORAGE_KEYS) {
    try {
      const raw = localStorage.getItem(legacyKey);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      const normalized = normalizeProductList(parsed);
      if (normalized.length > 0) {
        return normalized;
      }
    } catch {
      // Try next legacy key
    }
  }
  return null;
}

export function getStoredProducts(): Product[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRODUCTS);
    if (!raw) {
      // Attempt non-destructive migration from legacy product storage keys before seeding demo data
      const legacyProducts = tryRecoverLegacyProducts();
      if (legacyProducts && legacyProducts.length > 0) {
        saveProducts(legacyProducts, { markCustomized: true });
        return legacyProducts;
      }
      saveProducts(INITIAL_PRODUCTS, { markCustomized: false, skipIndexedDb: true });
      return INITIAL_PRODUCTS;
    }
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      saveProducts(INITIAL_PRODUCTS, { markCustomized: false, skipIndexedDb: true });
      return INITIAL_PRODUCTS;
    }
    const normalized = normalizeProductList(parsed);
    const manifest = getLocalInventoryManifest();
    // Preserve intentional empty catalog if user explicitly customized it
    if (normalized.length === 0 && !manifest?.userCustomized) {
      return INITIAL_PRODUCTS;
    }
    return normalized;
  } catch {
    return INITIAL_PRODUCTS;
  }
}

export function saveProducts(
  products: Product[],
  options?: {
    markCustomized?: boolean;
    skipIndexedDb?: boolean;
    overrideManifest?: InventoryManifest;
  }
): void {
  try {
    const normalized = normalizeProductList(products);
    const prevManifest = getLocalInventoryManifest();
    const markCustomized = options?.markCustomized ?? true;
    const nowIso = new Date().toISOString();
    const digest = computeInventoryDigest(normalized);

    const nextManifest: InventoryManifest = options?.overrideManifest || {
      schemaVersion: INVENTORY_SCHEMA_VERSION,
      revision: markCustomized ? (prevManifest?.revision || 0) + 1 : prevManifest?.revision || 0,
      userCustomized: markCustomized ? true : Boolean(prevManifest?.userCustomized),
      productCount: digest.productCount,
      totalStockPieces: digest.totalStockPieces,
      updatedAt: nowIso,
    };

    saveLocalInventoryManifest(nextManifest);
    writeProductsToLocalStorage(normalized);

    if (!options?.skipIndexedDb) {
      void mirrorProductsToIndexedDb(normalized, nextManifest);
    }
  } catch (e) {
    console.error('Failed to save products', e);
  }
}

export function getStoredCustomers(): Customer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CUSTOMERS);
    if (!raw) {
      saveCustomers(INITIAL_CUSTOMERS);
      return INITIAL_CUSTOMERS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_CUSTOMERS;
  }
}

export function saveCustomers(customers: Customer[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CUSTOMERS, JSON.stringify(customers));
  } catch (e) {
    console.error('Failed to save customers', e);
  }
}

export function getStoredBills(): Bill[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BILLS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveBills(bills: Bill[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.BILLS, JSON.stringify(bills));
  } catch (e) {
    console.error('Failed to save bills', e);
  }
}

export function getStoredKhata(): KhataTransaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.KHATA);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

export function saveKhata(khata: KhataTransaction[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.KHATA, JSON.stringify(khata));
  } catch (e) {
    console.error('Failed to save khata', e);
  }
}

/**
 * Deduct stock pieces when a bill is completed (supports negative stock for uninterrupted billing)
 */
export function deductProductStock(
  items: Array<{ productId: string; totalPieces: number }>
): Product[] {
  const soldByProduct = new Map<string, number>();
  items.forEach(item => {
    soldByProduct.set(
      item.productId,
      (soldByProduct.get(item.productId) || 0) + item.totalPieces
    );
  });

  const nowIso = new Date().toISOString();
  const currentProducts = getStoredProducts();
  const updated = currentProducts.map(prod => {
    const soldPieces = soldByProduct.get(prod.id);
    if (soldPieces !== undefined) {
      return { ...prod, stockPieces: prod.stockPieces - soldPieces, updatedAt: nowIso };
    }
    return prod;
  });
  saveProducts(updated);
  return updated;
}

/**
 * Compute daily summary (Today's Total Sale, Cash Received, Udhar Given)
 */
export function getDailySummary(selectedDateStr?: string): DailyReportSummary {
  const bills = getStoredBills();
  const khata = getStoredKhata();

  const targetDate = selectedDateStr || new Date().toISOString().slice(0, 10);

  // Bills generated on target date
  const targetBills = bills.filter(b => b.timestamp.slice(0, 10) === targetDate);

  let totalSales = 0;
  let billCashReceived = 0;
  let udharGiven = 0;

  targetBills.forEach(bill => {
    totalSales += bill.itemsTotal; // Value of goods sold
    billCashReceived += bill.amountReceived;
    // If amount received is less than grand total, new udhar is added
    const unpaidOnBill = Math.max(0, bill.itemsTotal - bill.amountReceived);
    udharGiven += unpaidOnBill;
  });

  // Direct cash settlements made on this date from Khata
  const directPayments = khata.filter(
    k => k.type === 'PAYMENT_COLLECTED' && k.timestamp.slice(0, 10) === targetDate
  );
  const directCashReceived = directPayments.reduce((acc, curr) => acc + curr.amount, 0);

  return {
    date: targetDate,
    totalSales,
    cashReceived: billCashReceived + directCashReceived,
    udharGiven,
    billsCount: targetBills.length,
  };
}

/**
 * Record a direct payment collected from a customer towards their Udhar
 */
export function recordCustomerPayment(
  customerId: string,
  amount: number,
  notes: string = 'Cash Received'
): { updatedCustomer: Customer; tx: KhataTransaction } {
  const customers = getStoredCustomers();
  const customer = customers.find(c => c.id === customerId);
  if (!customer) throw new Error('Customer not found');

  const previousBalance = customer.currentBalance;
  const newBalance = Math.max(0, previousBalance - amount);

  const updatedCustomer: Customer = {
    ...customer,
    currentBalance: newBalance,
    updatedAt: new Date().toISOString(),
  };

  const updatedList = customers.map(c => (c.id === customerId ? updatedCustomer : c));
  saveCustomers(updatedList);

  const tx: KhataTransaction = {
    id: 'tx_' + Date.now(),
    customerId: customer.id,
    customerName: customer.name,
    customerPhone: customer.phone,
    timestamp: new Date().toISOString(),
    formattedDateTime: formatDateTime(new Date()),
    type: 'PAYMENT_COLLECTED',
    amount,
    previousBalance,
    newBalance,
    description: notes || 'Cash Payment Collected',
  };

  const allKhata = getStoredKhata();
  saveKhata([tx, ...allKhata]);

  return { updatedCustomer, tx };
}

// Seed Wholesale Suppliers & Distributors
function getIsoDateOffset(daysOffset: number): string {
  const d = new Date(Date.now() + daysOffset * 86400000);
  return d.toISOString().slice(0, 10);
}

const INITIAL_SUPPLIERS: Supplier[] = [
  {
    id: 'sup_metro_fmcg',
    name: 'Metro FMCG Wholesale Distributors',
    contactPerson: 'Rajesh Malhotra',
    phone: '9811223344',
    email: 'dispatch@metrofmcg.in',
    gstin: '07AAAFM1234K1Z2',
    address: 'Plot 18, Okhla Industrial Phase II, New Delhi',
    categories: ['Tobacco / Cigarettes', 'Soaps & Personal Care', 'Detergents'],
    leadTimeDays: 2,
    paymentTerms: 'Net 15',
    notes: 'Primary distributor for ITC, HUL soaps & detergents. Morning delivery slot 9 AM - 12 PM.',
    onTimeDeliveries: 14,
    totalDeliveries: 15,
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 2 * 86400000).toISOString(),
  },
  {
    id: 'sup_ganesh_agencies',
    name: 'Shree Ganesh Confectionery & Tea',
    contactPerson: 'Vikram Bansal',
    phone: '9871100992',
    email: 'orders@ganeshagencies.co.in',
    gstin: '07AABCG9012M1Z8',
    address: 'Khari Baoli Wholesale Market, Shop 42',
    categories: ['Biscuits & Snacks', 'Beverages & Spices'],
    leadTimeDays: 3,
    paymentTerms: 'Net 7',
    notes: 'Parle, Britannia & Tata Tea stockist. Minimum 3 cartons per trip.',
    onTimeDeliveries: 9,
    totalDeliveries: 11,
    createdAt: new Date(Date.now() - 38 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 1 * 86400000).toISOString(),
  },
  {
    id: 'sup_hindustan_oil',
    name: 'Hindustan Edible Oil & Beverage Depot',
    contactPerson: 'Harpreet Singh',
    phone: '9910445566',
    email: 'supply@hindustandepot.in',
    gstin: '07AAACH4481P1Z5',
    address: 'Lawrence Road Industrial Area, Block B-7',
    categories: ['Edible Oils', 'Beverages & Spices'],
    leadTimeDays: 4,
    paymentTerms: 'COD',
    notes: 'Direct Fortune Mustard Oil & Coca-Cola tray supplier. Unloading at rear gate.',
    onTimeDeliveries: 7,
    totalDeliveries: 8,
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 3 * 86400000).toISOString(),
  },
];

const INITIAL_PURCHASE_ORDERS: PurchaseOrder[] = [
  {
    id: 'po_initial_1001',
    poNumber: 'PO-2026-1001',
    supplierId: 'sup_metro_fmcg',
    supplierName: 'Metro FMCG Wholesale Distributors',
    supplierPhone: '9811223344',
    status: 'in_transit',
    orderDate: new Date(Date.now() - 2 * 86400000).toISOString(),
    expectedDeliveryDate: getIsoDateOffset(0), // Due Today
    items: [
      {
        productId: 'prod_flake_blue',
        productName: 'Flake Blue',
        bundleUnitName: 'Bundle',
        bundlePieces: 50,
        unitType: 'bundle',
        orderedQty: 5,
        receivedQty: 0,
        totalOrderedPieces: 250,
        totalReceivedPieces: 0,
        unitCost: 2620,
        lineTotal: 13100,
      },
      {
        productId: 'prod_rin_bar',
        productName: 'Rin Detergent Bar 250g',
        bundleUnitName: 'Carton',
        bundlePieces: 60,
        unitType: 'bundle',
        orderedQty: 4,
        receivedQty: 0,
        totalOrderedPieces: 240,
        totalReceivedPieces: 0,
        unitCost: 920,
        lineTotal: 3680,
      },
    ],
    subtotal: 16780,
    gstAmount: 0,
    totalAmount: 16780,
    amountPaid: 0,
    notes: 'Urgent restock for low-stock Flake Blue & Rin Bars.',
    timeline: [
      {
        id: 'evt_1001_1',
        status: 'ordered',
        timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
        note: 'PO issued to Metro FMCG Wholesale Distributors',
      },
      {
        id: 'evt_1001_2',
        status: 'in_transit',
        timestamp: new Date(Date.now() - 12 * 3600000).toISOString(),
        note: 'Dispatched via Tempo #DL-1L-8421, expected today',
      },
    ],
    createdAt: new Date(Date.now() - 2 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 12 * 3600000).toISOString(),
  },
  {
    id: 'po_initial_1002',
    poNumber: 'PO-2026-1002',
    supplierId: 'sup_ganesh_agencies',
    supplierName: 'Shree Ganesh Confectionery & Tea',
    supplierPhone: '9871100992',
    status: 'ordered',
    orderDate: new Date(Date.now() - 4 * 86400000).toISOString(),
    expectedDeliveryDate: getIsoDateOffset(-1), // 1 day overdue
    items: [
      {
        productId: 'prod_parle_g',
        productName: 'Parle-G Gold Pack',
        bundleUnitName: 'Carton',
        bundlePieces: 96,
        unitType: 'bundle',
        orderedQty: 6,
        receivedQty: 0,
        totalOrderedPieces: 576,
        totalReceivedPieces: 0,
        unitCost: 760,
        lineTotal: 4560,
      },
      {
        productId: 'prod_tata_tea',
        productName: 'Tata Tea Gold 250g',
        bundleUnitName: 'Carton',
        bundlePieces: 20,
        unitType: 'bundle',
        orderedQty: 3,
        receivedQty: 0,
        totalOrderedPieces: 60,
        totalReceivedPieces: 0,
        unitCost: 2490,
        lineTotal: 7470,
      },
    ],
    subtotal: 12030,
    gstAmount: 601.5,
    totalAmount: 12631.5,
    amountPaid: 5000,
    notes: 'Follow up with Vikram on Khari Baoli dispatch.',
    timeline: [
      {
        id: 'evt_1002_1',
        status: 'ordered',
        timestamp: new Date(Date.now() - 4 * 86400000).toISOString(),
        note: 'PO confirmed with ₹5,000 advance',
      },
    ],
    createdAt: new Date(Date.now() - 4 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 4 * 86400000).toISOString(),
  },
  {
    id: 'po_initial_1000',
    poNumber: 'PO-2026-1000',
    supplierId: 'sup_hindustan_oil',
    supplierName: 'Hindustan Edible Oil & Beverage Depot',
    supplierPhone: '9910445566',
    status: 'received',
    orderDate: new Date(Date.now() - 9 * 86400000).toISOString(),
    expectedDeliveryDate: getIsoDateOffset(-5),
    actualDeliveryDate: new Date(Date.now() - 5 * 86400000).toISOString(),
    items: [
      {
        productId: 'prod_fortune_oil',
        productName: 'Fortune Mustard Oil 1L',
        bundleUnitName: 'Carton',
        bundlePieces: 16,
        unitType: 'bundle',
        orderedQty: 3,
        receivedQty: 3,
        totalOrderedPieces: 48,
        totalReceivedPieces: 48,
        unitCost: 1980,
        lineTotal: 5940,
      },
      {
        productId: 'prod_coke_can',
        productName: 'Coca-Cola 250ml Can',
        bundleUnitName: 'Tray',
        bundlePieces: 24,
        unitType: 'bundle',
        orderedQty: 4,
        receivedQty: 4,
        totalOrderedPieces: 96,
        totalReceivedPieces: 96,
        unitCost: 730,
        lineTotal: 2920,
      },
    ],
    subtotal: 8860,
    gstAmount: 0,
    totalAmount: 8860,
    amountPaid: 8860,
    notes: 'Delivered on schedule and verified.',
    timeline: [
      {
        id: 'evt_1000_1',
        status: 'ordered',
        timestamp: new Date(Date.now() - 9 * 86400000).toISOString(),
        note: 'Order placed',
      },
      {
        id: 'evt_1000_2',
        status: 'received',
        timestamp: new Date(Date.now() - 5 * 86400000).toISOString(),
        note: 'Full shipment received and added to inventory',
      },
    ],
    createdAt: new Date(Date.now() - 9 * 86400000).toISOString(),
    updatedAt: new Date(Date.now() - 5 * 86400000).toISOString(),
  },
];

export function getStoredSuppliers(): Supplier[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.SUPPLIERS);
    if (!raw) {
      saveSuppliers(INITIAL_SUPPLIERS, { skipIndexedDb: true });
      return INITIAL_SUPPLIERS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_SUPPLIERS;
  }
}

export function saveSuppliers(
  suppliers: Supplier[],
  options?: { skipIndexedDb?: boolean }
): void {
  try {
    localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(suppliers));
    if (!options?.skipIndexedDb) {
      void mirrorSuppliersToIndexedDb(suppliers);
    }
  } catch (e) {
    console.error('Failed to save suppliers', e);
  }
}

export function getStoredPurchaseOrders(): PurchaseOrder[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PURCHASE_ORDERS);
    if (!raw) {
      savePurchaseOrders(INITIAL_PURCHASE_ORDERS, { skipIndexedDb: true });
      return INITIAL_PURCHASE_ORDERS;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_PURCHASE_ORDERS;
  }
}

export function savePurchaseOrders(
  orders: PurchaseOrder[],
  options?: { skipIndexedDb?: boolean }
): void {
  try {
    localStorage.setItem(STORAGE_KEYS.PURCHASE_ORDERS, JSON.stringify(orders));
    if (!options?.skipIndexedDb) {
      void mirrorPurchaseOrdersToIndexedDb(orders);
    }
  } catch (e) {
    console.error('Failed to save purchase orders', e);
  }
}

export function generateNextPoNumber(existingOrders: PurchaseOrder[]): string {
  const year = new Date().getFullYear();
  let maxSeq = 1002;
  existingOrders.forEach(po => {
    const match = po.poNumber.match(/(\d+)$/);
    if (match) {
      const n = parseInt(match[1], 10);
      if (n > maxSeq) maxSeq = n;
    }
  });
  return `PO-${year}-${maxSeq + 1}`;
}

// Initial Cash Flow Seed Entries (syncs with initial POs + today's float)
const INITIAL_CASHFLOW_ENTRIES: CashFlowEntry[] = [
  {
    id: 'cf_init_float',
    date: getIsoDateOffset(0),
    timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
    type: 'cash_injection',
    amount: 5000,
    paymentMode: 'cash',
    category: 'Counter Float',
    title: 'Morning Counter Change & Float Top-up',
    notes: 'Small denomination notes added to cash box',
  },
  {
    id: 'cf_init_freight',
    date: getIsoDateOffset(0),
    timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    type: 'expense',
    amount: 450,
    paymentMode: 'cash',
    category: 'Transport & Freight',
    title: 'Tempo Unloading & Porter Charges',
    notes: 'Morning wholesale stock unloading',
  },
  {
    id: 'cf_init_po_1002',
    date: getIsoDateOffset(-4),
    timestamp: new Date(Date.now() - 4 * 86400000).toISOString(),
    type: 'supplier_payment',
    amount: 5000,
    paymentMode: 'upi',
    category: 'Supplier Payment',
    title: 'Advance for PO-2026-1002',
    notes: 'Advance paid to Shree Ganesh Confectionery & Tea',
    supplierId: 'sup_ganesh_agencies',
    supplierName: 'Shree Ganesh Confectionery & Tea',
    poId: 'po_initial_1002',
    poNumber: 'PO-2026-1002',
    isAutoSynced: true,
  },
  {
    id: 'cf_init_po_1000',
    date: getIsoDateOffset(-5),
    timestamp: new Date(Date.now() - 5 * 86400000).toISOString(),
    type: 'supplier_payment',
    amount: 8860,
    paymentMode: 'cash',
    category: 'Supplier Payment',
    title: 'Settlement for PO-2026-1000',
    notes: 'COD settlement on delivery',
    supplierId: 'sup_hindustan_oil',
    supplierName: 'Hindustan Edible Oil & Beverage Depot',
    poId: 'po_initial_1000',
    poNumber: 'PO-2026-1000',
    isAutoSynced: true,
  },
];

const INITIAL_OPENING_CASH: Record<string, number> = {
  [getIsoDateOffset(0)]: 12500,
};

export function getStoredCashFlowEntries(): CashFlowEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.CASHFLOW_ENTRIES);
    if (!raw) {
      saveCashFlowEntries(INITIAL_CASHFLOW_ENTRIES);
      return INITIAL_CASHFLOW_ENTRIES;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_CASHFLOW_ENTRIES;
  }
}

export function saveCashFlowEntries(entries: CashFlowEntry[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.CASHFLOW_ENTRIES, JSON.stringify(entries));
  } catch (e) {
    console.error('Failed to save cash flow entries', e);
  }
}

export function getStoredOpeningCashMap(): Record<string, number> {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.OPENING_CASH);
    if (!raw) {
      saveOpeningCashMap(INITIAL_OPENING_CASH);
      return INITIAL_OPENING_CASH;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_OPENING_CASH;
  }
}

export function saveOpeningCashMap(map: Record<string, number>): void {
  try {
    localStorage.setItem(STORAGE_KEYS.OPENING_CASH, JSON.stringify(map));
  } catch (e) {
    console.error('Failed to save opening cash map', e);
  }
}

const INITIAL_LOYALTY_TX: LoyaltyTransaction[] = [
  {
    id: 'ltx_init_1',
    customerId: 'cust_suresh',
    customerName: 'Suresh Kirana',
    type: 'EARN',
    points: 450,
    timestamp: new Date(Date.now() - 2 * 86400000).toISOString(),
    note: 'Bulk wholesale purchase accrual (Platinum 2.0x)',
  },
  {
    id: 'ltx_init_2',
    customerId: 'cust_ramesh',
    customerName: 'Ramesh Kirana Store',
    type: 'MILESTONE_BONUS',
    points: 50,
    timestamp: new Date(Date.now() - 4 * 86400000).toISOString(),
    note: 'Silver Entry Milestone claimed (+50 pts)',
  },
];

const INITIAL_STAFF: StaffMember[] = [
  {
    id: 'staff_owner',
    name: 'Rajesh Aggarwal',
    phone: '9811044210',
    role: 'Store Owner / Admin',
    dailyWage: 0,
    shiftStart: '08:30',
    active: true,
    pin: '1234',
    createdAt: new Date(Date.now() - 45 * 86400000).toISOString(),
  },
  {
    id: 'staff_mohan',
    name: 'Mohan Verma',
    phone: '9810203040',
    role: 'Counter Cashier',
    dailyWage: 650,
    shiftStart: '09:00',
    active: true,
    pin: '1111',
    createdAt: new Date(Date.now() - 30 * 86400000).toISOString(),
  },
  {
    id: 'staff_imran',
    name: 'Imran Khan',
    phone: '9810556677',
    role: 'Godown Manager',
    dailyWage: 750,
    shiftStart: '08:30',
    active: true,
    createdAt: new Date(Date.now() - 28 * 86400000).toISOString(),
  },
  {
    id: 'staff_suresh_drv',
    name: 'Suresh Yadav',
    phone: '9899112233',
    role: 'Delivery Driver',
    dailyWage: 700,
    shiftStart: '09:00',
    active: true,
    createdAt: new Date(Date.now() - 20 * 86400000).toISOString(),
  },
  {
    id: 'staff_deepak',
    name: 'Deepak Kumar',
    phone: '9711448899',
    role: 'Helper',
    dailyWage: 500,
    shiftStart: '09:30',
    active: true,
    createdAt: new Date(Date.now() - 15 * 86400000).toISOString(),
  },
];

const INITIAL_ATTENDANCE: AttendanceRecord[] = [
  {
    id: 'att_init_1',
    staffId: 'staff_mohan',
    staffName: 'Mohan Verma',
    role: 'Counter Cashier',
    date: getIsoDateOffset(0),
    clockInTime: new Date(Date.now() - 4 * 3600000).toISOString(),
    status: 'clocked_in',
    notes: 'Morning counter shift',
  },
  {
    id: 'att_init_2',
    staffId: 'staff_imran',
    staffName: 'Imran Khan',
    role: 'Godown Manager',
    date: getIsoDateOffset(0),
    clockInTime: new Date(Date.now() - 5 * 3600000).toISOString(),
    status: 'clocked_in',
    notes: 'Stock dispatch & unloading supervision',
  },
  {
    id: 'att_init_3',
    staffId: 'staff_mohan',
    staffName: 'Mohan Verma',
    role: 'Counter Cashier',
    date: getIsoDateOffset(-1),
    clockInTime: new Date(Date.now() - 86400000 - 9 * 3600000).toISOString(),
    clockOutTime: new Date(Date.now() - 86400000).toISOString(),
    durationMinutes: 540,
    status: 'completed',
    notes: 'Full 9h shift completed',
  },
];

export function getStoredLoyaltyTransactions(): LoyaltyTransaction[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.LOYALTY_TX);
    if (!raw) {
      saveLoyaltyTransactions(INITIAL_LOYALTY_TX);
      return INITIAL_LOYALTY_TX;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_LOYALTY_TX;
  }
}

export function saveLoyaltyTransactions(list: LoyaltyTransaction[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.LOYALTY_TX, JSON.stringify(list));
  } catch (e) {
    console.error('Failed to save loyalty transactions', e);
  }
}

export function getStoredStaffMembers(): StaffMember[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STAFF);
    if (!raw) {
      saveStaffMembers(INITIAL_STAFF);
      return INITIAL_STAFF;
    }
    const parsed: StaffMember[] = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      saveStaffMembers(INITIAL_STAFF);
      return INITIAL_STAFF;
    }
    const hasOwner = parsed.some(s => s.role === 'Store Owner / Admin');
    if (!hasOwner) {
      const ownerSeed = INITIAL_STAFF[0];
      const merged = [ownerSeed, ...parsed];
      saveStaffMembers(merged);
      return merged;
    }
    return parsed;
  } catch {
    return INITIAL_STAFF;
  }
}

export function saveStaffMembers(staff: StaffMember[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.STAFF, JSON.stringify(staff));
  } catch (e) {
    console.error('Failed to save staff members', e);
  }
}

export function getStoredRolePermissions(): RolePermissionMatrix {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ROLE_PERMISSIONS);
    if (!raw) return DEFAULT_ROLE_PERMISSIONS;
    return normalizeRolePermissionMatrix(JSON.parse(raw));
  } catch {
    return DEFAULT_ROLE_PERMISSIONS;
  }
}

export function saveRolePermissions(matrix: RolePermissionMatrix): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.ROLE_PERMISSIONS,
      JSON.stringify(normalizeRolePermissionMatrix(matrix))
    );
  } catch (e) {
    console.error('Failed to save role permissions', e);
  }
}

export function getStoredActiveStaffId(staffList: StaffMember[] = []): string {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ACTIVE_STAFF_ID);
    if (raw && (staffList.length === 0 || staffList.some(s => s.id === raw && s.active))) {
      return raw;
    }
  } catch {
    // ignore storage read error
  }
  const owner = staffList.find(s => s.role === 'Store Owner / Admin' && s.active);
  const firstActive = staffList.find(s => s.active);
  return owner?.id || firstActive?.id || 'staff_owner';
}

export function saveActiveStaffId(staffId: string): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ACTIVE_STAFF_ID, staffId);
  } catch (e) {
    console.error('Failed to save active staff id', e);
  }
}

const INITIAL_STAFF_ACTIVITY_LOGS: StaffActivityLog[] = [
  {
    id: 'act_seed_1',
    timestamp: new Date(Date.now() - 4 * 3600000).toISOString(),
    domain: 'team_rbac',
    action: 'SHIFT_CLOCK_IN',
    staffId: 'staff_mohan',
    staffName: 'Mohan Verma',
    staffRole: 'Counter Cashier',
    targetLabel: 'Morning Counter Shift',
    details: 'Clocked in at billing desk · Role: Counter Cashier',
  },
  {
    id: 'act_seed_2',
    timestamp: new Date(Date.now() - 3 * 3600000).toISOString(),
    domain: 'inventory',
    action: 'STOCK_RESTOCK',
    staffId: 'staff_imran',
    staffName: 'Imran Khan',
    staffRole: 'Godown Manager',
    targetLabel: 'Gold Flake King',
    details: 'Restocked +100 pcs into godown rack A2',
    quantityDelta: 100,
    productId: 'prod_goldflake',
  },
  {
    id: 'act_seed_3',
    timestamp: new Date(Date.now() - 2 * 3600000).toISOString(),
    domain: 'sales',
    action: 'KHATA_PAYMENT',
    staffId: 'staff_owner',
    staffName: 'Rajesh Aggarwal',
    staffRole: 'Store Owner / Admin',
    targetLabel: 'Gupta General Store',
    details: 'Recorded ₹1,500 Khata cash settlement',
    amount: 1500,
  },
];

export function getStoredStaffActivityLogs(): StaffActivityLog[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STAFF_ACTIVITY_LOGS);
    if (!raw) {
      saveStaffActivityLogs(INITIAL_STAFF_ACTIVITY_LOGS);
      return INITIAL_STAFF_ACTIVITY_LOGS;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_STAFF_ACTIVITY_LOGS;
  } catch {
    return INITIAL_STAFF_ACTIVITY_LOGS;
  }
}

export function saveStaffActivityLogs(logs: StaffActivityLog[]): void {
  try {
    // Keep up to 400 most recent audit log entries
    localStorage.setItem(STORAGE_KEYS.STAFF_ACTIVITY_LOGS, JSON.stringify(logs.slice(0, 400)));
  } catch (e) {
    console.error('Failed to save staff activity logs', e);
  }
}

export function getStoredAttendanceRecords(): AttendanceRecord[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.ATTENDANCE);
    if (!raw) {
      saveAttendanceRecords(INITIAL_ATTENDANCE);
      return INITIAL_ATTENDANCE;
    }
    return JSON.parse(raw);
  } catch {
    return INITIAL_ATTENDANCE;
  }
}

export function saveAttendanceRecords(records: AttendanceRecord[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.ATTENDANCE, JSON.stringify(records));
  } catch (e) {
    console.error('Failed to save attendance records', e);
  }
}

/**
 * Export all data to JSON string for backup
 */
export function exportAllData(): string {
  const data = {
    appName: 'SQ ENTERPRISES POS',
    exportedAt: new Date().toISOString(),
    products: getStoredProducts(),
    categories: getStoredCategories(),
    favoriteProductIds: getStoredFavoriteProductIds(),
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
    rolePermissions: getStoredRolePermissions(),
    staffActivityLogs: getStoredStaffActivityLogs(),
    whatsappMessages: getStoredWhatsAppMessages(),
    storeProfile: getStoredStoreProfile(),
  };
  return JSON.stringify(data, null, 2);
}

/**
 * Import backup data from JSON
 */
export function importDataFromJson(jsonStr: string): boolean {
  try {
    const data = JSON.parse(jsonStr);
    if (data.products && Array.isArray(data.products)) {
      saveProducts(data.products, { markCustomized: true });
    }
    if (data.categories && Array.isArray(data.categories)) {
      saveCategories(data.categories);
    }
    if (data.favoriteProductIds && Array.isArray(data.favoriteProductIds)) {
      saveFavoriteProductIds(data.favoriteProductIds);
    }
    if (data.customers && Array.isArray(data.customers)) {
      saveCustomers(data.customers);
    }
    if (data.bills && Array.isArray(data.bills)) {
      saveBills(data.bills);
    }
    if (data.khata && Array.isArray(data.khata)) {
      saveKhata(data.khata);
    }
    if (data.suppliers && Array.isArray(data.suppliers)) {
      saveSuppliers(data.suppliers);
    }
    if (data.purchaseOrders && Array.isArray(data.purchaseOrders)) {
      savePurchaseOrders(data.purchaseOrders);
    }
    if (data.cashFlowEntries && Array.isArray(data.cashFlowEntries)) {
      saveCashFlowEntries(data.cashFlowEntries);
    }
    if (data.openingCashMap && typeof data.openingCashMap === 'object') {
      saveOpeningCashMap(data.openingCashMap);
    }
    if (data.loyaltyTransactions && Array.isArray(data.loyaltyTransactions)) {
      saveLoyaltyTransactions(data.loyaltyTransactions);
    }
    if (data.staffMembers && Array.isArray(data.staffMembers)) {
      saveStaffMembers(data.staffMembers);
    }
    if (data.attendanceRecords && Array.isArray(data.attendanceRecords)) {
      saveAttendanceRecords(data.attendanceRecords);
    }
    if (data.rolePermissions && typeof data.rolePermissions === 'object') {
      saveRolePermissions(normalizeRolePermissionMatrix(data.rolePermissions));
    }
    if (data.staffActivityLogs && Array.isArray(data.staffActivityLogs)) {
      saveStaffActivityLogs(data.staffActivityLogs);
    }
    if (data.whatsappMessages && Array.isArray(data.whatsappMessages)) {
      saveWhatsAppMessages(data.whatsappMessages);
    }
    if (data.storeProfile && typeof data.storeProfile === 'object') {
      saveStoreProfile({
        ...DEFAULT_STORE_PROFILE,
        ...data.storeProfile,
        enabledModules: {
          ...DEFAULT_ENABLED_MODULES,
          ...(data.storeProfile.enabledModules || {}),
        },
        posUiVisibility: {
          ...DEFAULT_POS_UI_VISIBILITY,
          ...(data.storeProfile.posUiVisibility || {}),
        },
        headerIconVisibility: {
          ...DEFAULT_HEADER_ICON_VISIBILITY,
          ...(data.storeProfile.headerIconVisibility || {}),
        },
        whatsappConfig: {
          ...DEFAULT_WHATSAPP_CONFIG,
          ...(data.storeProfile.whatsappConfig || {}),
        },
        externalApiConfig: {
          ...DEFAULT_EXTERNAL_API_CONFIG,
          ...(data.storeProfile.externalApiConfig || {}),
        },
        performanceSettings: {
          ...DEFAULT_PERFORMANCE_SETTINGS,
          ...(data.storeProfile.performanceSettings || {}),
        },
      });
    }
    return true;
  } catch (e) {
    console.error('Import failed', e);
    return false;
  }
}

/**
 * Reset demo data back to default FMCG catalog (explicit user action only)
 */
export function resetToDemoData(): void {
  const resetManifest: InventoryManifest = {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    revision: 0,
    userCustomized: false,
    productCount: INITIAL_PRODUCTS.length,
    totalStockPieces: computeInventoryDigest(INITIAL_PRODUCTS).totalStockPieces,
    updatedAt: new Date().toISOString(),
  };
  saveProducts(INITIAL_PRODUCTS, {
    markCustomized: false,
    overrideManifest: resetManifest,
  });
  saveCategories(DEFAULT_PRODUCT_CATEGORIES);
  saveFavoriteProductIds(DEFAULT_FAVORITE_IDS);
  saveCustomers(INITIAL_CUSTOMERS);
  saveBills([]);
  saveKhata([]);
  saveSuppliers(INITIAL_SUPPLIERS);
  savePurchaseOrders(INITIAL_PURCHASE_ORDERS);
  saveCashFlowEntries(INITIAL_CASHFLOW_ENTRIES);
  saveOpeningCashMap(INITIAL_OPENING_CASH);
  saveLoyaltyTransactions(INITIAL_LOYALTY_TX);
  saveStaffMembers(INITIAL_STAFF);
  saveAttendanceRecords(INITIAL_ATTENDANCE);
  saveRolePermissions(DEFAULT_ROLE_PERMISSIONS);
  saveStaffActivityLogs(INITIAL_STAFF_ACTIVITY_LOGS);
  saveActiveStaffId('staff_owner');
  saveStoreProfile(DEFAULT_STORE_PROFILE);
}

export interface InventoryHydrationResult {
  restoredFromIndexedDb: boolean;
  products: Product[];
  categories: string[];
  favoriteProductIds: string[];
  suppliers?: Supplier[];
  purchaseOrders?: PurchaseOrder[];
  persistentStorageGranted: boolean;
}

/**
 * Reconciles localStorage and IndexedDB on app launch / app updates.
 * Guarantees customized products, stock quantities, categories, and favorites
 * survive app updates, cache clears, and localStorage evictions without resetting to demo data.
 */
export async function hydrateInventoryFromPersistentStorage(): Promise<InventoryHydrationResult> {
  const persistentStorageGranted = await requestBrowserPersistentStorage();
  const idbSnap = await readInventorySnapshotFromIndexedDb();
  const lsManifest = getLocalInventoryManifest();
  const lsProducts = getStoredProducts();
  const lsCategories = getStoredCategories(lsProducts);
  const lsFavorites = getStoredFavoriteProductIds(lsProducts);

  const idbHasProducts = idbSnap.products !== null;
  const idbRevision = idbSnap.manifest?.revision || 0;
  const lsRevision = lsManifest?.revision || 0;
  const idbCustomized = Boolean(idbSnap.manifest?.userCustomized) || idbRevision > 0;
  const lsCustomized = Boolean(lsManifest?.userCustomized) || lsRevision > 0;

  // Determine whether IndexedDB holds authoritative customized data (e.g., localStorage wiped on update)
  const shouldRestoreProductsFromIdb =
    idbHasProducts &&
    ((!lsCustomized && idbCustomized) ||
      (idbCustomized && idbRevision > lsRevision) ||
      (!lsCustomized &&
        idbSnap.products!.length > 0 &&
        JSON.stringify(idbSnap.products) !== JSON.stringify(INITIAL_PRODUCTS)));

  if (shouldRestoreProductsFromIdb && idbSnap.products) {
    const restoredProducts = idbSnap.products;
    const restoredCats =
      idbSnap.categories && idbSnap.categories.length > 0
        ? normalizeCategoryList([
            ...idbSnap.categories,
            ...restoredProducts.map(p => p.category).filter(Boolean),
          ])
        : getStoredCategories(restoredProducts);
    const restoredFavs =
      idbSnap.favoriteProductIds !== null
        ? idbSnap.favoriteProductIds
        : getStoredFavoriteProductIds(restoredProducts);

    saveProducts(restoredProducts, {
      markCustomized: true,
      skipIndexedDb: true,
      overrideManifest:
        idbSnap.manifest || {
          schemaVersion: INVENTORY_SCHEMA_VERSION,
          revision: Math.max(1, idbRevision),
          userCustomized: true,
          ...computeInventoryDigest(restoredProducts),
          updatedAt: new Date().toISOString(),
        },
    });
    localStorage.setItem(STORAGE_KEYS.PRODUCT_CATEGORIES, JSON.stringify(restoredCats));
    localStorage.setItem(STORAGE_KEYS.FAVORITE_PRODUCT_IDS, JSON.stringify(restoredFavs));

    let restoredSuppliers: Supplier[] | undefined;
    if (idbSnap.suppliers && idbSnap.suppliers.length > 0) {
      localStorage.setItem(STORAGE_KEYS.SUPPLIERS, JSON.stringify(idbSnap.suppliers));
      restoredSuppliers = idbSnap.suppliers;
    }
    let restoredOrders: PurchaseOrder[] | undefined;
    if (idbSnap.purchaseOrders && idbSnap.purchaseOrders.length > 0) {
      localStorage.setItem(
        STORAGE_KEYS.PURCHASE_ORDERS,
        JSON.stringify(idbSnap.purchaseOrders)
      );
      restoredOrders = idbSnap.purchaseOrders;
    }

    return {
      restoredFromIndexedDb: true,
      products: restoredProducts,
      categories: restoredCats,
      favoriteProductIds: restoredFavs,
      suppliers: restoredSuppliers,
      purchaseOrders: restoredOrders,
      persistentStorageGranted,
    };
  }

  // Re-hydrate any compacted base64 images back from IndexedDB if localStorage hit quota
  const hydratedProducts = mergeImageUrlsFromBackup(lsProducts, idbSnap.products);
  const hadImagesRestored = hydratedProducts.some(
    (p, idx) => Boolean(p.imageUrl) && !lsProducts[idx]?.imageUrl
  );

  // Also restore categories/favorites/suppliers/POs from IndexedDB if localStorage key disappeared
  let finalCategories = lsCategories;
  let restoredMeta = false;
  if (!localStorage.getItem(STORAGE_KEYS.PRODUCT_CATEGORIES) && idbSnap.categories) {
    finalCategories = normalizeCategoryList([
      ...idbSnap.categories,
      ...hydratedProducts.map(p => p.category).filter(Boolean),
    ]);
    localStorage.setItem(STORAGE_KEYS.PRODUCT_CATEGORIES, JSON.stringify(finalCategories));
    restoredMeta = true;
  }

  let finalFavorites = lsFavorites;
  if (!localStorage.getItem(STORAGE_KEYS.FAVORITE_PRODUCT_IDS) && idbSnap.favoriteProductIds) {
    finalFavorites = idbSnap.favoriteProductIds;
    localStorage.setItem(STORAGE_KEYS.FAVORITE_PRODUCT_IDS, JSON.stringify(finalFavorites));
    restoredMeta = true;
  }

  // Ensure IndexedDB has a fresh copy of current inventory, categories, favorites, suppliers & POs
  const currentDigest = computeInventoryDigest(hydratedProducts);
  const manifestToMirror: InventoryManifest = lsManifest || {
    schemaVersion: INVENTORY_SCHEMA_VERSION,
    revision: lsCustomized ? Math.max(1, lsRevision) : 0,
    userCustomized: lsCustomized,
    productCount: currentDigest.productCount,
    totalStockPieces: currentDigest.totalStockPieces,
    updatedAt: new Date().toISOString(),
  };
  if (!lsManifest) {
    saveLocalInventoryManifest(manifestToMirror);
  }
  await mirrorProductsToIndexedDb(hydratedProducts, manifestToMirror);
  await mirrorMetaKeyToIndexedDb('categories', finalCategories);
  await mirrorMetaKeyToIndexedDb('favorite_product_ids', finalFavorites);
  await mirrorSuppliersToIndexedDb(getStoredSuppliers());
  await mirrorPurchaseOrdersToIndexedDb(getStoredPurchaseOrders());

  return {
    restoredFromIndexedDb: hadImagesRestored || restoredMeta,
    products: hydratedProducts,
    categories: finalCategories,
    favoriteProductIds: finalFavorites,
    persistentStorageGranted,
  };
}

export const DEFAULT_ENABLED_MODULES: StoreModuleVisibility = {
  billing: true,
  khata: true,
  inventory: true,
  suppliers: true,
  cashflow: true,
  reports: true,
  staff_loyalty: true,
  whatsapp: true,
};

export const DEFAULT_POS_UI_VISIBILITY: PosUiVisibility = {
  walkInCustomerSelector: true,
  lowStockAlertBanner: true,
  categoryFilterTabs: true,
  catalogDisplayBar: true,
};

export const DEFAULT_HEADER_ICON_VISIBILITY: HeaderIconVisibility = {
  appLock: true,
  multiStore: true,
  operatorSwitcher: true,
  notifications: true,
  offlineSync: true,
  sound: true,
  haptics: true,
  pwaInstall: true,
  liveVoice: true,
  audioTranscribe: true,
  scanBill: true,
  receiptSettings: true,
  apkGuide: true,
  cart: true,
  navDrawerToggle: true,
};

export const DEFAULT_WHATSAPP_CONFIG: WhatsAppAutomationConfig = {
  enabled: true,
  autoConfirmOrders: false,
  autoDeductStock: true,
  autoReplyInquiries: true,
  defaultOrderPaymentMode: 'credit',
  businessPhoneNumberId: '',
  businessAccountId: '',
  verifyToken: 'sq_pos_whatsapp_verify',
  greetingTemplate: 'Namaste! Welcome to SQ Enterprises. Send your wholesale order or rate inquiry.',
};

export const DEFAULT_EXTERNAL_API_CONFIG: ExternalApiConfig = {
  enabled: true,
};

export const DEFAULT_PERFORMANCE_SETTINGS: PerformanceSettings = {
  enablePredictiveAnalytics: true,
  enableAutoCloudSync: true,
  enableLiveReceiptRendering: true,
};

export const DEFAULT_STORE_PROFILE: StoreProfile = {
  storeName: 'SQ ENTERPRISES',
  tagline: 'Wholesale FMCG & Bulk Distribution',
  contactNumber: '+91 98110 44210',
  email: 'billing@sqenterprises.in',
  address: 'Plot 14, Wholesale FMCG Market, Okhla Phase II, New Delhi - 110020',
  gstin: '07AABCS1429B1Z1',
  showLogoOnInvoices: true,
  showFacadeOnInvoices: true,
  showBrandingInHeader: true,
  enabledModules: DEFAULT_ENABLED_MODULES,
  posUiVisibility: DEFAULT_POS_UI_VISIBILITY,
  headerIconVisibility: DEFAULT_HEADER_ICON_VISIBILITY,
  whatsappConfig: DEFAULT_WHATSAPP_CONFIG,
  externalApiConfig: DEFAULT_EXTERNAL_API_CONFIG,
  performanceSettings: DEFAULT_PERFORMANCE_SETTINGS,
  updatedAt: new Date().toISOString(),
};

export function getStoredStoreProfile(): StoreProfile {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STORE_PROFILE);
    if (!raw) return DEFAULT_STORE_PROFILE;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STORE_PROFILE,
      ...parsed,
      enabledModules: {
        ...DEFAULT_ENABLED_MODULES,
        ...(parsed?.enabledModules || {}),
      },
      posUiVisibility: {
        ...DEFAULT_POS_UI_VISIBILITY,
        ...(parsed?.posUiVisibility || {}),
      },
      headerIconVisibility: {
        ...DEFAULT_HEADER_ICON_VISIBILITY,
        ...(parsed?.headerIconVisibility || {}),
      },
      whatsappConfig: {
        ...DEFAULT_WHATSAPP_CONFIG,
        ...(parsed?.whatsappConfig || {}),
      },
      externalApiConfig: {
        ...DEFAULT_EXTERNAL_API_CONFIG,
        ...(parsed?.externalApiConfig || {}),
      },
      performanceSettings: {
        ...DEFAULT_PERFORMANCE_SETTINGS,
        ...(parsed?.performanceSettings || {}),
      },
    };
  } catch {
    return DEFAULT_STORE_PROFILE;
  }
}

export function saveStoreProfile(profile: StoreProfile): void {
  try {
    localStorage.setItem(STORAGE_KEYS.STORE_PROFILE, JSON.stringify(profile));
  } catch (e) {
    console.error('Failed to save store profile', e);
  }
}

export const DEFAULT_PAPER_ROLL_CONFIG: ThermalPaperRollConfig = {
  lowPaperAlertEnabled: true,
  rollLengthMeters: 30,
  estimatedRemainingPct: 100,
  lowPaperThresholdPct: 15,
  billsPrintedSinceReset: 0,
  usedMetersSinceReset: 0,
  alertSoundOnLowPaper: true,
};

export const DEFAULT_PRINTER_CONNECTIONS_CONFIG: PrinterConnectionsConfig = {
  preferredType: 'browser',
  autoCutPaper: true,
  autoCutMode: 'partial',
  openCashDrawer: false,
  feedLinesAfterPrint: 3,
  paperRoll: DEFAULT_PAPER_ROLL_CONFIG,
  bluetooth: {
    enabled: false,
    chunkSizeBytes: 100,
    autoConnectOnPrint: true,
  },
  usb: {
    enabled: false,
    transport: 'webusb',
    baudRate: 9600,
  },
  networkIp: {
    enabled: false,
    host: '192.168.1.100',
    port: 9100,
    label: 'Counter LAN Printer',
    timeoutMs: 4000,
  },
  wifi: {
    enabled: false,
    mode: 'raw_tcp',
    host: '192.168.1.150',
    port: 9100,
    label: 'Wireless WiFi Printer',
    timeoutMs: 4500,
  },
};

export function resolvePrinterConnectionsConfig(
  printers?: Partial<PrinterConnectionsConfig>
): PrinterConnectionsConfig {
  const mergedRoll = {
    ...DEFAULT_PAPER_ROLL_CONFIG,
    ...(printers?.paperRoll || {}),
  };
  const safeRollLength =
    typeof mergedRoll.rollLengthMeters === 'number' &&
    Number.isFinite(mergedRoll.rollLengthMeters) &&
    mergedRoll.rollLengthMeters > 0
      ? Math.min(500, Math.max(1, Math.round(mergedRoll.rollLengthMeters * 10) / 10))
      : DEFAULT_PAPER_ROLL_CONFIG.rollLengthMeters;
  const safePct =
    typeof mergedRoll.estimatedRemainingPct === 'number' &&
    Number.isFinite(mergedRoll.estimatedRemainingPct)
      ? Math.min(100, Math.max(0, mergedRoll.estimatedRemainingPct))
      : DEFAULT_PAPER_ROLL_CONFIG.estimatedRemainingPct;
  const safeUsedMeters =
    typeof printers?.paperRoll?.usedMetersSinceReset === 'number' &&
    Number.isFinite(printers.paperRoll.usedMetersSinceReset) &&
    printers.paperRoll.usedMetersSinceReset >= 0
      ? Number(printers.paperRoll.usedMetersSinceReset.toFixed(4))
      : Number((safeRollLength * (1 - safePct / 100)).toFixed(4));

  return {
    preferredType: printers?.preferredType || DEFAULT_PRINTER_CONNECTIONS_CONFIG.preferredType,
    autoCutPaper:
      printers?.autoCutPaper ?? DEFAULT_PRINTER_CONNECTIONS_CONFIG.autoCutPaper,
    autoCutMode: printers?.autoCutMode || DEFAULT_PRINTER_CONNECTIONS_CONFIG.autoCutMode,
    openCashDrawer:
      printers?.openCashDrawer ?? DEFAULT_PRINTER_CONNECTIONS_CONFIG.openCashDrawer,
    feedLinesAfterPrint:
      typeof printers?.feedLinesAfterPrint === 'number'
        ? printers.feedLinesAfterPrint
        : DEFAULT_PRINTER_CONNECTIONS_CONFIG.feedLinesAfterPrint,
    paperRoll: {
      ...mergedRoll,
      rollLengthMeters: safeRollLength,
      estimatedRemainingPct: safePct,
      usedMetersSinceReset: safeUsedMeters,
    },
    bluetooth: {
      ...DEFAULT_PRINTER_CONNECTIONS_CONFIG.bluetooth,
      ...(printers?.bluetooth || {}),
    },
    usb: {
      ...DEFAULT_PRINTER_CONNECTIONS_CONFIG.usb,
      ...(printers?.usb || {}),
    },
    networkIp: {
      ...DEFAULT_PRINTER_CONNECTIONS_CONFIG.networkIp,
      ...(printers?.networkIp || {}),
    },
    wifi: {
      ...DEFAULT_PRINTER_CONNECTIONS_CONFIG.wifi,
      ...(printers?.wifi || {}),
    },
  };
}

const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = {
  template: 'standard',
  paperWidth: '58mm',
  showPhone: true,
  thankYouMessage: 'Thank you for your business!',
  autoSendWhatsApp: false,
  autoUdharWhatsApp: true,
  autoUdharSMS: true,
  enableGst: false,
  gstRate: 18,
  gstNumber: '07AABCS1429B1Z1',
  printers: DEFAULT_PRINTER_CONNECTIONS_CONFIG,
};

export function getStoredReceiptSettings(): ReceiptSettings {
  try {
    const raw = localStorage.getItem('sq_receipt_settings_v1');
    if (!raw) return DEFAULT_RECEIPT_SETTINGS;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_RECEIPT_SETTINGS,
      ...parsed,
      printers: resolvePrinterConnectionsConfig(parsed?.printers),
    };
  } catch {
    return DEFAULT_RECEIPT_SETTINGS;
  }
}

export function saveReceiptSettings(settings: ReceiptSettings): void {
  try {
    localStorage.setItem('sq_receipt_settings_v1', JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save receipt settings', e);
  }
}

const VALID_DISPLAY_MODES: PosDisplayMode[] = [
  'grid',
  'compact_grid',
  'list',
  'category_tabbed',
  'compact_search',
  'barcode_scanner',
  'favorites',
  'stock_alert',
];

export function getStoredDisplayMode(): PosDisplayMode {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.DISPLAY_MODE) as PosDisplayMode | null;
    if (raw && VALID_DISPLAY_MODES.includes(raw)) {
      return raw;
    }
    return 'grid';
  } catch {
    return 'grid';
  }
}

export function saveDisplayMode(mode: PosDisplayMode): void {
  try {
    localStorage.setItem(STORAGE_KEYS.DISPLAY_MODE, mode);
  } catch (e) {
    console.error('Failed to save display mode', e);
  }
}

const DEFAULT_FAVORITE_IDS = [
  'prod_goldflake',
  'prod_dettol',
  'prod_parle_g',
  'prod_tata_tea',
];

export function getStoredFavoriteProductIds(products: Product[] = []): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.FAVORITE_PRODUCT_IDS);
    if (raw !== null) {
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    }
    const flagged = products.filter(p => p.isFavorite).map(p => p.id);
    if (flagged.length > 0) return flagged;
    return DEFAULT_FAVORITE_IDS.filter(id =>
      products.length === 0 ? true : products.some(p => p.id === id)
    );
  } catch {
    return DEFAULT_FAVORITE_IDS;
  }
}

export function saveFavoriteProductIds(ids: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.FAVORITE_PRODUCT_IDS, JSON.stringify(ids));
    void mirrorMetaKeyToIndexedDb('favorite_product_ids', ids);
  } catch (e) {
    console.error('Failed to save favorite product IDs', e);
  }
}

export const DEFAULT_PRODUCT_CATEGORIES: string[] = [
  'Tobacco / Cigarettes',
  'Soaps & Personal Care',
  'Detergents',
  'Biscuits & Snacks',
  'Beverages & Spices',
  'Edible Oils',
  'Confectionery',
  'General FMCG',
];

function normalizeCategoryList(list: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of list) {
    const clean = typeof raw === 'string' ? raw.trim() : '';
    if (!clean || clean.toLowerCase() === 'all') continue;
    const key = clean.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      result.push(clean);
    }
  }
  return result;
}

export function getStoredCategories(products: Product[] = []): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.PRODUCT_CATEGORIES);
    const baseList =
      raw !== null
        ? normalizeCategoryList(JSON.parse(raw))
        : [...DEFAULT_PRODUCT_CATEGORIES];

    const productCats = products.map(p => p.category).filter(Boolean);
    const merged = normalizeCategoryList([...baseList, ...productCats]);

    if (raw === null) {
      saveCategories(merged, { skipIndexedDb: true });
    }
    return merged;
  } catch {
    return normalizeCategoryList([
      ...DEFAULT_PRODUCT_CATEGORIES,
      ...products.map(p => p.category).filter(Boolean),
    ]);
  }
}

export function saveCategories(
  categories: string[],
  options?: { skipIndexedDb?: boolean }
): void {
  try {
    const normalized = normalizeCategoryList(categories);
    localStorage.setItem(
      STORAGE_KEYS.PRODUCT_CATEGORIES,
      JSON.stringify(normalized)
    );
    if (!options?.skipIndexedDb) {
      void mirrorMetaKeyToIndexedDb('categories', normalized);
    }
  } catch (e) {
    console.error('Failed to save categories', e);
  }
}

const INITIAL_WHATSAPP_MESSAGES: WhatsAppInboundMessage[] = [
  {
    id: 'wa_seed_order_1',
    senderName: 'Ramesh Kirana Store',
    senderPhone: '9876543210',
    customerId: 'cust_ramesh',
    messageText: 'Namaste bhaiya, please pack 2 Bundle Gold Flake King and 1 Carton Dettol Soap for morning dispatch.',
    receivedAt: new Date(Date.now() - 25 * 60000).toISOString(),
    formattedTime: formatDateTime(new Date(Date.now() - 25 * 60000)),
    intent: 'order',
    status: 'pending_review',
    parsedItems: [
      {
        id: 'wa_seed_item_1',
        rawText: '2 Bundle Gold Flake King',
        matchedProductId: 'prod_goldflake',
        matchedProductName: 'Gold Flake King',
        unit: 'bundle',
        bundleUnitName: 'Bundle',
        bundlePieces: 50,
        quantity: 2,
        unitPrice: 4263,
        totalPieces: 100,
        lineTotal: 8526,
        availablePieces: 350,
        stockSufficient: true,
        confidence: 0.96,
      },
      {
        id: 'wa_seed_item_2',
        rawText: '1 Carton Dettol Soap',
        matchedProductId: 'prod_dettol',
        matchedProductName: 'Dettol Original Soap 75g',
        unit: 'bundle',
        bundleUnitName: 'Carton',
        bundlePieces: 48,
        quantity: 1,
        unitPrice: 1783.6,
        totalPieces: 48,
        lineTotal: 1783.6,
        availablePieces: 192,
        stockSufficient: true,
        confidence: 0.94,
      },
    ],
    estimatedTotal: 10309.6,
    suggestedReply:
      'Namaste Ramesh Kirana Store, your order with SQ ENTERPRISES is ready for billing:\n• Gold Flake King: 2 Bundle (100 pcs) = ₹8,526.00\n• Dettol Original Soap 75g: 1 Carton (48 pcs) = ₹1,783.60\nEstimated Total: ₹10,309.60.',
    stockUpdated: false,
    source: 'webhook',
  },
  {
    id: 'wa_seed_inquiry_1',
    senderName: 'Gupta General Store',
    senderPhone: '9823456789',
    customerId: 'cust_gupta',
    messageText: 'Tata Tea Gold aur Parle G Carton ka kya rate hai aur stock available hai kya?',
    receivedAt: new Date(Date.now() - 55 * 60000).toISOString(),
    formattedTime: formatDateTime(new Date(Date.now() - 55 * 60000)),
    intent: 'inquiry',
    status: 'pending_review',
    parsedItems: [
      {
        id: 'wa_seed_item_3',
        rawText: 'Tata Tea Gold',
        matchedProductId: 'prod_tata_tea',
        matchedProductName: 'Tata Tea Gold 250g',
        unit: 'bundle',
        bundleUnitName: 'Carton',
        bundlePieces: 20,
        quantity: 1,
        unitPrice: 2800,
        totalPieces: 20,
        lineTotal: 2800,
        availablePieces: 60,
        stockSufficient: true,
        confidence: 0.92,
      },
      {
        id: 'wa_seed_item_4',
        rawText: 'Parle G Carton',
        matchedProductId: 'prod_parle_g',
        matchedProductName: 'Parle-G Gold Pack',
        unit: 'bundle',
        bundleUnitName: 'Carton',
        bundlePieces: 96,
        quantity: 1,
        unitPrice: 860,
        totalPieces: 96,
        lineTotal: 860,
        availablePieces: 288,
        stockSufficient: true,
        confidence: 0.91,
      },
    ],
    estimatedTotal: 3660,
    suggestedReply:
      'Namaste Gupta General Store, live rates & stock at SQ ENTERPRISES:\n• Tata Tea Gold 250g: ₹2,800.00/Carton (20 pcs) — In Stock (3 Cartons)\n• Parle-G Gold Pack: ₹860.00/Carton (96 pcs) — In Stock (3 Cartons)\nReply with quantities to confirm your order!',
    stockUpdated: false,
    source: 'webhook',
  },
];

export function getStoredWhatsAppMessages(): WhatsAppInboundMessage[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WHATSAPP_MESSAGES);
    if (!raw) {
      saveWhatsAppMessages(INITIAL_WHATSAPP_MESSAGES);
      return INITIAL_WHATSAPP_MESSAGES;
    }
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : INITIAL_WHATSAPP_MESSAGES;
  } catch {
    return INITIAL_WHATSAPP_MESSAGES;
  }
}

export function saveWhatsAppMessages(messages: WhatsAppInboundMessage[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.WHATSAPP_MESSAGES,
      JSON.stringify(messages.slice(0, 200))
    );
  } catch (e) {
    console.error('Failed to save WhatsApp messages', e);
  }
}

export const MAIN_HQ_BRANCH_ID = 'branch_hq';

export const DEFAULT_MULTI_BRANCH_SYNC_CONFIG: MultiBranchSyncConfig = {
  enabled: true,
  activeBranchId: MAIN_HQ_BRANCH_ID,
  syncCatalogAcrossBranches: true,
  syncInventoryTransfers: true,
  syncCustomersAndKhata: true,
  autoSyncIntervalSec: 30,
};

export function createDefaultMainBranch(profile?: Partial<StoreProfile>): StoreBranch {
  const nowIso = new Date().toISOString();
  return {
    id: MAIN_HQ_BRANCH_ID,
    code: 'HQ-01',
    name: profile?.storeName?.trim() || DEFAULT_STORE_PROFILE.storeName,
    city: 'Main Depot',
    address: profile?.address?.trim() || DEFAULT_STORE_PROFILE.address,
    phone: profile?.contactNumber?.trim() || DEFAULT_STORE_PROFILE.contactNumber,
    managerName: 'Store Owner',
    isHeadquarters: true,
    active: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

export function getStoredMultiBranchConfig(): MultiBranchSyncConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MULTI_BRANCH_SYNC_CONFIG);
    if (!raw) return DEFAULT_MULTI_BRANCH_SYNC_CONFIG;
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_MULTI_BRANCH_SYNC_CONFIG,
      ...parsed,
      activeBranchId:
        typeof parsed?.activeBranchId === 'string' && parsed.activeBranchId.trim()
          ? parsed.activeBranchId.trim()
          : MAIN_HQ_BRANCH_ID,
    };
  } catch {
    return DEFAULT_MULTI_BRANCH_SYNC_CONFIG;
  }
}

export function saveMultiBranchConfig(config: MultiBranchSyncConfig): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MULTI_BRANCH_SYNC_CONFIG, JSON.stringify(config));
  } catch (e) {
    console.error('Failed to save multi-branch sync config', e);
  }
}

export function getStoredBranches(): StoreBranch[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.MULTI_STORE_BRANCHES);
    if (!raw) {
      const initial = [createDefaultMainBranch(getStoredStoreProfile())];
      saveBranches(initial);
      return initial;
    }
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed;
    }
    const fallback = [createDefaultMainBranch(getStoredStoreProfile())];
    saveBranches(fallback);
    return fallback;
  } catch {
    return [createDefaultMainBranch()];
  }
}

export function saveBranches(branches: StoreBranch[]): void {
  try {
    localStorage.setItem(STORAGE_KEYS.MULTI_STORE_BRANCHES, JSON.stringify(branches));
  } catch (e) {
    console.error('Failed to save branches', e);
  }
}

export function getStoredBranchTransfers(): BranchStockTransfer[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BRANCH_TRANSFERS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveBranchTransfers(transfers: BranchStockTransfer[]): void {
  try {
    localStorage.setItem(
      STORAGE_KEYS.BRANCH_TRANSFERS,
      JSON.stringify(transfers.slice(0, 200))
    );
  } catch (e) {
    console.error('Failed to save branch transfers', e);
  }
}

export function saveBranchVaultSnapshot(
  branchId: string,
  snapshot: BranchWorkspaceSnapshot
): void {
  try {
    localStorage.setItem(
      `${STORAGE_KEYS.BRANCH_VAULT_PREFIX}${branchId}`,
      JSON.stringify(snapshot)
    );
  } catch (e) {
    console.error('Failed to save branch vault snapshot', e);
  }
}

export function loadBranchVaultSnapshot(branchId: string): BranchWorkspaceSnapshot | null {
  try {
    const raw = localStorage.getItem(`${STORAGE_KEYS.BRANCH_VAULT_PREFIX}${branchId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

export function removeBranchVaultSnapshot(branchId: string): void {
  try {
    localStorage.removeItem(`${STORAGE_KEYS.BRANCH_VAULT_PREFIX}${branchId}`);
  } catch {
    // ignore
  }
}

export function captureLiveWorkspaceSnapshot(branchId: string): BranchWorkspaceSnapshot {
  return {
    branchId,
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
    updatedAt: new Date().toISOString(),
  };
}

export function applyWorkspaceSnapshotToLiveStorage(snapshot: BranchWorkspaceSnapshot): void {
  saveProducts(Array.isArray(snapshot.products) ? snapshot.products : []);
  saveCustomers(Array.isArray(snapshot.customers) ? snapshot.customers : []);
  saveBills(Array.isArray(snapshot.bills) ? snapshot.bills : []);
  saveKhata(Array.isArray(snapshot.khata) ? snapshot.khata : []);
  saveSuppliers(Array.isArray(snapshot.suppliers) ? snapshot.suppliers : []);
  savePurchaseOrders(Array.isArray(snapshot.purchaseOrders) ? snapshot.purchaseOrders : []);
  saveCashFlowEntries(Array.isArray(snapshot.cashFlowEntries) ? snapshot.cashFlowEntries : []);
  saveOpeningCashMap(
    snapshot.openingCashMap && typeof snapshot.openingCashMap === 'object'
      ? snapshot.openingCashMap
      : {}
  );
  saveLoyaltyTransactions(
    Array.isArray(snapshot.loyaltyTransactions) ? snapshot.loyaltyTransactions : []
  );
  saveStaffMembers(Array.isArray(snapshot.staffMembers) ? snapshot.staffMembers : []);
  saveAttendanceRecords(
    Array.isArray(snapshot.attendanceRecords) ? snapshot.attendanceRecords : []
  );
  if (snapshot.storeProfile && typeof snapshot.storeProfile === 'object') {
    saveStoreProfile(snapshot.storeProfile);
  }
}

export function computeBranchMetricsFromSnapshot(
  snapshot: Pick<BranchWorkspaceSnapshot, 'products' | 'bills'>
): {
  skuCount: number;
  stockPiecesTotal: number;
  todaySales: number;
  totalSales: number;
  billsCount: number;
} {
  const products = Array.isArray(snapshot.products) ? snapshot.products : [];
  const bills = Array.isArray(snapshot.bills) ? snapshot.bills : [];
  const todayStr = new Date().toISOString().slice(0, 10);

  let stockPiecesTotal = 0;
  for (const p of products) {
    stockPiecesTotal += Number(p.stockPieces) || 0;
  }

  let todaySales = 0;
  let totalSales = 0;
  for (const b of bills) {
    const amt = Number(b.itemsTotal) || 0;
    totalSales += amt;
    if (typeof b.timestamp === 'string' && b.timestamp.slice(0, 10) === todayStr) {
      todaySales += amt;
    }
  }

  return {
    skuCount: products.length,
    stockPiecesTotal,
    todaySales,
    totalSales,
    billsCount: bills.length,
  };
}

export const DEFAULT_APP_LOCK_PIN = '1234';

export const DEFAULT_APP_LOCK_SETTINGS: AppLockSettings = {
  enabled: true,
  masterPin: DEFAULT_APP_LOCK_PIN,
  requireOnLaunch: true,
  autoLockMinutes: 0,
  biometricEnabled: true,
  biometricCredentials: [],
  recovery: createDefaultRecoveryConfig(DEFAULT_STORE_PROFILE.email),
  updatedAt: new Date().toISOString(),
};

export function getStoredAppLockSettings(): AppLockSettings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.APP_LOCK_SETTINGS);
    if (!raw) {
      saveAppLockSettings(DEFAULT_APP_LOCK_SETTINGS);
      return DEFAULT_APP_LOCK_SETTINGS;
    }
    const parsed = JSON.parse(raw);
    const validPin =
      typeof parsed?.masterPin === 'string' && /^\d{4}$/.test(parsed.masterPin)
        ? parsed.masterPin
        : DEFAULT_APP_LOCK_PIN;
    const validAutoLock = [0, 1, 5, 15, 30].includes(Number(parsed?.autoLockMinutes))
      ? (Number(parsed.autoLockMinutes) as AppLockSettings['autoLockMinutes'])
      : 0;
    const defaultRecovery = createDefaultRecoveryConfig(getStoredStoreProfile().email);
    const parsedRecovery = parsed?.recovery;
    const normalizedRecovery = {
      ...defaultRecovery,
      ...(parsedRecovery && typeof parsedRecovery === 'object' ? parsedRecovery : {}),
      recoveryEmail:
        typeof parsedRecovery?.recoveryEmail === 'string'
          ? parsedRecovery.recoveryEmail.trim()
          : defaultRecovery.recoveryEmail,
      emailRecoveryEnabled:
        typeof parsedRecovery?.emailRecoveryEnabled === 'boolean'
          ? parsedRecovery.emailRecoveryEnabled
          : defaultRecovery.emailRecoveryEnabled,
      securityQuestionsEnabled:
        typeof parsedRecovery?.securityQuestionsEnabled === 'boolean'
          ? parsedRecovery.securityQuestionsEnabled
          : defaultRecovery.securityQuestionsEnabled,
      requireBothMethods: Boolean(parsedRecovery?.requireBothMethods),
      securityQuestions:
        Array.isArray(parsedRecovery?.securityQuestions) &&
        parsedRecovery.securityQuestions.length > 0
          ? parsedRecovery.securityQuestions
          : defaultRecovery.securityQuestions,
    };

    return {
      ...DEFAULT_APP_LOCK_SETTINGS,
      ...parsed,
      masterPin: validPin,
      autoLockMinutes: validAutoLock,
      biometricCredentials: Array.isArray(parsed?.biometricCredentials)
        ? parsed.biometricCredentials
        : [],
      recovery: normalizedRecovery,
    };
  } catch {
    return DEFAULT_APP_LOCK_SETTINGS;
  }
}

export function saveAppLockSettings(settings: AppLockSettings): void {
  try {
    localStorage.setItem(STORAGE_KEYS.APP_LOCK_SETTINGS, JSON.stringify(settings));
  } catch (e) {
    console.error('Failed to save App Lock settings', e);
  }
}
