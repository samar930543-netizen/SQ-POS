export type UnitType = 'bundle' | 'piece';
export type ReceiptTemplateType =
  | 'compact'
  | 'standard'
  | 'detailed'
  | 'minimalist'
  | 'wholesale_bulk'
  | 'clean_bill'
  | 'express_total'
  | 'express_units';
export type PaperWidthType = '58mm' | '80mm';
export type ReceiptDateTimeFormat = 'date_time' | 'date_only' | 'short_24h' | 'iso_compact';
export type ReceiptFontSize = 'xs' | 'sm' | 'md' | 'lg';
export type ReceiptAlignment = 'left' | 'center' | 'right';
export type ReceiptHeaderLayout = 'centered' | 'split_3line';
export type ReceiptItemDisplayFormat =
  | 'tabular_unit'
  | 'compact_inline'
  | 'two_line_detail'
  | 'numbered_audit'
  | 'bulk_cards';

export interface ReceiptDesignConfig {
  showStoreName: boolean;
  showTagline: boolean;
  showAddress: boolean;
  showStorePhone: boolean;
  showEmail: boolean;
  showLogo: boolean;
  showFacade: boolean;
  showInvoiceNumber: boolean;
  showInvoiceLabel: boolean;
  showDateTime: boolean;
  dateTimeFormat: ReceiptDateTimeFormat;
  showCustomerName: boolean;
  showCustomerPhone: boolean;
  headerLayout: ReceiptHeaderLayout;
  headerAlignment: ReceiptAlignment;
  footerAlignment: ReceiptAlignment;
  fontSize: ReceiptFontSize;
  itemDisplayFormat: ReceiptItemDisplayFormat;
  showItemRate: boolean;
  showItemUnitDetail: boolean;
  showTotalItemsCount: boolean;
  showItemsTotal?: boolean;
  showPaidAmount?: boolean;
  showBalanceDue?: boolean;
  showSummaryAdjustments?: boolean;
  showInlineQtyOnGrandTotal?: boolean;
  qtyUnitStyle?: 'short' | 'code_pie_ban_lar';
  showFooterMessage: boolean;
  customFooterText: string;
  showCustomHeaderText?: boolean;
  customHeaderText?: string;
  showBarcode?: boolean;
  barcodeFormat?: 'code128' | 'code39';
  showQrCode?: boolean;
  qrCodeMode?: 'invoice_verify' | 'upi_payment' | 'custom_url';
  qrUpiId?: string;
  qrCustomPayload?: string;
  qrCodeLabel?: string;
  watermarkEnabled?: boolean;
  watermarkText?: string;
  watermarkStyle?: 'diagonal' | 'repeated_grid' | 'stamp';
  watermarkOpacity?: number;
}

export interface SavedCustomReceiptPreset {
  id: string;
  name: string;
  baseTemplate: ReceiptTemplateType;
  paperWidth: PaperWidthType;
  design: ReceiptDesignConfig;
  updatedAt: string;
}

export type PosDisplayMode =
  | 'grid'
  | 'compact_grid'
  | 'list'
  | 'category_tabbed'
  | 'compact_search'
  | 'barcode_scanner'
  | 'favorites'
  | 'stock_alert';

export type PrinterConnectionType = 'bluetooth' | 'usb' | 'network_ip' | 'wifi';
export type AutoCutterMode = 'partial' | 'full';

export interface ThermalPaperRollConfig {
  lowPaperAlertEnabled: boolean;
  rollLengthMeters: number;
  estimatedRemainingPct: number;
  lowPaperThresholdPct: number;
  billsPrintedSinceReset: number;
  usedMetersSinceReset?: number;
  alertSoundOnLowPaper?: boolean;
  lastResetAt?: string;
}

export interface BluetoothPrinterConfig {
  enabled: boolean;
  deviceId?: string;
  deviceName?: string;
  serviceUuid?: string;
  characteristicUuid?: string;
  chunkSizeBytes?: number;
  autoConnectOnPrint?: boolean;
}

export interface UsbPrinterConfig {
  enabled: boolean;
  transport: 'webusb' | 'serial';
  vendorId?: number;
  productId?: number;
  deviceName?: string;
  baudRate?: number;
  interfaceNumber?: number;
  endpointNumber?: number;
}

export interface NetworkIpPrinterConfig {
  enabled: boolean;
  host: string;
  port: number;
  label?: string;
  timeoutMs?: number;
}

export interface WifiPrinterConfig {
  enabled: boolean;
  mode: 'raw_tcp' | 'system_wifi';
  host: string;
  port: number;
  ssidLabel?: string;
  label?: string;
  timeoutMs?: number;
}

export interface PrinterConnectionsConfig {
  preferredType: PrinterConnectionType | 'browser';
  autoCutPaper: boolean;
  autoCutMode?: AutoCutterMode;
  openCashDrawer: boolean;
  feedLinesAfterPrint: number;
  paperRoll?: ThermalPaperRollConfig;
  bluetooth: BluetoothPrinterConfig;
  usb: UsbPrinterConfig;
  networkIp: NetworkIpPrinterConfig;
  wifi: WifiPrinterConfig;
}

export interface ReceiptSettings {
  template: ReceiptTemplateType;
  paperWidth: PaperWidthType;
  showPhone: boolean;
  thankYouMessage: string;
  autoSendWhatsApp: boolean;
  autoUdharWhatsApp: boolean;
  autoUdharSMS: boolean;
  enableGst: boolean;          // Global toggle to enable or disable GST calculation
  gstRate: number;             // Standard GST rate percentage (e.g. 18%, 12%, 5%)
  gstNumber?: string;          // Shop GSTIN
  design?: ReceiptDesignConfig;
  savedCustomPresets?: SavedCustomReceiptPreset[];
  activeCustomPresetId?: string;
  printers?: PrinterConnectionsConfig;
}

export interface Product {
  id: string;
  name: string;
  category: string;
  barcode?: string;
  pieceBarcode?: string;
  bundleUnitName: string; // e.g. "Bundle", "Peti", "Carton", "Dozen", "Box"
  bundlePieces: number;   // e.g. 50 pieces per bundle
  bundlePrice: number;    // e.g. ₹4350
  piecePrice: number;     // e.g. ₹80
  stockPieces: number;    // Total stock in single pieces (e.g. 350 pcs = 7 bundles)
  lowStockThreshold: number; // Alert threshold in pieces (default 10)
  imageUrl?: string;
  emoji: string;
  color: string;
  isFavorite?: boolean;
  updatedAt?: string;
}

export interface CartItem {
  productId: string;
  productName: string;
  unit: UnitType;
  bundleUnitName: string;
  bundlePieces: number;
  quantity: number;      // e.g. 2 bundles or 5 pieces
  unitPrice: number;     // Price per selected unit (catalog/tier or transaction override)
  defaultUnitPrice?: number; // Catalog/customer-tier price before manual override
  isPriceOverridden?: boolean; // True when overridden for this transaction only
  totalPieces: number;   // quantity * (unit === 'bundle' ? bundlePieces : 1)
  itemTotal: number;     // quantity * unitPrice
}

export type PricingTierId = 'standard' | 'wholesale_a' | 'vip_distributor' | 'custom';
export type LoyaltyTierId = 'bronze' | 'silver' | 'gold' | 'platinum';

export interface CustomerCustomProductRate {
  bundlePrice?: number;
  piecePrice?: number;
}

export interface Customer {
  id: string;
  name: string;
  phone: string;
  address?: string;
  currentBalance: number; // Current Pending Due (Udhar)
  creditLimit?: number; // Customizable maximum credit (Udhar) limit in ₹
  creditWarningPct?: number; // Percentage of limit that triggers a nearing-limit alert (default 80)
  ratingMode?: 'auto' | 'manual'; // Whether rating comes from payment history or manual override
  manualCreditRating?: number; // Manual star rating override (1-5)
  creditRatingNote?: string; // Operator note explaining rating or credit terms
  pricingTier?: PricingTierId;
  customDiscountPct?: number;
  customProductRates?: Record<string, CustomerCustomProductRate>;
  loyaltyPoints?: number;
  lifetimeLoyaltyPoints?: number;
  claimedMilestoneIds?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface BillItem {
  productId: string;
  productName: string;
  unit: UnitType;
  bundleUnitName: string;
  bundlePieces: number;
  quantity: number;
  unitPrice: number;
  totalPieces: number;
  itemTotal: number;
}

export interface Bill {
  id: string;
  billNumber: string;
  timestamp: string;          // ISO string
  formattedDateTime: string;  // e.g. "10 Nov 2026, 01:25 PM"
  customerId?: string;
  customerName: string;
  customerPhone: string;
  items: BillItem[];
  itemsTotal: number;         // Total of current bill items (Taxable Subtotal if GST enabled)
  isGstBill?: boolean;        // Whether GST calculation is active for this bill
  gstRate?: number;           // GST rate % applied (e.g. 18)
  cgstAmount?: number;        // Central GST amount (half of GST)
  sgstAmount?: number;        // State GST amount (half of GST)
  totalGstAmount?: number;    // Total GST amount (CGST + SGST)
  gstNumber?: string;         // Shop GSTIN
  previousBalance: number;    // Previous udhar before this bill
  grandTotal: number;         // (itemsTotal + totalGstAmount) + previousBalance
  amountReceived: number;     // Cash paid by customer now
  remainingBalance: number;   // New pending udhar balance
  paymentMode: 'cash' | 'upi' | 'credit' | 'partial';
  pricingTierLabel?: string;
  pricingSavings?: number;
  loyaltyPointsEarned?: number;
  loyaltyPointsRedeemed?: number;
  loyaltyDiscountAmount?: number;
  syncStatus?: 'synced' | 'pending_offline' | 'failed';
  syncedAt?: string;
  offlineCreated?: boolean;
  staffId?: string;
  staffName?: string;
  staffRole?: StaffRole;
  source?: 'pos' | 'ocr' | 'whatsapp' | 'external';
  whatsappMessageId?: string;
  externalOrderId?: string;
  externalStatus?: string;
  notes?: string;
}

export interface KhataTransaction {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  timestamp: string;
  formattedDateTime: string;
  type: 'BILL' | 'PAYMENT_COLLECTED';
  billId?: string;
  amount: number;             // Bill amount or payment collected
  previousBalance: number;
  newBalance: number;
  description: string;
}

export interface DailyReportSummary {
  date: string;               // YYYY-MM-DD
  totalSales: number;         // Total items billed today
  cashReceived: number;       // Cash collected today (from bills + khata payments)
  udharGiven: number;         // New pending dues added today
  billsCount: number;
}

export type OcrScanMode = 'invoice' | 'restock';

export interface OcrDetectedItem {
  id: string;
  productName: string;
  originalText?: string;       // Raw handwritten/Hindi/Devanagari text read from slip
  quantity: number;
  unitType: 'bundle' | 'piece';
  unitName: string;
  bundlePieces: number;
  unitPrice?: number;
  totalPrice?: number;
  confidence?: number;
  selectedProductId: string;   // Matched product ID in store catalog, or 'CUSTOM' or 'SKIP'
  piecesToAdd: number;
  enabled: boolean;
}

export interface OcrBillScanResult {
  vendorName?: string;
  customerName?: string;
  customerPhone?: string;
  invoiceNumber?: string;
  invoiceDate?: string;
  totalAmount?: number;
  amountPaid?: number;
  detectedLanguage?: 'english' | 'hindi' | 'bilingual' | string;
  isHandwritten?: boolean;
  notes?: string;
  items: OcrDetectedItem[];
}

export type AnalyticsTimeframe = 'daily' | 'weekly' | 'monthly' | 'custom';
export type MovementTier = 'fast_moving' | 'steady' | 'slow_moving' | 'out_of_stock';

export interface CustomAnalyticsDateRange {
  startDate: string; // YYYY-MM-DD
  endDate: string;   // YYYY-MM-DD
}

export interface DailySoldItemBreakdown {
  productId: string;
  productName: string;
  category: string;
  emoji: string;
  bundleUnitName: string;
  bundlePieces: number;
  bundlesSold: number;
  loosePiecesSold: number;
  totalPiecesSold: number;
  revenue: number;
  ordersCount: number;
  avgUnitPrice: number;
  shareOfDayQuantityPct: number;
  currentStockPieces: number;
  lowStockThreshold: number;
}

export interface DailySalesDayBreakdown {
  dateKey: string;
  label: string;
  weekdayName: string;
  billsCount: number;
  totalRevenue: number;
  totalPiecesSold: number;
  uniqueSkusSold: number;
  topSellerName?: string;
  topSellerEmoji?: string;
  topSellerPieces: number;
  items: DailySoldItemBreakdown[];
}

export interface ProductAnalytics {
  productId: string;
  productName: string;
  category: string;
  emoji: string;
  bundleUnitName: string;
  bundlePieces: number;
  currentStockPieces: number;
  lowStockThreshold: number;
  unitsSoldPieces: number;
  revenue: number;
  ordersCount: number;
  prevUnitsSoldPieces: number;
  dailyVelocity: number;          // Weighted pieces/day velocity
  prevDailyVelocity: number;      // Baseline pieces/day velocity
  velocityChangePct: number;      // % change vs baseline
  daysOfCover: number;            // Estimated days until stockout
  predicted7dDemand: number;      // Forecasted pieces needed next 7 days
  predicted30dDemand: number;     // Forecasted pieces needed next 30 days
  recommendedReorderPieces: number; // Suggested restock pieces (14d target + safety - stock)
  movementTier: MovementTier;
  isSpikeActive: boolean;
  spikeMultiplier: number;
}

export interface DemandSpike {
  productId: string;
  productName: string;
  category: string;
  emoji: string;
  baselineDailyVelocity: number;
  spikeVelocity: number;
  multiplier: number;
  peakDate: string;
  peakUnitsSold: number;
  currentStockPieces: number;
  daysOfCoverAtSpike: number;
  severity: 'high' | 'moderate';
}

export interface TimeSeriesBucket {
  key: string;
  label: string;
  revenue: number;
  piecesSold: number;
  billsCount: number;
  isForecast?: boolean;
}

export interface WeekdaySeasonality {
  dayIndex: number;
  dayName: string;
  avgRevenue: number;
  avgPieces: number;
  indexScore: number; // 1.0 = average
}

export interface CategorySeasonality {
  category: string;
  revenue: number;
  piecesSold: number;
  sharePct: number;
  growthPct: number;
  seasonalFactor: number;
}

export interface SalesAnalyticsReport {
  timeframe: AnalyticsTimeframe;
  windowDays: number;
  startDateKey: string;
  endDateKey: string;
  totalRevenue: number;
  prevRevenue: number;
  revenueChangePct: number;
  totalPiecesSold: number;
  prevPiecesSold: number;
  piecesChangePct: number;
  totalBills: number;
  avgOrderValue: number;
  predictedNextPeriodRevenue: number;
  predictedNextPeriodPieces: number;
  fastMoving: ProductAnalytics[];
  steadyMoving: ProductAnalytics[];
  slowMoving: ProductAnalytics[];
  outOfStock: ProductAnalytics[];
  criticalLowStock: ProductAnalytics[];
  allProducts: ProductAnalytics[];
  demandSpikes: DemandSpike[];
  series: TimeSeriesBucket[];
  forecastSeries: TimeSeriesBucket[];
  weekdaySeasonality: WeekdaySeasonality[];
  categoryTrends: CategorySeasonality[];
  peakWeekday: WeekdaySeasonality | null;
  seasonalSummary: string;
}

export type PredictiveStockUrgency = 'out_of_stock' | 'critical' | 'low_stock' | 'healthy';

export interface PredictiveInventoryItem {
  productId: string;
  productName: string;
  category: string;
  emoji: string;
  bundleUnitName: string;
  bundlePieces: number;
  currentStockPieces: number;
  lowStockThreshold: number;
  sold30DaysPieces: number;
  sold30DaysRevenue: number;
  activeDaysSold: number;
  avgDailyConsumption: number;
  daysOfStockRemaining: number;
  isLowStock: boolean;
  urgency: PredictiveStockUrgency;
  suggestedReorderPieces: number;
  suggestedReorderBundles: number;
  estimatedReorderCost: number;
}

export interface PredictiveInventoryReport {
  windowDays: 30;
  targetCoverDays: number;
  startDateKey: string;
  endDateKey: string;
  billsAnalyzedCount: number;
  total30DaysPiecesSold: number;
  avgTotalDailyPieces: number;
  items: PredictiveInventoryItem[];
  lowStockItems: PredictiveInventoryItem[];
  totalSuggestedReorderPieces: number;
  totalEstimatedReorderCost: number;
}

export type SupplierPaymentTerms = 'COD' | 'Advance' | 'Net 7' | 'Net 15' | 'Net 30';

export interface Supplier {
  id: string;
  name: string;
  contactPerson?: string;
  phone: string;
  email?: string;
  gstin?: string;
  address?: string;
  categories: string[];
  leadTimeDays: number;
  paymentTerms: SupplierPaymentTerms;
  notes?: string;
  onTimeDeliveries: number;
  totalDeliveries: number;
  createdAt: string;
  updatedAt: string;
}

export type PurchaseOrderStatus =
  | 'draft'
  | 'ordered'
  | 'in_transit'
  | 'partial'
  | 'received'
  | 'cancelled';

export interface PurchaseOrderItem {
  productId: string;
  productName: string;
  bundleUnitName: string;
  bundlePieces: number;
  unitType: UnitType;
  orderedQty: number;
  receivedQty: number;
  totalOrderedPieces: number;
  totalReceivedPieces: number;
  unitCost: number;
  lineTotal: number;
}

export interface PurchaseOrderTimelineEvent {
  id: string;
  status: PurchaseOrderStatus;
  timestamp: string;
  note: string;
}

export interface PurchaseOrder {
  id: string;
  poNumber: string;
  supplierId: string;
  supplierName: string;
  supplierPhone: string;
  status: PurchaseOrderStatus;
  orderDate: string;            // ISO timestamp
  expectedDeliveryDate: string; // YYYY-MM-DD
  actualDeliveryDate?: string;  // ISO timestamp when fully received
  items: PurchaseOrderItem[];
  subtotal: number;
  gstAmount: number;
  totalAmount: number;
  amountPaid: number;
  notes?: string;
  timeline: PurchaseOrderTimelineEvent[];
  createdAt: string;
  updatedAt: string;
}

export type CashFlowEntryType = 'cash_injection' | 'expense' | 'supplier_payment';
export type CashFlowPaymentMode = 'cash' | 'upi' | 'bank';
export type ExpenseCategory =
  | 'Transport & Freight'
  | 'Staff Wages'
  | 'Rent & Utilities'
  | 'Packaging & Supplies'
  | 'Tea & Petty Cash'
  | 'Maintenance'
  | 'Other Expense';

export interface CashFlowEntry {
  id: string;
  date: string; // YYYY-MM-DD
  timestamp: string; // ISO string
  type: CashFlowEntryType;
  amount: number;
  paymentMode: CashFlowPaymentMode;
  category?: ExpenseCategory | string;
  title: string;
  notes?: string;
  supplierId?: string;
  supplierName?: string;
  poId?: string;
  poNumber?: string;
  isAutoSynced?: boolean;
}

export interface DailyCashFlowSummary {
  date: string;
  openingCash: number;
  hasExplicitOpeningCash: boolean;
  automatedBillCashIn: number;
  automatedBillUpiIn: number;
  automatedKhataCashIn: number;
  automatedSalesGross: number;
  totalAutomatedInflow: number;
  manualCashInjections: number;
  supplierPaymentsTotal: number;
  manualExpensesTotal: number;
  totalOutflow: number;
  closingCashDrawer: number; // Opening + Cash Bills + Khata Cash + Cash Injections - Cash Outflows
  closingBalanceAllModes: number; // Opening + All Automated Sales Inflow + All Injections - All Outflows
  netDayChange: number;
  supplierPaymentItems: CashFlowEntry[];
  injectionItems: CashFlowEntry[];
  expenseItems: CashFlowEntry[];
  dateBills: Bill[];
  dateKhataPayments: KhataTransaction[];
}

export interface OcrExpenseLineItem {
  description: string;
  amount: number;
}

export interface OcrExpenseScanResult {
  merchantName?: string;
  receiptDate?: string;
  receiptNumber?: string;
  paymentMode: CashFlowPaymentMode;
  suggestedCategory: ExpenseCategory;
  title: string;
  totalAmount: number;
  detectedLanguage?: string;
  isHandwritten?: boolean;
  notes?: string;
  lineItems: OcrExpenseLineItem[];
  confidence?: number;
}

export interface PricingTierConfig {
  id: PricingTierId;
  name: string;
  discountPercent: number;
  description: string;
}

export interface LoyaltyTierConfig {
  id: LoyaltyTierId;
  name: string;
  minLifetimePoints: number;
  earnMultiplier: number; // Multiplier on base 1 pt per ₹100
  bonusDiscountPct: number;
  description: string;
}

export interface LoyaltyMilestone {
  id: string;
  title: string;
  pointsRequired: number;
  rewardPointsBonus: number;
  rewardCashValue: number;
  description: string;
}

export interface LoyaltyTransaction {
  id: string;
  customerId: string;
  customerName: string;
  type: 'EARN' | 'REDEEM' | 'MILESTONE_BONUS' | 'ADJUSTMENT';
  points: number; // Positive for earned/bonus, negative for redeemed
  discountValue?: number;
  billId?: string;
  billNumber?: string;
  timestamp: string;
  note: string;
}

export type StaffRole =
  | 'Store Owner / Admin'
  | 'Counter Cashier'
  | 'Godown Manager'
  | 'Delivery Driver'
  | 'Sales Executive'
  | 'Helper';

export type StaffPermission =
  | 'billing'
  | 'khata'
  | 'inventory'
  | 'categories'
  | 'suppliers'
  | 'cashflow'
  | 'reports'
  | 'staff_loyalty'
  | 'whatsapp'
  | 'store_profile'
  | 'delete_records'
  | 'manage_rbac';

export type RolePermissionMatrix = Record<StaffRole, Record<StaffPermission, boolean>>;

export type StaffActivityDomain = 'sales' | 'inventory' | 'team_rbac';

export interface StaffActivityLog {
  id: string;
  timestamp: string;
  domain: StaffActivityDomain;
  action: string;
  staffId: string;
  staffName: string;
  staffRole: StaffRole;
  targetLabel: string;
  details: string;
  amount?: number;
  quantityDelta?: number;
  billId?: string;
  productId?: string;
}

export interface StaffMember {
  id: string;
  name: string;
  phone: string;
  role: StaffRole;
  dailyWage: number;
  shiftStart: string; // HH:mm
  active: boolean;
  pin?: string;
  customPermissions?: Partial<Record<StaffPermission, boolean>>;
  createdAt: string;
}

export interface AttendanceRecord {
  id: string;
  staffId: string;
  staffName: string;
  role: StaffRole;
  date: string; // YYYY-MM-DD
  clockInTime: string; // ISO string
  clockOutTime?: string; // ISO string
  durationMinutes?: number;
  status: 'clocked_in' | 'completed' | 'absent';
  notes?: string;
}

export type ManageableTabKey =
  | 'billing'
  | 'khata'
  | 'inventory'
  | 'suppliers'
  | 'cashflow'
  | 'reports'
  | 'staff_loyalty'
  | 'whatsapp';

export interface StoreModuleVisibility {
  billing: boolean;
  khata: boolean;
  inventory: boolean;
  suppliers: boolean;
  cashflow: boolean;
  reports: boolean;
  staff_loyalty: boolean;
  whatsapp?: boolean;
}

export type PosUiElementKey =
  | 'walkInCustomerSelector'
  | 'lowStockAlertBanner'
  | 'categoryFilterTabs'
  | 'catalogDisplayBar';

export interface PosUiVisibility {
  walkInCustomerSelector: boolean;
  lowStockAlertBanner: boolean;
  categoryFilterTabs: boolean;
  catalogDisplayBar: boolean;
}

export type HeaderIconKey =
  | 'appLock'
  | 'multiStore'
  | 'operatorSwitcher'
  | 'notifications'
  | 'offlineSync'
  | 'sound'
  | 'haptics'
  | 'pwaInstall'
  | 'liveVoice'
  | 'audioTranscribe'
  | 'scanBill'
  | 'receiptSettings'
  | 'apkGuide'
  | 'cart'
  | 'navDrawerToggle';

export type HeaderIconVisibility = Record<HeaderIconKey, boolean>;

export interface WhatsAppAutomationConfig {
  enabled: boolean;
  autoConfirmOrders: boolean;
  autoDeductStock: boolean;
  autoReplyInquiries: boolean;
  defaultOrderPaymentMode: 'cash' | 'credit';
  businessPhoneNumberId: string;
  businessAccountId?: string;
  verifyToken: string;
  greetingTemplate?: string;
  lastWebhookAt?: string;
}

export interface ExternalApiConfig {
  enabled: boolean;
}

export interface PerformanceSettings {
  enablePredictiveAnalytics: boolean;
  enableAutoCloudSync: boolean;
  enableLiveReceiptRendering: boolean;
}

export interface StoreProfile {
  storeName: string;
  tagline?: string;
  contactNumber: string;
  email: string;
  address: string;
  gstin?: string;
  logoDataUrl?: string;
  facadePhotoDataUrl?: string;
  showLogoOnInvoices: boolean;
  showFacadeOnInvoices: boolean;
  showBrandingInHeader?: boolean;
  enabledModules?: StoreModuleVisibility;
  posUiVisibility?: PosUiVisibility;
  headerIconVisibility?: HeaderIconVisibility;
  whatsappConfig?: WhatsAppAutomationConfig;
  externalApiConfig?: ExternalApiConfig;
  performanceSettings?: PerformanceSettings;
  multiStoreConfig?: MultiBranchSyncConfig;
  updatedAt: string;
}

export type SyncEntityType =
  | 'bill'
  | 'khata_payment'
  | 'customer'
  | 'inventory'
  | 'cashflow'
  | 'loyalty'
  | 'attendance'
  | 'purchase_order'
  | 'supplier'
  | 'store_profile';

export type SyncItemStatus = 'pending' | 'syncing' | 'synced' | 'failed';

export interface SyncQueueItem {
  id: string;
  entityType: SyncEntityType;
  entityId: string;
  label: string;
  amount?: number;
  payload: Record<string, unknown>;
  createdAt: string;
  status: SyncItemStatus;
  attempts: number;
  lastAttemptAt?: string;
  syncedAt?: string;
  errorMessage?: string;
}

export interface OfflineSyncConfig {
  forceOfflineMode: boolean;
  autoSyncOnReconnect: boolean;
  lastSuccessfulSyncAt?: string;
  lastSyncError?: string;
}

export interface ServerSyncStatus {
  reachable: boolean;
  serverTime?: string;
  totalSyncedBills: number;
  totalSyncedOperations: number;
  totalSyncedProducts?: number;
  totalSyncedCustomers?: number;
  externalApiAuthConfigured?: boolean;
  externalApiEnabled?: boolean;
  lastSyncedAt?: string;
  revision: number;
}

export type SystemNotificationCategory =
  | 'low_stock'
  | 'credit_limit'
  | 'sync'
  | 'purchase_order'
  | 'whatsapp'
  | 'system';

export type SystemNotificationSeverity = 'info' | 'success' | 'warning' | 'critical';

export interface SystemNotification {
  id: string;
  category: SystemNotificationCategory;
  severity: SystemNotificationSeverity;
  title: string;
  message: string;
  timestamp: string;
  read: boolean;
  meta?: {
    productId?: string;
    poId?: string;
    customerId?: string;
    whatsappMessageId?: string;
  };
}

export type WhatsAppMessageIntent = 'order' | 'inquiry' | 'payment' | 'other';

export type WhatsAppMessageStatus =
  | 'pending_review'
  | 'auto_processed'
  | 'billed'
  | 'replied'
  | 'insufficient_stock'
  | 'ignored';

export interface WhatsAppParsedItem {
  id: string;
  rawText: string;
  matchedProductId: string;
  matchedProductName: string;
  unit: UnitType;
  bundleUnitName: string;
  bundlePieces: number;
  quantity: number;
  unitPrice: number;
  totalPieces: number;
  lineTotal: number;
  availablePieces: number;
  stockSufficient: boolean;
  confidence: number;
}

export interface WhatsAppInboundMessage {
  id: string;
  externalMessageId?: string;
  senderName: string;
  senderPhone: string;
  customerId?: string;
  messageText: string;
  receivedAt: string;
  formattedTime: string;
  intent: WhatsAppMessageIntent;
  status: WhatsAppMessageStatus;
  parsedItems: WhatsAppParsedItem[];
  estimatedTotal: number;
  suggestedReply: string;
  replyText?: string;
  repliedAt?: string;
  replyDeliveryMode?: 'cloud_api' | 'whatsapp_web' | 'auto_queued' | 'local_log';
  linkedBillId?: string;
  linkedBillNumber?: string;
  stockUpdated: boolean;
  stockUpdatedAt?: string;
  processingNote?: string;
  source: 'webhook' | 'simulator' | 'manual';
}

export type ViewportLayoutMode = 'mobile' | 'tablet' | 'desktop';
export type ViewportLayoutPreference = 'auto' | ViewportLayoutMode;

export type AudioListMode = 'cart' | 'restock' | 'list';

export interface AudioTranscribedItem {
  id: string;
  productName: string;
  spokenText?: string;
  quantity: number;
  unitType: UnitType;
  unitName: string;
  bundlePieces: number;
  unitPrice: number;
  notes?: string;
  selectedProductId: string; // Matched Product ID, 'CUSTOM', or 'SKIP'
  enabled: boolean;
}

export interface AudioTranscribeResult {
  transcript: string;
  model: string;
  listTitle?: string;
  detectedLanguage?: string;
  processingTimeMs?: number;
  parseWarning?: string;
  items: AudioTranscribedItem[];
}

export interface SavedAudioItemList {
  id: string;
  title: string;
  mode: AudioListMode;
  sourceType: 'microphone' | 'upload';
  sourceFileName?: string;
  transcript: string;
  detectedLanguage?: string;
  items: AudioTranscribedItem[];
  createdAt: string;
  updatedAt: string;
}

export interface StoreBranch {
  id: string;
  code: string;
  name: string;
  city?: string;
  address?: string;
  phone?: string;
  managerName?: string;
  isHeadquarters: boolean;
  active: boolean;
  skuCount?: number;
  stockPiecesTotal?: number;
  todaySales?: number;
  totalSales?: number;
  billsCount?: number;
  lastSyncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MultiBranchSyncConfig {
  enabled: boolean;
  activeBranchId: string;
  syncCatalogAcrossBranches: boolean;
  syncInventoryTransfers: boolean;
  syncCustomersAndKhata: boolean;
  autoSyncIntervalSec: number;
  lastBranchSyncAt?: string;
  lastBranchSyncNote?: string;
}

export interface BranchStockTransfer {
  id: string;
  transferNumber: string;
  fromBranchId: string;
  fromBranchName: string;
  toBranchId: string;
  toBranchName: string;
  productId: string;
  productName: string;
  pieces: number;
  note?: string;
  status: 'completed' | 'pending_sync';
  timestamp: string;
  createdBy?: string;
}

export interface BranchWorkspaceSnapshot {
  branchId: string;
  products: Product[];
  customers: Customer[];
  bills: Bill[];
  khata: KhataTransaction[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  cashFlowEntries: CashFlowEntry[];
  openingCashMap: Record<string, number>;
  loyaltyTransactions: LoyaltyTransaction[];
  staffMembers: StaffMember[];
  attendanceRecords: AttendanceRecord[];
  storeProfile: StoreProfile;
  updatedAt: string;
}

export interface BiometricCredentialInfo {
  credentialId: string;
  label: string;
  enrolledAt: string;
  lastUsedAt?: string;
}

export interface SecurityQuestionItem {
  id: string;
  question: string;
  answerHash: string;
}

export interface AppLockRecoveryConfig {
  recoveryEmail: string;
  emailRecoveryEnabled: boolean;
  securityQuestionsEnabled: boolean;
  requireBothMethods?: boolean;
  securityQuestions: SecurityQuestionItem[];
  updatedAt?: string;
}

export interface AppLockSettings {
  enabled: boolean;
  masterPin: string; // 4-digit numeric PIN
  requireOnLaunch: boolean;
  autoLockMinutes: 0 | 1 | 5 | 15 | 30;
  biometricEnabled: boolean;
  biometricCredentials: BiometricCredentialInfo[];
  recovery?: AppLockRecoveryConfig;
  updatedAt: string;
}
