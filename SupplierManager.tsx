import React, { useMemo, useState, useEffect } from 'react';
import {
  Product,
  Supplier,
  SupplierPaymentTerms,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  UnitType,
} from '../types';
import { formatCurrency, formatDateOnly } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  buildLowStockReorderQueue,
  buildWhatsAppLink,
  buildWhatsAppPurchaseOrderText,
  estimateWholesaleUnitCost,
  getDeliveryScheduleInfo,
  getPoStatusLabel,
  getSupplierOnTimeRate,
  normalizePoItem,
} from '../utils/supplierHelpers';
import {
  getConfiguredUnits,
  getPreferredUnit,
  hasConfiguredBundleTier,
} from '../utils/unitSpecs';
import {
  Truck,
  Plus,
  Search,
  Phone,
  Calendar,
  CheckCircle2,
  Clock,
  AlertTriangle,
  PackageCheck,
  Edit2,
  Trash2,
  X,
  ArrowRight,
  Copy,
  Check,
  MessageSquare,
  Download,
  Building2,
  ClipboardList,
  RefreshCw,
} from 'lucide-react';

interface SupplierManagerProps {
  products: Product[];
  suppliers: Supplier[];
  purchaseOrders: PurchaseOrder[];
  onSaveSupplier: (supplier: Supplier) => void;
  onDeleteSupplier: (supplierId: string) => void;
  onSavePurchaseOrder: (po: PurchaseOrder) => void;
  onReceivePurchaseOrder: (
    poId: string,
    receipts: Array<{ productId: string; unitType: UnitType; receiveQtyNow: number }>,
    note: string
  ) => void;
  onUpdatePoStatus: (poId: string, status: PurchaseOrderStatus, note: string) => void;
  onRecordPoPayment: (poId: string, additionalAmount: number) => void;
  prefillProductId?: string | null;
  onClearPrefill?: () => void;
  managedCategories?: string[];
}

type SupplierViewTab = 'orders' | 'vendors' | 'timeline' | 'reorder';
type PoFilterTab = 'all' | 'active' | 'overdue' | 'received' | 'draft';

const PAYMENT_TERMS_OPTIONS: SupplierPaymentTerms[] = ['COD', 'Advance', 'Net 7', 'Net 15', 'Net 30'];

function addDaysIsoDate(days: number): string {
  const d = new Date(Date.now() + Math.max(0, days) * 86400000);
  return d.toISOString().slice(0, 10);
}

export const SupplierManager: React.FC<SupplierManagerProps> = ({
  products,
  suppliers,
  purchaseOrders,
  onSaveSupplier,
  onDeleteSupplier,
  onSavePurchaseOrder,
  onReceivePurchaseOrder,
  onUpdatePoStatus,
  onRecordPoPayment,
  prefillProductId,
  onClearPrefill,
  managedCategories = [],
}) => {
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const [activeSubTab, setActiveSubTab] = useState<SupplierViewTab>('orders');
  const [poFilter, setPoFilter] = useState<PoFilterTab>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Vendor Modal state
  const [isVendorModalOpen, setIsVendorModalOpen] = useState(false);
  const [editingVendor, setEditingVendor] = useState<Supplier | null>(null);
  const [confirmDeleteVendorId, setConfirmDeleteVendorId] = useState<string | null>(null);

  // Vendor Form Fields
  const [vName, setVName] = useState('');
  const [vContact, setVContact] = useState('');
  const [vPhone, setVPhone] = useState('');
  const [vEmail, setVEmail] = useState('');
  const [vGstin, setVGstin] = useState('');
  const [vAddress, setVAddress] = useState('');
  const [vLeadTime, setVLeadTime] = useState('2');
  const [vTerms, setVTerms] = useState<SupplierPaymentTerms>('Net 15');
  const [vCategories, setVCategories] = useState<string[]>([]);
  const [vNotes, setVNotes] = useState('');

  // Purchase Order Builder Modal
  const [isPoModalOpen, setIsPoModalOpen] = useState(false);
  const [poSupplierId, setPoSupplierId] = useState('');
  const [poExpectedDate, setPoExpectedDate] = useState(addDaysIsoDate(2));
  const [poGstRate, setPoGstRate] = useState<number>(0);
  const [poAdvancePaid, setPoAdvancePaid] = useState('0');
  const [poNotes, setPoNotes] = useState('');
  const [poItems, setPoItems] = useState<PurchaseOrderItem[]>([]);
  const [poProductPickId, setPoProductPickId] = useState('');

  // PO Detail & Receiving Modal
  const [selectedPoId, setSelectedPoId] = useState<string | null>(null);
  const [receiveInputs, setReceiveInputs] = useState<Record<string, string>>({});
  const [receiveNote, setReceiveNote] = useState('Shipment verified & stocked');
  const [paymentInput, setPaymentInput] = useState('');
  const [copiedPoId, setCopiedPoId] = useState<string | null>(null);

  // Low-Stock Reorder Multi-Select
  const [selectedReorderIds, setSelectedReorderIds] = useState<Record<string, boolean>>({});

  const showToast = (msg: string) => {
    setToastMessage(msg);
    setTimeout(() => setToastMessage(null), 3200);
  };

  // All catalog categories
  const allCategories = useMemo(() => {
    const set = new Set<string>();
    managedCategories.forEach(c => {
      if (c) set.add(c);
    });
    products.forEach(p => {
      if (p.category) set.add(p.category);
    });
    suppliers.forEach(s => s.categories.forEach(c => set.add(c)));
    return Array.from(set).sort();
  }, [managedCategories, products, suppliers]);

  // Low-Stock Reorder Queue
  const reorderQueue = useMemo(
    () => buildLowStockReorderQueue(products, suppliers, purchaseOrders),
    [products, suppliers, purchaseOrders]
  );

  // Pre-open PO Builder if navigated with a prefillProductId (from Stock or Analytics)
  useEffect(() => {
    if (!prefillProductId) return;
    const prod = products.find(p => p.id === prefillProductId);
    if (prod) {
      const matchedSup =
        suppliers.find(s => s.categories.includes(prod.category)) || suppliers[0];
      if (matchedSup) {
        setPoSupplierId(matchedSup.id);
        setPoExpectedDate(addDaysIsoDate(matchedSup.leadTimeDays));
      }
      const prefUnit = getPreferredUnit(prod);
      const suggestedQty =
        prefUnit === 'bundle'
          ? Math.max(
              1,
              Math.ceil(Math.max(prod.lowStockThreshold * 2, prod.bundlePieces) / Math.max(1, prod.bundlePieces))
            )
          : Math.max(1, prod.lowStockThreshold * 2);
      const unitCost = estimateWholesaleUnitCost(prod, prefUnit);
      setPoItems([normalizePoItem(prod, prefUnit, suggestedQty, unitCost, 0)]);
      setPoGstRate(0);
      setPoAdvancePaid('0');
      setPoNotes(`Restock order for ${prod.name}`);
      setIsPoModalOpen(true);
    }
    if (onClearPrefill) onClearPrefill();
  }, [prefillProductId, products, suppliers, onClearPrefill]);

  // Selected PO for Detail Modal
  const selectedPo = useMemo(
    () => purchaseOrders.find(po => po.id === selectedPoId) || null,
    [purchaseOrders, selectedPoId]
  );

  // Initialize receive inputs whenever selectedPo changes
  useEffect(() => {
    if (!selectedPo) return;
    const next: Record<string, string> = {};
    selectedPo.items.forEach(item => {
      const key = `${item.productId}__${item.unitType}`;
      const remaining = Math.max(0, item.orderedQty - item.receivedQty);
      next[key] = String(remaining);
    });
    setReceiveInputs(next);
    const unpaid = Math.max(0, selectedPo.totalAmount - selectedPo.amountPaid);
    setPaymentInput(unpaid > 0 ? String(Math.round(unpaid * 100) / 100) : '');
  }, [selectedPo]);

  // Summary KPIs
  const kpis = useMemo(() => {
    let openValue = 0;
    let openCount = 0;
    let overdueCount = 0;
    let dueTodayCount = 0;
    let totalPayable = 0;

    purchaseOrders.forEach(po => {
      const sched = getDeliveryScheduleInfo(po);
      if (po.status === 'ordered' || po.status === 'in_transit' || po.status === 'partial') {
        openCount += 1;
        openValue += po.totalAmount;
        if (sched.urgency === 'overdue') overdueCount += 1;
        if (sched.urgency === 'due_today') dueTodayCount += 1;
      }
      if (po.status !== 'cancelled' && po.status !== 'draft') {
        totalPayable += Math.max(0, po.totalAmount - po.amountPaid);
      }
    });

    const totalDeliv = suppliers.reduce((s, v) => s + (v.totalDeliveries || 0), 0);
    const onTimeDeliv = suppliers.reduce((s, v) => s + (v.onTimeDeliveries || 0), 0);
    const avgOnTimeRate = totalDeliv > 0 ? Math.round((onTimeDeliv / totalDeliv) * 100) : 100;

    return {
      vendorCount: suppliers.length,
      openCount,
      openValue,
      overdueCount,
      dueTodayCount,
      totalPayable,
      avgOnTimeRate,
    };
  }, [purchaseOrders, suppliers]);

  // Filtered Purchase Orders
  const filteredOrders = useMemo(() => {
    return purchaseOrders
      .filter(po => {
        const sched = getDeliveryScheduleInfo(po);
        if (poFilter === 'active') {
          if (po.status !== 'ordered' && po.status !== 'in_transit' && po.status !== 'partial') {
            return false;
          }
        } else if (poFilter === 'overdue') {
          if (sched.urgency !== 'overdue' && sched.urgency !== 'due_today') return false;
        } else if (poFilter === 'received') {
          if (po.status !== 'received') return false;
        } else if (poFilter === 'draft') {
          if (po.status !== 'draft') return false;
        }

        if (searchQuery.trim()) {
          const q = searchQuery.toLowerCase();
          return (
            po.poNumber.toLowerCase().includes(q) ||
            po.supplierName.toLowerCase().includes(q) ||
            po.items.some(i => i.productName.toLowerCase().includes(q))
          );
        }
        return true;
      })
      .sort((a, b) => new Date(b.orderDate).getTime() - new Date(a.orderDate).getTime());
  }, [purchaseOrders, poFilter, searchQuery]);

  // Filtered Vendors
  const filteredSuppliers = useMemo(() => {
    if (!searchQuery.trim()) return suppliers;
    const q = searchQuery.toLowerCase();
    return suppliers.filter(
      s =>
        s.name.toLowerCase().includes(q) ||
        (s.contactPerson || '').toLowerCase().includes(q) ||
        s.phone.includes(q) ||
        s.categories.some(c => c.toLowerCase().includes(q))
    );
  }, [suppliers, searchQuery]);

  // Vendor stats map
  const supplierStatsMap = useMemo(() => {
    const map = new Map<string, { totalSpend: number; openPos: number; payable: number }>();
    suppliers.forEach(s => map.set(s.id, { totalSpend: 0, openPos: 0, payable: 0 }));
    purchaseOrders.forEach(po => {
      const curr = map.get(po.supplierId) || { totalSpend: 0, openPos: 0, payable: 0 };
      if (po.status !== 'cancelled' && po.status !== 'draft') {
        curr.totalSpend += po.totalAmount;
        curr.payable += Math.max(0, po.totalAmount - po.amountPaid);
      }
      if (po.status === 'ordered' || po.status === 'in_transit' || po.status === 'partial') {
        curr.openPos += 1;
      }
      map.set(po.supplierId, curr);
    });
    return map;
  }, [suppliers, purchaseOrders]);

  // Timeline groups
  const timelineGroups = useMemo(() => {
    const active = purchaseOrders.filter(po => po.status !== 'cancelled' && po.status !== 'draft');
    const overdue: PurchaseOrder[] = [];
    const dueToday: PurchaseOrder[] = [];
    const upcoming: PurchaseOrder[] = [];
    const completed: PurchaseOrder[] = [];

    active.forEach(po => {
      const sched = getDeliveryScheduleInfo(po);
      if (sched.urgency === 'overdue') overdue.push(po);
      else if (sched.urgency === 'due_today') dueToday.push(po);
      else if (sched.urgency === 'upcoming') upcoming.push(po);
      else if (sched.urgency === 'completed') completed.push(po);
    });

    upcoming.sort((a, b) => a.expectedDeliveryDate.localeCompare(b.expectedDeliveryDate));
    completed.sort((a, b) => (b.actualDeliveryDate || b.updatedAt).localeCompare(a.actualDeliveryDate || a.updatedAt));

    return { overdue, dueToday, upcoming, completed };
  }, [purchaseOrders]);

  // Open Vendor Modal for New or Edit
  const openVendorModal = (vendor?: Supplier) => {
    soundManager.playMechanicalClick();
    if (vendor) {
      setEditingVendor(vendor);
      setVName(vendor.name);
      setVContact(vendor.contactPerson || '');
      setVPhone(vendor.phone);
      setVEmail(vendor.email || '');
      setVGstin(vendor.gstin || '');
      setVAddress(vendor.address || '');
      setVLeadTime(String(vendor.leadTimeDays));
      setVTerms(vendor.paymentTerms);
      setVCategories(vendor.categories);
      setVNotes(vendor.notes || '');
    } else {
      setEditingVendor(null);
      setVName('');
      setVContact('');
      setVPhone('');
      setVEmail('');
      setVGstin('');
      setVAddress('');
      setVLeadTime('2');
      setVTerms('Net 15');
      setVCategories([]);
      setVNotes('');
    }
    setIsVendorModalOpen(true);
  };

  const handleVendorSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!vName.trim() || !vPhone.trim()) return;

    const now = new Date().toISOString();
    const supplier: Supplier = {
      id: editingVendor ? editingVendor.id : `sup_${Date.now()}`,
      name: vName.trim(),
      contactPerson: vContact.trim() || undefined,
      phone: vPhone.trim(),
      email: vEmail.trim() || undefined,
      gstin: vGstin.trim().toUpperCase() || undefined,
      address: vAddress.trim() || undefined,
      categories: vCategories.length > 0 ? vCategories : ['General FMCG'],
      leadTimeDays: Math.max(1, parseInt(vLeadTime, 10) || 2),
      paymentTerms: vTerms,
      notes: vNotes.trim() || undefined,
      onTimeDeliveries: editingVendor ? editingVendor.onTimeDeliveries : 0,
      totalDeliveries: editingVendor ? editingVendor.totalDeliveries : 0,
      createdAt: editingVendor ? editingVendor.createdAt : now,
      updatedAt: now,
    };

    soundManager.playCheckoutSuccess();
    onSaveSupplier(supplier);
    setIsVendorModalOpen(false);
    showToast(editingVendor ? `Updated vendor ${supplier.name}` : `Added vendor ${supplier.name}`);
  };

  // Open PO Modal
  const openNewPoModal = (supplierId?: string, initialItems?: PurchaseOrderItem[], initialNotes?: string) => {
    soundManager.playMechanicalClick();
    const chosenSup =
      suppliers.find(s => s.id === supplierId) || suppliers[0] || null;
    setPoSupplierId(chosenSup ? chosenSup.id : '');
    setPoExpectedDate(addDaysIsoDate(chosenSup ? chosenSup.leadTimeDays : 2));
    setPoGstRate(0);
    setPoAdvancePaid('0');
    setPoNotes(initialNotes || '');
    setPoItems(initialItems || []);
    setPoProductPickId(products[0]?.id || '');
    setIsPoModalOpen(true);
  };

  const handleSelectPoSupplier = (id: string) => {
    setPoSupplierId(id);
    const sup = suppliers.find(s => s.id === id);
    if (sup) {
      setPoExpectedDate(addDaysIsoDate(sup.leadTimeDays));
    }
  };

  const handleAddProductToPo = () => {
    const prod = products.find(p => p.id === poProductPickId);
    if (!prod) return;
    const prefUnit = getPreferredUnit(prod);
    soundManager.playItemAdded();
    setPoItems(prev => {
      const existing = prev.find(i => i.productId === prod.id && i.unitType === prefUnit);
      if (existing) {
        return prev.map(i =>
          i.productId === prod.id && i.unitType === prefUnit
            ? normalizePoItem(prod, prefUnit, i.orderedQty + 1, i.unitCost, 0)
            : i
        );
      }
      return [
        ...prev,
        normalizePoItem(
          prod,
          prefUnit,
          prefUnit === 'bundle' ? 2 : Math.max(1, prod.lowStockThreshold),
          estimateWholesaleUnitCost(prod, prefUnit),
          0
        ),
      ];
    });
  };

  const handleAutoFillLowStockInPo = () => {
    const sup = suppliers.find(s => s.id === poSupplierId);
    const candidates = products.filter(p => {
      if (p.stockPieces > p.lowStockThreshold) return false;
      if (sup && sup.categories.length > 0) {
        const matchesCat = sup.categories.includes(p.category);
        if (matchesCat) return true;
      }
      return true;
    });

    if (candidates.length === 0) {
      showToast('All catalog items are currently above threshold.');
      return;
    }

    // Prioritize items matching vendor's category if any match
    const catMatched = sup
      ? candidates.filter(p => sup.categories.includes(p.category))
      : candidates;
    const toUse = catMatched.length > 0 ? catMatched : candidates;

    soundManager.playScannerBeep();
    const newItems: PurchaseOrderItem[] = toUse.map(prod => {
      const prefUnit = getPreferredUnit(prod);
      const qty =
        prefUnit === 'bundle'
          ? Math.max(
              1,
              Math.ceil(Math.max(prod.lowStockThreshold * 2, prod.bundlePieces) / Math.max(1, prod.bundlePieces))
            )
          : Math.max(1, prod.lowStockThreshold * 2);
      return normalizePoItem(prod, prefUnit, qty, estimateWholesaleUnitCost(prod, prefUnit), 0);
    });

    setPoItems(newItems);
    showToast(`Added ${newItems.length} low-stock SKU${newItems.length > 1 ? 's' : ''} to PO`);
  };

  const handleUpdatePoLine = (
    index: number,
    patch: Partial<{ unitType: UnitType; orderedQty: number; unitCost: number }>
  ) => {
    setPoItems(prev =>
      prev.map((item, idx) => {
        if (idx !== index) return item;
        const prod = products.find(p => p.id === item.productId);
        if (!prod) return item;
        const nextUnit = patch.unitType ?? item.unitType;
        const nextQty = patch.orderedQty ?? item.orderedQty;
        const nextCost =
          patch.unitCost !== undefined
            ? patch.unitCost
            : patch.unitType && patch.unitType !== item.unitType
            ? estimateWholesaleUnitCost(prod, nextUnit)
            : item.unitCost;
        return normalizePoItem(prod, nextUnit, nextQty, nextCost, 0);
      })
    );
  };

  const poSubtotal = useMemo(
    () => poItems.reduce((sum, item) => sum + item.lineTotal, 0),
    [poItems]
  );
  const poGstAmount = useMemo(
    () => Math.round(poSubtotal * (poGstRate / 100) * 100) / 100,
    [poSubtotal, poGstRate]
  );
  const poTotalAmount = poSubtotal + poGstAmount;

  const handleSubmitPo = (initialStatus: 'draft' | 'ordered') => {
    const sup = suppliers.find(s => s.id === poSupplierId);
    if (!sup || poItems.length === 0) return;

    const now = new Date().toISOString();
    const year = new Date().getFullYear();
    let maxSeq = 1002;
    purchaseOrders.forEach(po => {
      const m = po.poNumber.match(/(\d+)$/);
      if (m) maxSeq = Math.max(maxSeq, parseInt(m[1], 10));
    });
    const poNumber = `PO-${year}-${maxSeq + 1}`;
    const advance = Math.min(poTotalAmount, Math.max(0, parseFloat(poAdvancePaid) || 0));

    const newPo: PurchaseOrder = {
      id: `po_${Date.now()}`,
      poNumber,
      supplierId: sup.id,
      supplierName: sup.name,
      supplierPhone: sup.phone,
      status: initialStatus,
      orderDate: now,
      expectedDeliveryDate: poExpectedDate || addDaysIsoDate(sup.leadTimeDays),
      items: poItems,
      subtotal: poSubtotal,
      gstAmount: poGstAmount,
      totalAmount: poTotalAmount,
      amountPaid: advance,
      notes: poNotes.trim() || undefined,
      timeline: [
        {
          id: `evt_${Date.now()}`,
          status: initialStatus,
          timestamp: now,
          note:
            initialStatus === 'draft'
              ? `Draft PO created for ${sup.name}`
              : `PO ${poNumber} issued to ${sup.name}${advance > 0 ? ` (Advance ${formatCurrency(advance)})` : ''}`,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };

    soundManager.playCheckoutSuccess();
    onSavePurchaseOrder(newPo);
    setIsPoModalOpen(false);
    setSelectedPoId(newPo.id);
    showToast(`${poNumber} ${initialStatus === 'draft' ? 'saved as draft' : 'sent & tracked'}`);
  };

  // Generate PO from Low-Stock Reorder Queue
  const handleCreatePoFromReorderQueue = () => {
    const selected = reorderQueue.filter(
      c => selectedReorderIds[c.product.id] && c.suggestedBundles > 0
    );
    const itemsToOrder =
      selected.length > 0
        ? selected
        : reorderQueue.filter(c => c.suggestedBundles > 0);

    if (itemsToOrder.length === 0) {
      showToast('No uncovered low-stock items require ordering.');
      return;
    }

    const firstSup = itemsToOrder[0].suggestedSupplier || suppliers[0];
    const poLines = itemsToOrder.map(c =>
      normalizePoItem(
        c.product,
        c.suggestedUnit,
        Math.max(1, c.suggestedBundles),
        estimateWholesaleUnitCost(c.product, c.suggestedUnit),
        0
      )
    );

    openNewPoModal(
      firstSup?.id,
      poLines,
      `Automated restock for ${poLines.length} low-stock item${poLines.length > 1 ? 's' : ''}`
    );
    setSelectedReorderIds({});
  };

  // Confirm Receive Shipment inside PO Detail Modal
  const handleConfirmReceive = () => {
    if (!selectedPo) return;
    const receipts = selectedPo.items
      .map(item => {
        const key = `${item.productId}__${item.unitType}`;
        const qty = Math.max(0, parseInt(receiveInputs[key] || '0', 10) || 0);
        return {
          productId: item.productId,
          unitType: item.unitType,
          receiveQtyNow: qty,
        };
      })
      .filter(r => r.receiveQtyNow > 0);

    if (receipts.length === 0) {
      showToast('Enter at least 1 unit to receive.');
      return;
    }

    soundManager.playCheckoutSuccess();
    onReceivePurchaseOrder(
      selectedPo.id,
      receipts,
      receiveNote.trim() || 'Shipment received & added to inventory'
    );
    showToast(`Stock updated from ${selectedPo.poNumber}`);
  };

  // Export POs to CSV
  const handleExportPosCsv = () => {
    soundManager.playMechanicalClick();
    const headers = [
      'PO Number',
      'Supplier',
      'Status',
      'Order Date',
      'Expected Delivery',
      'Actual Delivery',
      'Items Count',
      'Total Amount (INR)',
      'Amount Paid (INR)',
      'Balance Due (INR)',
    ];

    const rows = purchaseOrders.map(po => [
      po.poNumber,
      `"${po.supplierName.replace(/"/g, '""')}"`,
      getPoStatusLabel(po.status),
      po.orderDate.slice(0, 10),
      po.expectedDeliveryDate,
      po.actualDeliveryDate ? po.actualDeliveryDate.slice(0, 10) : '',
      po.items.length,
      po.totalAmount,
      po.amountPaid,
      Math.max(0, po.totalAmount - po.amountPaid),
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sq-enterprises-purchase-orders-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast('Exported purchase orders CSV');
  };

  const handleCopyPoText = async (po: PurchaseOrder) => {
    try {
      await navigator.clipboard.writeText(buildWhatsAppPurchaseOrderText(po));
      setCopiedPoId(po.id);
      setTimeout(() => setCopiedPoId(null), 2000);
    } catch {
      showToast('Could not copy PO summary');
    }
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Workspace Header */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Truck className="w-5 h-5 text-blue-400" />
              Supplier &amp; Purchase Order Management
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Vendor directory · Purchase orders · Delivery SLA tracking · 1-click inventory restock
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleExportPosCsv}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
              title="Download Purchase Orders CSV"
            >
              <Download className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Export CSV</span>
            </button>

            <button
              type="button"
              onClick={() => openVendorModal()}
              className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-100 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition"
            >
              <Building2 className="w-3.5 h-3.5 text-slate-300" />
              <span>Add Vendor</span>
            </button>

            <button
              type="button"
              onClick={() => openNewPoModal()}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold shadow-md shadow-blue-900/30 flex items-center gap-1.5 transition active:scale-95"
            >
              <Plus className="w-4 h-4" />
              <span>New Purchase Order</span>
            </button>
          </div>
        </div>

        {/* Toast Feedback */}
        {toastMessage && (
          <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between">
            <span>{toastMessage}</span>
            <button
              type="button"
              onClick={() => setToastMessage(null)}
              className="text-emerald-300 hover:text-white"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* KPI Summary Grid */}
        <div
          className={`grid ${
            isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
          } gap-2.5`}
        >
          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">Open Orders</div>
            <div className="text-lg font-bold text-white tabular-nums mt-0.5">
              {kpis.openCount}{' '}
              <span className="text-xs font-medium text-slate-400">
                ({formatCurrency(kpis.openValue)})
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">Delivery Alerts</div>
            <div className="text-lg font-bold tabular-nums mt-0.5 flex items-baseline gap-2">
              <span className={kpis.overdueCount > 0 ? 'text-rose-400' : 'text-emerald-400'}>
                {kpis.overdueCount} overdue
              </span>
              <span className="text-xs font-medium text-amber-400">
                · {kpis.dueTodayCount} due today
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">Active Vendors &amp; SLA</div>
            <div className="text-lg font-bold text-white tabular-nums mt-0.5">
              {kpis.vendorCount} vendors{' '}
              <span className="text-xs font-medium text-emerald-400">
                · {kpis.avgOnTimeRate}% on-time
              </span>
            </div>
          </div>

          <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
            <div className="text-[11px] text-slate-400">Vendor Balance Payable</div>
            <div className="text-lg font-bold text-amber-300 tabular-nums mt-0.5">
              {formatCurrency(kpis.totalPayable)}
            </div>
          </div>
        </div>

        {/* Sub-navigation & Search */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800 overflow-x-auto">
            {(
              [
                { id: 'orders', label: `Purchase Orders (${purchaseOrders.length})` },
                { id: 'vendors', label: `Vendors (${suppliers.length})` },
                { id: 'timeline', label: 'Delivery Timeline' },
                { id: 'reorder', label: `Low-Stock Reorder (${reorderQueue.length})` },
              ] as const
            ).map(tab => (
              <button
                key={tab.id}
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setActiveSubTab(tab.id);
                }}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                  activeSubTab === tab.id
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-400 hover:text-white'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {(activeSubTab === 'orders' || activeSubTab === 'vendors') && (
            <div className="relative sm:w-72">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder={
                  activeSubTab === 'orders'
                    ? 'Search PO #, vendor, or item...'
                    : 'Search vendor, phone, category...'
                }
                className="w-full pl-8 pr-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* ================= 1. PURCHASE ORDERS VIEW ================= */}
        {activeSubTab === 'orders' && (
          <div className="space-y-3">
            {/* PO Filter Bar */}
            <div className="flex items-center gap-1.5 flex-wrap">
              {(
                [
                  { id: 'all', label: 'All Orders' },
                  { id: 'active', label: 'Open & In Transit' },
                  { id: 'overdue', label: 'Overdue / Due Today' },
                  { id: 'received', label: 'Received' },
                  { id: 'draft', label: 'Drafts' },
                ] as const
              ).map(f => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setPoFilter(f.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition ${
                    poFilter === f.id
                      ? 'bg-slate-800 text-white border-slate-600'
                      : 'bg-slate-900/50 text-slate-400 border-slate-800 hover:text-slate-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {filteredOrders.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
                <ClipboardList className="w-8 h-8 text-slate-500 mx-auto" />
                <div className="text-sm font-semibold text-slate-300">
                  No purchase orders match this filter
                </div>
                <p className="text-xs text-slate-500">
                  Create a purchase order or use the Low-Stock Reorder queue to generate one from inventory alerts.
                </p>
              </div>
            ) : (
              <div className="divide-y divide-slate-800/80 rounded-2xl bg-slate-900/60 border border-slate-800">
                {filteredOrders.map(po => {
                  const sched = getDeliveryScheduleInfo(po);
                  const totalOrderedPcs = po.items.reduce((s, i) => s + i.totalOrderedPieces, 0);
                  const totalReceivedPcs = po.items.reduce((s, i) => s + i.totalReceivedPieces, 0);
                  const receiptPct =
                    totalOrderedPcs > 0
                      ? Math.min(100, Math.round((totalReceivedPcs / totalOrderedPcs) * 100))
                      : 0;
                  const balanceDue = Math.max(0, po.totalAmount - po.amountPaid);

                  return (
                    <div
                      key={po.id}
                      className={`p-4 hover:bg-slate-900 transition flex ${
                        isDesktopLayout ? 'flex-row items-center' : 'flex-col'
                      } justify-between gap-3`}
                    >
                      <div className="space-y-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <button
                            type="button"
                            onClick={() => setSelectedPoId(po.id)}
                            className="font-mono font-bold text-sm text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline"
                          >
                            {po.poNumber}
                          </button>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="font-semibold text-sm text-white truncate">
                            {po.supplierName}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span
                            className={`text-xs font-semibold ${
                              po.status === 'received'
                                ? 'text-emerald-400'
                                : po.status === 'cancelled'
                                ? 'text-slate-500'
                                : po.status === 'in_transit'
                                ? 'text-sky-400'
                                : po.status === 'partial'
                                ? 'text-amber-300'
                                : 'text-slate-300'
                            }`}
                          >
                            {getPoStatusLabel(po.status)}
                          </span>
                        </div>

                        <div className="flex items-center gap-2 text-xs text-slate-400 flex-wrap">
                          <span>Ordered {formatDateOnly(new Date(po.orderDate))}</span>
                          <span aria-hidden="true">·</span>
                          <span>ETA {po.expectedDeliveryDate}</span>
                          <span aria-hidden="true">·</span>
                          <span
                            className={`font-semibold ${
                              sched.urgency === 'overdue'
                                ? 'text-rose-400'
                                : sched.urgency === 'due_today'
                                ? 'text-amber-300'
                                : sched.urgency === 'completed'
                                ? 'text-emerald-400'
                                : 'text-slate-300'
                            }`}
                          >
                            {sched.label}
                          </span>
                          <span aria-hidden="true">·</span>
                          <span className="tabular-nums">
                            {po.items.length} SKU{po.items.length > 1 ? 's' : ''} ({totalReceivedPcs}/
                            {totalOrderedPcs} pcs received)
                          </span>
                        </div>

                        {/* Item preview line */}
                        <div className="text-xs text-slate-500 truncate">
                          {po.items
                            .map(
                              i =>
                                `${i.productName} (${i.orderedQty} ${
                                  i.unitType === 'bundle' ? i.bundleUnitName : 'Pc'
                                })`
                            )
                            .join(' · ')}
                        </div>
                      </div>

                      {/* Right Metrics & Actions */}
                      <div className="flex flex-wrap items-center justify-between lg:justify-end gap-4">
                        <div className="text-left lg:text-right">
                          <div className="text-sm font-bold text-white tabular-nums">
                            {formatCurrency(po.totalAmount)}
                          </div>
                          <div className="text-[11px] tabular-nums text-slate-400">
                            {balanceDue > 0 ? (
                              <span className="text-amber-300">
                                Due: {formatCurrency(balanceDue)}
                              </span>
                            ) : (
                              <span className="text-emerald-400">Paid in full</span>
                            )}
                          </div>
                        </div>

                        {/* Progress Bar mini */}
                        <div className="w-20 hidden sm:block">
                          <div className="h-1.5 rounded-full bg-slate-800 overflow-hidden">
                            <div
                              className={`h-full transition-all ${
                                receiptPct === 100 ? 'bg-emerald-500' : 'bg-blue-500'
                              }`}
                              style={{ width: `${receiptPct}%` }}
                            />
                          </div>
                          <div className="text-[10px] text-slate-400 tabular-nums mt-0.5 text-right">
                            {receiptPct}% stocked
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {po.status === 'draft' && (
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playMechanicalClick();
                                onUpdatePoStatus(po.id, 'ordered', 'PO confirmed & sent to vendor');
                                showToast(`${po.poNumber} marked as Ordered`);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-semibold transition"
                            >
                              Issue Order
                            </button>
                          )}

                          {po.status === 'ordered' && (
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playMechanicalClick();
                                onUpdatePoStatus(po.id, 'in_transit', 'Marked dispatched / in transit');
                                showToast(`${po.poNumber} marked In Transit`);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-semibold transition"
                            >
                              Mark In Transit
                            </button>
                          )}

                          {(po.status === 'ordered' ||
                            po.status === 'in_transit' ||
                            po.status === 'partial') && (
                            <button
                              type="button"
                              onClick={() => {
                                soundManager.playMechanicalClick();
                                setSelectedPoId(po.id);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1 transition"
                            >
                              <PackageCheck className="w-3.5 h-3.5" />
                              <span>Receive Stock</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              setSelectedPoId(po.id);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition"
                          >
                            Details
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= 2. VENDORS DIRECTORY VIEW ================= */}
        {activeSubTab === 'vendors' && (
          <div className="space-y-3">
            {filteredSuppliers.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
                <Building2 className="w-8 h-8 text-slate-500 mx-auto" />
                <div className="text-sm font-semibold text-slate-300">No vendors found</div>
                <button
                  type="button"
                  onClick={() => openVendorModal()}
                  className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold"
                >
                  Add First Vendor
                </button>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {filteredSuppliers.map(vendor => {
                  const stats = supplierStatsMap.get(vendor.id) || {
                    totalSpend: 0,
                    openPos: 0,
                    payable: 0,
                  };
                  const onTimePct = getSupplierOnTimeRate(vendor);

                  return (
                    <div
                      key={vendor.id}
                      className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-col justify-between gap-3"
                    >
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <h3 className="font-bold text-sm text-white truncate">{vendor.name}</h3>
                            <div className="text-xs text-slate-400 mt-0.5 flex items-center gap-1.5 flex-wrap">
                              {vendor.contactPerson && <span>{vendor.contactPerson}</span>}
                              {vendor.contactPerson && <span aria-hidden="true">·</span>}
                              <span className="font-mono">{vendor.phone}</span>
                              {vendor.gstin && (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span className="font-mono text-slate-300">GSTIN {vendor.gstin}</span>
                                </>
                              )}
                            </div>
                          </div>

                          <div className="text-right flex-shrink-0">
                            <div
                              className={`text-xs font-bold tabular-nums ${
                                onTimePct >= 85
                                  ? 'text-emerald-400'
                                  : onTimePct >= 70
                                  ? 'text-amber-300'
                                  : 'text-rose-400'
                              }`}
                            >
                              {onTimePct}% on-time
                            </div>
                            <div className="text-[11px] text-slate-500 tabular-nums">
                              {vendor.leadTimeDays}d lead · {vendor.paymentTerms}
                            </div>
                          </div>
                        </div>

                        <div className="text-xs text-slate-300">
                          Supplies: {vendor.categories.join(' · ')}
                        </div>

                        {vendor.address && (
                          <div className="text-xs text-slate-400">{vendor.address}</div>
                        )}
                        {vendor.notes && (
                          <div className="text-xs text-slate-400 italic">{vendor.notes}</div>
                        )}
                      </div>

                      <div className="pt-3 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-2">
                        <div className="text-xs text-slate-400 tabular-nums flex items-center gap-2">
                          <span>{stats.openPos} open PO</span>
                          <span aria-hidden="true">·</span>
                          <span>Spend {formatCurrency(stats.totalSpend)}</span>
                          {stats.payable > 0 && (
                            <>
                              <span aria-hidden="true">·</span>
                              <span className="text-amber-300 font-semibold">
                                Payable {formatCurrency(stats.payable)}
                              </span>
                            </>
                          )}
                        </div>

                        <div className="flex items-center gap-1.5">
                          <a
                            href={`tel:${vendor.phone}`}
                            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                            title={`Call ${vendor.phone}`}
                            aria-label={`Call ${vendor.name}`}
                          >
                            <Phone className="w-3.5 h-3.5" />
                          </a>

                          <button
                            type="button"
                            onClick={() => openVendorModal(vendor)}
                            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 transition"
                            title="Edit Vendor"
                            aria-label={`Edit ${vendor.name}`}
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>

                          {confirmDeleteVendorId === vendor.id ? (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => {
                                  soundManager.playAlertSound();
                                  onDeleteSupplier(vendor.id);
                                  setConfirmDeleteVendorId(null);
                                  showToast(`Removed vendor ${vendor.name}`);
                                }}
                                className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[11px] font-bold"
                              >
                                Confirm
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmDeleteVendorId(null)}
                                className="px-2 py-1 rounded-lg bg-slate-800 text-slate-300 text-[11px]"
                              >
                                Cancel
                              </button>
                            </div>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmDeleteVendorId(vendor.id)}
                              className="p-2 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 border border-slate-700 transition"
                              title="Delete Vendor"
                              aria-label={`Delete ${vendor.name}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openNewPoModal(vendor.id)}
                            className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1 transition"
                          >
                            <Plus className="w-3.5 h-3.5" />
                            <span>Order PO</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* ================= 3. DELIVERY TIMELINE VIEW ================= */}
        {activeSubTab === 'timeline' && (
          <div className="space-y-5">
            {(
              [
                {
                  key: 'overdue',
                  title: 'Overdue Shipments',
                  subtitle: 'Past expected delivery date — follow up with vendor immediately',
                  orders: timelineGroups.overdue,
                  tone: 'text-rose-400',
                },
                {
                  key: 'dueToday',
                  title: 'Arriving Today',
                  subtitle: 'Scheduled for unloading & inventory check-in today',
                  orders: timelineGroups.dueToday,
                  tone: 'text-amber-300',
                },
                {
                  key: 'upcoming',
                  title: 'Upcoming Scheduled Deliveries',
                  subtitle: 'Confirmed orders within vendor lead-time window',
                  orders: timelineGroups.upcoming,
                  tone: 'text-sky-400',
                },
                {
                  key: 'completed',
                  title: 'Completed Deliveries',
                  subtitle: 'Verified & synced into live POS inventory',
                  orders: timelineGroups.completed,
                  tone: 'text-emerald-400',
                },
              ] as const
            ).map(group => (
              <section key={group.key} className="space-y-2.5">
                <div className="flex items-baseline justify-between border-b border-slate-800 pb-1.5">
                  <div>
                    <h3 className={`text-sm font-bold ${group.tone}`}>
                      {group.title} ({group.orders.length})
                    </h3>
                    <p className="text-xs text-slate-400">{group.subtitle}</p>
                  </div>
                </div>

                {group.orders.length === 0 ? (
                  <div className="p-4 rounded-xl bg-slate-900/30 border border-slate-800/70 text-xs text-slate-500">
                    No shipments in this delivery window.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {group.orders.map(po => {
                      const sched = getDeliveryScheduleInfo(po);
                      const stageIdx =
                        po.status === 'received'
                          ? 3
                          : po.status === 'partial'
                          ? 2
                          : po.status === 'in_transit'
                          ? 1
                          : 0;
                      const stages = ['Ordered', 'In Transit', 'Receiving', 'Delivered'];
                      const waUrl = buildWhatsAppLink(
                        po.supplierPhone,
                        `Hello ${po.supplierName}, following up from SQ ENTERPRISES regarding ${po.poNumber} (ETA ${po.expectedDeliveryDate}). Please share current dispatch/delivery status.`
                      );

                      return (
                        <div
                          key={po.id}
                          className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 space-y-3"
                        >
                          <div className="flex flex-wrap items-start justify-between gap-2">
                            <div>
                              <div className="flex items-center gap-2 flex-wrap">
                                <button
                                  type="button"
                                  onClick={() => setSelectedPoId(po.id)}
                                  className="font-mono font-bold text-sm text-blue-400 hover:underline"
                                >
                                  {po.poNumber}
                                </button>
                                <span className="text-slate-600" aria-hidden="true">·</span>
                                <span className="font-bold text-sm text-white">
                                  {po.supplierName}
                                </span>
                                <span className="text-slate-600" aria-hidden="true">·</span>
                                <span className={`text-xs font-semibold ${group.tone}`}>
                                  {sched.label}
                                </span>
                              </div>
                              <div className="text-xs text-slate-400 mt-0.5">
                                Ordered {formatDateOnly(new Date(po.orderDate))} · Expected{' '}
                                <span className="font-mono text-slate-200">
                                  {po.expectedDeliveryDate}
                                </span>
                                {po.actualDeliveryDate && (
                                  <>
                                    {' '}
                                    · Delivered{' '}
                                    <span className="font-mono text-emerald-300">
                                      {po.actualDeliveryDate.slice(0, 10)}
                                    </span>
                                  </>
                                )}
                              </div>
                            </div>

                            <div className="flex items-center gap-1.5">
                              {po.status !== 'received' && po.supplierPhone && (
                                <a
                                  href={waUrl}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="px-2.5 py-1.5 rounded-xl bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 border border-emerald-500/30 text-xs font-semibold flex items-center gap-1 transition"
                                >
                                  <MessageSquare className="w-3.5 h-3.5" />
                                  <span>Follow Up</span>
                                </a>
                              )}
                              {po.status === 'ordered' && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    soundManager.playMechanicalClick();
                                    onUpdatePoStatus(po.id, 'in_transit', 'Vendor dispatched shipment');
                                    showToast(`${po.poNumber} updated to In Transit`);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/30 text-xs font-semibold"
                                >
                                  Mark In Transit
                                </button>
                              )}
                              {(po.status === 'ordered' ||
                                po.status === 'in_transit' ||
                                po.status === 'partial') && (
                                <button
                                  type="button"
                                  onClick={() => setSelectedPoId(po.id)}
                                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold"
                                >
                                  Receive Stock
                                </button>
                              )}
                            </div>
                          </div>

                          {/* 4-Step Delivery Stepper */}
                          <div className="grid grid-cols-4 gap-2 pt-1">
                            {stages.map((stageLabel, idx) => {
                              const done = idx <= stageIdx;
                              return (
                                <div key={stageLabel} className="space-y-1">
                                  <div
                                    className={`h-1.5 rounded-full ${
                                      done
                                        ? po.status === 'received'
                                          ? 'bg-emerald-500'
                                          : sched.urgency === 'overdue'
                                          ? 'bg-rose-500'
                                          : 'bg-blue-500'
                                        : 'bg-slate-800'
                                    }`}
                                  />
                                  <div
                                    className={`text-[11px] font-medium ${
                                      done ? 'text-slate-200' : 'text-slate-500'
                                    }`}
                                  >
                                    {stageLabel}
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Latest Timeline Note */}
                          {po.timeline.length > 0 && (
                            <div className="text-xs text-slate-400 flex items-center justify-between pt-1 border-t border-slate-800/60">
                              <span>
                                Latest: {po.timeline[po.timeline.length - 1].note}
                              </span>
                              <span className="font-mono text-[11px] text-slate-500">
                                {new Date(
                                  po.timeline[po.timeline.length - 1].timestamp
                                ).toLocaleString('en-IN', {
                                  day: '2-digit',
                                  month: 'short',
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })}
                              </span>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </section>
            ))}
          </div>
        )}

        {/* ================= 4. LOW-STOCK REORDER QUEUE ================= */}
        {activeSubTab === 'reorder' && (
          <div className="space-y-3">
            <div className="p-4 rounded-2xl bg-slate-900/70 border border-slate-800 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-bold text-white">
                  Low-Stock Restock Recommendations
                </h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Automatically deducts stock already incoming on open Purchase Orders so you never double-order.
                </p>
              </div>
              <button
                type="button"
                onClick={handleCreatePoFromReorderQueue}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1.5 transition"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>
                  {Object.values(selectedReorderIds).some(Boolean)
                    ? 'Create PO for Selected'
                    : 'Create PO for Uncovered SKUs'}
                </span>
              </button>
            </div>

            {reorderQueue.length === 0 ? (
              <div className="p-8 rounded-2xl bg-slate-900/40 border border-slate-800 text-center space-y-2">
                <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto" />
                <div className="text-sm font-semibold text-white">
                  All products are stocked above reorder thresholds
                </div>
              </div>
            ) : (
              <div className="divide-y divide-slate-800 rounded-2xl bg-slate-900/60 border border-slate-800">
                {reorderQueue.map(candidate => {
                  const checked = !!selectedReorderIds[candidate.product.id];
                  return (
                    <div
                      key={candidate.product.id}
                      className="p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 hover:bg-slate-900"
                    >
                      <label className="flex items-start gap-3 cursor-pointer min-w-0">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={e =>
                            setSelectedReorderIds(prev => ({
                              ...prev,
                              [candidate.product.id]: e.target.checked,
                            }))
                          }
                          className="mt-1 rounded border-slate-600 bg-slate-950 text-blue-600 focus:ring-blue-500"
                        />
                        <div className="min-w-0">
                          <div className="font-bold text-sm text-white truncate">
                            {candidate.product.name}
                          </div>
                          <div className="text-xs text-slate-400 mt-0.5">
                            {candidate.product.category} · Current:{' '}
                            <span className="text-rose-400 font-semibold tabular-nums">
                              {candidate.product.stockPieces} pcs
                            </span>{' '}
                            (Threshold {candidate.product.lowStockThreshold} pcs)
                            {candidate.inTransitPieces > 0 && (
                              <>
                                {' '}
                                ·{' '}
                                <span className="text-sky-400 font-semibold tabular-nums">
                                  {candidate.inTransitPieces} pcs already on open PO
                                </span>
                              </>
                            )}
                          </div>
                          {candidate.suggestedSupplier && (
                            <div className="text-[11px] text-slate-500 mt-0.5">
                              Preferred Vendor: {candidate.suggestedSupplier.name} (
                              {candidate.suggestedSupplier.leadTimeDays}d lead)
                            </div>
                          )}
                        </div>
                      </label>

                      <div className="flex items-center justify-between sm:justify-end gap-3 pl-6 sm:pl-0">
                        {candidate.suggestedBundles > 0 ? (
                          <>
                            <div className="text-left sm:text-right">
                              <div className="text-xs font-bold text-emerald-400 tabular-nums">
                                Order {candidate.suggestedBundles}{' '}
                                {candidate.suggestedUnit === 'bundle'
                                  ? candidate.product.bundleUnitName
                                  : 'Pc'}
                                {candidate.suggestedBundles > 1 ? 's' : ''}
                              </div>
                              <div className="text-[11px] text-slate-400 tabular-nums">
                                Est. {formatCurrency(candidate.estimatedCost)}
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                openNewPoModal(
                                  candidate.suggestedSupplier?.id,
                                  [
                                    normalizePoItem(
                                      candidate.product,
                                      candidate.suggestedUnit,
                                      candidate.suggestedBundles,
                                      estimateWholesaleUnitCost(
                                        candidate.product,
                                        candidate.suggestedUnit
                                      ),
                                      0
                                    ),
                                  ],
                                  `Restock for low-stock ${candidate.product.name}`
                                )
                              }
                              className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1"
                            >
                              <span>Quick PO</span>
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          </>
                        ) : (
                          <span className="text-xs text-sky-400 font-semibold">
                            Covered by open PO
                          </span>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ================= VENDOR ADD/EDIT MODAL ================= */}
      {isVendorModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">
                {editingVendor ? 'Edit Vendor Details' : 'Add New Wholesale Vendor'}
              </h3>
              <button
                type="button"
                onClick={() => setIsVendorModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleVendorSubmit} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Supplier / Agency Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={vName}
                    onChange={e => setVName(e.target.value)}
                    placeholder="e.g. Metro FMCG Distributors"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Contact Person
                  </label>
                  <input
                    type="text"
                    value={vContact}
                    onChange={e => setVContact(e.target.value)}
                    placeholder="e.g. Rajesh Malhotra"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Phone / WhatsApp *
                  </label>
                  <input
                    type="tel"
                    required
                    value={vPhone}
                    onChange={e => setVPhone(e.target.value)}
                    placeholder="10-digit mobile number"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Email</label>
                  <input
                    type="email"
                    value={vEmail}
                    onChange={e => setVEmail(e.target.value)}
                    placeholder="orders@vendor.in"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">GSTIN</label>
                  <input
                    type="text"
                    value={vGstin}
                    onChange={e => setVGstin(e.target.value)}
                    placeholder="07AAAFM1234K1Z2"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono uppercase focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Lead Time (Days)
                  </label>
                  <input
                    type="number"
                    min="1"
                    max="60"
                    value={vLeadTime}
                    onChange={e => setVLeadTime(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Payment Terms
                  </label>
                  <select
                    value={vTerms}
                    onChange={e => setVTerms(e.target.value as SupplierPaymentTerms)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  >
                    {PAYMENT_TERMS_OPTIONS.map(t => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1.5">
                  Product Categories Supplied
                </label>
                <div className="flex flex-wrap gap-1.5">
                  {allCategories.map(cat => {
                    const active = vCategories.includes(cat);
                    return (
                      <button
                        key={cat}
                        type="button"
                        onClick={() =>
                          setVCategories(prev =>
                            prev.includes(cat) ? prev.filter(c => c !== cat) : [...prev, cat]
                          )
                        }
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium border transition ${
                          active
                            ? 'bg-blue-600 text-white border-blue-500'
                            : 'bg-slate-950 text-slate-400 border-slate-700 hover:text-white'
                        }`}
                      >
                        {cat}
                      </button>
                    );
                  })}
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Address</label>
                <input
                  type="text"
                  value={vAddress}
                  onChange={e => setVAddress(e.target.value)}
                  placeholder="Warehouse / Market address"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">Delivery Notes</label>
                <textarea
                  rows={2}
                  value={vNotes}
                  onChange={e => setVNotes(e.target.value)}
                  placeholder="Preferred delivery hours, minimum order rules, etc."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsVendorModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
                >
                  {editingVendor ? 'Save Vendor Changes' : 'Add Vendor'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= CREATE PURCHASE ORDER MODAL ================= */}
      {isPoModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl text-slate-100 shadow-2xl overflow-hidden">
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="font-bold text-sm text-white">Create Purchase Order</h3>
                <p className="text-[11px] text-slate-400">
                  Assign supplier, delivery timeline &amp; restock quantities
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsPoModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Select Vendor *
                  </label>
                  <select
                    value={poSupplierId}
                    onChange={e => handleSelectPoSupplier(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  >
                    {suppliers.length === 0 && <option value="">No vendors added yet</option>}
                    {suppliers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.leadTimeDays}d lead · {s.paymentTerms})
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Expected Delivery Date *
                  </label>
                  <input
                    type="date"
                    value={poExpectedDate}
                    onChange={e => setPoExpectedDate(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Add Item Bar */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-200">Order Items</span>
                  <button
                    type="button"
                    onClick={handleAutoFillLowStockInPo}
                    className="px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 font-semibold flex items-center gap-1"
                  >
                    <AlertTriangle className="w-3 h-3" />
                    <span>Auto-Fill Low Stock Items</span>
                  </button>
                </div>

                <div className="flex gap-2">
                  <select
                    value={poProductPickId}
                    onChange={e => setPoProductPickId(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                  >
                    {products.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.name} (Stock: {p.stockPieces} pcs ·{' '}
                        {hasConfiguredBundleTier(p)
                          ? `${p.bundleUnitName} of ${p.bundlePieces}`
                          : 'Single Piece'}
                        )
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddProductToPo}
                    className="px-3 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold flex items-center gap-1"
                  >
                    <Plus className="w-3.5 h-3.5" />
                    <span>Add</span>
                  </button>
                </div>

                {poItems.length === 0 ? (
                  <div className="py-5 text-center text-slate-500">
                    Add products above or click Auto-Fill Low Stock Items.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800">
                    {poItems.map((item, idx) => {
                      const prod = products.find(p => p.id === item.productId);
                      const configuredUnits = prod ? getConfiguredUnits(prod) : (['bundle', 'piece'] as UnitType[]);
                      const showBundleOpt = configuredUnits.includes('bundle') || item.unitType === 'bundle';
                      const showPieceOpt = configuredUnits.includes('piece') || item.unitType === 'piece';

                      return (
                      <div
                        key={`${item.productId}_${idx}`}
                        className="py-2.5 flex flex-wrap items-center justify-between gap-2"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-white truncate">
                            {item.productName}
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {item.totalOrderedPieces} total pcs
                          </div>
                        </div>

                        <div className="flex items-center gap-1.5">
                          {showBundleOpt && showPieceOpt ? (
                            <select
                              value={item.unitType}
                              onChange={e =>
                                handleUpdatePoLine(idx, {
                                  unitType: e.target.value as UnitType,
                                })
                              }
                              className="px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white"
                            >
                              <option value="bundle">{item.bundleUnitName}</option>
                              <option value="piece">Piece</option>
                            </select>
                          ) : (
                            <span className="px-2.5 py-1.5 bg-slate-900/70 border border-slate-800 rounded-lg text-slate-300 text-xs font-semibold">
                              {item.unitType === 'bundle' ? item.bundleUnitName : 'Piece'}
                            </span>
                          )}

                          <input
                            type="number"
                            min="1"
                            value={item.orderedQty}
                            onChange={e =>
                              handleUpdatePoLine(idx, {
                                orderedQty: Math.max(1, parseInt(e.target.value, 10) || 1),
                              })
                            }
                            className="w-16 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-center"
                            title="Quantity"
                          />

                          <input
                            type="number"
                            min="0"
                            value={item.unitCost}
                            onChange={e =>
                              handleUpdatePoLine(idx, {
                                unitCost: Math.max(0, parseFloat(e.target.value) || 0),
                              })
                            }
                            className="w-20 px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono text-right"
                            title="Unit Cost (INR)"
                          />

                          <div className="w-20 text-right font-bold text-emerald-300 tabular-nums">
                            {formatCurrency(item.lineTotal)}
                          </div>

                          <button
                            type="button"
                            onClick={() =>
                              setPoItems(prev => prev.filter((_, i) => i !== idx))
                            }
                            className="p-1 text-slate-500 hover:text-rose-400"
                            aria-label="Remove item"
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Tax, Advance & Notes */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">GST Rate</label>
                  <select
                    value={poGstRate}
                    onChange={e => setPoGstRate(Number(e.target.value))}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                  >
                    <option value={0}>0% (Non-GST / Inclusive)</option>
                    <option value={5}>5% GST</option>
                    <option value={12}>12% GST</option>
                    <option value={18}>18% GST</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Advance Paid (₹)
                  </label>
                  <input
                    type="number"
                    min="0"
                    value={poAdvancePaid}
                    onChange={e => setPoAdvancePaid(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono"
                  />
                </div>

                <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-center text-right">
                  <span className="text-[11px] text-slate-400">
                    Subtotal {formatCurrency(poSubtotal)}
                    {poGstAmount > 0 ? ` + GST ${formatCurrency(poGstAmount)}` : ''}
                  </span>
                  <span className="text-base font-bold text-white tabular-nums">
                    Total {formatCurrency(poTotalAmount)}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-semibold mb-1">
                  Order / Dispatch Notes
                </label>
                <input
                  type="text"
                  value={poNotes}
                  onChange={e => setPoNotes(e.target.value)}
                  placeholder="Delivery slot, transport instructions, etc."
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-slate-800 bg-slate-950/60 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsPoModalOpen(false)}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!poSupplierId || poItems.length === 0}
                onClick={() => handleSubmitPo('draft')}
                className="px-4 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-white border border-slate-700 text-xs font-bold"
              >
                Save Draft
              </button>
              <button
                type="button"
                disabled={!poSupplierId || poItems.length === 0}
                onClick={() => handleSubmitPo('ordered')}
                className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-bold"
              >
                Issue Purchase Order
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ================= PO DETAIL & RECEIVE STOCK MODAL ================= */}
      {selectedPo && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-2xl max-h-[92vh] flex flex-col bg-slate-900 border border-slate-700 rounded-2xl text-slate-100 shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-5 py-3.5 border-b border-slate-800 flex items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="font-mono font-bold text-base text-white">
                    {selectedPo.poNumber}
                  </h3>
                  <span className="text-slate-600" aria-hidden="true">·</span>
                  <span className="text-xs font-semibold text-blue-300">
                    {getPoStatusLabel(selectedPo.status)}
                  </span>
                </div>
                <p className="text-xs text-slate-400">
                  {selectedPo.supplierName} · {selectedPo.supplierPhone} · ETA{' '}
                  {selectedPo.expectedDeliveryDate}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedPoId(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Share / Status Controls */}
              <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                <div className="flex flex-wrap items-center gap-1.5">
                  <a
                    href={buildWhatsAppLink(
                      selectedPo.supplierPhone,
                      buildWhatsAppPurchaseOrderText(selectedPo)
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center gap-1.5"
                  >
                    <MessageSquare className="w-3.5 h-3.5" />
                    <span>Send PO on WhatsApp</span>
                  </a>

                  <button
                    type="button"
                    onClick={() => handleCopyPoText(selectedPo)}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold flex items-center gap-1.5"
                  >
                    {copiedPoId === selectedPo.id ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy PO Text</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="flex items-center gap-1.5">
                  {selectedPo.status === 'draft' && (
                    <button
                      type="button"
                      onClick={() => {
                        onUpdatePoStatus(selectedPo.id, 'ordered', 'Order issued to vendor');
                        showToast(`${selectedPo.poNumber} ordered`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 text-white font-bold"
                    >
                      Issue Order
                    </button>
                  )}
                  {selectedPo.status === 'ordered' && (
                    <button
                      type="button"
                      onClick={() => {
                        onUpdatePoStatus(selectedPo.id, 'in_transit', 'Shipment dispatched by vendor');
                        showToast(`${selectedPo.poNumber} marked In Transit`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-sky-600 text-white font-bold"
                    >
                      Mark In Transit
                    </button>
                  )}
                  {(selectedPo.status === 'draft' ||
                    selectedPo.status === 'ordered' ||
                    selectedPo.status === 'in_transit') && (
                    <button
                      type="button"
                      onClick={() => {
                        onUpdatePoStatus(selectedPo.id, 'cancelled', 'PO cancelled by store');
                        showToast(`${selectedPo.poNumber} cancelled`);
                      }}
                      className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-rose-500/20 text-slate-300 hover:text-rose-300 border border-slate-700 font-semibold"
                    >
                      Cancel PO
                    </button>
                  )}
                </div>
              </div>

              {/* Line Items & Receive Quantities */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <h4 className="font-bold text-slate-200">
                    Items &amp; Stock Check-In
                  </h4>
                  <span className="text-[11px] text-slate-400">
                    Confirming receipt adds pieces directly to live inventory
                  </span>
                </div>

                <div className="divide-y divide-slate-800 rounded-xl bg-slate-950 border border-slate-800">
                  {selectedPo.items.map(item => {
                    const key = `${item.productId}__${item.unitType}`;
                    const remaining = Math.max(0, item.orderedQty - item.receivedQty);
                    const unitLabel = item.unitType === 'bundle' ? item.bundleUnitName : 'Pc';
                    const canReceiveMore =
                      remaining > 0 &&
                      (selectedPo.status === 'ordered' ||
                        selectedPo.status === 'in_transit' ||
                        selectedPo.status === 'partial');

                    return (
                      <div
                        key={key}
                        className="p-3 flex flex-wrap items-center justify-between gap-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="font-semibold text-white truncate">
                            {item.productName}
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums mt-0.5">
                            Ordered: {item.orderedQty} {unitLabel}s ({item.totalOrderedPieces} pcs) ·
                            Received: {item.receivedQty} {unitLabel}s ({item.totalReceivedPieces} pcs) ·
                            Rate {formatCurrency(item.unitCost)}
                          </div>
                        </div>

                        <div className="flex items-center gap-3">
                          <div className="text-right font-bold text-slate-200 tabular-nums">
                            {formatCurrency(item.lineTotal)}
                          </div>

                          {canReceiveMore ? (
                            <div className="flex items-center gap-1.5">
                              <span className="text-[11px] text-slate-400">Receive:</span>
                              <input
                                type="number"
                                min="0"
                                max={remaining}
                                value={receiveInputs[key] ?? String(remaining)}
                                onChange={e =>
                                  setReceiveInputs(prev => ({
                                    ...prev,
                                    [key]: e.target.value,
                                  }))
                                }
                                className="w-16 px-2 py-1 bg-slate-900 border border-emerald-500/40 rounded-lg text-white font-mono text-center"
                              />
                            </div>
                          ) : (
                            <span className="text-[11px] font-semibold text-emerald-400">
                              {item.receivedQty >= item.orderedQty ? 'Stocked' : 'Closed'}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Receive Action Bar */}
                {(selectedPo.status === 'ordered' ||
                  selectedPo.status === 'in_transit' ||
                  selectedPo.status === 'partial') && (
                  <div className="p-3 rounded-xl bg-emerald-500/10 border border-emerald-500/30 flex flex-col sm:flex-row sm:items-center gap-2.5">
                    <input
                      type="text"
                      value={receiveNote}
                      onChange={e => setReceiveNote(e.target.value)}
                      placeholder="Receipt note (e.g. Challan #8841 verified)"
                      className="flex-1 px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white focus:outline-none focus:border-emerald-500"
                    />
                    <button
                      type="button"
                      onClick={handleConfirmReceive}
                      className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold flex items-center justify-center gap-1.5 whitespace-nowrap"
                    >
                      <PackageCheck className="w-4 h-4" />
                      <span>Confirm &amp; Restock Inventory</span>
                    </button>
                  </div>
                )}
              </div>

              {/* Financial Summary & Payment Settlement */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1 tabular-nums">
                  <div className="flex justify-between text-slate-400">
                    <span>Subtotal</span>
                    <span>{formatCurrency(selectedPo.subtotal)}</span>
                  </div>
                  <div className="flex justify-between text-slate-400">
                    <span>GST</span>
                    <span>{formatCurrency(selectedPo.gstAmount)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-white pt-1 border-t border-slate-800">
                    <span>Total Order Value</span>
                    <span>{formatCurrency(selectedPo.totalAmount)}</span>
                  </div>
                  <div className="flex justify-between text-emerald-400">
                    <span>Paid to Vendor</span>
                    <span>{formatCurrency(selectedPo.amountPaid)}</span>
                  </div>
                  <div className="flex justify-between font-bold text-amber-300">
                    <span>Balance Payable</span>
                    <span>
                      {formatCurrency(Math.max(0, selectedPo.totalAmount - selectedPo.amountPaid))}
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="font-semibold text-slate-200">Record Vendor Payment</div>
                  {selectedPo.totalAmount - selectedPo.amountPaid > 0 &&
                  selectedPo.status !== 'cancelled' ? (
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min="1"
                        step="0.01"
                        value={paymentInput}
                        onChange={e => setPaymentInput(e.target.value)}
                        placeholder="Amount ₹"
                        className="flex-1 px-3 py-1.5 bg-slate-900 border border-slate-700 rounded-xl text-white font-mono"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const amt = parseFloat(paymentInput);
                          if (!amt || amt <= 0) return;
                          soundManager.playCheckoutSuccess();
                          onRecordPoPayment(selectedPo.id, amt);
                          showToast(`Recorded ${formatCurrency(amt)} payment on ${selectedPo.poNumber}`);
                        }}
                        className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
                      >
                        Record Paid
                      </button>
                    </div>
                  ) : (
                    <div className="text-emerald-400 font-semibold flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4" />
                      <span>No pending vendor balance on this PO</span>
                    </div>
                  )}
                  {selectedPo.notes && (
                    <div className="text-[11px] text-slate-400 pt-1">
                      Note: {selectedPo.notes}
                    </div>
                  )}
                </div>
              </div>

              {/* Delivery & Audit Timeline */}
              <div className="space-y-2">
                <h4 className="font-bold text-slate-200 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5 text-slate-400" />
                  <span>Delivery &amp; Order Timeline</span>
                </h4>
                <div className="space-y-1.5 rounded-xl bg-slate-950 border border-slate-800 p-3">
                  {selectedPo.timeline.map(evt => (
                    <div
                      key={evt.id}
                      className="flex items-start justify-between gap-3 py-1 border-b last:border-b-0 border-slate-800/60"
                    >
                      <div>
                        <span className="font-semibold text-slate-200">
                          {getPoStatusLabel(evt.status)}
                        </span>
                        <span className="text-slate-500 mx-1.5" aria-hidden="true">·</span>
                        <span className="text-slate-300">{evt.note}</span>
                      </div>
                      <span className="font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(evt.timestamp).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
