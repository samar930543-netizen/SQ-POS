/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect, useRef } from 'react';
import {
  Product,
  Customer,
  Bill,
  CartItem,
  UnitType,
  KhataTransaction,
  ReceiptSettings,
  OcrScanMode,
  AudioListMode,
  Supplier,
  PurchaseOrder,
  PurchaseOrderStatus,
  CashFlowEntry,
  CashFlowPaymentMode,
  PricingTierId,
  CustomerCustomProductRate,
  LoyaltyMilestone,
  LoyaltyTransaction,
  StaffMember,
  AttendanceRecord,
  StoreProfile,
  StoreModuleVisibility,
  PosUiVisibility,
  HeaderIconVisibility,
  SystemNotification,
  SystemNotificationCategory,
  SystemNotificationSeverity,
  RolePermissionMatrix,
  StaffPermission,
  StaffRole,
  StaffActivityDomain,
  StaffActivityLog,
  WhatsAppAutomationConfig,
  WhatsAppInboundMessage,
  WhatsAppParsedItem,
  ExternalApiConfig,
  PerformanceSettings,
  StoreBranch,
  MultiBranchSyncConfig,
  BranchStockTransfer,
  AppLockSettings,
} from './types';
import {
  getStoredProducts,
  saveProducts,
  getStoredCustomers,
  saveCustomers,
  getStoredBills,
  saveBills,
  getStoredKhata,
  deductProductStock,
  recordCustomerPayment,
  getStoredReceiptSettings,
  saveReceiptSettings,
  getStoredSuppliers,
  saveSuppliers,
  getStoredPurchaseOrders,
  savePurchaseOrders,
  getStoredCashFlowEntries,
  saveCashFlowEntries,
  getStoredOpeningCashMap,
  saveOpeningCashMap,
  getStoredLoyaltyTransactions,
  saveLoyaltyTransactions,
  getStoredStaffMembers,
  saveStaffMembers,
  getStoredAttendanceRecords,
  saveAttendanceRecords,
  getStoredRolePermissions,
  saveRolePermissions,
  getStoredActiveStaffId,
  saveActiveStaffId,
  getStoredStaffActivityLogs,
  saveStaffActivityLogs,
  getStoredStoreProfile,
  saveStoreProfile,
  DEFAULT_ENABLED_MODULES,
  DEFAULT_POS_UI_VISIBILITY,
  DEFAULT_HEADER_ICON_VISIBILITY,
  DEFAULT_WHATSAPP_CONFIG,
  DEFAULT_EXTERNAL_API_CONFIG,
  DEFAULT_PERFORMANCE_SETTINGS,
  getStoredFavoriteProductIds,
  saveFavoriteProductIds,
  getStoredCategories,
  saveCategories,
  getStoredWhatsAppMessages,
  saveWhatsAppMessages,
  getStoredBranches,
  getStoredMultiBranchConfig,
  getStoredBranchTransfers,
  getStoredAppLockSettings,
  saveAppLockSettings,
  resolvePrinterConnectionsConfig,
  hydrateInventoryFromPersistentStorage,
} from './utils/storage';
import { isThermalPaperLow } from './utils/printerManager';
import {
  fetchMultiStoreStateFromServer,
  refreshLocalBranchSummaries,
  removeStoreBranch,
  saveStoreBranchProfile,
  switchActiveStoreBranch,
  syncAllBranchesNow,
  transferStockBetweenBranches,
  updateMultiBranchSyncConfig,
} from './utils/multiStore';
import {
  DEFAULT_ROLE_PERMISSIONS,
  canStaffPerform,
  getEffectiveStaffPermissions,
} from './utils/staffRbac';
import { getDeliveryScheduleInfo } from './utils/supplierHelpers';
import { generateSampleSalesHistory } from './utils/salesAnalytics';
import {
  applyCustomerProductRateOverride,
  getCustomerPricingLabel,
  getEffectiveUnitPrice,
  mergeCartOverridesIntoCustomer,
} from './utils/customerPricing';
import { calculatePointsEarnedForBill } from './utils/loyaltyProgram';
import { evaluateCustomerCreditLimit } from './utils/customerCredit';
import { formatCurrency, formatDateTime } from './utils/formatters';
import { soundManager } from './utils/soundEffects';
import {
  appendStoredNotificationLog,
  getStoredAcknowledgedAlertIds,
  getStoredNotificationLogs,
  saveAcknowledgedAlertIds,
  saveNotificationLogs,
} from './utils/notifications';
import { isUnitConfigured } from './utils/unitSpecs';
import { Header, AppTab } from './components/Header';
import { ProductGrid } from './components/ProductGrid';
import { CartDrawer } from './components/CartDrawer';
import { FloatingCartBar } from './components/FloatingCartBar';
import { CustomerKhata, CustomerCreditProfileUpdates } from './components/CustomerKhata';
import { InventoryManager } from './components/InventoryManager';
import { CategoryMutationResult } from './components/CategoryManagementPanel';
import { DailyReports } from './components/DailyReports';
import { SupplierManager } from './components/SupplierManager';
import { CashFlowManager } from './components/CashFlowManager';
import { StaffAndLoyaltyManager } from './components/StaffAndLoyaltyManager';
import { StoreProfileSettings } from './components/StoreProfileSettings';
import { WhatsAppAutomationPanel } from './components/WhatsAppAutomationPanel';
import {
  buildAutoReplyForMessage,
  buildBillFromWhatsAppMessage,
  buildWhatsAppWebUrl,
  evaluateWhatsAppItemsAgainstInventory,
  findCustomerByPhone,
  parseWhatsAppMessageLocally,
} from './utils/whatsappAutomation';
import { useOfflineSync } from './hooks/useOfflineSync';
import { OfflineSyncModal } from './components/OfflineSyncModal';
import { ReceiptModal } from './components/ReceiptModal';
import { ApkGuideModal } from './components/ApkGuideModal';
import { ProductModal } from './components/ProductModal';
import { ReceiptSettingsModal } from './components/ReceiptSettingsModal';
import { ScanBillModal } from './components/ScanBillModal';
import { AudioTranscribeModal } from './components/AudioTranscribeModal';
import { LiveVoiceModal } from './components/LiveVoiceModal';
import { NotificationCenterModal } from './components/NotificationCenterModal';
import { OperatorSwitchModal } from './components/OperatorSwitchModal';
import { MultiStoreModal } from './components/MultiStoreModal';
import { AppLockScreen } from './components/AppLockScreen';
import { LayoutProvider, useViewportLayout } from './hooks/useViewportLayout';
import { Lock } from 'lucide-react';

function PosAppContent() {
  const { layoutPref, resolvedLayout } = useViewportLayout();
  const [products, setProducts] = useState<Product[]>(() => getStoredProducts());
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [bills, setBills] = useState<Bill[]>([]);
  const [khata, setKhata] = useState<KhataTransaction[]>([]);
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [purchaseOrders, setPurchaseOrders] = useState<PurchaseOrder[]>([]);
  const [cashFlowEntries, setCashFlowEntries] = useState<CashFlowEntry[]>([]);
  const [openingCashMap, setOpeningCashMap] = useState<Record<string, number>>({});
  const [loyaltyTransactions, setLoyaltyTransactions] = useState<LoyaltyTransaction[]>([]);
  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [rolePermissions, setRolePermissions] = useState<RolePermissionMatrix>(() =>
    getStoredRolePermissions()
  );
  const [activeStaffId, setActiveStaffId] = useState<string>(() => getStoredActiveStaffId());
  const [staffActivityLogs, setStaffActivityLogs] = useState<StaffActivityLog[]>(() =>
    getStoredStaffActivityLogs()
  );
  const [isOperatorSwitcherOpen, setIsOperatorSwitcherOpen] = useState(false);
  const [poPrefillProductId, setPoPrefillProductId] = useState<string | null>(null);
  const [focusLoyaltyCustomerId, setFocusLoyaltyCustomerId] = useState<string | null>(null);
  const [focusKhataCustomerId, setFocusKhataCustomerId] = useState<string | null>(null);

  // Cart & active billing customer state (drives live Customer-Specific Pricing)
  const [cart, setCart] = useState<CartItem[]>([]);
  const [activeBillingCustomerId, setActiveBillingCustomerId] = useState<string>('');

  const [storeProfile, setStoreProfile] = useState<StoreProfile>(() => getStoredStoreProfile());
  const [branches, setBranches] = useState<StoreBranch[]>(() => getStoredBranches());
  const [multiBranchConfig, setMultiBranchConfig] = useState<MultiBranchSyncConfig>(() =>
    getStoredMultiBranchConfig()
  );
  const [branchTransfers, setBranchTransfers] = useState<BranchStockTransfer[]>(() =>
    getStoredBranchTransfers()
  );
  const [isMultiStoreOpen, setIsMultiStoreOpen] = useState(false);
  const [isSyncingBranches, setIsSyncingBranches] = useState(false);
  const [appLockSettings, setAppLockSettings] = useState<AppLockSettings>(() =>
    getStoredAppLockSettings()
  );
  const [isAppLocked, setIsAppLocked] = useState<boolean>(() => {
    const initialCfg = getStoredAppLockSettings();
    return Boolean(initialCfg.enabled && initialCfg.requireOnLaunch);
  });
  const [whatsappMessages, setWhatsappMessages] = useState<WhatsAppInboundMessage[]>(() =>
    getStoredWhatsAppMessages()
  );
  const [hasServerWhatsappToken, setHasServerWhatsappToken] = useState(false);
  const [isSyncingWhatsappServer, setIsSyncingWhatsappServer] = useState(false);

  const getFirstEnabledTab = (modules?: StoreModuleVisibility): AppTab => {
    const order: Array<Exclude<AppTab, 'store_profile'>> = [
      'billing',
      'khata',
      'inventory',
      'suppliers',
      'cashflow',
      'reports',
      'staff_loyalty',
      'whatsapp',
    ];
    if (!modules) return 'billing';
    return order.find(tab => modules[tab] !== false) || 'store_profile';
  };

  // Active view tab (starts on first enabled module)
  const [activeTab, setActiveTab] = useState<AppTab>(() =>
    getFirstEnabledTab(getStoredStoreProfile().enabledModules)
  );

  // Modals & Drawers
  const [isCartOpen, setIsCartOpen] = useState(false);
  const [isApkGuideOpen, setIsApkGuideOpen] = useState(false);
  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [isReceiptSettingsOpen, setIsReceiptSettingsOpen] = useState(false);
  const [isScanBillOpen, setIsScanBillOpen] = useState(false);
  const [isAudioTranscribeOpen, setIsAudioTranscribeOpen] = useState(false);
  const [isLiveVoiceOpen, setIsLiveVoiceOpen] = useState(false);
  const [audioTranscribeInitialMode, setAudioTranscribeInitialMode] =
    useState<AudioListMode>('cart');
  const [isOfflineSyncOpen, setIsOfflineSyncOpen] = useState(false);
  const [isNotificationCenterOpen, setIsNotificationCenterOpen] = useState(false);
  const [notificationLogs, setNotificationLogs] = useState<SystemNotification[]>(() =>
    getStoredNotificationLogs()
  );
  const [acknowledgedAlertIds, setAcknowledgedAlertIds] = useState<string[]>(() =>
    getStoredAcknowledgedAlertIds()
  );
  const [scanBillInitialMode, setScanBillInitialMode] = useState<OcrScanMode>('invoice');
  const [receiptSettings, setReceiptSettings] = useState<ReceiptSettings>(() =>
    getStoredReceiptSettings()
  );
  const [favoriteProductIds, setFavoriteProductIds] = useState<string[]>(() =>
    getStoredFavoriteProductIds(products)
  );
  const [categories, setCategories] = useState<string[]>(() => getStoredCategories(products));
  const [productToEdit, setProductToEdit] = useState<Product | null>(null);
  const [prefillProductBarcode, setPrefillProductBarcode] = useState<string>('');
  const [prefillProductDraft, setPrefillProductDraft] = useState<{
    name?: string;
    unitType?: UnitType;
    unitPrice?: number;
  } | null>(null);
  const [activeReceiptBill, setActiveReceiptBill] = useState<Bill | null>(null);

  // Load persisted store data (supports full reloads after backup restore or server sync)
  const loadData = (options?: { skipProducts?: boolean }) => {
    if (!options?.skipProducts) {
      const loadedProducts = getStoredProducts();
      setProducts(loadedProducts);
      setFavoriteProductIds(getStoredFavoriteProductIds(loadedProducts));
      setCategories(getStoredCategories(loadedProducts));
    }
    const loadedStaff = getStoredStaffMembers();
    setCustomers(getStoredCustomers());
    setBills(getStoredBills());
    setKhata(getStoredKhata());
    setSuppliers(getStoredSuppliers());
    setPurchaseOrders(getStoredPurchaseOrders());
    setCashFlowEntries(getStoredCashFlowEntries());
    setOpeningCashMap(getStoredOpeningCashMap());
    setLoyaltyTransactions(getStoredLoyaltyTransactions());
    setStaffMembers(loadedStaff);
    setAttendanceRecords(getStoredAttendanceRecords());
    setRolePermissions(getStoredRolePermissions());
    setActiveStaffId(getStoredActiveStaffId(loadedStaff));
    setStaffActivityLogs(getStoredStaffActivityLogs());
    setReceiptSettings(getStoredReceiptSettings());
    setStoreProfile(getStoredStoreProfile());
    setWhatsappMessages(getStoredWhatsAppMessages());
  };

  const skipInitialProductsPersistRef = useRef(true);
  const skipInitialFavsPersistRef = useRef(true);
  const skipInitialCatsPersistRef = useRef(true);
  const suppressNextProductsEffectRef = useRef(false);
  const suppressNextFavsEffectRef = useRef(false);
  const suppressNextCatsEffectRef = useRef(false);

  useEffect(() => {
    let active = true;
    loadData({ skipProducts: true });

    void hydrateInventoryFromPersistentStorage().then(res => {
      if (!active) return;
      if (res.restoredFromIndexedDb) {
        suppressNextProductsEffectRef.current = true;
        suppressNextCatsEffectRef.current = true;
        suppressNextFavsEffectRef.current = true;
        setProducts(res.products);
        setCategories(res.categories);
        setFavoriteProductIds(res.favoriteProductIds);
        if (res.suppliers) setSuppliers(res.suppliers);
        if (res.purchaseOrders) setPurchaseOrders(res.purchaseOrders);
      }
    });

    const handleCrossTabStorage = (e: StorageEvent) => {
      if (e.key === 'sq_pos_products_v2' && e.newValue) {
        suppressNextProductsEffectRef.current = true;
        setProducts(getStoredProducts());
      } else if (e.key === 'sq_pos_favorite_ids_v1' && e.newValue) {
        suppressNextFavsEffectRef.current = true;
        setFavoriteProductIds(getStoredFavoriteProductIds(getStoredProducts()));
      } else if (e.key === 'sq_pos_categories_v1' && e.newValue) {
        suppressNextCatsEffectRef.current = true;
        setCategories(getStoredCategories(getStoredProducts()));
      }
    };
    window.addEventListener('storage', handleCrossTabStorage);

    return () => {
      active = false;
      window.removeEventListener('storage', handleCrossTabStorage);
    };
  }, []);

  // Save products and stock level changes back to localStorage + IndexedDB whenever state updates
  useEffect(() => {
    if (skipInitialProductsPersistRef.current) {
      skipInitialProductsPersistRef.current = false;
      return;
    }
    if (suppressNextProductsEffectRef.current) {
      suppressNextProductsEffectRef.current = false;
      return;
    }
    saveProducts(products);
  }, [products]);

  useEffect(() => {
    if (skipInitialFavsPersistRef.current) {
      skipInitialFavsPersistRef.current = false;
      return;
    }
    if (suppressNextFavsEffectRef.current) {
      suppressNextFavsEffectRef.current = false;
      return;
    }
    saveFavoriteProductIds(favoriteProductIds);
  }, [favoriteProductIds]);

  useEffect(() => {
    if (skipInitialCatsPersistRef.current) {
      skipInitialCatsPersistRef.current = false;
      return;
    }
    if (suppressNextCatsEffectRef.current) {
      suppressNextCatsEffectRef.current = false;
      return;
    }
    saveCategories(categories);
  }, [categories]);

  const activeStaff =
    staffMembers.find(s => s.id === activeStaffId && s.active) ||
    staffMembers.find(s => s.role === 'Store Owner / Admin' && s.active) ||
    staffMembers.find(s => s.active) ||
    staffMembers[0] ||
    null;

  const activeStaffPerms = getEffectiveStaffPermissions(activeStaff, rolePermissions);
  const rbacAllowedTabs: Record<AppTab, boolean> = {
    billing: activeStaffPerms.billing,
    khata: activeStaffPerms.khata,
    inventory: activeStaffPerms.inventory,
    suppliers: activeStaffPerms.suppliers,
    cashflow: activeStaffPerms.cashflow,
    reports: activeStaffPerms.reports,
    staff_loyalty: activeStaffPerms.staff_loyalty,
    whatsapp: activeStaffPerms.whatsapp,
    store_profile: activeStaffPerms.store_profile,
  };

  const getFirstPermittedTab = (): AppTab => {
    const order: AppTab[] = [
      'billing',
      'khata',
      'inventory',
      'suppliers',
      'cashflow',
      'reports',
      'staff_loyalty',
      'whatsapp',
      'store_profile',
    ];
    const modules = storeProfile.enabledModules;
    return (
      order.find(tab => {
        const modOk = tab === 'store_profile' || !modules || modules[tab] !== false;
        return modOk && rbacAllowedTabs[tab];
      }) || 'billing'
    );
  };

  // Ensure activeTab switches cleanly if its module was hidden in Store Settings or restricted by RBAC
  useEffect(() => {
    const modules = storeProfile.enabledModules;
    const isHiddenByStore = activeTab !== 'store_profile' && modules && modules[activeTab] === false;
    const isDeniedByRbac = staffMembers.length > 0 && !rbacAllowedTabs[activeTab];
    if (isHiddenByStore || isDeniedByRbac) {
      const next = getFirstPermittedTab();
      if (next !== activeTab) {
        setActiveTab(next);
      }
    }
  }, [storeProfile.enabledModules, activeStaffId, rolePermissions, staffMembers.length]);

  const recordStaffActivity = React.useCallback(
    (params: {
      domain: StaffActivityDomain;
      action: string;
      targetLabel: string;
      details: string;
      amount?: number;
      quantityDelta?: number;
      billId?: string;
      productId?: string;
      staffOverride?: { staffId: string; staffName: string; staffRole: StaffRole };
    }) => {
      const actor = params.staffOverride || {
        staffId: activeStaff?.id || 'staff_owner',
        staffName: activeStaff?.name || 'Store Owner',
        staffRole: activeStaff?.role || 'Store Owner / Admin',
      };
      const entry: StaffActivityLog = {
        id: `act_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        timestamp: new Date().toISOString(),
        domain: params.domain,
        action: params.action,
        staffId: actor.staffId,
        staffName: actor.staffName,
        staffRole: actor.staffRole,
        targetLabel: params.targetLabel,
        details: params.details,
        amount: params.amount,
        quantityDelta: params.quantityDelta,
        billId: params.billId,
        productId: params.productId,
      };
      setStaffActivityLogs(prev => {
        const next = [entry, ...prev].slice(0, 400);
        saveStaffActivityLogs(next);
        return next;
      });
    },
    [activeStaff]
  );

  const appendSystemNotification = React.useCallback(
    (params: {
      category: SystemNotificationCategory;
      severity: SystemNotificationSeverity;
      title: string;
      message: string;
      meta?: SystemNotification['meta'];
    }) => {
      setNotificationLogs(prev => appendStoredNotificationLog(prev, params));
    },
    []
  );

  const effectivePerformanceSettings: PerformanceSettings = {
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...(storeProfile.performanceSettings || {}),
  };

  const offlineSync = useOfflineSync({
    bills,
    onBillsUpdated: setBills,
    onFullDataReload: loadData,
    enableAutoCloudSync: effectivePerformanceSettings.enableAutoCloudSync,
    onNotificationEvent: event =>
      appendSystemNotification({
        category: 'sync',
        severity: event.severity,
        title: event.title,
        message: event.message,
      }),
  });

  const activeBillingCustomer =
    customers.find(c => c.id === activeBillingCustomerId) || null;

  // Automatically reprice non-overridden cart items whenever active billing customer or pricing tier changes
  useEffect(() => {
    setCart(prev => {
      if (prev.length === 0) return prev;
      let changed = false;
      const next = prev.map(item => {
        const product = products.find(p => p.id === item.productId);
        if (!product) return item;
        const eff = getEffectiveUnitPrice(product, item.unit, activeBillingCustomer);

        if (item.isPriceOverridden) {
          if (item.defaultUnitPrice === eff.tierDefaultPrice) {
            return item;
          }
          changed = true;
          return {
            ...item,
            defaultUnitPrice: eff.tierDefaultPrice,
          };
        }

        const nextTotal = Math.round(eff.unitPrice * item.quantity * 100) / 100;
        if (
          eff.unitPrice === item.unitPrice &&
          nextTotal === item.itemTotal &&
          item.defaultUnitPrice === eff.tierDefaultPrice
        ) {
          return item;
        }
        changed = true;
        return {
          ...item,
          unitPrice: eff.unitPrice,
          defaultUnitPrice: eff.tierDefaultPrice,
          itemTotal: nextTotal,
        };
      });
      return changed ? next : prev;
    });
  }, [activeBillingCustomerId, customers, products]);

  // Cart Calculations
  const cartCount = cart.reduce((sum, item) => sum + item.quantity, 0);
  const cartTotal = cart.reduce((sum, item) => sum + item.itemTotal, 0);
  const lowStockProductsList = products.filter(p => p.stockPieces <= p.lowStockThreshold);
  const lowStockCount = lowStockProductsList.length;
  const duePurchaseOrders = purchaseOrders.filter(po => {
    if (po.status !== 'ordered' && po.status !== 'in_transit' && po.status !== 'partial') {
      return false;
    }
    const sched = getDeliveryScheduleInfo(po);
    return sched.urgency === 'overdue' || sched.urgency === 'due_today';
  });
  const pendingPoAlertCount = duePurchaseOrders.length;

  const showLowStockAlerts = storeProfile.posUiVisibility?.lowStockAlertBanner !== false;
  const creditLimitAlertCustomers = customers.filter(c => {
    const status = evaluateCustomerCreditLimit(c).status;
    return status === 'nearing' || status === 'exceeded';
  });

  const isLowThermalPaper = isThermalPaperLow(receiptSettings.printers);
  const ackSet = new Set(acknowledgedAlertIds);
  const unreadLowStockAlertsCount = showLowStockAlerts
    ? lowStockProductsList.filter(p => !ackSet.has(`low_stock_${p.id}`)).length
    : 0;
  const unreadCreditAlertsCount = creditLimitAlertCustomers.filter(
    c => !ackSet.has(`credit_${c.id}`)
  ).length;
  const unreadPoAlertsCount = duePurchaseOrders.filter(po => !ackSet.has(`po_${po.id}`)).length;
  const hasUnreadSyncWarning =
    (offlineSync.isEffectivelyOffline && !ackSet.has('sync_offline')) ||
    (offlineSync.failedCount > 0 && !ackSet.has('sync_failed'));
  const hasUnreadLowPaperWarning = isLowThermalPaper && !ackSet.has('low_paper');
  const unreadLogsCount = notificationLogs.filter(entry => !entry.read).length;
  const unreadAlertCount =
    unreadLowStockAlertsCount +
    unreadCreditAlertsCount +
    unreadPoAlertsCount +
    (hasUnreadSyncWarning ? 1 : 0) +
    (hasUnreadLowPaperWarning ? 1 : 0) +
    unreadLogsCount;

  const handleMarkAllNotificationsRead = () => {
    const nextLogs = notificationLogs.map(entry => (entry.read ? entry : { ...entry, read: true }));
    setNotificationLogs(nextLogs);
    saveNotificationLogs(nextLogs);

    const activeIds = [
      ...lowStockProductsList.map(p => `low_stock_${p.id}`),
      ...creditLimitAlertCustomers.map(c => `credit_${c.id}`),
      ...duePurchaseOrders.map(po => `po_${po.id}`),
      ...(offlineSync.isEffectivelyOffline ? ['sync_offline'] : []),
      ...(offlineSync.failedCount > 0 ? ['sync_failed'] : []),
      ...(isLowThermalPaper ? ['low_paper'] : []),
    ];
    const nextAck = Array.from(new Set([...acknowledgedAlertIds, ...activeIds]));
    setAcknowledgedAlertIds(nextAck);
    saveAcknowledgedAlertIds(nextAck);
  };

  const handleUpdateReceiptSettings = (newSettings: ReceiptSettings) => {
    const wasLow = isThermalPaperLow(receiptSettings.printers);
    const nowLow = isThermalPaperLow(newSettings.printers);
    saveReceiptSettings(newSettings);
    setReceiptSettings(newSettings);
    if (!wasLow && nowLow) {
      const nextAck = acknowledgedAlertIds.filter(id => id !== 'low_paper');
      setAcknowledgedAlertIds(nextAck);
      saveAcknowledgedAlertIds(nextAck);
      const pct = Math.round(newSettings.printers?.paperRoll?.estimatedRemainingPct ?? 0);
      appendSystemNotification({
        category: 'system',
        severity: 'warning',
        title: 'Thermal Paper Roll Low',
        message: `Estimated thermal receipt paper is down to ${pct}%. Load a new roll in Printer Settings soon.`,
      });
    }
  };

  const handleResetThermalPaperRoll = () => {
    const resolvedPrinters = resolvePrinterConnectionsConfig(receiptSettings.printers);
    const updated: ReceiptSettings = {
      ...receiptSettings,
      printers: {
        ...resolvedPrinters,
        paperRoll: {
          ...resolvedPrinters.paperRoll!,
          estimatedRemainingPct: 100,
          usedMetersSinceReset: 0,
          billsPrintedSinceReset: 0,
          lastResetAt: new Date().toISOString(),
        },
      },
    };
    saveReceiptSettings(updated);
    setReceiptSettings(updated);
    appendSystemNotification({
      category: 'system',
      severity: 'success',
      title: 'Thermal Paper Roll Reset',
      message: 'New thermal paper roll loaded (100% remaining).',
    });
  };

  const handleClearNotificationLogs = () => {
    setNotificationLogs([]);
    saveNotificationLogs([]);
  };

  const handleDismissNotificationLog = (id: string) => {
    const nextLogs = notificationLogs.filter(entry => entry.id !== id);
    setNotificationLogs(nextLogs);
    saveNotificationLogs(nextLogs);
  };

  // Save or clear a custom SKU+unit price override directly onto a customer's profile
  const persistCustomerRateOverride = (
    customerId: string,
    product: Product,
    unit: UnitType,
    newPrice: number | null
  ) => {
    const currentCustomers = getStoredCustomers();
    let changedCustomer: Customer | null = null;
    const updatedCustomers = currentCustomers.map(c => {
      if (c.id !== customerId) return c;
      const next = applyCustomerProductRateOverride(c, product, unit, newPrice);
      if (next !== c) {
        changedCustomer = next;
      }
      return next;
    });

    if (changedCustomer) {
      saveCustomers(updatedCustomers);
      setCustomers(updatedCustomers);
    }
  };

  // Add to cart with unit (Bundle vs Piece) applying Customer-Specific Pricing or optional price override
  const handleAddToCart = (
    product: Product,
    unit: UnitType,
    quantity: number = 1,
    overrideUnitPrice?: number
  ) => {
    if (!isUnitConfigured(product, unit)) return;
    soundManager.vibrateItemAdded();
    const eff = getEffectiveUnitPrice(product, unit, activeBillingCustomer);
    const defaultUnitPrice = eff.tierDefaultPrice;
    const hasExplicitOverride =
      typeof overrideUnitPrice === 'number' &&
      Number.isFinite(overrideUnitPrice) &&
      overrideUnitPrice >= 0;
    const sanitizedOverride = hasExplicitOverride
      ? Math.round(overrideUnitPrice * 100) / 100
      : undefined;

    if (sanitizedOverride !== undefined && activeBillingCustomer) {
      persistCustomerRateOverride(activeBillingCustomer.id, product, unit, sanitizedOverride);
    }

    const totalPiecesPerUnit = unit === 'bundle' ? product.bundlePieces : 1;

    setCart(prev => {
      const existingIdx = prev.findIndex(
        item => item.productId === product.id && item.unit === unit
      );

      if (existingIdx > -1) {
        const existing = prev[existingIdx];
        const newQty = existing.quantity + quantity;
        const unitPrice =
          sanitizedOverride !== undefined
            ? sanitizedOverride
            : existing.isPriceOverridden
            ? existing.unitPrice
            : eff.unitPrice;
        const isPriceOverridden =
          sanitizedOverride !== undefined
            ? !activeBillingCustomer && Math.abs(sanitizedOverride - defaultUnitPrice) > 0.001
            : Boolean(existing.isPriceOverridden);

        const updated = [...prev];
        updated[existingIdx] = {
          ...existing,
          unitPrice,
          defaultUnitPrice,
          isPriceOverridden,
          quantity: newQty,
          totalPieces: newQty * totalPiecesPerUnit,
          itemTotal: Math.round(newQty * unitPrice * 100) / 100,
        };
        return updated;
      } else {
        const unitPrice = sanitizedOverride !== undefined ? sanitizedOverride : eff.unitPrice;
        const isPriceOverridden =
          sanitizedOverride !== undefined &&
          !activeBillingCustomer &&
          Math.abs(sanitizedOverride - defaultUnitPrice) > 0.001;
        const newItem: CartItem = {
          productId: product.id,
          productName: product.name,
          unit,
          bundleUnitName: product.bundleUnitName,
          bundlePieces: product.bundlePieces,
          quantity,
          unitPrice,
          defaultUnitPrice,
          isPriceOverridden,
          totalPieces: quantity * totalPiecesPerUnit,
          itemTotal: Math.round(quantity * unitPrice * 100) / 100,
        };
        return [...prev, newItem];
      }
    });
  };

  // Update item quantity (inserts item if not yet in cart and newQty > 0; saves override to customer profile when active)
  const handleUpdateQuantity = (
    productId: string,
    unit: UnitType,
    newQty: number,
    overrideUnitPrice?: number
  ) => {
    if (newQty <= 0) {
      handleRemoveCartItem(productId, unit);
      return;
    }

    const existingCartItem = cart.find(
      item => item.productId === productId && item.unit === unit
    );
    if (!existingCartItem || newQty > existingCartItem.quantity) {
      soundManager.vibrateItemAdded();
    }

    const hasExplicitOverride =
      typeof overrideUnitPrice === 'number' &&
      Number.isFinite(overrideUnitPrice) &&
      overrideUnitPrice >= 0;
    const sanitizedOverride = hasExplicitOverride
      ? Math.round(overrideUnitPrice * 100) / 100
      : undefined;

    const targetProduct = products.find(p => p.id === productId);
    if (sanitizedOverride !== undefined && activeBillingCustomer && targetProduct) {
      persistCustomerRateOverride(activeBillingCustomer.id, targetProduct, unit, sanitizedOverride);
    }

    setCart(prev => {
      const product = targetProduct;
      const eff = product
        ? getEffectiveUnitPrice(product, unit, activeBillingCustomer)
        : undefined;
      const defaultUnitPrice = eff?.tierDefaultPrice;
      const exists = prev.some(item => item.productId === productId && item.unit === unit);

      if (exists) {
        return prev.map(item => {
          if (item.productId === productId && item.unit === unit) {
            const totalPiecesPerUnit = item.unit === 'bundle' ? item.bundlePieces : 1;
            const resolvedDefault = defaultUnitPrice ?? item.defaultUnitPrice ?? item.unitPrice;
            const nextUnitPrice = sanitizedOverride !== undefined ? sanitizedOverride : item.unitPrice;
            const nextOverridden =
              sanitizedOverride !== undefined
                ? !activeBillingCustomer && Math.abs(sanitizedOverride - resolvedDefault) > 0.001
                : Boolean(item.isPriceOverridden);

            return {
              ...item,
              unitPrice: nextUnitPrice,
              defaultUnitPrice: resolvedDefault,
              isPriceOverridden: nextOverridden,
              quantity: newQty,
              totalPieces: newQty * totalPiecesPerUnit,
              itemTotal: Math.round(newQty * nextUnitPrice * 100) / 100,
            };
          }
          return item;
        });
      }

      if (!product || !isUnitConfigured(product, unit)) return prev;
      const fallbackDefault = defaultUnitPrice ?? 0;
      const unitPrice = sanitizedOverride !== undefined ? sanitizedOverride : (eff?.unitPrice ?? fallbackDefault);
      const isPriceOverridden =
        sanitizedOverride !== undefined &&
        !activeBillingCustomer &&
        Math.abs(sanitizedOverride - fallbackDefault) > 0.001;
      const totalPiecesPerUnit = unit === 'bundle' ? product.bundlePieces : 1;
      const newItem: CartItem = {
        productId: product.id,
        productName: product.name,
        unit,
        bundleUnitName: product.bundleUnitName,
        bundlePieces: product.bundlePieces,
        quantity: newQty,
        unitPrice,
        defaultUnitPrice: fallbackDefault,
        isPriceOverridden,
        totalPieces: newQty * totalPiecesPerUnit,
        itemTotal: Math.round(newQty * unitPrice * 100) / 100,
      };
      return [...prev, newItem];
    });
  };

  // Override or reset unit sell price; saves directly to customer profile when a customer is active
  const handleUpdateItemPrice = (productId: string, unit: UnitType, newPrice: number | null) => {
    const product = products.find(p => p.id === productId);
    const eff = product
      ? getEffectiveUnitPrice(product, unit, activeBillingCustomer)
      : undefined;

    if (activeBillingCustomer && product) {
      persistCustomerRateOverride(activeBillingCustomer.id, product, unit, newPrice);
    }

    setCart(prev =>
      prev.map(item => {
        if (item.productId !== productId || item.unit !== unit) return item;
        const defaultPrice = eff
          ? eff.tierDefaultPrice
          : item.defaultUnitPrice ?? item.unitPrice;

        if (newPrice === null || !Number.isFinite(newPrice)) {
          return {
            ...item,
            unitPrice: defaultPrice,
            defaultUnitPrice: defaultPrice,
            isPriceOverridden: false,
            itemTotal: Math.round(item.quantity * defaultPrice * 100) / 100,
          };
        }

        const safePrice = Math.max(0, Math.round(newPrice * 100) / 100);
        return {
          ...item,
          unitPrice: safePrice,
          defaultUnitPrice: defaultPrice,
          isPriceOverridden:
            !activeBillingCustomer && Math.abs(safePrice - defaultPrice) > 0.001,
          itemTotal: Math.round(item.quantity * safePrice * 100) / 100,
        };
      })
    );
  };

  // Toggle unit inside cart (Bundle <-> Piece)
  const handleToggleUnit = (productId: string, currentUnit: UnitType) => {
    const product = products.find(p => p.id === productId);
    if (!product) return;

    const newUnit: UnitType = currentUnit === 'bundle' ? 'piece' : 'bundle';
    if (!isUnitConfigured(product, newUnit)) return;
    const eff = getEffectiveUnitPrice(product, newUnit, activeBillingCustomer);
    const newUnitPrice = eff.unitPrice;
    const newTotalPiecesPerUnit = newUnit === 'bundle' ? product.bundlePieces : 1;

    setCart(prev => {
      const otherUnitItemIdx = prev.findIndex(
        i => i.productId === productId && i.unit === newUnit
      );
      const currentItem = prev.find(
        i => i.productId === productId && i.unit === currentUnit
      );
      if (!currentItem) return prev;

      if (otherUnitItemIdx > -1) {
        // Merge into existing other unit
        const existingOther = prev[otherUnitItemIdx];
        const newQty = existingOther.quantity + currentItem.quantity;
        const mergedPrice = existingOther.isPriceOverridden ? existingOther.unitPrice : newUnitPrice;
        return prev
          .filter(i => !(i.productId === productId && i.unit === currentUnit))
          .map(i =>
            i.productId === productId && i.unit === newUnit
              ? {
                  ...i,
                  unitPrice: mergedPrice,
                  defaultUnitPrice: eff.tierDefaultPrice,
                  quantity: newQty,
                  totalPieces: newQty * newTotalPiecesPerUnit,
                  itemTotal: Math.round(newQty * mergedPrice * 100) / 100,
                }
              : i
          );
      } else {
        // Convert in place (applies newly selected unit's effective/saved customer rate)
        return prev.map(i =>
          i.productId === productId && i.unit === currentUnit
            ? {
                ...i,
                unit: newUnit,
                unitPrice: newUnitPrice,
                defaultUnitPrice: eff.tierDefaultPrice,
                isPriceOverridden: false,
                totalPieces: i.quantity * newTotalPiecesPerUnit,
                itemTotal: Math.round(i.quantity * newUnitPrice * 100) / 100,
              }
            : i
        );
      }
    });
  };

  // Remove item from cart
  const handleRemoveCartItem = (productId: string, unit: UnitType) => {
    setCart(prev => prev.filter(i => !(i.productId === productId && i.unit === unit)));
  };

  // Clear cart
  const handleClearCart = () => {
    setCart([]);
  };

  // Checkout Bill Completed (persists locally + queues for background sync)
  const handleCompleteBill = (bill: Bill, updatedCustomer?: Customer) => {
    soundManager.vibrateSaleCompleted();
    const resolvedStaffId = bill.staffId || activeStaff?.id || 'staff_owner';
    const resolvedStaffName = bill.staffName || activeStaff?.name || 'Store Owner';
    const resolvedStaffRole = bill.staffRole || activeStaff?.role || 'Store Owner / Admin';

    const billWithSyncMeta: Bill = {
      ...bill,
      staffId: resolvedStaffId,
      staffName: resolvedStaffName,
      staffRole: resolvedStaffRole,
      syncStatus: 'pending_offline',
      offlineCreated: offlineSync.isEffectivelyOffline,
    };

    // 1. Deduct stock based on unit & total pieces sold
    const prevStockById = new Map(products.map(p => [p.id, p.stockPieces]));
    const updatedProducts = deductProductStock(
      billWithSyncMeta.items.map(item => ({
        productId: item.productId,
        totalPieces: item.totalPieces,
      }))
    );
    setProducts(updatedProducts);

    if (showLowStockAlerts) {
      updatedProducts.forEach(prod => {
        const prevStock = prevStockById.get(prod.id);
        if (
          prevStock !== undefined &&
          prevStock > prod.lowStockThreshold &&
          prod.stockPieces <= prod.lowStockThreshold
        ) {
          appendSystemNotification({
            category: 'low_stock',
            severity: prod.stockPieces <= 0 ? 'critical' : 'warning',
            title: `Low Stock: ${prod.name}`,
            message: `Remaining stock dropped to ${prod.stockPieces} pcs (threshold: ${prod.lowStockThreshold} pcs).`,
            meta: { productId: prod.id },
          });
        }
      });
    }

    // 2. Save bill locally
    const currentBills = getStoredBills();
    const updatedBills = [billWithSyncMeta, ...currentBills];
    saveBills(updatedBills);
    setBills(updatedBills);

    // 3. Update customer balance & loyalty points + ledger transactions
    let finalCustomerForSync: Customer | undefined;
    const newLoyaltyTx: LoyaltyTransaction[] = [];

    if (updatedCustomer) {
      const redeemed = billWithSyncMeta.loyaltyPointsRedeemed || 0;
      const earned = billWithSyncMeta.loyaltyPointsEarned || 0;
      const now = new Date().toISOString();

      const nextAvailablePoints = Math.max(
        0,
        (updatedCustomer.loyaltyPoints || 0) - redeemed + earned
      );
      const nextLifetimePoints =
        (updatedCustomer.lifetimeLoyaltyPoints || 0) + earned;

      const currentCustomers = getStoredCustomers();
      const storedCustomer = currentCustomers.find(c => c.id === updatedCustomer.id);
      const baseCustomer: Customer = storedCustomer
        ? {
            ...storedCustomer,
            currentBalance: updatedCustomer.currentBalance,
            updatedAt: now,
          }
        : updatedCustomer;
      const customerWithSavedRates = mergeCartOverridesIntoCustomer(
        baseCustomer,
        cart,
        products
      );

      finalCustomerForSync = {
        ...customerWithSavedRates,
        loyaltyPoints: nextAvailablePoints,
        lifetimeLoyaltyPoints: nextLifetimePoints,
        updatedAt: now,
      };

      const updatedCusts = currentCustomers.map(c =>
        c.id === finalCustomerForSync!.id ? finalCustomerForSync! : c
      );
      saveCustomers(updatedCusts);
      setCustomers(updatedCusts);

      // Automated Credit Limit Alert check when bill leaves unpaid balance
      const creditEval = evaluateCustomerCreditLimit(
        finalCustomerForSync,
        finalCustomerForSync.currentBalance
      );
      if (
        creditEval.hasLimit &&
        finalCustomerForSync.currentBalance > billWithSyncMeta.previousBalance &&
        (creditEval.status === 'nearing' || creditEval.status === 'exceeded')
      ) {
        const isExceeded = creditEval.status === 'exceeded';
        appendSystemNotification({
          category: 'credit_limit',
          severity: isExceeded ? 'critical' : 'warning',
          title: isExceeded
            ? `Credit Limit Exceeded: ${finalCustomerForSync.name}`
            : `Nearing Credit Limit: ${finalCustomerForSync.name}`,
          message: isExceeded
            ? `After Bill #${billWithSyncMeta.billNumber}, balance reached ${formatCurrency(
                finalCustomerForSync.currentBalance
              )} against ${formatCurrency(creditEval.limit)} limit (${Math.round(
                creditEval.utilizationPct
              )}% used).`
            : `After Bill #${billWithSyncMeta.billNumber}, balance reached ${Math.round(
                creditEval.utilizationPct
              )}% (${formatCurrency(finalCustomerForSync.currentBalance)} / ${formatCurrency(
                creditEval.limit
              )}).`,
          meta: { customerId: finalCustomerForSync.id },
        });
      }

      // Append loyalty ledger records
      if (redeemed > 0) {
        newLoyaltyTx.push({
          id: `ltx_redeem_${Date.now()}`,
          customerId: finalCustomerForSync.id,
          customerName: finalCustomerForSync.name,
          type: 'REDEEM',
          points: -redeemed,
          discountValue: billWithSyncMeta.loyaltyDiscountAmount || redeemed,
          billId: billWithSyncMeta.id,
          billNumber: billWithSyncMeta.billNumber,
          timestamp: now,
          note: `Redeemed ${redeemed} pts for ₹${billWithSyncMeta.loyaltyDiscountAmount || redeemed} off on Bill #${billWithSyncMeta.billNumber}`,
        });
      }
      if (earned > 0) {
        newLoyaltyTx.push({
          id: `ltx_earn_${Date.now() + 1}`,
          customerId: finalCustomerForSync.id,
          customerName: finalCustomerForSync.name,
          type: 'EARN',
          points: earned,
          billId: billWithSyncMeta.id,
          billNumber: billWithSyncMeta.billNumber,
          timestamp: now,
          note: `Earned ${earned} pts on Bill #${billWithSyncMeta.billNumber}`,
        });
      }
      if (newLoyaltyTx.length > 0) {
        const nextLtx = [...newLoyaltyTx, ...getStoredLoyaltyTransactions()];
        saveLoyaltyTransactions(nextLtx);
        setLoyaltyTransactions(nextLtx);
      }
    }

    // 4. Enqueue for IndexedDB offline vault + Background Sync (includes deducted stock SKUs)
    const deductedProdIds = new Set(billWithSyncMeta.items.map(i => i.productId));
    const affectedProducts = updatedProducts.filter(p => deductedProdIds.has(p.id));
    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'bill',
      entityId: billWithSyncMeta.id,
      label: `Bill #${billWithSyncMeta.billNumber} · ${billWithSyncMeta.customerName}`,
      amount: billWithSyncMeta.grandTotal,
      billRecord: billWithSyncMeta,
      payload: {
        bill: billWithSyncMeta,
        updatedCustomer: finalCustomerForSync,
        updatedProducts: affectedProducts,
        loyaltyTransactions: newLoyaltyTx,
      },
    });

    // 5. Log sales & inventory deduction activity
    const totalPcsSold = billWithSyncMeta.items.reduce((sum, i) => sum + i.totalPieces, 0);
    recordStaffActivity({
      domain: 'sales',
      action: 'BILL_CREATED',
      targetLabel: `#${billWithSyncMeta.billNumber} · ${billWithSyncMeta.customerName}`,
      details: `${billWithSyncMeta.items.length} SKU(s) · ${totalPcsSold} pcs billed · Paid ${formatCurrency(
        billWithSyncMeta.amountReceived
      )}${
        billWithSyncMeta.remainingBalance > 0
          ? ` · Udhar ${formatCurrency(billWithSyncMeta.remainingBalance)}`
          : ''
      }`,
      amount: billWithSyncMeta.itemsTotal + (billWithSyncMeta.totalGstAmount || 0),
      quantityDelta: -totalPcsSold,
      billId: billWithSyncMeta.id,
      staffOverride: {
        staffId: billWithSyncMeta.staffId || 'staff_owner',
        staffName: billWithSyncMeta.staffName || 'Store Owner',
        staffRole: billWithSyncMeta.staffRole || 'Store Owner / Admin',
      },
    });

    // 6. Clear cart & open receipt
    setCart([]);
    setActiveReceiptBill(billWithSyncMeta);
  };

  // Express 1-tap full cash checkout for fast barcode billing
  const handleExpressCashCheckout = () => {
    if (cart.length === 0) return;

    soundManager.playCheckoutSuccess();
    const now = new Date();
    const formattedDateTime = formatDateTime(now);
    const billNumber = 'SQ-' + Date.now().toString().slice(-6);
    const resolvedCustomer = activeBillingCustomer;
    const customerName = resolvedCustomer ? resolvedCustomer.name : 'Walk-in Customer';
    const customerPhone = resolvedCustomer ? resolvedCustomer.phone : '';

    const itemsTotal = Math.round(cart.reduce((sum, i) => sum + i.itemTotal, 0) * 100) / 100;
    const isGstBill = Boolean(receiptSettings.enableGst);
    const gstRate = isGstBill ? receiptSettings.gstRate || 18 : 0;
    const totalGstAmount = isGstBill ? Math.round(((itemsTotal * gstRate) / 100) * 100) / 100 : 0;
    const cgstAmount = isGstBill ? Math.round((totalGstAmount / 2) * 100) / 100 : undefined;
    const sgstAmount = isGstBill ? Math.round((totalGstAmount / 2) * 100) / 100 : undefined;

    const previousBalance = resolvedCustomer ? resolvedCustomer.currentBalance : 0;
    const grandTotal = Math.round((itemsTotal + totalGstAmount + previousBalance) * 100) / 100;

    const pricingSavings = resolvedCustomer
      ? cart.reduce((acc, item) => {
          if (item.isPriceOverridden) return acc;
          const prod = products.find(p => p.id === item.productId);
          if (!prod) return acc;
          const eff = getEffectiveUnitPrice(prod, item.unit, resolvedCustomer);
          return acc + Math.max(0, eff.standardPrice - item.unitPrice) * item.quantity;
        }, 0)
      : 0;

    const pointsEarned = resolvedCustomer
      ? calculatePointsEarnedForBill(itemsTotal, resolvedCustomer)
      : 0;

    const bill: Bill = {
      id: 'bill_' + Date.now(),
      billNumber,
      timestamp: now.toISOString(),
      formattedDateTime,
      customerId: resolvedCustomer?.id,
      customerName,
      customerPhone,
      staffId: activeStaff?.id,
      staffName: activeStaff?.name,
      staffRole: activeStaff?.role,
      items: cart.map(i => ({
        productId: i.productId,
        productName: i.productName,
        unit: i.unit,
        bundleUnitName: i.bundleUnitName,
        bundlePieces: i.bundlePieces,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        totalPieces: i.totalPieces,
        itemTotal: i.itemTotal,
      })),
      itemsTotal,
      isGstBill,
      gstRate: isGstBill ? gstRate : undefined,
      cgstAmount,
      sgstAmount,
      totalGstAmount: isGstBill ? totalGstAmount : undefined,
      gstNumber: isGstBill ? receiptSettings.gstNumber || '07AABCS1429B1Z1' : undefined,
      previousBalance,
      grandTotal,
      amountReceived: grandTotal,
      remainingBalance: 0,
      paymentMode: 'cash',
      pricingTierLabel: resolvedCustomer ? getCustomerPricingLabel(resolvedCustomer) : undefined,
      pricingSavings: pricingSavings > 0 ? Math.round(pricingSavings * 100) / 100 : undefined,
      loyaltyPointsEarned: resolvedCustomer && pointsEarned > 0 ? pointsEarned : undefined,
      source: 'pos',
    };

    const updatedCustomer = resolvedCustomer
      ? {
          ...resolvedCustomer,
          currentBalance: 0,
          updatedAt: now.toISOString(),
        }
      : undefined;

    handleCompleteBill(bill, updatedCustomer);
    setIsCartOpen(false);
  };

  // Add new customer
  const handleAddNewCustomer = (
    name: string,
    phone: string,
    address?: string,
    creditLimit?: number
  ): Customer => {
    const newCust: Customer = {
      id: 'cust_' + Date.now(),
      name,
      phone,
      address,
      currentBalance: 0,
      creditLimit: creditLimit && creditLimit > 0 ? creditLimit : undefined,
      creditWarningPct: 80,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const current = getStoredCustomers();
    const updated = [newCust, ...current];
    saveCustomers(updated);
    setCustomers(updated);
    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'customer',
      entityId: newCust.id,
      label: `New Customer · ${newCust.name}`,
      payload: { customer: newCust },
    });
    return newCust;
  };

  // Update customer customizable credit limit & manual/auto rating profile
  const handleUpdateCustomerCreditProfile = (
    customerId: string,
    updates: CustomerCreditProfileUpdates
  ) => {
    const now = new Date().toISOString();
    const current = getStoredCustomers();
    let updatedCustomer: Customer | null = null;
    const nextList = current.map(c => {
      if (c.id !== customerId) return c;
      updatedCustomer = {
        ...c,
        ...updates,
        updatedAt: now,
      };
      return updatedCustomer;
    });
    if (!updatedCustomer) return;

    saveCustomers(nextList);
    setCustomers(nextList);

    const creditEval = evaluateCustomerCreditLimit(updatedCustomer);
    if (
      updates.creditLimit !== undefined &&
      creditEval.hasLimit &&
      (creditEval.status === 'nearing' || creditEval.status === 'exceeded')
    ) {
      appendSystemNotification({
        category: 'credit_limit',
        severity: creditEval.status === 'exceeded' ? 'critical' : 'warning',
        title:
          creditEval.status === 'exceeded'
            ? `Credit Limit Exceeded: ${(updatedCustomer as Customer).name}`
            : `Nearing Credit Limit: ${(updatedCustomer as Customer).name}`,
        message: `Updated credit limit to ${formatCurrency(
          creditEval.limit
        )}; current balance is ${formatCurrency(
          (updatedCustomer as Customer).currentBalance
        )} (${Math.round(creditEval.utilizationPct)}% used).`,
        meta: { customerId: (updatedCustomer as Customer).id },
      });
    }

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'customer',
      entityId: (updatedCustomer as Customer).id,
      label: `Credit Profile · ${(updatedCustomer as Customer).name}`,
      payload: { customer: updatedCustomer },
    });
  };

  // Record payment towards Udhar
  const handleRecordPayment = (customerId: string, amount: number, notes?: string) => {
    const { updatedCustomer, tx } = recordCustomerPayment(customerId, amount, notes);
    setCustomers(prev => prev.map(c => (c.id === customerId ? updatedCustomer : c)));
    setKhata(prev => [tx, ...prev]);
    recordStaffActivity({
      domain: 'sales',
      action: 'KHATA_PAYMENT',
      targetLabel: updatedCustomer.name,
      details: `Collected ${formatCurrency(amount)} Udhar payment${notes ? ` (${notes})` : ''}`,
      amount,
    });
    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'khata_payment',
      entityId: tx.id,
      label: `Khata Cash · ${updatedCustomer.name}`,
      amount,
      payload: { tx, updatedCustomer },
    });
  };

  // Product CRUD
  const handleSaveProduct = (product: Product) => {
    const stampedProduct: Product = {
      ...product,
      updatedAt: new Date().toISOString(),
    };
    const current = getStoredProducts();
    const prevProduct = current.find(p => p.id === stampedProduct.id);
    const idx = current.findIndex(p => p.id === stampedProduct.id);
    let updated: Product[];
    if (idx > -1) {
      updated = current.map(p => (p.id === stampedProduct.id ? stampedProduct : p));
    } else {
      updated = [stampedProduct, ...current];
    }
    saveProducts(updated);
    setProducts(updated);

    recordStaffActivity({
      domain: 'inventory',
      action: prevProduct ? 'PRODUCT_UPDATED' : 'PRODUCT_ADDED',
      targetLabel: stampedProduct.name,
      details: prevProduct
        ? `Updated SKU (${stampedProduct.category}) · Stock ${stampedProduct.stockPieces} pcs`
        : `Added new SKU under ${stampedProduct.category} with ${stampedProduct.stockPieces} pcs`,
      quantityDelta: prevProduct
        ? stampedProduct.stockPieces - prevProduct.stockPieces
        : stampedProduct.stockPieces,
      productId: stampedProduct.id,
    });

    if (
      stampedProduct.category &&
      !categories.some(c => c.toLowerCase() === stampedProduct.category.toLowerCase())
    ) {
      const nextCats = [...categories, stampedProduct.category];
      saveCategories(nextCats);
      setCategories(nextCats);
    }

    // Sync favorite IDs list with product.isFavorite
    const nextFavIds = stampedProduct.isFavorite
      ? Array.from(new Set([...favoriteProductIds, stampedProduct.id]))
      : favoriteProductIds.filter(id => id !== stampedProduct.id);
    setFavoriteProductIds(nextFavIds);
    saveFavoriteProductIds(nextFavIds);

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'inventory',
      entityId: stampedProduct.id,
      label: `Catalog SKU · ${stampedProduct.name}`,
      payload: { product: stampedProduct },
    });

    setProductToEdit(null);
  };

  // Dedicated Category CRUD
  const handleAddCategory = (name: string): CategoryMutationResult => {
    const clean = name.trim();
    if (!clean) {
      return { ok: false, error: 'Please enter a category name.' };
    }
    if (clean.toLowerCase() === 'all') {
      return { ok: false, error: '"All" is reserved for catalog filtering.' };
    }
    const existing = categories.find(c => c.toLowerCase() === clean.toLowerCase());
    if (existing) {
      return { ok: false, error: `Category "${existing}" already exists.` };
    }
    const next = [...categories, clean];
    saveCategories(next);
    setCategories(next);
    recordStaffActivity({
      domain: 'inventory',
      action: 'CATEGORY_ADDED',
      targetLabel: clean,
      details: `Created product category "${clean}"`,
    });
    return { ok: true, category: clean };
  };

  const handleRenameCategory = (
    oldName: string,
    newName: string
  ): CategoryMutationResult => {
    const cleanNew = newName.trim();
    if (!cleanNew) {
      return { ok: false, error: 'Category name cannot be empty.' };
    }
    if (cleanNew.toLowerCase() === 'all') {
      return { ok: false, error: '"All" is reserved for catalog filtering.' };
    }
    const duplicate = categories.find(
      c => c.toLowerCase() === cleanNew.toLowerCase() && c !== oldName
    );
    if (duplicate) {
      return { ok: false, error: `Category "${duplicate}" already exists.` };
    }
    if (cleanNew === oldName) {
      return { ok: true, category: cleanNew };
    }

    const nextCategories = categories.map(c => (c === oldName ? cleanNew : c));
    saveCategories(nextCategories);
    setCategories(nextCategories);

    // Update all products belonging to the renamed category seamlessly
    const currentProducts = getStoredProducts();
    const renamedProducts: Product[] = [];
    const nowIso = new Date().toISOString();
    const nextProducts = currentProducts.map(p => {
      if (p.category !== oldName) return p;
      const upd = { ...p, category: cleanNew, updatedAt: nowIso };
      renamedProducts.push(upd);
      return upd;
    });
    if (renamedProducts.length > 0) {
      saveProducts(nextProducts);
      setProducts(nextProducts);
      void offlineSync.enqueueAndSyncIfOnline({
        entityType: 'inventory',
        entityId: `cat_rename_${Date.now()}`,
        label: `Category Rename · ${oldName} -> ${cleanNew}`,
        payload: { products: renamedProducts },
      });
    }

    // Keep supplier category tags in sync
    const currentSuppliers = getStoredSuppliers();
    let suppliersChanged = false;
    const nextSuppliers = currentSuppliers.map(s => {
      if (!s.categories.includes(oldName)) return s;
      suppliersChanged = true;
      const updatedSupCats = Array.from(
        new Set(s.categories.map(c => (c === oldName ? cleanNew : c)))
      );
      return { ...s, categories: updatedSupCats, updatedAt: new Date().toISOString() };
    });
    if (suppliersChanged) {
      saveSuppliers(nextSuppliers);
      setSuppliers(nextSuppliers);
    }

    recordStaffActivity({
      domain: 'inventory',
      action: 'CATEGORY_RENAMED',
      targetLabel: `${oldName} -> ${cleanNew}`,
      details: `Renamed category "${oldName}" to "${cleanNew}"`,
    });

    return { ok: true, category: cleanNew };
  };

  const handleDeleteCategory = (name: string): CategoryMutationResult => {
    const assignedCount = products.filter(p => p.category === name).length;
    if (assignedCount > 0) {
      return {
        ok: false,
        error: `Cannot delete "${name}" while ${assignedCount} product${
          assignedCount === 1 ? ' is' : 's are'
        } assigned to it.`,
      };
    }

    const nextCategories = categories.filter(c => c !== name);
    saveCategories(nextCategories);
    setCategories(nextCategories);
    recordStaffActivity({
      domain: 'inventory',
      action: 'CATEGORY_DELETED',
      targetLabel: name,
      details: `Deleted unused category "${name}"`,
    });

    return { ok: true };
  };

  const handleToggleFavorite = (productId: string) => {
    const isCurrentlyFav = favoriteProductIds.includes(productId);
    const nextFavIds = isCurrentlyFav
      ? favoriteProductIds.filter(id => id !== productId)
      : [...favoriteProductIds, productId];
    const nowIso = new Date().toISOString();
    setFavoriteProductIds(nextFavIds);
    saveFavoriteProductIds(nextFavIds);
    setProducts(prev => {
      const updated = prev.map(p =>
        p.id === productId ? { ...p, isFavorite: !isCurrentlyFav, updatedAt: nowIso } : p
      );
      saveProducts(updated);
      return updated;
    });
  };

  const handleDeleteProduct = (productId: string) => {
    const current = getStoredProducts();
    const target = current.find(p => p.id === productId);
    const updated = current.filter(p => p.id !== productId);
    saveProducts(updated);
    setProducts(updated);
    setFavoriteProductIds(prev => {
      const next = prev.filter(id => id !== productId);
      saveFavoriteProductIds(next);
      return next;
    });
    if (target) {
      recordStaffActivity({
        domain: 'inventory',
        action: 'PRODUCT_DELETED',
        targetLabel: target.name,
        details: `Deleted SKU from ${target.category} (had ${target.stockPieces} pcs)`,
        quantityDelta: -target.stockPieces,
        productId: target.id,
      });
      void offlineSync.enqueueAndSyncIfOnline({
        entityType: 'inventory',
        entityId: target.id,
        label: `Delete SKU · ${target.name}`,
        payload: { deletedProductId: target.id },
      });
    }
  };

  const handleRestockProduct = (productId: string, additionalPieces: number) => {
    const current = getStoredProducts();
    const target = current.find(p => p.id === productId);
    let updatedProduct: Product | null = null;
    const nowIso = new Date().toISOString();
    const updated = current.map(p => {
      if (p.id === productId) {
        updatedProduct = {
          ...p,
          stockPieces: p.stockPieces + additionalPieces,
          updatedAt: nowIso,
        };
        return updatedProduct;
      }
      return p;
    });
    saveProducts(updated);
    setProducts(updated);
    if (target && additionalPieces > 0) {
      recordStaffActivity({
        domain: 'inventory',
        action: 'STOCK_RESTOCK',
        targetLabel: target.name,
        details: `Manual restock: +${additionalPieces} pcs (new stock: ${
          target.stockPieces + additionalPieces
        } pcs)`,
        quantityDelta: additionalPieces,
        productId: target.id,
      });
    }
    if (updatedProduct) {
      void offlineSync.enqueueAndSyncIfOnline({
        entityType: 'inventory',
        entityId: (updatedProduct as Product).id,
        label: `Restock · ${(updatedProduct as Product).name}`,
        payload: { product: updatedProduct },
      });
    }
  };

  // OCR Batch Stock Restock Handler
  const handleApplyOcrStockUpdate = (
    updates: Array<{ productId: string; addedPieces: number; productName: string }>
  ) => {
    const current = getStoredProducts();
    const nowIso = new Date().toISOString();
    const syncedProducts: Product[] = [];
    const updated = current.map(p => {
      const match = updates.find(u => u.productId === p.id);
      if (match) {
        const nextProd = {
          ...p,
          stockPieces: p.stockPieces + match.addedPieces,
          updatedAt: nowIso,
        };
        syncedProducts.push(nextProd);
        return nextProd;
      }
      return p;
    });
    saveProducts(updated);
    setProducts(updated);
    const totalAdded = updates.reduce((sum, u) => sum + u.addedPieces, 0);
    if (updates.length > 0) {
      recordStaffActivity({
        domain: 'inventory',
        action: 'OCR_STOCK_RESTOCK',
        targetLabel: `${updates.length} SKU(s) via OCR Scan`,
        details: `Batch restocked ${updates
          .slice(0, 3)
          .map(u => `${u.productName} (+${u.addedPieces})`)
          .join(', ')}${updates.length > 3 ? ` +${updates.length - 3} more` : ''}`,
        quantityDelta: totalAdded,
      });
      void offlineSync.enqueueAndSyncIfOnline({
        entityType: 'inventory',
        entityId: `ocr_restock_${Date.now()}`,
        label: `OCR Restock · ${syncedProducts.length} SKU(s)`,
        payload: { products: syncedProducts },
      });
    }
  };

  // OCR Digital Invoice Handler (creates Bill, optionally deducts matched stock, updates Khata & opens Receipt)
  const handleGenerateDigitalInvoiceFromOcr = (
    bill: Bill,
    updatedCustomer?: Customer,
    deductStockItems?: Array<{ productId: string; totalPieces: number }>
  ) => {
    const billWithStaff: Bill = {
      ...bill,
      staffId: bill.staffId || activeStaff?.id || 'staff_owner',
      staffName: bill.staffName || activeStaff?.name || 'Store Owner',
      staffRole: bill.staffRole || activeStaff?.role || 'Store Owner / Admin',
    };

    if (deductStockItems && deductStockItems.length > 0) {
      const updatedProducts = deductProductStock(deductStockItems);
      setProducts(updatedProducts);
    }

    const currentBills = getStoredBills();
    const updatedBills = [billWithStaff, ...currentBills];
    saveBills(updatedBills);
    setBills(updatedBills);

    if (updatedCustomer) {
      const currentCustomers = getStoredCustomers();
      const updatedCusts = currentCustomers.map(c =>
        c.id === updatedCustomer.id ? updatedCustomer : c
      );
      saveCustomers(updatedCusts);
      setCustomers(updatedCusts);
    }

    const totalPcs = billWithStaff.items.reduce((sum, i) => sum + i.totalPieces, 0);
    recordStaffActivity({
      domain: 'sales',
      action: 'OCR_INVOICE_BILL',
      targetLabel: `#${billWithStaff.billNumber} · ${billWithStaff.customerName}`,
      details: `OCR digital invoice generated · ${billWithStaff.items.length} SKU(s)`,
      amount: billWithStaff.itemsTotal + (billWithStaff.totalGstAmount || 0),
      quantityDelta: deductStockItems?.length ? -totalPcs : undefined,
      billId: billWithStaff.id,
    });

    soundManager.vibrateSaleCompleted();
    setActiveReceiptBill(billWithStaff);
  };

  // Load OCR extracted items into the POS Cart
  const handleLoadOcrItemsToCart = (ocrCartItems: CartItem[]) => {
    if (ocrCartItems.length > 0) {
      soundManager.vibrateItemAdded();
    }
    setCart(prev => [...prev, ...ocrCartItems]);
    setActiveTab('billing');
    setIsCartOpen(true);
  };

  // Populate 60-day sample sales history for analytics & demand forecasting preview
  const handleSeedSampleHistory = () => {
    const sampleBills = generateSampleSalesHistory(products);
    const currentBills = getStoredBills();
    const merged = [...currentBills, ...sampleBills];
    saveBills(merged);
    setBills(merged);
  };

  // Supplier & Purchase Order Handlers
  const handleSaveSupplier = (supplier: Supplier) => {
    const current = getStoredSuppliers();
    const exists = current.some(s => s.id === supplier.id);
    const updated = exists
      ? current.map(s => (s.id === supplier.id ? supplier : s))
      : [supplier, ...current];
    saveSuppliers(updated);
    setSuppliers(updated);
  };

  const handleDeleteSupplier = (supplierId: string) => {
    const updated = getStoredSuppliers().filter(s => s.id !== supplierId);
    saveSuppliers(updated);
    setSuppliers(updated);
  };

  const handleSavePurchaseOrder = (po: PurchaseOrder) => {
    const current = getStoredPurchaseOrders();
    const exists = current.some(p => p.id === po.id);
    const updated = exists
      ? current.map(p => (p.id === po.id ? po : p))
      : [po, ...current];
    savePurchaseOrders(updated);
    setPurchaseOrders(updated);

    // Sync any advance paid on a newly created PO into Cash Flow ledger
    if (!exists && po.amountPaid > 0) {
      const now = new Date().toISOString();
      const cfEntry: CashFlowEntry = {
        id: `cf_po_${Date.now()}`,
        date: po.orderDate.slice(0, 10),
        timestamp: now,
        type: 'supplier_payment',
        amount: po.amountPaid,
        paymentMode: 'cash',
        category: 'Supplier Payment',
        title: `Advance for ${po.poNumber}`,
        notes: po.notes,
        supplierId: po.supplierId,
        supplierName: po.supplierName,
        poId: po.id,
        poNumber: po.poNumber,
        isAutoSynced: true,
      };
      const nextEntries = [cfEntry, ...getStoredCashFlowEntries()];
      saveCashFlowEntries(nextEntries);
      setCashFlowEntries(nextEntries);
    }
  };

  const handleUpdatePoStatus = (
    poId: string,
    status: PurchaseOrderStatus,
    note: string
  ) => {
    const now = new Date().toISOString();
    const updated = getStoredPurchaseOrders().map(po => {
      if (po.id !== poId) return po;
      return {
        ...po,
        status,
        updatedAt: now,
        timeline: [
          ...po.timeline,
          {
            id: `evt_${Date.now()}`,
            status,
            timestamp: now,
            note,
          },
        ],
      };
    });
    savePurchaseOrders(updated);
    setPurchaseOrders(updated);
  };

  const handleRecordPoPayment = (poId: string, additionalAmount: number) => {
    const now = new Date().toISOString();
    let paidPo: PurchaseOrder | null = null;
    const updated = getStoredPurchaseOrders().map(po => {
      if (po.id !== poId) return po;
      const newPaid = Math.min(po.totalAmount, po.amountPaid + additionalAmount);
      paidPo = {
        ...po,
        amountPaid: newPaid,
        updatedAt: now,
        timeline: [
          ...po.timeline,
          {
            id: `evt_${Date.now()}`,
            status: po.status,
            timestamp: now,
            note: `Vendor payment of ₹${additionalAmount.toFixed(2)} recorded`,
          },
        ],
      };
      return paidPo;
    });
    savePurchaseOrders(updated);
    setPurchaseOrders(updated);

    if (paidPo && additionalAmount > 0) {
      const target = paidPo as PurchaseOrder;
      const cfEntry: CashFlowEntry = {
        id: `cf_po_pay_${Date.now()}`,
        date: now.slice(0, 10),
        timestamp: now,
        type: 'supplier_payment',
        amount: additionalAmount,
        paymentMode: 'cash',
        category: 'Supplier Payment',
        title: `Settlement for ${target.poNumber}`,
        supplierId: target.supplierId,
        supplierName: target.supplierName,
        poId: target.id,
        poNumber: target.poNumber,
        isAutoSynced: true,
      };
      const nextEntries = [cfEntry, ...getStoredCashFlowEntries()];
      saveCashFlowEntries(nextEntries);
      setCashFlowEntries(nextEntries);
    }
  };

  // Cash Flow Handlers
  const handleSetOpeningCash = (date: string, amount: number | null) => {
    const current = { ...getStoredOpeningCashMap() };
    if (amount === null) {
      delete current[date];
    } else {
      current[date] = amount;
    }
    saveOpeningCashMap(current);
    setOpeningCashMap(current);
  };

  const handleAddCashFlowEntry = (entry: CashFlowEntry) => {
    const updated = [entry, ...getStoredCashFlowEntries()];
    saveCashFlowEntries(updated);
    setCashFlowEntries(updated);
    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'cashflow',
      entityId: entry.id,
      label: `Cash Flow · ${entry.title}`,
      amount: entry.amount,
      payload: { entry },
    });
  };

  const handleAddCashFlowEntries = (entries: CashFlowEntry[]) => {
    if (!entries.length) return;
    const updated = [...entries, ...getStoredCashFlowEntries()];
    saveCashFlowEntries(updated);
    setCashFlowEntries(updated);
    entries.forEach(entry => {
      void offlineSync.enqueueAndSyncIfOnline({
        entityType: 'cashflow',
        entityId: entry.id,
        label: `Cash Flow · ${entry.title}`,
        amount: entry.amount,
        payload: { entry },
      });
    });
  };

  const handleDeleteCashFlowEntry = (entryId: string) => {
    const updated = getStoredCashFlowEntries().filter(e => e.id !== entryId);
    saveCashFlowEntries(updated);
    setCashFlowEntries(updated);
  };

  const handlePaySupplierFromCashFlow = (params: {
    date: string;
    supplierId: string;
    supplierName: string;
    poId?: string;
    poNumber?: string;
    amount: number;
    paymentMode: CashFlowPaymentMode;
    notes?: string;
  }) => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const timestamp =
      params.date === todayStr
        ? now.toISOString()
        : `${params.date}T${now.toISOString().slice(11)}`;

    const entry: CashFlowEntry = {
      id: `cf_sup_${Date.now()}`,
      date: params.date,
      timestamp,
      type: 'supplier_payment',
      amount: params.amount,
      paymentMode: params.paymentMode,
      category: 'Supplier Payment',
      title: params.poNumber
        ? `Payment for ${params.poNumber}`
        : `Payment to ${params.supplierName}`,
      notes: params.notes,
      supplierId: params.supplierId,
      supplierName: params.supplierName,
      poId: params.poId,
      poNumber: params.poNumber,
      isAutoSynced: false,
    };

    const nextEntries = [entry, ...getStoredCashFlowEntries()];
    saveCashFlowEntries(nextEntries);
    setCashFlowEntries(nextEntries);

    // If linked to an open PO, also credit its amountPaid & timeline
    if (params.poId) {
      const updatedOrders = getStoredPurchaseOrders().map(po => {
        if (po.id !== params.poId) return po;
        const newPaid = Math.min(po.totalAmount, po.amountPaid + params.amount);
        return {
          ...po,
          amountPaid: newPaid,
          updatedAt: now.toISOString(),
          timeline: [
            ...po.timeline,
            {
              id: `evt_${Date.now()}`,
              status: po.status,
              timestamp: now.toISOString(),
              note: `₹${params.amount.toFixed(2)} paid via ${params.paymentMode.toUpperCase()} (Cash Flow)`,
            },
          ],
        };
      });
      savePurchaseOrders(updatedOrders);
      setPurchaseOrders(updatedOrders);
    }
  };

  const handleReceivePurchaseOrder = (
    poId: string,
    receipts: Array<{ productId: string; unitType: UnitType; receiveQtyNow: number }>,
    note: string
  ) => {
    const now = new Date().toISOString();
    const currentOrders = getStoredPurchaseOrders();
    const targetPo = currentOrders.find(po => po.id === poId);
    if (!targetPo) return;

    const piecesDeltaByProduct = new Map<string, number>();

    const nextItems = targetPo.items.map(item => {
      const rec = receipts.find(
        r => r.productId === item.productId && r.unitType === item.unitType
      );
      if (!rec || rec.receiveQtyNow <= 0) return item;

      const remainingQty = Math.max(0, item.orderedQty - item.receivedQty);
      const acceptedQty = Math.min(remainingQty, rec.receiveQtyNow);
      if (acceptedQty <= 0) return item;

      const pcsPerUnit = item.unitType === 'bundle' ? Math.max(1, item.bundlePieces) : 1;
      const addedPieces = acceptedQty * pcsPerUnit;

      piecesDeltaByProduct.set(
        item.productId,
        (piecesDeltaByProduct.get(item.productId) || 0) + addedPieces
      );

      const newReceivedQty = item.receivedQty + acceptedQty;
      return {
        ...item,
        receivedQty: newReceivedQty,
        totalReceivedPieces: newReceivedQty * pcsPerUnit,
      };
    });

    if (piecesDeltaByProduct.size === 0) return;

    // 1. Atomically add received pieces to live inventory
    const updatedProducts = getStoredProducts().map(prod => {
      const delta = piecesDeltaByProduct.get(prod.id);
      if (!delta) return prod;
      return {
        ...prod,
        stockPieces: prod.stockPieces + delta,
        updatedAt: now,
      };
    });
    saveProducts(updatedProducts);
    setProducts(updatedProducts);

    // 2. Determine whether PO is partial or fully received
    const allItemsReceived = nextItems.every(i => i.receivedQty >= i.orderedQty);
    const nextStatus: PurchaseOrderStatus = allItemsReceived ? 'received' : 'partial';
    const wasAlreadyReceived = targetPo.status === 'received';

    const updatedOrders = currentOrders.map(po => {
      if (po.id !== poId) return po;
      return {
        ...po,
        items: nextItems,
        status: nextStatus,
        actualDeliveryDate: allItemsReceived ? now : po.actualDeliveryDate,
        updatedAt: now,
        timeline: [
          ...po.timeline,
          {
            id: `evt_${Date.now()}`,
            status: nextStatus,
            timestamp: now,
            note,
          },
        ],
      };
    });
    savePurchaseOrders(updatedOrders);
    setPurchaseOrders(updatedOrders);

    // 3. Log PO inventory receipt activity
    const totalPoPiecesReceived = Array.from(piecesDeltaByProduct.values()).reduce(
      (s, v) => s + v,
      0
    );
    recordStaffActivity({
      domain: 'inventory',
      action: 'PO_STOCK_RECEIVED',
      targetLabel: `${targetPo.poNumber} · ${targetPo.supplierName}`,
      details: `Received +${totalPoPiecesReceived} pcs across ${piecesDeltaByProduct.size} SKU(s) (${note})`,
      quantityDelta: totalPoPiecesReceived,
    });

    // 4. Update vendor on-time delivery SLA score when PO completes
    if (allItemsReceived && !wasAlreadyReceived) {
      const deliveryDateStr = now.slice(0, 10);
      const wasOnTime = deliveryDateStr <= targetPo.expectedDeliveryDate.slice(0, 10);
      const updatedSuppliers = getStoredSuppliers().map(sup => {
        if (sup.id !== targetPo.supplierId) return sup;
        return {
          ...sup,
          totalDeliveries: (sup.totalDeliveries || 0) + 1,
          onTimeDeliveries: (sup.onTimeDeliveries || 0) + (wasOnTime ? 1 : 0),
          updatedAt: now,
        };
      });
      saveSuppliers(updatedSuppliers);
      setSuppliers(updatedSuppliers);
    }
  };

  // Customer-Specific Pricing, Loyalty Rewards & Staff Attendance Handlers
  const handleSaveCustomerPricing = (
    customerId: string,
    pricingTier: PricingTierId,
    customDiscountPct: number,
    customProductRates: Record<string, CustomerCustomProductRate>
  ) => {
    const now = new Date().toISOString();
    const updated = getStoredCustomers().map(c => {
      if (c.id !== customerId) return c;
      return {
        ...c,
        pricingTier,
        customDiscountPct: pricingTier === 'custom' ? customDiscountPct : 0,
        customProductRates,
        updatedAt: now,
      };
    });
    saveCustomers(updated);
    setCustomers(updated);
  };

  const handleClaimMilestone = (customerId: string, milestone: LoyaltyMilestone) => {
    const now = new Date().toISOString();
    let targetName = '';
    const updated = getStoredCustomers().map(c => {
      if (c.id !== customerId) return c;
      const existingClaimed = new Set(c.claimedMilestoneIds || []);
      if (existingClaimed.has(milestone.id)) return c;
      existingClaimed.add(milestone.id);
      targetName = c.name;
      return {
        ...c,
        loyaltyPoints: (c.loyaltyPoints || 0) + milestone.rewardPointsBonus,
        lifetimeLoyaltyPoints: (c.lifetimeLoyaltyPoints || 0) + milestone.rewardPointsBonus,
        claimedMilestoneIds: Array.from(existingClaimed),
        updatedAt: now,
      };
    });
    if (!targetName) return;
    saveCustomers(updated);
    setCustomers(updated);

    const tx: LoyaltyTransaction = {
      id: `ltx_ms_${Date.now()}`,
      customerId,
      customerName: targetName,
      type: 'MILESTONE_BONUS',
      points: milestone.rewardPointsBonus,
      discountValue: milestone.rewardCashValue,
      timestamp: now,
      note: `Claimed "${milestone.title}" milestone bonus`,
    };
    const nextTx = [tx, ...getStoredLoyaltyTransactions()];
    saveLoyaltyTransactions(nextTx);
    setLoyaltyTransactions(nextTx);
  };

  const handleAdjustLoyaltyPoints = (customerId: string, pointsDelta: number, note: string) => {
    if (!pointsDelta) return;
    const now = new Date().toISOString();
    let targetName = '';
    const updated = getStoredCustomers().map(c => {
      if (c.id !== customerId) return c;
      targetName = c.name;
      return {
        ...c,
        loyaltyPoints: Math.max(0, (c.loyaltyPoints || 0) + pointsDelta),
        lifetimeLoyaltyPoints:
          pointsDelta > 0
            ? (c.lifetimeLoyaltyPoints || 0) + pointsDelta
            : c.lifetimeLoyaltyPoints || 0,
        updatedAt: now,
      };
    });
    if (!targetName) return;
    saveCustomers(updated);
    setCustomers(updated);

    const tx: LoyaltyTransaction = {
      id: `ltx_adj_${Date.now()}`,
      customerId,
      customerName: targetName,
      type: 'ADJUSTMENT',
      points: pointsDelta,
      timestamp: now,
      note: note || 'Manual loyalty adjustment',
    };
    const nextTx = [tx, ...getStoredLoyaltyTransactions()];
    saveLoyaltyTransactions(nextTx);
    setLoyaltyTransactions(nextTx);
  };

  const handleSaveStaffMember = (staff: StaffMember) => {
    const current = getStoredStaffMembers();
    const exists = current.some(s => s.id === staff.id);
    const updated = exists
      ? current.map(s => (s.id === staff.id ? staff : s))
      : [staff, ...current];
    saveStaffMembers(updated);
    setStaffMembers(updated);
    recordStaffActivity({
      domain: 'team_rbac',
      action: exists ? 'STAFF_UPDATED' : 'STAFF_ADDED',
      targetLabel: staff.name,
      details: `${exists ? 'Updated' : 'Added'} staff account · Role: ${staff.role}${
        staff.pin ? ' (PIN protected)' : ''
      }`,
    });
  };

  const handleDeleteStaffMember = (staffId: string) => {
    const current = getStoredStaffMembers();
    const target = current.find(s => s.id === staffId);
    const updated = current.filter(s => s.id !== staffId);
    saveStaffMembers(updated);
    setStaffMembers(updated);
    if (target) {
      recordStaffActivity({
        domain: 'team_rbac',
        action: 'STAFF_REMOVED',
        targetLabel: target.name,
        details: `Removed staff account (${target.role})`,
      });
    }
  };

  const handleUpdateRolePermission = (
    role: StaffRole,
    permission: StaffPermission,
    allowed: boolean
  ) => {
    const nextMatrix: RolePermissionMatrix = {
      ...rolePermissions,
      [role]: {
        ...rolePermissions[role],
        [permission]: allowed,
      },
    };
    if (role === 'Store Owner / Admin') {
      nextMatrix[role].manage_rbac = true;
      nextMatrix[role].staff_loyalty = true;
      nextMatrix[role].store_profile = true;
    }
    saveRolePermissions(nextMatrix);
    setRolePermissions(nextMatrix);
    recordStaffActivity({
      domain: 'team_rbac',
      action: 'RBAC_UPDATED',
      targetLabel: `${role} -> ${permission}`,
      details: `${allowed ? 'Granted' : 'Revoked'} "${permission}" access for ${role}`,
    });
  };

  const handleResetRolePermissions = () => {
    saveRolePermissions(DEFAULT_ROLE_PERMISSIONS);
    setRolePermissions(DEFAULT_ROLE_PERMISSIONS);
    recordStaffActivity({
      domain: 'team_rbac',
      action: 'RBAC_RESET',
      targetLabel: 'Role Matrix',
      details: 'Reset all role permissions to default POS configuration',
    });
  };

  const handleSwitchOperator = (targetStaff: StaffMember) => {
    saveActiveStaffId(targetStaff.id);
    setActiveStaffId(targetStaff.id);
    recordStaffActivity({
      domain: 'team_rbac',
      action: 'OPERATOR_SWITCH',
      targetLabel: targetStaff.name,
      details: `Switched active POS operator to ${targetStaff.name} (${targetStaff.role})`,
      staffOverride: {
        staffId: targetStaff.id,
        staffName: targetStaff.name,
        staffRole: targetStaff.role,
      },
    });
  };

  const handleClockInStaff = (staff: StaffMember, note?: string) => {
    const now = new Date();
    const todayStr = now.toISOString().slice(0, 10);
    const current = getStoredAttendanceRecords();
    const alreadyIn = current.some(
      r => r.staffId === staff.id && r.date === todayStr && r.status === 'clocked_in'
    );
    if (alreadyIn) return;

    const record: AttendanceRecord = {
      id: `att_${Date.now()}`,
      staffId: staff.id,
      staffName: staff.name,
      role: staff.role,
      date: todayStr,
      clockInTime: now.toISOString(),
      status: 'clocked_in',
      notes: note || undefined,
    };
    const updated = [record, ...current];
    saveAttendanceRecords(updated);
    setAttendanceRecords(updated);
    recordStaffActivity({
      domain: 'team_rbac',
      action: 'SHIFT_CLOCK_IN',
      targetLabel: staff.name,
      details: `Clocked in (${staff.role})${note ? ` · ${note}` : ''}`,
    });
  };

  const handleClockOutStaff = (recordId: string, note?: string) => {
    const now = new Date();
    let targetRecord: AttendanceRecord | null = null;
    const updated = getStoredAttendanceRecords().map(r => {
      if (r.id !== recordId || r.status !== 'clocked_in') return r;
      const mins = Math.max(
        1,
        Math.round((now.getTime() - new Date(r.clockInTime).getTime()) / 60000)
      );
      targetRecord = {
        ...r,
        clockOutTime: now.toISOString(),
        durationMinutes: mins,
        status: 'completed' as const,
        notes: note ? (r.notes ? `${r.notes} · ${note}` : note) : r.notes,
      };
      return targetRecord;
    });
    saveAttendanceRecords(updated);
    setAttendanceRecords(updated);
    if (targetRecord) {
      const done = targetRecord as AttendanceRecord;
      recordStaffActivity({
        domain: 'team_rbac',
        action: 'SHIFT_CLOCK_OUT',
        targetLabel: done.staffName,
        details: `Clocked out after ${done.durationMinutes || 0} mins (${done.role})`,
      });
    }
  };

  const handlePostWagesToCashFlow = (date: string, amount: number, staffSummary: string) => {
    if (amount <= 0) return;
    const now = new Date();
    const entry: CashFlowEntry = {
      id: `cf_wage_${Date.now()}`,
      date,
      timestamp: now.toISOString(),
      type: 'expense',
      amount,
      paymentMode: 'cash',
      category: 'Staff Wages',
      title: `Daily Staff Wages (${date})`,
      notes: staffSummary,
      isAutoSynced: false,
    };
    const updated = [entry, ...getStoredCashFlowEntries()];
    saveCashFlowEntries(updated);
    setCashFlowEntries(updated);
  };

  const handleSaveStoreProfile = (updatedProfile: StoreProfile) => {
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    if (updatedProfile.gstin && updatedProfile.gstin !== receiptSettings.gstNumber) {
      const nextReceiptSettings: ReceiptSettings = {
        ...receiptSettings,
        gstNumber: updatedProfile.gstin,
      };
      saveReceiptSettings(nextReceiptSettings);
      setReceiptSettings(nextReceiptSettings);
    }

    if (updatedProfile.whatsappConfig) {
      fetch('/api/whatsapp/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedProfile.whatsappConfig }),
      }).catch(() => {});
    }

    if (updatedProfile.externalApiConfig) {
      fetch('/api/external-api/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: updatedProfile.externalApiConfig }),
      }).catch(() => {});
    }

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `Store Profile · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const handleUpdateEnabledModules = (modules: StoreModuleVisibility) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      enabledModules: {
        ...DEFAULT_ENABLED_MODULES,
        ...modules,
      },
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `Store Modules · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const handleUpdatePosUiVisibility = (visibility: PosUiVisibility) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      posUiVisibility: {
        ...DEFAULT_POS_UI_VISIBILITY,
        ...visibility,
      },
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `POS UI Visibility · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const handleUpdateHeaderIconVisibility = (visibility: HeaderIconVisibility) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      headerIconVisibility: {
        ...DEFAULT_HEADER_ICON_VISIBILITY,
        ...visibility,
      },
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `Header Icons · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const handleToggleHeaderBranding = (show: boolean) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      showBrandingInHeader: show,
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `Header Branding ${show ? 'Shown' : 'Hidden'} · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  // =========================================================================
  // WHATSAPP BUSINESS AUTOMATION HANDLERS & SERVER WEBHOOK SYNC
  // =========================================================================
  const effectiveWhatsappConfig: WhatsAppAutomationConfig = {
    ...DEFAULT_WHATSAPP_CONFIG,
    ...(storeProfile.whatsappConfig || {}),
  };

  const effectiveExternalApiConfig: ExternalApiConfig = {
    ...DEFAULT_EXTERNAL_API_CONFIG,
    ...(storeProfile.externalApiConfig || {}),
  };

  const pendingWhatsappCount = whatsappMessages.filter(
    m => m.status === 'pending_review' || m.status === 'insufficient_stock'
  ).length;

  const syncWhatsappWithServer = React.useCallback(async () => {
    setIsSyncingWhatsappServer(true);
    try {
      const [cfgRes, msgRes] = await Promise.all([
        fetch('/api/whatsapp/config').catch(() => null),
        fetch('/api/whatsapp/messages').catch(() => null),
      ]);
      if (cfgRes?.ok) {
        const cfgJson = await cfgRes.json();
        setHasServerWhatsappToken(Boolean(cfgJson?.hasServerAccessToken));
      }
      if (msgRes?.ok) {
        const msgJson = await msgRes.json();
        const serverMsgs: WhatsAppInboundMessage[] = Array.isArray(msgJson?.messages)
          ? msgJson.messages
          : [];
        if (serverMsgs.length > 0) {
          setWhatsappMessages(prev => {
            const existingIds = new Set(prev.map(m => m.id));
            const newFromWebhook = serverMsgs.filter(m => !existingIds.has(m.id));
            if (newFromWebhook.length === 0) return prev;
            const merged = [...newFromWebhook, ...prev].slice(0, 200);
            saveWhatsAppMessages(merged);
            newFromWebhook.forEach(item => {
              appendSystemNotification({
                category: 'whatsapp',
                severity: item.intent === 'order' ? 'info' : 'info',
                title: `WhatsApp ${item.intent === 'order' ? 'Order' : 'Message'}: ${item.senderName}`,
                message: item.messageText.slice(0, 120),
                meta: { whatsappMessageId: item.id },
              });
            });
            return merged;
          });
        }
      }
    } finally {
      setIsSyncingWhatsappServer(false);
    }
  }, [appendSystemNotification]);

  useEffect(() => {
    void fetchMultiStoreStateFromServer().then(state => {
      setMultiBranchConfig(state.config);
      setBranches(state.branches);
      setBranchTransfers(state.transfers);
    });

    if (!effectivePerformanceSettings.enableAutoCloudSync) {
      return;
    }
    void syncWhatsappWithServer();
    // Push initial WhatsApp config to server so webhook guard matches settings
    fetch('/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: effectiveWhatsappConfig }),
    }).catch(() => {});
    // Push initial External API config so /api/v1/* endpoint guard matches settings
    fetch('/api/external-api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: effectiveExternalApiConfig }),
    })
      .then(() => offlineSync.refreshServerStatus())
      .catch(() => {});
  }, []);

  // Keep active branch KPI summary metrics fresh whenever live products or bills change
  useEffect(() => {
    setBranches(prev => refreshLocalBranchSummaries(prev, multiBranchConfig.activeBranchId));
  }, [products, bills, multiBranchConfig.activeBranchId]);

  const activeBranch =
    branches.find(b => b.id === multiBranchConfig.activeBranchId) || branches[0] || null;

  const handleToggleMultiBranchSync = async (enabled: boolean) => {
    const nextConfig: MultiBranchSyncConfig = {
      ...multiBranchConfig,
      enabled,
      lastBranchSyncNote: enabled
        ? 'Multi-branch synchronization enabled'
        : 'Multi-branch synchronization paused (Standalone mode)',
    };
    const reconciled = await updateMultiBranchSyncConfig(nextConfig);
    setMultiBranchConfig(reconciled);

    appendSystemNotification({
      category: 'sync',
      severity: enabled ? 'success' : 'warning',
      title: enabled
        ? 'Multi-Branch Synchronization Enabled'
        : 'Multi-Branch Synchronization Disabled',
      message: enabled
        ? 'Cross-branch catalog, customer Khata, and inter-branch stock transfers are now active.'
        : 'Stores are running in standalone mode. Multi-branch sync & inter-branch transfers are paused.',
    });
  };

  const handleUpdateMultiBranchConfig = async (nextConfig: MultiBranchSyncConfig) => {
    const reconciled = await updateMultiBranchSyncConfig(nextConfig);
    setMultiBranchConfig(reconciled);
  };

  const handleSwitchBranch = async (targetBranchId: string) => {
    const res = await switchActiveStoreBranch(targetBranchId, multiBranchConfig, branches);
    if (!res.ok) return;
    setMultiBranchConfig(res.config);
    setBranches(res.branches);
    setCart([]);
    setActiveBillingCustomerId('');
    loadData();
    const switched = res.branches.find(b => b.id === targetBranchId);
    if (switched) {
      appendSystemNotification({
        category: 'system',
        severity: 'info',
        title: `Switched Store Terminal: ${switched.code}`,
        message: `Active POS workspace is now ${switched.name}.`,
      });
    }
  };

  const handleSaveBranch = async (
    input: {
      id?: string;
      code: string;
      name: string;
      city?: string;
      address?: string;
      phone?: string;
      managerName?: string;
    },
    options?: {
      copyCatalog?: boolean;
      initialStockMode?: 'zero' | 'copy';
      copyCustomers?: boolean;
    }
  ): Promise<{ ok: boolean; error?: string }> => {
    const res = await saveStoreBranchProfile(
      input,
      branches,
      multiBranchConfig.activeBranchId,
      options
    );
    if (res.ok) {
      setBranches(res.branches);
      // If active branch metadata was edited, refresh live store profile name/contact
      if (input.id && input.id === multiBranchConfig.activeBranchId) {
        loadData({ skipProducts: true });
      }
    }
    return { ok: res.ok, error: res.error };
  };

  const handleDeleteBranch = async (
    branchId: string
  ): Promise<{ ok: boolean; error?: string }> => {
    const res = await removeStoreBranch(branchId, multiBranchConfig, branches);
    if (res.ok) {
      setMultiBranchConfig(res.config);
      setBranches(res.branches);
      if (res.switchedToHq) {
        setCart([]);
        setActiveBillingCustomerId('');
        loadData();
      }
    }
    return { ok: res.ok, error: res.error };
  };

  const handleSyncAllBranches = React.useCallback(async (): Promise<{
    ok: boolean;
    error?: string;
    syncDisabled?: boolean;
  }> => {
    if (!multiBranchConfig.enabled) {
      return {
        ok: false,
        syncDisabled: true,
        error: 'Multi-branch synchronization is OFF. Turn ON the sync switch to sync branches.',
      };
    }
    setIsSyncingBranches(true);
    try {
      const res = await syncAllBranchesNow(multiBranchConfig, branches);
      if (res.ok) {
        if (res.config) setMultiBranchConfig(res.config);
        if (res.branches) setBranches(res.branches);
        if (res.transfers) setBranchTransfers(res.transfers);
        if (res.activeSnapshotUpdated) {
          loadData();
        }
      }
      return {
        ok: res.ok,
        error: res.error,
        syncDisabled: res.syncDisabled,
      };
    } finally {
      setIsSyncingBranches(false);
    }
  }, [multiBranchConfig, branches]);

  const handleTransferBranchStock = async (params: {
    fromBranchId: string;
    toBranchId: string;
    productId: string;
    productName: string;
    pieces: number;
    note?: string;
  }): Promise<{ ok: boolean; error?: string; syncDisabled?: boolean }> => {
    const res = await transferStockBetweenBranches(
      {
        ...params,
        createdBy: activeStaff?.name || 'Store Owner',
      },
      multiBranchConfig,
      branches
    );
    if (res.ok) {
      if (res.branches) setBranches(res.branches);
      if (res.transfers) setBranchTransfers(res.transfers);
      if (
        params.fromBranchId === multiBranchConfig.activeBranchId ||
        params.toBranchId === multiBranchConfig.activeBranchId
      ) {
        setProducts(getStoredProducts());
      }
      appendSystemNotification({
        category: 'sync',
        severity: 'success',
        title: `Stock Transferred: ${params.pieces} pcs`,
        message: `${params.productName} moved across branches (${
          res.transfer?.transferNumber || 'Completed'
        }).`,
      });
    }
    return {
      ok: res.ok,
      error: res.error,
      syncDisabled: res.syncDisabled,
    };
  };

  // Periodic background branch sync ONLY when Multi-Branch Sync toggle is ON and not offline
  useEffect(() => {
    if (
      !multiBranchConfig.enabled ||
      !effectivePerformanceSettings.enableAutoCloudSync ||
      offlineSync.isEffectivelyOffline ||
      branches.length < 2
    ) {
      return;
    }
    const intervalMs = Math.max(15, multiBranchConfig.autoSyncIntervalSec || 30) * 1000;
    const timer = window.setInterval(() => {
      void handleSyncAllBranches();
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [
    multiBranchConfig.enabled,
    multiBranchConfig.autoSyncIntervalSec,
    effectivePerformanceSettings.enableAutoCloudSync,
    offlineSync.isEffectivelyOffline,
    branches.length,
    handleSyncAllBranches,
  ]);

  const handleUpdateAppLockSettings = (next: AppLockSettings) => {
    const wasEnabled = appLockSettings.enabled;
    saveAppLockSettings(next);
    setAppLockSettings(next);
    if (!next.enabled && isAppLocked) {
      setIsAppLocked(false);
    }
    if (wasEnabled !== next.enabled) {
      appendSystemNotification({
        category: 'system',
        severity: next.enabled ? 'success' : 'warning',
        title: next.enabled ? 'Master App Lock Enabled' : 'Master App Lock Disabled',
        message: next.enabled
          ? 'POS requires Biometric Fingerprint/Face ID or 4-digit Master PIN on launch.'
          : 'Launch authentication has been disabled in Store Settings.',
      });
    }
  };

  const handleLockAppNow = () => {
    if (!appLockSettings.enabled) return;
    setIsAppLocked(true);
  };

  const handleUnlockApp = (method: 'pin' | 'biometric', credentialId?: string) => {
    if (method === 'biometric' && credentialId) {
      const updatedCreds = appLockSettings.biometricCredentials.map(c =>
        c.credentialId === credentialId
          ? { ...c, lastUsedAt: new Date().toISOString() }
          : c
      );
      const nextSettings: AppLockSettings = {
        ...appLockSettings,
        biometricCredentials: updatedCreds,
        updatedAt: new Date().toISOString(),
      };
      saveAppLockSettings(nextSettings);
      setAppLockSettings(nextSettings);
    }
    setIsAppLocked(false);
  };

  const handleResetAppLockPin = (newPin: string, recoveryMethodSummary: string) => {
    const nextSettings: AppLockSettings = {
      ...appLockSettings,
      masterPin: newPin,
      updatedAt: new Date().toISOString(),
    };
    saveAppLockSettings(nextSettings);
    setAppLockSettings(nextSettings);
    setIsAppLocked(false);
    appendSystemNotification({
      category: 'system',
      severity: 'info',
      title: 'Master PIN Reset Completed',
      message: `4-digit Master PIN was reset via ${recoveryMethodSummary}.`,
    });
  };

  // Inactivity auto-lock timer when enabled and configured (> 0 minutes)
  useEffect(() => {
    if (
      isAppLocked ||
      !appLockSettings.enabled ||
      !appLockSettings.autoLockMinutes ||
      appLockSettings.autoLockMinutes <= 0
    ) {
      return;
    }

    let idleTimer: number | undefined;
    const timeoutMs = appLockSettings.autoLockMinutes * 60 * 1000;

    const resetIdleTimer = () => {
      if (idleTimer !== undefined) {
        window.clearTimeout(idleTimer);
      }
      idleTimer = window.setTimeout(() => {
        setIsAppLocked(true);
      }, timeoutMs);
    };

    resetIdleTimer();
    const events: Array<keyof WindowEventMap> = [
      'pointerdown',
      'keydown',
      'touchstart',
      'scroll',
    ];
    events.forEach(evt => window.addEventListener(evt, resetIdleTimer, { passive: true }));

    return () => {
      if (idleTimer !== undefined) window.clearTimeout(idleTimer);
      events.forEach(evt => window.removeEventListener(evt, resetIdleTimer));
    };
  }, [isAppLocked, appLockSettings.enabled, appLockSettings.autoLockMinutes]);

  const handleUpdateWhatsappConfig = (nextConfig: WhatsAppAutomationConfig) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      whatsappConfig: nextConfig,
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    fetch('/api/whatsapp/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: nextConfig }),
    }).catch(() => {});

    appendSystemNotification({
      category: 'whatsapp',
      severity: nextConfig.enabled ? 'success' : 'warning',
      title: nextConfig.enabled
        ? 'WhatsApp Automation Enabled'
        : 'WhatsApp Automation Paused',
      message: nextConfig.enabled
        ? 'Inbound WhatsApp orders and inquiries will sync with POS and stock levels.'
        : 'WhatsApp integration is disabled in Settings; webhook auto-processing is paused.',
    });

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `WhatsApp Settings · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const handleUpdateExternalApiConfig = (nextConfig: ExternalApiConfig) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      externalApiConfig: nextConfig,
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    fetch('/api/external-api/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ config: nextConfig }),
    })
      .then(() => offlineSync.refreshServerStatus())
      .catch(() => {});

    appendSystemNotification({
      category: 'system',
      severity: nextConfig.enabled ? 'success' : 'warning',
      title: nextConfig.enabled
        ? 'External Integration API Enabled'
        : 'External Integration API Disabled',
      message: nextConfig.enabled
        ? 'REST v1 endpoints (/api/v1/*) are active for external catalog, stock, and order sync.'
        : 'External app integration is disabled in Settings; /api/v1/* requests will return 403.',
    });

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `External API Settings · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const handleUpdatePerformanceSettings = (nextPerf: PerformanceSettings) => {
    const updatedProfile: StoreProfile = {
      ...storeProfile,
      performanceSettings: nextPerf,
      updatedAt: new Date().toISOString(),
    };
    saveStoreProfile(updatedProfile);
    setStoreProfile(updatedProfile);

    const activeCount = [
      nextPerf.enablePredictiveAnalytics,
      nextPerf.enableAutoCloudSync,
      nextPerf.enableLiveReceiptRendering,
    ].filter(Boolean).length;

    appendSystemNotification({
      category: 'system',
      severity: activeCount === 3 ? 'success' : 'info',
      title: 'Performance Profile Updated',
      message: `${activeCount}/3 engines active · Predictive ${
        nextPerf.enablePredictiveAnalytics ? 'On' : 'Paused'
      }, Auto-Sync ${
        nextPerf.enableAutoCloudSync ? 'On' : 'Paused'
      }, Live Receipt ${
        nextPerf.enableLiveReceiptRendering ? 'On' : 'Paused'
      }.`,
    });

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'store_profile',
      entityId: 'store_profile_v1',
      label: `Performance Settings · ${updatedProfile.storeName}`,
      payload: { storeProfile: updatedProfile },
    });
  };

  const persistWhatsappMessagesList = (nextList: WhatsAppInboundMessage[]) => {
    setWhatsappMessages(nextList);
    saveWhatsAppMessages(nextList);
    fetch('/api/whatsapp/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ messages: nextList }),
    }).catch(() => {});
  };

  const handleConfirmAndBillWhatsAppOrder = (
    messageId: string,
    paymentMode: 'cash' | 'credit',
    deductStock: boolean,
    explicitMsg?: WhatsAppInboundMessage
  ) => {
    const targetMsg = explicitMsg || whatsappMessages.find(m => m.id === messageId);
    if (!targetMsg) return;

    const matchedCust =
      (targetMsg.customerId ? customers.find(c => c.id === targetMsg.customerId) : null) ||
      findCustomerByPhone(customers, targetMsg.senderPhone);

    const evaluatedItems = evaluateWhatsAppItemsAgainstInventory(
      targetMsg.parsedItems,
      products,
      matchedCust
    ).filter(i => i.matchedProductId !== 'UNMATCHED');

    if (evaluatedItems.length === 0) return;

    const { bill, updatedCustomer } = buildBillFromWhatsAppMessage({
      message: targetMsg,
      items: evaluatedItems,
      customer: matchedCust,
      products,
      receiptSettings,
      paymentMode,
      staff: activeStaff,
    });

    const billWithSyncMeta: Bill = {
      ...bill,
      syncStatus: 'pending_offline',
      offlineCreated: offlineSync.isEffectivelyOffline,
    };

    let updatedProductsAfterDeduction: Product[] | undefined;
    if (deductStock) {
      const prevStockById = new Map(products.map(p => [p.id, p.stockPieces]));
      const updatedProducts = deductProductStock(
        billWithSyncMeta.items.map(i => ({
          productId: i.productId,
          totalPieces: i.totalPieces,
        }))
      );
      setProducts(updatedProducts);
      const itemIdSet = new Set(billWithSyncMeta.items.map(i => i.productId));
      updatedProductsAfterDeduction = updatedProducts.filter(p => itemIdSet.has(p.id));

      if (showLowStockAlerts) {
        updatedProducts.forEach(prod => {
          const prevStock = prevStockById.get(prod.id);
          if (
            prevStock !== undefined &&
            prevStock > prod.lowStockThreshold &&
            prod.stockPieces <= prod.lowStockThreshold
          ) {
            appendSystemNotification({
              category: 'low_stock',
              severity: prod.stockPieces <= 0 ? 'critical' : 'warning',
              title: `Low Stock (WhatsApp Order): ${prod.name}`,
              message: `Stock dropped to ${prod.stockPieces} pcs after WhatsApp Bill #${billWithSyncMeta.billNumber}.`,
              meta: { productId: prod.id },
            });
          }
        });
      }
    }

    const updatedBills = [billWithSyncMeta, ...getStoredBills()];
    saveBills(updatedBills);
    setBills(updatedBills);

    if (updatedCustomer) {
      const updatedCustomers = getStoredCustomers().map(c =>
        c.id === updatedCustomer.id ? updatedCustomer : c
      );
      saveCustomers(updatedCustomers);
      setCustomers(updatedCustomers);
    }

    void offlineSync.enqueueAndSyncIfOnline({
      entityType: 'bill',
      entityId: billWithSyncMeta.id,
      label: `WhatsApp Bill #${billWithSyncMeta.billNumber} · ${billWithSyncMeta.customerName}`,
      amount: billWithSyncMeta.grandTotal,
      billRecord: billWithSyncMeta,
      payload: {
        bill: billWithSyncMeta,
        updatedCustomer,
        updatedProducts: updatedProductsAfterDeduction,
      },
    });

    const totalPcsSold = billWithSyncMeta.items.reduce((sum, i) => sum + i.totalPieces, 0);
    recordStaffActivity({
      domain: 'sales',
      action: 'WHATSAPP_ORDER_BILLED',
      targetLabel: `#${billWithSyncMeta.billNumber} · ${billWithSyncMeta.customerName}`,
      details: `WhatsApp order confirmed · ${billWithSyncMeta.items.length} SKU(s), ${totalPcsSold} pcs${
        deductStock ? ' (stock auto-deducted)' : ''
      }`,
      amount: billWithSyncMeta.itemsTotal + (billWithSyncMeta.totalGstAmount || 0),
      quantityDelta: deductStock ? -totalPcsSold : undefined,
      billId: billWithSyncMeta.id,
    });

    appendSystemNotification({
      category: 'whatsapp',
      severity: 'success',
      title: `WhatsApp Order Billed: #${billWithSyncMeta.billNumber}`,
      message: `${billWithSyncMeta.customerName} · ${formatCurrency(
        billWithSyncMeta.itemsTotal + (billWithSyncMeta.totalGstAmount || 0)
      )} (${totalPcsSold} pcs ${deductStock ? 'deducted from stock' : 'queued'})`,
      meta: { whatsappMessageId: targetMsg.id, customerId: matchedCust?.id },
    });

    const nowIso = new Date().toISOString();
    const nextList = whatsappMessages.some(m => m.id === targetMsg.id)
      ? whatsappMessages.map(m =>
          m.id === targetMsg.id
            ? {
                ...m,
                parsedItems: evaluatedItems,
                status: explicitMsg ? ('auto_processed' as const) : ('billed' as const),
                linkedBillId: billWithSyncMeta.id,
                linkedBillNumber: billWithSyncMeta.billNumber,
                stockUpdated: deductStock,
                stockUpdatedAt: deductStock ? nowIso : undefined,
                processingNote: `POS Bill #${billWithSyncMeta.billNumber} created (${
                  paymentMode === 'credit' ? 'Khata Udhar' : 'Cash Paid'
                })${deductStock ? ' · Stock updated' : ''}.`,
              }
            : m
        )
      : [
          {
            ...targetMsg,
            parsedItems: evaluatedItems,
            status: 'auto_processed' as const,
            linkedBillId: billWithSyncMeta.id,
            linkedBillNumber: billWithSyncMeta.billNumber,
            stockUpdated: deductStock,
            stockUpdatedAt: deductStock ? nowIso : undefined,
            processingNote: `Auto-billed #${billWithSyncMeta.billNumber} & stock deducted.`,
          },
          ...whatsappMessages,
        ];

    persistWhatsappMessagesList(nextList);

    if (!explicitMsg) {
      soundManager.vibrateSaleCompleted();
      setActiveReceiptBill(billWithSyncMeta);
    }
  };

  const handleSendWhatsAppReply = async (
    messageId: string,
    replyText: string,
    explicitMsg?: WhatsAppInboundMessage
  ): Promise<{ deliveryMode: string; whatsappWebUrl: string } | null> => {
    const targetMsg = explicitMsg || whatsappMessages.find(m => m.id === messageId);
    if (!targetMsg) return null;

    let deliveryMode = 'whatsapp_web';
    let whatsappWebUrl = buildWhatsAppWebUrl(targetMsg.senderPhone, replyText);

    try {
      const res = await fetch('/api/whatsapp/send-reply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageId: targetMsg.id,
          recipientPhone: targetMsg.senderPhone,
          replyText,
        }),
      });
      if (res.ok) {
        const data = await res.json();
        deliveryMode = data.deliveryMode || deliveryMode;
        whatsappWebUrl = data.whatsappWebUrl || whatsappWebUrl;
      }
    } catch {
      // Offline / local fallback already handled by whatsappWebUrl
    }

    const nowIso = new Date().toISOString();
    const nextList = whatsappMessages.map(m =>
      m.id === targetMsg.id
        ? {
            ...m,
            replyText,
            repliedAt: nowIso,
            replyDeliveryMode: deliveryMode as WhatsAppInboundMessage['replyDeliveryMode'],
            status:
              m.status === 'pending_review' && (m.intent === 'inquiry' || m.intent === 'other' || m.intent === 'payment')
                ? ('replied' as const)
                : m.status,
          }
        : m
    );
    persistWhatsappMessagesList(nextList);

    recordStaffActivity({
      domain: 'sales',
      action: 'WHATSAPP_REPLY_SENT',
      targetLabel: targetMsg.senderName,
      details: `Dispatched WhatsApp ${targetMsg.intent} reply (${deliveryMode})`,
    });

    return { deliveryMode, whatsappWebUrl };
  };

  const handleReceiveInboundWhatsAppMessage = async (params: {
    senderName: string;
    senderPhone: string;
    messageText: string;
    source: 'simulator' | 'manual';
  }): Promise<WhatsAppInboundMessage | null> => {
    if (!effectiveWhatsappConfig.enabled) {
      return null;
    }

    let parsedMsg: WhatsAppInboundMessage | null = null;
    try {
      const res = await fetch('/api/whatsapp/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...params,
          products,
          customers,
          storeName: storeProfile.storeName,
          saveToInbox: false,
        }),
      });
      if (res.ok) {
        const json = await res.json();
        if (json?.message) {
          parsedMsg = json.message as WhatsAppInboundMessage;
        }
      }
    } catch {
      // Use deterministic local parser fallback
    }

    if (!parsedMsg) {
      parsedMsg = parseWhatsAppMessageLocally({
        ...params,
        products,
        customers,
        storeName: storeProfile.storeName,
      });
    }

    const matchedCust = findCustomerByPhone(customers, parsedMsg.senderPhone);
    const liveItems = evaluateWhatsAppItemsAgainstInventory(
      parsedMsg.parsedItems,
      products,
      matchedCust
    );
    const liveTotal =
      Math.round(liveItems.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
    const allStockAvailable =
      liveItems.length > 0 && liveItems.every(i => i.stockSufficient);

    const enrichedMsg: WhatsAppInboundMessage = {
      ...parsedMsg,
      customerId: matchedCust?.id,
      senderName: matchedCust?.name || parsedMsg.senderName,
      parsedItems: liveItems,
      estimatedTotal: liveTotal,
      suggestedReply: buildAutoReplyForMessage({
        intent: parsedMsg.intent,
        senderName: parsedMsg.senderName,
        parsedItems: liveItems,
        customer: matchedCust,
        products,
        storeName: storeProfile.storeName,
        messageText: parsedMsg.messageText,
      }),
      status:
        parsedMsg.intent === 'order' && liveItems.length > 0 && !allStockAvailable
          ? 'insufficient_stock'
          : 'pending_review',
    };

    const nextList = [enrichedMsg, ...whatsappMessages];
    persistWhatsappMessagesList(nextList);

    appendSystemNotification({
      category: 'whatsapp',
      severity:
        enrichedMsg.status === 'insufficient_stock' ? 'warning' : 'info',
      title: `WhatsApp ${
        enrichedMsg.intent === 'order'
          ? 'Order Received'
          : enrichedMsg.intent === 'inquiry'
          ? 'Customer Inquiry'
          : 'Message'
      }: ${enrichedMsg.senderName}`,
      message:
        enrichedMsg.status === 'insufficient_stock'
          ? `Order received for ${liveItems.length} item(s), but some SKUs have insufficient stock.`
          : enrichedMsg.messageText.slice(0, 120),
      meta: { whatsappMessageId: enrichedMsg.id, customerId: matchedCust?.id },
    });

    // Automated Order Fulfillment & Stock Sync when autoConfirmOrders is ON
    if (
      effectiveWhatsappConfig.autoConfirmOrders &&
      enrichedMsg.intent === 'order' &&
      liveItems.length > 0 &&
      allStockAvailable
    ) {
      handleConfirmAndBillWhatsAppOrder(
        enrichedMsg.id,
        effectiveWhatsappConfig.defaultOrderPaymentMode || 'credit',
        effectiveWhatsappConfig.autoDeductStock !== false,
        enrichedMsg
      );
    } else if (
      effectiveWhatsappConfig.autoReplyInquiries &&
      enrichedMsg.intent === 'inquiry'
    ) {
      void handleSendWhatsAppReply(
        enrichedMsg.id,
        enrichedMsg.suggestedReply,
        enrichedMsg
      );
    }

    return enrichedMsg;
  };

  const handleUpdateWhatsAppMessageItems = (
    messageId: string,
    items: WhatsAppParsedItem[]
  ) => {
    const nextTotal =
      Math.round(items.reduce((sum, i) => sum + i.lineTotal, 0) * 100) / 100;
    const allInStock = items.length > 0 && items.every(i => i.stockSufficient);
    const nextList = whatsappMessages.map(m =>
      m.id === messageId
        ? {
            ...m,
            parsedItems: items,
            estimatedTotal: nextTotal,
            status:
              m.status === 'pending_review' || m.status === 'insufficient_stock'
                ? allInStock
                  ? ('pending_review' as const)
                  : ('insufficient_stock' as const)
                : m.status,
          }
        : m
    );
    persistWhatsappMessagesList(nextList);
  };

  const handleLoadWhatsAppOrderToCart = (messageId: string) => {
    const msg = whatsappMessages.find(m => m.id === messageId);
    if (!msg) return;
    const matchedCust =
      (msg.customerId ? customers.find(c => c.id === msg.customerId) : null) ||
      findCustomerByPhone(customers, msg.senderPhone);
    if (matchedCust) {
      setActiveBillingCustomerId(matchedCust.id);
    }
    const cartItems: CartItem[] = msg.parsedItems
      .filter(i => i.matchedProductId !== 'UNMATCHED')
      .map(i => ({
        productId: i.matchedProductId,
        productName: i.matchedProductName,
        unit: i.unit,
        bundleUnitName: i.bundleUnitName,
        bundlePieces: i.bundlePieces,
        quantity: i.quantity,
        unitPrice: i.unitPrice,
        defaultUnitPrice: i.unitPrice,
        isPriceOverridden: false,
        totalPieces: i.totalPieces,
        itemTotal: i.lineTotal,
      }));
    if (cartItems.length > 0) {
      soundManager.vibrateItemAdded();
      setCart(cartItems);
      setActiveTab('billing');
      setIsCartOpen(true);
    }
  };

  const handleIgnoreWhatsAppMessage = (messageId: string) => {
    const nextList = whatsappMessages.map(m =>
      m.id === messageId ? { ...m, status: 'ignored' as const } : m
    );
    persistWhatsappMessagesList(nextList);
  };

  const handleDeleteWhatsAppMessage = (messageId: string) => {
    const nextList = whatsappMessages.filter(m => m.id !== messageId);
    persistWhatsappMessagesList(nextList);
  };

  if (isAppLocked && appLockSettings.enabled) {
    return (
      <AppLockScreen
        settings={appLockSettings}
        storeProfile={storeProfile}
        activeBranch={activeBranch}
        onUnlock={handleUnlockApp}
        onResetPin={handleResetAppLockPin}
      />
    );
  }

  return (
    <div
      data-layout={resolvedLayout}
      data-layout-pref={layoutPref}
      className="app-root-viewport h-screen w-full max-w-none m-0 overflow-hidden bg-slate-950 text-slate-100 font-sans flex"
    >
      <div
        className="app-main-container flex flex-col h-full w-full max-w-none m-0 overflow-hidden bg-slate-950"
      >
      
      {/* Mobile-first POS Top Header & Module Navigation Bar */}
      <Header
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        cartCount={cartCount}
        cartTotal={cartTotal}
        lowStockCount={lowStockCount}
        pendingPoAlertCount={pendingPoAlertCount}
        pendingWhatsappCount={pendingWhatsappCount}
        onOpenCart={() => setIsCartOpen(true)}
        onOpenApkGuide={() => setIsApkGuideOpen(true)}
        onOpenReceiptSettings={() => setIsReceiptSettingsOpen(true)}
        onOpenScanBill={() => {
          setScanBillInitialMode('invoice');
          setIsScanBillOpen(true);
        }}
        onOpenAudioTranscribe={() => {
          setAudioTranscribeInitialMode(activeTab === 'inventory' ? 'restock' : 'cart');
          setIsAudioTranscribeOpen(true);
        }}
        onOpenLiveVoice={() => setIsLiveVoiceOpen(true)}
        onOpenOfflineSync={() => setIsOfflineSyncOpen(true)}
        onOpenNotifications={() => setIsNotificationCenterOpen(true)}
        unreadAlertCount={unreadAlertCount}
        isOffline={offlineSync.isEffectivelyOffline}
        isSyncing={offlineSync.isSyncing}
        pendingSyncCount={offlineSync.pendingCount + offlineSync.failedCount}
        storeProfile={storeProfile}
        activeStaff={activeStaff}
        onOpenOperatorSwitcher={() => setIsOperatorSwitcherOpen(true)}
        rbacAllowedTabs={rbacAllowedTabs}
        activeBranch={activeBranch}
        multiBranchSyncEnabled={multiBranchConfig.enabled}
        branchCount={branches.length}
        onOpenMultiStore={() => setIsMultiStoreOpen(true)}
        appLockEnabled={appLockSettings.enabled}
        onLockApp={handleLockAppNow}
      />

      {/* Main View Area */}
      <main className="flex-1 overflow-hidden relative">
        {!rbacAllowedTabs[activeTab] ? (
          <div className="h-full w-full flex items-center justify-center p-6 bg-slate-950">
            <div className="max-w-md w-full p-6 rounded-2xl bg-slate-900 border border-slate-800 text-center space-y-3">
              <div className="w-11 h-11 rounded-xl bg-amber-500/15 border border-amber-500/30 text-amber-400 flex items-center justify-center mx-auto">
                <Lock className="w-5 h-5" />
              </div>
              <h3 className="text-base font-bold text-white">Module Access Restricted</h3>
              <p className="text-xs text-slate-400">
                Active operator <strong>{activeStaff?.name}</strong> ({activeStaff?.role}) does not
                have permission for this module under current RBAC rules.
              </p>
              <div className="flex items-center justify-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsOperatorSwitcherOpen(true)}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                >
                  Switch Operator
                </button>
                <button
                  type="button"
                  onClick={() => setActiveTab(getFirstPermittedTab())}
                  className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
                >
                  Go to Allowed Module
                </button>
              </div>
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'billing' && (
              <ProductGrid
                products={products}
                cart={cart}
                onAddToCart={handleAddToCart}
                onUpdateQuantity={handleUpdateQuantity}
                onOpenNewProductModal={() => {
                  setProductToEdit(null);
                  setPrefillProductBarcode('');
                  setPrefillProductDraft(null);
                  setIsProductModalOpen(true);
                }}
                onCreateProductWithBarcode={barcode => {
                  setProductToEdit(null);
                  setPrefillProductBarcode(barcode);
                  setPrefillProductDraft(null);
                  setIsProductModalOpen(true);
                }}
                onOpenCart={() => setIsCartOpen(true)}
                onExpressCashCheckout={handleExpressCashCheckout}
                isExternalModalOpen={
                  isCartOpen ||
                  isProductModalOpen ||
                  isReceiptSettingsOpen ||
                  isScanBillOpen ||
                  isAudioTranscribeOpen ||
                  isLiveVoiceOpen ||
                  isOfflineSyncOpen ||
                  isNotificationCenterOpen ||
                  isOperatorSwitcherOpen ||
                  isMultiStoreOpen ||
                  isApkGuideOpen ||
                  Boolean(activeReceiptBill)
                }
                customers={customers}
                selectedCustomerId={activeBillingCustomerId}
                onSelectCustomer={setActiveBillingCustomerId}
                onAddNewCustomer={(name, phone) => handleAddNewCustomer(name, phone)}
                activeCustomer={activeBillingCustomer}
                favoriteProductIds={favoriteProductIds}
                onToggleFavorite={handleToggleFavorite}
                onOrderPurchaseOrder={productId => {
                  setPoPrefillProductId(productId);
                  setActiveTab('suppliers');
                }}
                onOpenAudioTranscribe={() => {
                  setAudioTranscribeInitialMode('cart');
                  setIsAudioTranscribeOpen(true);
                }}
                posUiVisibility={storeProfile.posUiVisibility}
              />
            )}

            {activeTab === 'khata' && (
              <CustomerKhata
                customers={customers}
                bills={bills}
                khata={khata}
                onAddNewCustomer={handleAddNewCustomer}
                onRecordPayment={handleRecordPayment}
                onUpdateCustomerCreditProfile={handleUpdateCustomerCreditProfile}
                onSelectCustomerForBilling={cust => {
                  setActiveBillingCustomerId(cust.id);
                  setActiveTab('billing');
                }}
                onOpenCustomerRewards={custId => {
                  setFocusLoyaltyCustomerId(custId);
                  setActiveTab('staff_loyalty');
                }}
                onViewBillDetails={bill => setActiveReceiptBill(bill)}
                focusCustomerId={focusKhataCustomerId}
                onClearFocusCustomer={() => setFocusKhataCustomerId(null)}
              />
            )}

            {activeTab === 'inventory' && (
              <InventoryManager
                products={products}
                categories={categories}
                onSaveProduct={handleSaveProduct}
                onDeleteProduct={handleDeleteProduct}
                onRestockProduct={handleRestockProduct}
                onAddCategory={handleAddCategory}
                onRenameCategory={handleRenameCategory}
                onDeleteCategory={handleDeleteCategory}
                onOpenNewProductModal={() => {
                  setProductToEdit(null);
                  setPrefillProductBarcode('');
                  setPrefillProductDraft(null);
                  setIsProductModalOpen(true);
                }}
                onEditProduct={prod => {
                  setProductToEdit(prod);
                  setPrefillProductBarcode('');
                  setPrefillProductDraft(null);
                  setIsProductModalOpen(true);
                }}
                onOpenScanBillModal={() => {
                  setScanBillInitialMode('restock');
                  setIsScanBillOpen(true);
                }}
                onOpenAudioTranscribe={() => {
                  setAudioTranscribeInitialMode('restock');
                  setIsAudioTranscribeOpen(true);
                }}
                onOrderPurchaseOrder={productId => {
                  setPoPrefillProductId(productId);
                  setActiveTab('suppliers');
                }}
                showLowStockBanner={storeProfile.posUiVisibility?.lowStockAlertBanner !== false}
                canManageCategories={canStaffPerform(activeStaff, rolePermissions, 'categories')}
                canDeleteProducts={canStaffPerform(activeStaff, rolePermissions, 'delete_records')}
              />
            )}

            {activeTab === 'suppliers' && (
              <SupplierManager
                products={products}
                suppliers={suppliers}
                purchaseOrders={purchaseOrders}
                managedCategories={categories}
                onSaveSupplier={handleSaveSupplier}
                onDeleteSupplier={handleDeleteSupplier}
                onSavePurchaseOrder={handleSavePurchaseOrder}
                onReceivePurchaseOrder={handleReceivePurchaseOrder}
                onUpdatePoStatus={handleUpdatePoStatus}
                onRecordPoPayment={handleRecordPoPayment}
                prefillProductId={poPrefillProductId}
                onClearPrefill={() => setPoPrefillProductId(null)}
              />
            )}

            {activeTab === 'cashflow' && (
              <CashFlowManager
                bills={bills}
                khata={khata}
                suppliers={suppliers}
                purchaseOrders={purchaseOrders}
                cashFlowEntries={cashFlowEntries}
                openingCashMap={openingCashMap}
                onSetOpeningCash={handleSetOpeningCash}
                onAddCashFlowEntry={handleAddCashFlowEntry}
                onAddCashFlowEntries={handleAddCashFlowEntries}
                onDeleteCashFlowEntry={handleDeleteCashFlowEntry}
                onPaySupplierFromCashFlow={handlePaySupplierFromCashFlow}
                onViewBillReceipt={bill => setActiveReceiptBill(bill)}
              />
            )}

            {activeTab === 'reports' && (
              <DailyReports
                bills={bills}
                khata={khata}
                products={products}
                onViewBillReceipt={bill => setActiveReceiptBill(bill)}
                onRestockProduct={handleRestockProduct}
                onSeedSampleHistory={handleSeedSampleHistory}
                enablePredictiveAnalytics={effectivePerformanceSettings.enablePredictiveAnalytics}
                onOpenPerformanceSettings={() => setActiveTab('store_profile')}
              />
            )}

            {activeTab === 'staff_loyalty' && (
              <StaffAndLoyaltyManager
                customers={customers}
                products={products}
                bills={bills}
                loyaltyTransactions={loyaltyTransactions}
                staffMembers={staffMembers}
                attendanceRecords={attendanceRecords}
                rolePermissions={rolePermissions}
                activeStaff={activeStaff}
                activityLogs={staffActivityLogs}
                onSaveCustomerPricing={handleSaveCustomerPricing}
                onClaimMilestone={handleClaimMilestone}
                onAdjustLoyaltyPoints={handleAdjustLoyaltyPoints}
                onSaveStaffMember={handleSaveStaffMember}
                onDeleteStaffMember={handleDeleteStaffMember}
                onClockInStaff={handleClockInStaff}
                onClockOutStaff={handleClockOutStaff}
                onPostWagesToCashFlow={handlePostWagesToCashFlow}
                onUpdateRolePermission={handleUpdateRolePermission}
                onResetRolePermissions={handleResetRolePermissions}
                onOpenOperatorSwitcher={() => setIsOperatorSwitcherOpen(true)}
                onViewBillReceipt={bill => setActiveReceiptBill(bill)}
                focusCustomerId={focusLoyaltyCustomerId}
                onClearFocusCustomer={() => setFocusLoyaltyCustomerId(null)}
              />
            )}

            {activeTab === 'whatsapp' && (
              <WhatsAppAutomationPanel
                messages={whatsappMessages}
                config={effectiveWhatsappConfig}
                products={products}
                customers={customers}
                bills={bills}
                receiptSettings={receiptSettings}
                storeName={storeProfile.storeName}
                hasServerAccessToken={hasServerWhatsappToken}
                isSyncingServer={isSyncingWhatsappServer}
                onToggleEnabled={enabled =>
                  handleUpdateWhatsappConfig({
                    ...effectiveWhatsappConfig,
                    enabled,
                  })
                }
                onOpenSettings={() => setActiveTab('store_profile')}
                onRefreshFromServer={() => void syncWhatsappWithServer()}
                onReceiveInboundMessage={handleReceiveInboundWhatsAppMessage}
                onUpdateMessageItems={handleUpdateWhatsAppMessageItems}
                onConfirmAndBillOrder={(msgId, mode, deduct) =>
                  handleConfirmAndBillWhatsAppOrder(msgId, mode, deduct)
                }
                onSendReply={(msgId, text) => handleSendWhatsAppReply(msgId, text)}
                onLoadOrderToCart={handleLoadWhatsAppOrderToCart}
                onIgnoreMessage={handleIgnoreWhatsAppMessage}
                onDeleteMessage={handleDeleteWhatsAppMessage}
                onAddNewCustomer={(name, phone) => handleAddNewCustomer(name, phone)}
                onViewBillReceipt={bill => setActiveReceiptBill(bill)}
              />
            )}

            {activeTab === 'store_profile' && (
              <StoreProfileSettings
                profile={storeProfile}
                onSaveProfile={handleSaveStoreProfile}
                onUpdateEnabledModules={handleUpdateEnabledModules}
                onUpdatePosUiVisibility={handleUpdatePosUiVisibility}
                onUpdateHeaderIconVisibility={handleUpdateHeaderIconVisibility}
                onToggleHeaderBranding={handleToggleHeaderBranding}
                onUpdateWhatsappConfig={handleUpdateWhatsappConfig}
                onUpdateExternalApiConfig={handleUpdateExternalApiConfig}
                onUpdatePerformanceSettings={handleUpdatePerformanceSettings}
                onOpenWhatsappInbox={() => setActiveTab('whatsapp')}
                onOpenReceiptSettings={() => setIsReceiptSettingsOpen(true)}
                onOpenApkGuide={() => setIsApkGuideOpen(true)}
                receiptSettings={receiptSettings}
                onSaveReceiptSettings={handleUpdateReceiptSettings}
                hasServerWhatsappToken={hasServerWhatsappToken}
                serverStatus={offlineSync.serverStatus}
                isSyncingServer={offlineSync.isSyncing}
                onPushFullSnapshot={offlineSync.pushFullBackup}
                onPullServerSnapshot={offlineSync.pullServerBackup}
                localCounts={{
                  products: products.length,
                  customers: customers.length,
                  orders: bills.length,
                }}
                branches={branches}
                multiBranchConfig={multiBranchConfig}
                branchTransfers={branchTransfers}
                products={products}
                isSyncingBranches={isSyncingBranches}
                onToggleMultiBranchSync={handleToggleMultiBranchSync}
                onUpdateMultiBranchConfig={handleUpdateMultiBranchConfig}
                onSwitchBranch={handleSwitchBranch}
                onSaveBranch={handleSaveBranch}
                onDeleteBranch={handleDeleteBranch}
                onSyncAllBranches={handleSyncAllBranches}
                onTransferBranchStock={handleTransferBranchStock}
                appLockSettings={appLockSettings}
                onUpdateAppLockSettings={handleUpdateAppLockSettings}
                onLockAppNow={handleLockAppNow}
              />
            )}

            {activeTab === 'billing' && !isCartOpen && (
              <FloatingCartBar
                cart={cart}
                activeCustomer={activeBillingCustomer}
                onOpenCart={() => setIsCartOpen(true)}
                onClearCart={handleClearCart}
                onExpressCashCheckout={handleExpressCashCheckout}
              />
            )}
          </>
        )}
      </main>

      {/* Cart Drawer */}
      <CartDrawer
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        cart={cart}
        products={products}
        customers={customers}
        selectedCustomerId={activeBillingCustomerId}
        onSelectCustomerId={setActiveBillingCustomerId}
        onUpdateQuantity={handleUpdateQuantity}
        onAddProductByScan={(prod, unit, qty) => handleAddToCart(prod, unit, qty)}
        onUpdateItemPrice={handleUpdateItemPrice}
        onToggleUnit={handleToggleUnit}
        onRemoveItem={handleRemoveCartItem}
        onClearCart={handleClearCart}
        onCompleteBill={handleCompleteBill}
        onAddNewCustomer={(name, phone) => handleAddNewCustomer(name, phone)}
        staffMembers={staffMembers}
        activeStaff={activeStaff}
      />

      {/* Strict Receipt Modal */}
      {activeReceiptBill && (
        <ReceiptModal
          bill={activeReceiptBill}
          onClose={() => setActiveReceiptBill(null)}
          onOpenSettings={() => setIsReceiptSettingsOpen(true)}
          storeProfile={storeProfile}
          receiptSettings={receiptSettings}
          enableLiveReceiptRendering={effectivePerformanceSettings.enableLiveReceiptRendering}
          onUpdateReceiptSettings={handleUpdateReceiptSettings}
        />
      )}

      {/* Android .APK Guide Modal */}
      <ApkGuideModal
        isOpen={isApkGuideOpen}
        onClose={() => setIsApkGuideOpen(false)}
        onDataRefreshed={loadData}
      />

      {/* Add / Edit Product Modal */}
      <ProductModal
        isOpen={isProductModalOpen}
        onClose={() => {
          setIsProductModalOpen(false);
          setProductToEdit(null);
          setPrefillProductBarcode('');
          setPrefillProductDraft(null);
        }}
        onSaveProduct={handleSaveProduct}
        productToEdit={productToEdit}
        categories={categories}
        products={products}
        initialBarcode={prefillProductBarcode || undefined}
        initialDraft={prefillProductDraft || undefined}
        onAddCategory={handleAddCategory}
      />

      {/* Receipt Settings Modal */}
      <ReceiptSettingsModal
        isOpen={isReceiptSettingsOpen}
        onClose={() => setIsReceiptSettingsOpen(false)}
        settings={receiptSettings}
        onSaveSettings={handleUpdateReceiptSettings}
        storeProfile={storeProfile}
        onOpenStoreProfile={() => {
          setIsReceiptSettingsOpen(false);
          setActiveTab('store_profile');
        }}
        whatsappAutomationEnabled={effectiveWhatsappConfig.enabled}
        onToggleWhatsappAutomation={enabled =>
          handleUpdateWhatsappConfig({
            ...effectiveWhatsappConfig,
            enabled,
          })
        }
        showHeaderBranding={storeProfile.showBrandingInHeader !== false}
        onToggleHeaderBranding={handleToggleHeaderBranding}
        performanceSettings={effectivePerformanceSettings}
        onUpdatePerformanceSettings={handleUpdatePerformanceSettings}
      />

      {/* OCR Bill Scanner Modal */}
      <ScanBillModal
        isOpen={isScanBillOpen}
        onClose={() => setIsScanBillOpen(false)}
        products={products}
        customers={customers}
        receiptSettings={receiptSettings}
        initialMode={scanBillInitialMode}
        onApplyStockUpdate={handleApplyOcrStockUpdate}
        onGenerateDigitalInvoice={handleGenerateDigitalInvoiceFromOcr}
        onLoadItemsToCart={handleLoadOcrItemsToCart}
        onAddNewCustomer={(name, phone) => handleAddNewCustomer(name, phone)}
      />

      {/* Gemini 3.5 Audio Transcribe & Item List Modal */}
      <AudioTranscribeModal
        isOpen={isAudioTranscribeOpen}
        onClose={() => setIsAudioTranscribeOpen(false)}
        products={products}
        initialMode={audioTranscribeInitialMode}
        onLoadItemsToCart={handleLoadOcrItemsToCart}
        onApplyStockUpdate={handleApplyOcrStockUpdate}
        onCreateProductFromAudioItem={draft => {
          setProductToEdit(null);
          setPrefillProductBarcode('');
          setPrefillProductDraft(draft);
          setIsProductModalOpen(true);
        }}
      />

      {/* Gemini 3.8 Live Real-Time Voice Conversation Modal */}
      <LiveVoiceModal
        isOpen={isLiveVoiceOpen}
        onClose={() => setIsLiveVoiceOpen(false)}
        storeProfile={storeProfile}
        products={products}
        customers={customers}
        bills={bills}
      />

      {/* Offline Mode & Background Synchronization Modal */}
      <OfflineSyncModal
        isOpen={isOfflineSyncOpen}
        onClose={() => setIsOfflineSyncOpen(false)}
        isBrowserOnline={offlineSync.isBrowserOnline}
        forceOfflineMode={offlineSync.forceOfflineMode}
        autoSyncOnReconnect={offlineSync.autoSyncOnReconnect}
        isEffectivelyOffline={offlineSync.isEffectivelyOffline}
        swOfflineReady={offlineSync.swOfflineReady}
        isSyncing={offlineSync.isSyncing}
        syncQueue={offlineSync.syncQueue}
        pendingCount={offlineSync.pendingCount}
        failedCount={offlineSync.failedCount}
        syncedCount={offlineSync.syncedCount}
        pendingBillsCount={offlineSync.pendingBillsCount}
        indexedDbBillCount={offlineSync.indexedDbBillCount}
        indexedDbProductCount={offlineSync.indexedDbProductCount}
        persistentStorageGranted={offlineSync.persistentStorageGranted}
        serverStatus={offlineSync.serverStatus}
        lastSuccessfulSyncAt={offlineSync.lastSuccessfulSyncAt}
        onToggleForceOffline={() => void offlineSync.toggleForceOfflineMode()}
        onToggleAutoSync={offlineSync.toggleAutoSyncOnReconnect}
        onSyncNow={targetId => void offlineSync.syncNow({ targetItemId: targetId })}
        onClearSynced={() => void offlineSync.clearSyncedHistory()}
        onPushFullBackup={() => void offlineSync.pushFullBackup()}
        onPullServerBackup={() => void offlineSync.pullServerBackup()}
        autoCloudSyncEnabled={effectivePerformanceSettings.enableAutoCloudSync}
      />

      {/* Dedicated Notification Center & System Alert Log */}
      <NotificationCenterModal
        isOpen={isNotificationCenterOpen}
        onClose={() => setIsNotificationCenterOpen(false)}
        products={products}
        customers={customers}
        purchaseOrders={purchaseOrders}
        logs={notificationLogs}
        acknowledgedAlertIds={acknowledgedAlertIds}
        showLowStockAlerts={showLowStockAlerts}
        printersConfig={receiptSettings.printers}
        isOffline={offlineSync.isEffectivelyOffline}
        isSyncing={offlineSync.isSyncing}
        pendingSyncCount={offlineSync.pendingCount}
        failedSyncCount={offlineSync.failedCount}
        lastSuccessfulSyncAt={offlineSync.lastSuccessfulSyncAt}
        onMarkAllRead={handleMarkAllNotificationsRead}
        onClearLogs={handleClearNotificationLogs}
        onDismissLog={handleDismissNotificationLog}
        onOrderPurchaseOrder={productId => {
          setPoPrefillProductId(productId);
          setActiveTab('suppliers');
        }}
        onOpenInventory={() => setActiveTab('inventory')}
        onOpenKhataCustomer={custId => {
          if (custId) setFocusKhataCustomerId(custId);
          setActiveTab('khata');
        }}
        onOpenSuppliers={() => setActiveTab('suppliers')}
        onOpenOfflineSync={() => setIsOfflineSyncOpen(true)}
        onSyncNow={() => void offlineSync.syncNow()}
        onResetPaperRoll={handleResetThermalPaperRoll}
        onOpenPrinterSettings={() => setIsReceiptSettingsOpen(true)}
      />

      {/* Active Operator Switcher Modal */}
      <OperatorSwitchModal
        isOpen={isOperatorSwitcherOpen}
        onClose={() => setIsOperatorSwitcherOpen(false)}
        staffMembers={staffMembers}
        activeStaff={activeStaff}
        rolePermissions={rolePermissions}
        onSwitchOperator={handleSwitchOperator}
        onOpenTeamTab={
          rbacAllowedTabs.staff_loyalty
            ? () => setActiveTab('staff_loyalty')
            : undefined
        }
      />

      {/* Multi-Store Branches & Multi-Branch Synchronization Modal */}
      <MultiStoreModal
        isOpen={isMultiStoreOpen}
        onClose={() => setIsMultiStoreOpen(false)}
        branches={branches}
        config={multiBranchConfig}
        transfers={branchTransfers}
        products={products}
        isSyncingBranches={isSyncingBranches}
        onToggleMultiBranchSync={handleToggleMultiBranchSync}
        onUpdateMultiBranchConfig={handleUpdateMultiBranchConfig}
        onSwitchBranch={handleSwitchBranch}
        onSaveBranch={handleSaveBranch}
        onDeleteBranch={handleDeleteBranch}
        onSyncAllBranches={handleSyncAllBranches}
        onTransferStock={handleTransferBranchStock}
      />

      </div>
    </div>
  );
}

export default function App() {
  return (
    <LayoutProvider>
      <PosAppContent />
    </LayoutProvider>
  );
}
