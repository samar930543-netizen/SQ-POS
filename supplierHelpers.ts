import {
  Product,
  PurchaseOrder,
  PurchaseOrderItem,
  PurchaseOrderStatus,
  Supplier,
  UnitType,
} from '../types';
import { formatCurrency } from './formatters';
import { hasConfiguredBundleTier } from './unitSpecs';

export type DeliveryUrgency = 'overdue' | 'due_today' | 'upcoming' | 'completed' | 'cancelled' | 'draft';

export interface DeliveryScheduleInfo {
  urgency: DeliveryUrgency;
  daysDelta: number; // Negative = days overdue, 0 = due today, Positive = days remaining
  label: string;
}

/**
 * Compute delivery SLA status relative to today's local YYYY-MM-DD date.
 */
export function getDeliveryScheduleInfo(
  po: PurchaseOrder,
  referenceDate: Date = new Date()
): DeliveryScheduleInfo {
  if (po.status === 'received') {
    return {
      urgency: 'completed',
      daysDelta: 0,
      label: po.actualDeliveryDate
        ? `Delivered ${new Date(po.actualDeliveryDate).toLocaleDateString('en-IN', {
            day: '2-digit',
            month: 'short',
          })}`
        : 'Delivered',
    };
  }

  if (po.status === 'cancelled') {
    return {
      urgency: 'cancelled',
      daysDelta: 0,
      label: 'Cancelled',
    };
  }

  if (po.status === 'draft') {
    return {
      urgency: 'draft',
      daysDelta: 0,
      label: 'Draft (Not Sent)',
    };
  }

  const todayStr = referenceDate.toISOString().slice(0, 10);
  const expectedStr = (po.expectedDeliveryDate || todayStr).slice(0, 10);

  const todayMs = new Date(`${todayStr}T00:00:00`).getTime();
  const expectedMs = new Date(`${expectedStr}T00:00:00`).getTime();
  const daysDelta = Math.round((expectedMs - todayMs) / 86400000);

  if (daysDelta < 0) {
    const overdueDays = Math.abs(daysDelta);
    return {
      urgency: 'overdue',
      daysDelta,
      label: `${overdueDays}d overdue`,
    };
  }

  if (daysDelta === 0) {
    return {
      urgency: 'due_today',
      daysDelta: 0,
      label: 'Due today',
    };
  }

  return {
    urgency: 'upcoming',
    daysDelta,
    label: daysDelta === 1 ? 'Due tomorrow' : `In ${daysDelta} days`,
  };
}

export function getPoStatusLabel(status: PurchaseOrderStatus): string {
  switch (status) {
    case 'draft':
      return 'Draft';
    case 'ordered':
      return 'Ordered';
    case 'in_transit':
      return 'In Transit';
    case 'partial':
      return 'Partially Received';
    case 'received':
      return 'Received';
    case 'cancelled':
      return 'Cancelled';
  }
}

export function getSupplierOnTimeRate(supplier: Supplier): number {
  if (!supplier.totalDeliveries || supplier.totalDeliveries <= 0) return 100;
  return Math.round((supplier.onTimeDeliveries / supplier.totalDeliveries) * 100);
}

/**
 * Estimate default wholesale purchase rate (~88% of selling price) when creating a PO line.
 */
export function estimateWholesaleUnitCost(product: Product, unitType: 'bundle' | 'piece'): number {
  let base = unitType === 'bundle' ? product.bundlePrice : product.piecePrice;
  if (base <= 0) {
    base =
      unitType === 'bundle' && product.piecePrice > 0
        ? product.piecePrice * Math.max(1, product.bundlePieces)
        : product.bundlePrice > 0
        ? product.bundlePrice / Math.max(1, product.bundlePieces)
        : 0;
  }
  return Math.max(1, Math.round(base * 0.88));
}

export interface LowStockReorderCandidate {
  product: Product;
  deficitPieces: number;
  inTransitPieces: number;
  suggestedUnit: UnitType;
  suggestedBundles: number;
  estimatedCost: number;
  suggestedSupplier: Supplier | null;
}

/**
 * Identifies low-stock or out-of-stock SKUs, subtracts quantities already ordered in open POs,
 * and suggests the best matching vendor by product category.
 */
export function buildLowStockReorderQueue(
  products: Product[],
  suppliers: Supplier[],
  purchaseOrders: PurchaseOrder[]
): LowStockReorderCandidate[] {
  const incomingByProduct = new Map<string, number>();

  purchaseOrders.forEach(po => {
    if (po.status === 'ordered' || po.status === 'in_transit' || po.status === 'partial') {
      po.items.forEach(item => {
        const remaining = Math.max(0, item.totalOrderedPieces - item.totalReceivedPieces);
        incomingByProduct.set(
          item.productId,
          (incomingByProduct.get(item.productId) || 0) + remaining
        );
      });
    }
  });

  return products
    .filter(p => p.stockPieces <= p.lowStockThreshold)
    .map(product => {
      const inTransitPieces = incomingByProduct.get(product.id) || 0;
      const hasBundle = hasConfiguredBundleTier(product);
      const suggestedUnit: UnitType = hasBundle ? 'bundle' : 'piece';
      const targetStock = hasBundle
        ? Math.max(product.lowStockThreshold * 3, product.bundlePieces * 2)
        : Math.max(product.lowStockThreshold * 3, 10);
      const netNeeded = Math.max(0, targetStock - (product.stockPieces + inTransitPieces));
      const suggestedBundles =
        netNeeded > 0
          ? hasBundle
            ? Math.max(1, Math.ceil(netNeeded / Math.max(1, product.bundlePieces)))
            : netNeeded
          : 0;
      const unitCost = estimateWholesaleUnitCost(product, suggestedUnit);
      const suggestedSupplier =
        suppliers.find(s => s.categories.includes(product.category)) || suppliers[0] || null;

      return {
        product,
        deficitPieces: Math.max(0, product.lowStockThreshold - product.stockPieces),
        inTransitPieces,
        suggestedUnit,
        suggestedBundles,
        estimatedCost: suggestedBundles * unitCost,
        suggestedSupplier,
      };
    })
    .sort((a, b) => a.product.stockPieces - b.product.stockPieces);
}

/**
 * Formats a clean WhatsApp Purchase Order text for the supplier.
 */
export function buildWhatsAppPurchaseOrderText(po: PurchaseOrder): string {
  const line = '------------------------------';
  let text = `*SQ ENTERPRISES - PURCHASE ORDER*\n`;
  text += `${line}\n`;
  text += `*PO No:* ${po.poNumber}\n`;
  text += `*Vendor:* ${po.supplierName}\n`;
  text += `*Order Date:* ${new Date(po.orderDate).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })}\n`;
  text += `*Expected Delivery:* ${po.expectedDeliveryDate}\n`;
  text += `${line}\n`;
  text += `*ITEMS REQUESTED*\n`;

  po.items.forEach((item, idx) => {
    const unitLabel = item.unitType === 'bundle' ? item.bundleUnitName : 'Pc';
    text += `${idx + 1}. ${item.productName}\n`;
    text += `   Qty: ${item.orderedQty} ${unitLabel}${item.orderedQty > 1 ? 's' : ''} (${item.totalOrderedPieces} pcs) @ ${formatCurrency(item.unitCost)} = *${formatCurrency(item.lineTotal)}*\n`;
  });

  text += `${line}\n`;
  text += `*Subtotal:* ${formatCurrency(po.subtotal)}\n`;
  if (po.gstAmount > 0) {
    text += `*GST:* ${formatCurrency(po.gstAmount)}\n`;
  }
  text += `*Total Order Value:* *${formatCurrency(po.totalAmount)}*\n`;
  if (po.notes) {
    text += `*Note:* ${po.notes}\n`;
  }
  text += `${line}\n`;
  text += `Please confirm dispatch & vehicle details.\n`;
  text += `_SQ ENTERPRISES Wholesale_`;
  return text;
}

/**
 * Build a WhatsApp URL safely for <a href=...>.
 */
export function buildWhatsAppLink(phone: string, message: string): string {
  const cleanPhone = (phone || '').replace(/\D/g, '');
  const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
  return `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`;
}

/**
 * Compute updated PurchaseOrderItem metrics cleanly.
 */
export function normalizePoItem(
  product: Product,
  unitType: 'bundle' | 'piece',
  orderedQty: number,
  unitCost: number,
  receivedQty: number = 0
): PurchaseOrderItem {
  const qty = Math.max(1, Math.round(orderedQty));
  const pcsPerUnit = unitType === 'bundle' ? Math.max(1, product.bundlePieces) : 1;
  const clampedReceived = Math.min(qty, Math.max(0, Math.round(receivedQty)));

  return {
    productId: product.id,
    productName: product.name,
    bundleUnitName: product.bundleUnitName,
    bundlePieces: product.bundlePieces,
    unitType,
    orderedQty: qty,
    receivedQty: clampedReceived,
    totalOrderedPieces: qty * pcsPerUnit,
    totalReceivedPieces: clampedReceived * pcsPerUnit,
    unitCost: Math.max(0, unitCost),
    lineTotal: qty * Math.max(0, unitCost),
  };
}
