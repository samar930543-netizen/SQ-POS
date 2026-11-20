import React, { useState, useEffect, useMemo } from 'react';
import { CartItem, Customer, Product, Bill, UnitType, StaffMember } from '../types';
import {
  formatCurrency,
  formatDateTime,
  buildWhatsAppBillText,
  buildUdharWhatsAppText,
  buildUdharSMSText,
  launchWhatsApp,
  launchSMS
} from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { getStoredReceiptSettings, getStoredStoreProfile } from '../utils/storage';
import { getCustomerPricingLabel, getEffectiveUnitPrice } from '../utils/customerPricing';
import { getConfiguredUnits } from '../utils/unitSpecs';
import {
  calculateMaxRedeemablePoints,
  calculatePointsEarnedForBill,
  getLoyaltyTierBadgeColor,
  getLoyaltyTierForPoints,
} from '../utils/loyaltyProgram';
import { evaluateCustomerCreditLimit } from '../utils/customerCredit';
import { EditableQuantityBadge } from './EditableQuantityBadge';
import { CustomerSelectorModal } from './CustomerSelectorModal';
import { CameraBarcodeModal } from './CameraBarcodeModal';
import { useHardwareBarcodeScanner } from '../hooks/useHardwareBarcodeScanner';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  getStoredBarcodePrefs,
  matchProductForQuickScan,
  resolveUnitForScannedProduct,
} from '../utils/barcodeScanner';
import {
  X,
  Trash2,
  Plus,
  Minus,
  User,
  ArrowRight,
  Receipt,
  UserPlus,
  AlertCircle,
  AlertTriangle,
  ShieldAlert,
  Tag,
  Award,
  Gift,
  Pencil,
  Check,
  RotateCcw,
  ChevronDown,
  ScanBarcode,
  Camera,
} from 'lucide-react';

interface CartDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  cart: CartItem[];
  products: Product[];
  customers: Customer[];
  selectedCustomerId?: string;
  onSelectCustomerId?: (customerId: string) => void;
  onUpdateQuantity: (productId: string, unit: UnitType, newQty: number) => void;
  onAddProductByScan?: (product: Product, unit: UnitType, quantity?: number) => void;
  onUpdateItemPrice?: (productId: string, unit: UnitType, newPrice: number | null) => void;
  onToggleUnit: (productId: string, currentUnit: UnitType) => void;
  onRemoveItem: (productId: string, unit: UnitType) => void;
  onClearCart: () => void;
  onCompleteBill: (bill: Bill, updatedCustomer?: Customer) => void;
  onAddNewCustomer: (name: string, phone: string) => Customer;
  staffMembers?: StaffMember[];
  activeStaff?: StaffMember | null;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  isOpen,
  onClose,
  cart,
  products,
  customers,
  selectedCustomerId: controlledCustomerId,
  onSelectCustomerId,
  onUpdateQuantity,
  onAddProductByScan,
  onUpdateItemPrice,
  onToggleUnit,
  onRemoveItem,
  onClearCart,
  onCompleteBill,
  onAddNewCustomer,
  staffMembers = [],
  activeStaff = null,
}) => {
  const { isMobileLayout, isTabletLayout } = useViewportLayout();
  const [internalCustomerId, setInternalCustomerId] = useState<string>('');
  const selectedCustomerId =
    controlledCustomerId !== undefined ? controlledCustomerId : internalCustomerId;
  const setSelectedCustomerId = (id: string) => {
    if (onSelectCustomerId) {
      onSelectCustomerId(id);
    } else {
      setInternalCustomerId(id);
    }
  };

  const [isAddingNewCustomer, setIsAddingNewCustomer] = useState<boolean>(false);
  const [newCustomerName, setNewCustomerName] = useState<string>('');
  const [newCustomerPhone, setNewCustomerPhone] = useState<string>('');
  const [amountReceivedInput, setAmountReceivedInput] = useState<string>('');
  const [pointsToRedeemInput, setPointsToRedeemInput] = useState<string>('');
  const [editingPriceKey, setEditingPriceKey] = useState<string | null>(null);
  const [priceDraft, setPriceDraft] = useState<string>('');
  const [isCustomerModalOpen, setIsCustomerModalOpen] = useState<boolean>(false);
  const [isCartScannerOpen, setIsCartScannerOpen] = useState<boolean>(false);
  const [cartBarcodeInput, setCartBarcodeInput] = useState<string>('');
  const [cartScanNotice, setCartScanNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [attributedStaffId, setAttributedStaffId] = useState<string>(activeStaff?.id || '');

  // GST Calculation State (Synced with Global Setting & dynamically togglable)
  const [isGstBill, setIsGstBill] = useState<boolean>(() => {
    return getStoredReceiptSettings().enableGst ?? false;
  });
  const [gstRate, setGstRate] = useState<number>(() => {
    return getStoredReceiptSettings().gstRate ?? 18;
  });
  const [gstNumber, setGstNumber] = useState<string>(() => {
    return getStoredReceiptSettings().gstNumber || '07AABCS1429B1Z1';
  });

  // Sync settings when drawer opens
  useEffect(() => {
    if (isOpen) {
      const settings = getStoredReceiptSettings();
      setIsGstBill(settings.enableGst ?? false);
      setGstRate(settings.gstRate ?? 18);
      setGstNumber(settings.gstNumber || '07AABCS1429B1Z1');
      if (activeStaff?.id) {
        setAttributedStaffId(activeStaff.id);
      }
    } else {
      setEditingPriceKey(null);
      setIsCustomerModalOpen(false);
      setIsCartScannerOpen(false);
      setCartScanNotice(null);
      setCartBarcodeInput('');
    }
  }, [isOpen, activeStaff?.id]);

  const handleScanIntoCart = (rawCode: string): { ok: boolean; message: string } => {
    if (!onAddProductByScan) {
      return { ok: false, message: 'Barcode scanning handler unavailable.' };
    }
    const { match, multiplier, code } = matchProductForQuickScan(products, rawCode);
    if (!match) {
      soundManager.playAlertSound();
      const message = `No SKU matches "${code || rawCode.trim()}"`;
      setCartScanNotice({ ok: false, text: message });
      return { ok: false, message };
    }

    const prefs = getStoredBarcodePrefs();
    const chosenUnit = resolveUnitForScannedProduct(
      match.product,
      prefs.defaultUnit,
      match.detectedUnit
    );
    onAddProductByScan(match.product, chosenUnit, multiplier);
    soundManager.playScannerBeep();
    const unitLabel = chosenUnit === 'bundle' ? match.product.bundleUnitName : 'Pc';
    const message = `+${multiplier} ${unitLabel} ${match.product.name}`;
    setCartScanNotice({ ok: true, text: message });
    return { ok: true, message };
  };

  useHardwareBarcodeScanner({
    enabled: Boolean(isOpen && onAddProductByScan && !isCustomerModalOpen && !isCartScannerOpen),
    onScan: code => {
      handleScanIntoCart(code);
    },
  });

  // Find currently selected customer
  const selectedCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // Reset redeemed points when customer changes or cart empties
  useEffect(() => {
    setPointsToRedeemInput('');
  }, [selectedCustomerId, cart.length === 0]);

  // Items Subtotal (already reflecting customer-specific pricing in cart)
  const itemsTotal = useMemo(() => {
    return cart.reduce((acc, item) => acc + item.itemTotal, 0);
  }, [cart]);

  // Customer-specific pricing label & savings vs standard catalog price
  const pricingTierLabel = useMemo(() => {
    return selectedCustomer ? getCustomerPricingLabel(selectedCustomer) : 'Standard Rate';
  }, [selectedCustomer]);

  const pricingSavings = useMemo(() => {
    if (!selectedCustomer) return 0;
    return cart.reduce((acc, item) => {
      if (item.isPriceOverridden) return acc;
      const prod = products.find(p => p.id === item.productId);
      if (!prod) return acc;
      const eff = getEffectiveUnitPrice(prod, item.unit, selectedCustomer);
      return acc + Math.max(0, eff.standardPrice - item.unitPrice) * item.quantity;
    }, 0);
  }, [cart, products, selectedCustomer]);

  // Loyalty tier & redemption calculations
  const availableLoyaltyPoints = selectedCustomer?.loyaltyPoints || 0;
  const loyaltyTier = useMemo(() => {
    return getLoyaltyTierForPoints(selectedCustomer?.lifetimeLoyaltyPoints || 0);
  }, [selectedCustomer]);

  const maxRedeemablePoints = useMemo(() => {
    if (!selectedCustomer) return 0;
    return calculateMaxRedeemablePoints(availableLoyaltyPoints, itemsTotal);
  }, [selectedCustomer, availableLoyaltyPoints, itemsTotal]);

  const pointsToRedeem = useMemo(() => {
    const parsed = Math.floor(Number(pointsToRedeemInput) || 0);
    if (parsed <= 0) return 0;
    return Math.min(parsed, maxRedeemablePoints);
  }, [pointsToRedeemInput, maxRedeemablePoints]);

  const loyaltyDiscountAmount = pointsToRedeem; // 1 pt = ₹1

  // Net taxable subtotal after loyalty redemption
  const netItemsTotal = Math.max(0, itemsTotal - loyaltyDiscountAmount);

  // GST calculation
  const totalGstAmount = useMemo(() => {
    if (!isGstBill) return 0;
    return (netItemsTotal * gstRate) / 100;
  }, [isGstBill, netItemsTotal, gstRate]);

  const cgstAmount = useMemo(() => totalGstAmount / 2, [totalGstAmount]);
  const sgstAmount = useMemo(() => totalGstAmount / 2, [totalGstAmount]);

  // Previous Udhar balance of customer
  const previousBalance = selectedCustomer ? selectedCustomer.currentBalance : 0;

  // Grand total = Net Items Total + GST Amount + Previous Balance
  const grandTotal = netItemsTotal + totalGstAmount + previousBalance;

  // Loyalty points to be earned on this bill
  const pointsToEarn = useMemo(() => {
    return calculatePointsEarnedForBill(netItemsTotal, selectedCustomer);
  }, [netItemsTotal, selectedCustomer]);

  // Amount received parsed
  const amountReceived = amountReceivedInput === '' ? 0 : parseFloat(amountReceivedInput) || 0;

  // Remaining balance = Grand Total - Amount Received (Auto-Udhar calculation)
  const remainingBalance = Math.max(0, grandTotal - amountReceived);

  // Projected credit limit evaluation if attached customer carries a remaining balance
  const projectedCreditEval = useMemo(() => {
    if (!selectedCustomer) return null;
    return evaluateCustomerCreditLimit(selectedCustomer, remainingBalance);
  }, [selectedCustomer, remainingBalance]);

  // Set default amount received when grandTotal changes or customer selected
  useEffect(() => {
    if (cart.length > 0) {
      setAmountReceivedInput(grandTotal.toString());
    }
  }, [grandTotal, cart.length]);

  // Handle Quick Amount buttons
  const handleSetQuickAmount = (amount: number) => {
    soundManager.playMechanicalClick();
    setAmountReceivedInput(amount.toString());
  };

  // Add new customer handler
  const handleCreateCustomer = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustomerName.trim()) return;

    const created = onAddNewCustomer(newCustomerName.trim(), newCustomerPhone.trim());
    setSelectedCustomerId(created.id);
    setIsAddingNewCustomer(false);
    setNewCustomerName('');
    setNewCustomerPhone('');
    soundManager.playScannerBeep();
  };

  // Handle Checkout
  const handleGenerateBill = () => {
    if (cart.length === 0) return;

    soundManager.playCheckoutSuccess();

    const now = new Date();
    const formattedDateTime = formatDateTime(now);
    const billNumber = 'SQ-' + Date.now().toString().slice(-6);

    let resolvedCustomer = selectedCustomer;
    let customerName = resolvedCustomer ? resolvedCustomer.name : 'Walk-in Customer';
    let customerPhone = resolvedCustomer ? resolvedCustomer.phone : '';

    // If new customer details were typed without pressing create
    if (!resolvedCustomer && newCustomerName.trim()) {
      const created = onAddNewCustomer(newCustomerName.trim(), newCustomerPhone.trim());
      resolvedCustomer = created;
      setSelectedCustomerId(created.id);
      customerName = created.name;
      customerPhone = created.phone;
    }

    const resolvedStaff =
      staffMembers.find(s => s.id === attributedStaffId) || activeStaff || undefined;

    const bill: Bill = {
      id: 'bill_' + Date.now(),
      billNumber,
      timestamp: now.toISOString(),
      formattedDateTime,
      customerId: resolvedCustomer?.id,
      customerName,
      customerPhone,
      staffId: resolvedStaff?.id,
      staffName: resolvedStaff?.name,
      staffRole: resolvedStaff?.role,
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
      itemsTotal: netItemsTotal,
      isGstBill,
      gstRate: isGstBill ? gstRate : undefined,
      cgstAmount: isGstBill ? cgstAmount : undefined,
      sgstAmount: isGstBill ? sgstAmount : undefined,
      totalGstAmount: isGstBill ? totalGstAmount : undefined,
      gstNumber: isGstBill ? gstNumber : undefined,
      previousBalance,
      grandTotal,
      amountReceived,
      remainingBalance,
      paymentMode: amountReceived >= grandTotal ? 'cash' : amountReceived > 0 ? 'partial' : 'credit',
      pricingTierLabel: resolvedCustomer ? pricingTierLabel : undefined,
      pricingSavings: pricingSavings > 0 ? Math.round(pricingSavings * 100) / 100 : undefined,
      loyaltyPointsEarned: resolvedCustomer && pointsToEarn > 0 ? pointsToEarn : undefined,
      loyaltyPointsRedeemed: resolvedCustomer && pointsToRedeem > 0 ? pointsToRedeem : undefined,
      loyaltyDiscountAmount: resolvedCustomer && loyaltyDiscountAmount > 0 ? loyaltyDiscountAmount : undefined,
    };

    // Update customer's pending due if customer is attached (loyalty balance & custom rates updated centrally in App.handleCompleteBill)
    let updatedCustomer: Customer | undefined;
    if (resolvedCustomer) {
      updatedCustomer = {
        ...resolvedCustomer,
        currentBalance: remainingBalance,
        updatedAt: now.toISOString(),
      };
    }

    setPointsToRedeemInput('');
    setNewCustomerName('');
    setNewCustomerPhone('');
    setIsAddingNewCustomer(false);

    // Automatic Customer Udhar Alerts & WhatsApp Receipt Sending
    const receiptSettings = getStoredReceiptSettings();
    const storeProfile = getStoredStoreProfile();
    const isUdharTransaction = remainingBalance > 0;

    if (isUdharTransaction && customerPhone) {
      // Calculate specific new credit added in this transaction
      const newCreditAdded = remainingBalance > previousBalance 
        ? (remainingBalance - previousBalance) 
        : (amountReceived < itemsTotal ? itemsTotal - amountReceived : remainingBalance);

      const alertPayload = {
        customerName,
        billNumber,
        formattedDateTime,
        newCreditAdded: Math.max(0, newCreditAdded),
        totalRemainingBalance: remainingBalance,
      };

      // 1. Automatic WhatsApp Udhar Alert (Enabled by default)
      if (receiptSettings.autoUdharWhatsApp ?? true) {
        const udharWaMsg = buildUdharWhatsAppText(alertPayload, storeProfile);
        launchWhatsApp(customerPhone, udharWaMsg);
      }

      // 2. Automatic Carrier SMS Udhar Alert (Enabled by default)
      if (receiptSettings.autoUdharSMS ?? true) {
        const udharSmsMsg = buildUdharSMSText(alertPayload, storeProfile);
        // Delay slightly if WhatsApp tab opened so both actions trigger smoothly
        setTimeout(() => {
          launchSMS(customerPhone, udharSmsMsg);
        }, 350);
      }
    } else if (receiptSettings.autoSendWhatsApp && customerPhone) {
      // General bill receipt if autoSendWhatsApp is ON and not an Udhar transaction
      const text = buildWhatsAppBillText(bill, storeProfile);
      launchWhatsApp(customerPhone, text);
    }

    onCompleteBill(bill, updatedCustomer);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div
        className={`w-full ${
          isMobileLayout ? 'max-w-full' : isTabletLayout ? 'max-w-md' : 'max-w-lg'
        } bg-slate-900 border-l border-slate-800 h-full flex flex-col text-slate-100 shadow-2xl`}
      >
        
        {/* Cart Header */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400">
              <Receipt className="w-4 h-4" />
            </span>
            <div>
              <h2 className="text-sm font-bold text-white tracking-wide uppercase">BILLING CART</h2>
              <p className="text-[11px] text-slate-400 tabular-nums">
                {cart.length} {cart.length === 1 ? 'item' : 'items'} selected
                {cart.length > 0 && ' · Tap qty to edit'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            {cart.length > 0 && (
              <button
                onClick={() => {
                  soundManager.playAlertSound();
                  onClearCart();
                }}
                className="px-2.5 py-1 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-500/10 rounded-lg transition"
              >
                Clear
              </button>
            )}
            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="Close cart"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Inline Quick Barcode Add Strip inside Cart Drawer */}
        {onAddProductByScan && (
          <div className="px-4 py-2 bg-slate-900/95 border-b border-slate-800 space-y-1.5">
            <form
              onSubmit={e => {
                e.preventDefault();
                if (!cartBarcodeInput.trim()) return;
                handleScanIntoCart(cartBarcodeInput);
                setCartBarcodeInput('');
              }}
              className="flex items-center gap-1.5"
            >
              <div className="relative flex-1">
                <ScanBarcode className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-blue-400" />
                <input
                  type="text"
                  data-barcode-input="global"
                  value={cartBarcodeInput}
                  onChange={e => setCartBarcodeInput(e.target.value)}
                  placeholder="Scan barcode to add to bill (e.g. 2*8901234001) + Enter"
                  className="w-full pl-8 pr-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                />
              </div>
              <button
                type="button"
                onClick={() => setIsCartScannerOpen(true)}
                className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-blue-300 transition"
                title="Open Camera Scanner"
                aria-label="Open Camera Scanner"
              >
                <Camera className="w-4 h-4" />
              </button>
            </form>
            {cartScanNotice && (
              <div
                className={`text-[11px] font-semibold flex items-center justify-between ${
                  cartScanNotice.ok ? 'text-emerald-400' : 'text-rose-400'
                }`}
              >
                <span className="truncate">{cartScanNotice.text}</span>
                <button
                  type="button"
                  onClick={() => setCartScanNotice(null)}
                  className="text-slate-500 hover:text-white ml-2"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        )}

        {/* Cart Items List */}
        <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-2.5 divide-y divide-slate-800/60">
          {cart.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-48 text-center text-slate-400">
              <Receipt className="w-10 h-10 text-slate-600 mb-2 stroke-[1.5]" />
              <p className="font-semibold text-slate-300">Cart is empty</p>
              <p className="text-xs text-slate-500 mt-1">Tap any product icon or bundle to add items to bill</p>
            </div>
          ) : (
            cart.map(item => {
              const product = products.find(p => p.id === item.productId);
              const availableStock = product?.stockPieces || 0;

              return (
                <div key={`${item.productId}_${item.unit}`} className="pt-2.5 first:pt-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <h4 className="font-bold text-white text-sm truncate">{item.productName}</h4>
                      
                      {/* Unit Switcher right inside the cart (only switchable if SKU has >1 configured tier) */}
                      <div className="mt-1 flex items-center gap-2">
                        <span className="text-[11px] text-slate-400">Unit:</span>
                        {(!product || getConfiguredUnits(product).length > 1) ? (
                          <button
                            onClick={() => {
                              soundManager.playItemAdded();
                              onToggleUnit(item.productId, item.unit);
                            }}
                            className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-blue-400 border border-slate-700 transition"
                          >
                            {item.unit === 'bundle' ? `📦 ${item.bundleUnitName} (${item.bundlePieces} pcs)` : '🔹 Loose Piece'}
                            <span className="text-[10px] text-slate-500 underline ml-1">Switch</span>
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-slate-800/70 text-xs font-semibold text-slate-300 border border-slate-700/80">
                            {item.unit === 'bundle' ? `📦 ${item.bundleUnitName} (${item.bundlePieces} pcs)` : '🔹 Single Piece'}
                          </span>
                        )}
                      </div>

                      {(() => {
                        const rowKey = `${item.productId}_${item.unit}`;
                        const isEditingPrice = editingPriceKey === rowKey;
                        const eff = product
                          ? getEffectiveUnitPrice(product, item.unit, selectedCustomer)
                          : null;
                        const isSavedCustomerRate = Boolean(
                          selectedCustomer && eff?.rateSource === 'SKU Contract'
                        );
                        const showCustomPrice = Boolean(
                          item.isPriceOverridden || isSavedCustomerRate
                        );
                        const defaultRate = eff
                          ? eff.tierDefaultPrice
                          : item.defaultUnitPrice ?? item.unitPrice;
                        const hasPriceDiff = Math.abs(defaultRate - item.unitPrice) > 0.001;

                        if (isEditingPrice && onUpdateItemPrice) {
                          const commitPrice = () => {
                            const parsed = Number(priceDraft.trim());
                            if (priceDraft.trim() !== '' && Number.isFinite(parsed) && parsed >= 0) {
                              soundManager.playItemAdded();
                              onUpdateItemPrice(item.productId, item.unit, parsed);
                            }
                            setEditingPriceKey(null);
                          };

                          return (
                            <div className="mt-1 space-y-1">
                              <div className="flex items-center gap-1.5 flex-wrap">
                                <span className="text-[11px] text-slate-400">Rate:</span>
                                <div className="relative flex items-center">
                                  <span className="absolute left-2 text-[11px] font-bold text-slate-400">
                                    ₹
                                  </span>
                                  <input
                                    type="number"
                                    min="0"
                                    step="any"
                                    autoFocus
                                    value={priceDraft}
                                    onFocus={e => e.target.select()}
                                    onChange={e => setPriceDraft(e.target.value)}
                                    onKeyDown={e => {
                                      if (e.key === 'Enter') {
                                        e.preventDefault();
                                        commitPrice();
                                      } else if (e.key === 'Escape') {
                                        e.preventDefault();
                                        setEditingPriceKey(null);
                                      }
                                    }}
                                    aria-label={`Custom sell price for ${item.productName}`}
                                    className="w-24 pl-5 pr-2 py-0.5 bg-slate-950 border border-blue-500 rounded-md text-xs font-bold text-white tabular-nums focus:outline-none focus:ring-1 focus:ring-blue-400"
                                  />
                                </div>
                                <button
                                  type="button"
                                  onClick={commitPrice}
                                  className="px-2 py-0.5 rounded-md bg-blue-600 hover:bg-blue-500 text-white text-[11px] font-bold flex items-center gap-0.5 transition"
                                  aria-label="Apply custom price"
                                >
                                  <Check className="w-3 h-3" />
                                  <span>Set</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setEditingPriceKey(null)}
                                  className="px-1.5 py-0.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-[11px] font-semibold transition"
                                >
                                  Cancel
                                </button>
                              </div>
                              <p className="text-[10px] text-slate-400">
                                {selectedCustomer
                                  ? `Saves to ${selectedCustomer.name} for future bills`
                                  : 'Select a customer below to save rate to their profile'}
                              </p>
                            </div>
                          );
                        }

                        return (
                          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1.5 flex-wrap tabular-nums">
                            <span>
                              Rate:{' '}
                              <span
                                className={`font-semibold ${
                                  showCustomPrice ? 'text-amber-300' : 'text-slate-200'
                                }`}
                              >
                                {formatCurrency(item.unitPrice)}
                              </span>{' '}
                              / {item.unit === 'bundle' ? item.bundleUnitName : 'pc'}
                            </span>

                            {showCustomPrice && hasPriceDiff && (
                              <span className="text-[11px] text-slate-500 line-through">
                                {formatCurrency(defaultRate)}
                              </span>
                            )}

                            {isSavedCustomerRate && !item.isPriceOverridden && (
                              <span className="text-[10px] font-semibold text-emerald-400">
                                · Saved Rate
                              </span>
                            )}

                            {onUpdateItemPrice && (
                              <button
                                type="button"
                                onClick={() => {
                                  soundManager.playMechanicalClick();
                                  setEditingPriceKey(rowKey);
                                  setPriceDraft(String(item.unitPrice));
                                }}
                                className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-[10px] font-semibold text-blue-300 border border-slate-700/80 transition"
                                title={
                                  selectedCustomer
                                    ? `Edit & save rate to ${selectedCustomer.name}'s profile`
                                    : 'Override sell price for this bill'
                                }
                              >
                                <Pencil className="w-2.5 h-2.5" />
                                <span>{showCustomPrice ? 'Override' : 'Edit Price'}</span>
                              </button>
                            )}

                            {showCustomPrice && onUpdateItemPrice && (
                              <button
                                type="button"
                                onClick={() => {
                                  soundManager.playMechanicalClick();
                                  onUpdateItemPrice(item.productId, item.unit, null);
                                }}
                                className="inline-flex items-center gap-0.5 text-[10px] font-semibold text-slate-400 hover:text-white underline"
                                title={
                                  isSavedCustomerRate
                                    ? 'Remove saved customer rate & reset to default'
                                    : 'Reset to default rate'
                                }
                              >
                                <RotateCcw className="w-2.5 h-2.5" />
                                <span>Reset</span>
                              </button>
                            )}
                          </div>
                        );
                      })()}
                    </div>

                    {/* Item Total */}
                    <div className="text-right">
                      <div className="text-sm font-black text-white">
                        {formatCurrency(item.itemTotal)}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        ({item.totalPieces} pcs)
                      </div>
                    </div>
                  </div>

                  {/* Quantity Stepper & Remove */}
                  <div className="mt-2 flex items-center justify-between">
                    <div className="flex items-center gap-1 bg-slate-950 rounded-lg border border-slate-800 p-0.5">
                      <button
                        onClick={() => {
                          soundManager.playItemAdded();
                          onUpdateQuantity(item.productId, item.unit, item.quantity - 1);
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 active:scale-95 transition"
                        aria-label="Decrease quantity"
                      >
                        <Minus className="w-3.5 h-3.5" />
                      </button>

                      <EditableQuantityBadge
                        quantity={item.quantity}
                        min={0}
                        triggerMode="click"
                        onCommit={newQty => onUpdateQuantity(item.productId, item.unit, newQty)}
                        ariaLabel={`${item.productName} quantity`}
                      />

                      <button
                        onClick={() => {
                          soundManager.playItemAdded();
                          onUpdateQuantity(item.productId, item.unit, item.quantity + 1);
                        }}
                        className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-slate-800 active:scale-95 transition"
                        aria-label="Increase quantity"
                      >
                        <Plus className="w-3.5 h-3.5" />
                      </button>
                    </div>

                    <button
                      onClick={() => {
                        soundManager.playAlertSound();
                        onRemoveItem(item.productId, item.unit);
                      }}
                      className="p-1.5 text-slate-500 hover:text-rose-400 transition"
                      aria-label="Remove item"
                    >
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Customer Khata & Udhar Section */}
        {cart.length > 0 && (
          <div className="p-3 bg-slate-950/80 border-t border-slate-800 space-y-2.5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-bold text-slate-300 uppercase tracking-wide flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-blue-400" />
                CUSTOMER KHATA (UDHAR)
              </span>

              <button
                onClick={() => setIsAddingNewCustomer(!isAddingNewCustomer)}
                className="text-[11px] text-blue-400 hover:text-blue-300 flex items-center gap-1 font-medium"
              >
                <UserPlus className="w-3 h-3" />
                {isAddingNewCustomer ? 'Select Existing' : '+ New Customer'}
              </button>
            </div>

            {/* Quick Add New Customer Form */}
            {isAddingNewCustomer ? (
              <form onSubmit={handleCreateCustomer} className="space-y-2 bg-slate-900 p-2.5 rounded-xl border border-slate-700">
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="text"
                    required
                    placeholder="Customer Name *"
                    value={newCustomerName}
                    onChange={e => setNewCustomerName(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  <input
                    type="tel"
                    placeholder="Phone (10 digits)"
                    value={newCustomerPhone}
                    onChange={e => setNewCustomerPhone(e.target.value)}
                    className="px-2.5 py-1.5 bg-slate-950 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                </div>
                <button
                  type="submit"
                  className="w-full py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs rounded-lg transition"
                >
                  Save & Attach to Bill
                </button>
              </form>
            ) : (
              /* Searchable Customer Modal Trigger */
              <div className="space-y-1">
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setIsCustomerModalOpen(true);
                  }}
                  aria-label="Select billing customer account"
                  className="w-full px-3 py-2 bg-slate-900 hover:bg-slate-800/80 border border-slate-700 hover:border-blue-500/60 rounded-xl text-xs text-white flex items-center justify-between gap-2 text-left transition"
                >
                  <span className="truncate font-semibold">
                    {selectedCustomer
                      ? `${selectedCustomer.name} (${selectedCustomer.phone || 'No phone'}) — Due: ${formatCurrency(selectedCustomer.currentBalance)}`
                      : 'Walk-in Cash Customer (No Khata)'}
                  </span>
                  <span className="text-[11px] font-semibold text-blue-400 flex items-center gap-1 flex-shrink-0">
                    <span>Search</span>
                    <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                  </span>
                </button>
              </div>
            )}

            {/* If Customer is selected, show pricing tier, loyalty balance & previous balance */}
            {selectedCustomer && (
              <div className="space-y-2">
                <div className="p-2.5 bg-slate-900 border border-slate-800 rounded-xl space-y-1.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <Tag className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span className="font-bold text-emerald-300 truncate">{pricingTierLabel}</span>
                    </div>
                    {pricingSavings > 0 && (
                      <span className="text-[11px] font-bold text-emerald-400 tabular-nums whitespace-nowrap">
                        Saved {formatCurrency(pricingSavings)}
                      </span>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-1.5 border-t border-slate-800/80">
                    <div className="flex items-center gap-1.5">
                      <Award className={`w-3.5 h-3.5 ${getLoyaltyTierBadgeColor(loyaltyTier.id)}`} />
                      <span className={`font-bold ${getLoyaltyTierBadgeColor(loyaltyTier.id)}`}>
                        {loyaltyTier.name} ({loyaltyTier.earnMultiplier}x)
                      </span>
                      <span className="text-[11px] text-slate-400 tabular-nums">
                        · {availableLoyaltyPoints} pts avail
                      </span>
                    </div>
                    <span className="text-[11px] font-semibold text-blue-300 tabular-nums">
                      +{pointsToEarn} pts on bill
                    </span>
                  </div>

                  {/* Loyalty Points Redemption Input */}
                  {availableLoyaltyPoints > 0 && maxRedeemablePoints > 0 && (
                    <div className="pt-1.5 border-t border-slate-800/80 flex items-center gap-2">
                      <Gift className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <input
                        type="number"
                        min="0"
                        max={maxRedeemablePoints}
                        value={pointsToRedeemInput}
                        onChange={e => setPointsToRedeemInput(e.target.value)}
                        placeholder={`Redeem pts (max ${maxRedeemablePoints})`}
                        className="flex-1 px-2 py-1 bg-slate-950 border border-slate-700 rounded-lg text-[11px] text-white tabular-nums focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setPointsToRedeemInput(
                            pointsToRedeem > 0 ? '' : String(maxRedeemablePoints)
                          );
                        }}
                        className="px-2 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-[10px] font-bold whitespace-nowrap"
                      >
                        {pointsToRedeem > 0 ? 'Clear' : `Use Max (₹${maxRedeemablePoints})`}
                      </button>
                    </div>
                  )}
                </div>

                {previousBalance > 0 && (
                  <div className="p-2 bg-amber-500/10 border border-amber-500/30 rounded-xl flex items-center justify-between text-xs">
                    <div>
                      <span className="text-amber-300 font-bold block">{selectedCustomer.name}</span>
                      <span className="text-[11px] text-slate-400">Previous Pending Udhar:</span>
                    </div>
                    <div className="text-sm font-black text-amber-400 tabular-nums">
                      {formatCurrency(previousBalance)}
                    </div>
                  </div>
                )}

                {projectedCreditEval?.hasLimit && (
                  <div className="px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between text-[11px] tabular-nums">
                    <span className="text-slate-400">
                      Credit Limit: <strong className="text-slate-200">{formatCurrency(projectedCreditEval.limit)}</strong>
                    </span>
                    <span
                      className={`font-bold ${
                        projectedCreditEval.status === 'exceeded'
                          ? 'text-rose-400'
                          : projectedCreditEval.status === 'nearing'
                          ? 'text-amber-300'
                          : 'text-emerald-400'
                      }`}
                    >
                      {projectedCreditEval.excessAmount > 0
                        ? `Over by ${formatCurrency(projectedCreditEval.excessAmount)}`
                        : `${formatCurrency(projectedCreditEval.remainingHeadroom)} headroom`}
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Bill Calculations (Dynamic GST vs Non-GST) */}
        {cart.length > 0 && (
          <div className="p-4 bg-slate-950 border-t border-slate-800 space-y-2.5">
            {/* Calculation Lines */}
            <div className="space-y-1.5 text-xs">
              <div className="flex justify-between items-center text-slate-400">
                <span>{isGstBill ? 'Subtotal (Pre-Loyalty):' : 'Items Total:'}</span>
                <span className="font-semibold text-white tabular-nums">{formatCurrency(itemsTotal)}</span>
              </div>

              {loyaltyDiscountAmount > 0 && (
                <div className="flex justify-between items-center text-amber-300">
                  <span>Loyalty Redemption ({pointsToRedeem} pts):</span>
                  <span className="font-bold tabular-nums">- {formatCurrency(loyaltyDiscountAmount)}</span>
                </div>
              )}

              {/* Dynamic GST Mode Switcher Bar */}
              <div className="flex items-center justify-between py-1 px-2 rounded-lg bg-slate-900 border border-slate-800">
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full ${isGstBill ? 'bg-emerald-400 animate-pulse' : 'bg-slate-600'}`} />
                  <span className="text-[11px] font-semibold text-slate-300">
                    {isGstBill ? `GST Active (${gstRate}%)` : 'Non-GST Wholesale Bill'}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setIsGstBill(!isGstBill);
                  }}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded transition ${
                    isGstBill
                      ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30 hover:bg-emerald-500/30'
                      : 'bg-slate-800 text-slate-400 border border-slate-700 hover:text-white'
                  }`}
                >
                  {isGstBill ? 'Switch to Non-GST' : `Enable GST (+${gstRate}%)`}
                </button>
              </div>

              {/* GST Breakdown lines when active */}
              {isGstBill && (
                <div className="space-y-1 pl-2 border-l-2 border-emerald-500/40 text-[11px] text-slate-400">
                  <div className="flex justify-between">
                    <span>CGST ({(gstRate / 2).toFixed(1)}%):</span>
                    <span className="text-slate-300 font-mono">{formatCurrency(cgstAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>SGST ({(gstRate / 2).toFixed(1)}%):</span>
                    <span className="text-slate-300 font-mono">{formatCurrency(sgstAmount)}</span>
                  </div>
                  <div className="flex justify-between font-semibold text-emerald-400">
                    <span>Total GST Tax ({gstRate}%):</span>
                    <span className="font-mono">+{formatCurrency(totalGstAmount)}</span>
                  </div>
                </div>
              )}

              {previousBalance > 0 && (
                <div className="flex justify-between text-amber-300 font-medium">
                  <span>+ Previous Udhar Balance:</span>
                  <span className="font-bold">{formatCurrency(previousBalance)}</span>
                </div>
              )}

              <div className="flex justify-between text-sm font-black text-white pt-1 border-t border-slate-800">
                <span>GRAND TOTAL:</span>
                <span className="text-blue-400">{formatCurrency(grandTotal)}</span>
              </div>
            </div>

            {/* Amount Received Input with Quick Chips */}
            <div className="space-y-1.5 pt-1">
              <div className="flex items-center justify-between">
                <label className="text-xs font-bold text-emerald-400">
                  Amount Received (Cash Paid):
                </label>
                <div className="text-[11px] text-slate-400">
                  Auto Udhar: <span className="font-bold text-rose-400">{formatCurrency(remainingBalance)}</span>
                </div>
              </div>

              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-emerald-400">
                  ₹
                </span>
                <input
                  type="number"
                  min="0"
                  step="any"
                  value={amountReceivedInput}
                  onChange={e => setAmountReceivedInput(e.target.value)}
                  placeholder="Enter cash received..."
                  className="w-full pl-8 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-base font-bold text-white focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
                />
              </div>

              {/* Quick Suggestion Chips */}
              <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-0.5 text-xs scrollbar-none">
                <button
                  type="button"
                  onClick={() => handleSetQuickAmount(grandTotal)}
                  className="px-2.5 py-1 rounded-lg bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-semibold hover:bg-emerald-500/30 whitespace-nowrap active:scale-95"
                >
                  Full Paid: ₹{grandTotal}
                </button>
                {previousBalance > 0 && (
                  <button
                    type="button"
                    onClick={() => handleSetQuickAmount(itemsTotal)}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 text-slate-300 border border-slate-700 font-medium hover:bg-slate-700 whitespace-nowrap active:scale-95"
                  >
                    Items Only: ₹{itemsTotal}
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => handleSetQuickAmount(0)}
                  className="px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/40 font-semibold hover:bg-rose-500/30 whitespace-nowrap active:scale-95"
                >
                  ₹0 (Full Udhar)
                </button>
              </div>
            </div>

            {/* Remaining Balance & Credit Limit Warning Indicator */}
            {remainingBalance > 0 && (
              <div className="space-y-1.5">
                <div className="p-2 rounded-xl bg-rose-950/40 border border-rose-800/40 flex items-center justify-between text-xs">
                  <span className="text-rose-300 font-medium flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5" />
                    Remaining Balance (Saved to Udhar):
                  </span>
                  <span className="text-sm font-black text-rose-400 tabular-nums">
                    {formatCurrency(remainingBalance)}
                  </span>
                </div>

                {projectedCreditEval?.hasLimit &&
                  (projectedCreditEval.status === 'exceeded' ||
                    projectedCreditEval.status === 'nearing') && (
                    <div
                      className={`p-2 rounded-xl border flex items-start gap-2 text-[11px] tabular-nums ${
                        projectedCreditEval.status === 'exceeded'
                          ? 'bg-rose-950/60 border-rose-500/45 text-rose-200'
                          : 'bg-amber-950/45 border-amber-500/45 text-amber-200'
                      }`}
                    >
                      {projectedCreditEval.status === 'exceeded' ? (
                        <ShieldAlert className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                      ) : (
                        <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
                      )}
                      <div>
                        <span className="font-bold">
                          {projectedCreditEval.status === 'exceeded'
                            ? projectedCreditEval.excessAmount > 0
                              ? `Credit Limit Alert: Exceeds ${formatCurrency(projectedCreditEval.limit)} cap by ${formatCurrency(projectedCreditEval.excessAmount)}`
                              : `Credit Limit Alert: Reaches 100% of ${formatCurrency(projectedCreditEval.limit)} cap`
                            : `Credit Limit Alert: Reaches ${Math.round(projectedCreditEval.utilizationPct)}% of ${formatCurrency(projectedCreditEval.limit)} cap`}
                        </span>
                      </div>
                    </div>
                  )}
              </div>
            )}

            {/* Staff Order Attribution Selector */}
            {staffMembers.length > 0 && (
              <div className="flex items-center justify-between gap-2 px-2.5 py-1.5 rounded-xl bg-slate-900 border border-slate-800 text-[11px]">
                <span className="text-slate-400 font-semibold whitespace-nowrap">
                  Order Handled By:
                </span>
                <select
                  value={attributedStaffId || activeStaff?.id || ''}
                  onChange={e => setAttributedStaffId(e.target.value)}
                  aria-label="Order handled by staff member"
                  className="bg-slate-950 border border-slate-700 rounded-lg px-2 py-1 text-white font-semibold focus:outline-none focus:border-blue-500 max-w-[210px] truncate"
                >
                  {staffMembers
                    .filter(s => s.active)
                    .map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role === 'Store Owner / Admin' ? 'Owner' : s.role})
                      </option>
                    ))}
                </select>
              </div>
            )}

            {/* Generate Bill Button */}
            <button
              onClick={handleGenerateBill}
              className="w-full py-3.5 rounded-xl bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-black text-sm uppercase tracking-wider shadow-lg shadow-blue-900/40 flex items-center justify-center gap-2 transition active:scale-98"
            >
              <span>Generate Bill & Print</span>
              <ArrowRight className="w-4 h-4" />
            </button>
          </div>
        )}

      </div>

      <CustomerSelectorModal
        isOpen={isCustomerModalOpen}
        onClose={() => setIsCustomerModalOpen(false)}
        customers={customers}
        selectedCustomerId={selectedCustomerId}
        onSelectCustomer={setSelectedCustomerId}
        walkInLabel="Walk-in Cash Customer (No Khata)"
        onQuickCreateCustomer={onAddNewCustomer}
      />

      <CameraBarcodeModal
        isOpen={isCartScannerOpen}
        onClose={() => setIsCartScannerOpen(false)}
        title="Scan Additional Items into Bill"
        subtitle="Items scanned here add immediately to the current checkout cart"
        mode="continuous"
        products={products}
        cartCount={cart.reduce((sum, i) => sum + i.quantity, 0)}
        cartTotal={itemsTotal}
        onScanCode={code => handleScanIntoCart(code)}
      />
    </div>
  );
};
