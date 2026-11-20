import {
  Bill,
  ReceiptDateTimeFormat,
  ReceiptDesignConfig,
  ReceiptSettings,
  ReceiptTemplateType,
} from '../types';

export const RECEIPT_PRESET_DESIGNS: Record<ReceiptTemplateType, ReceiptDesignConfig> = {
  standard: {
    showStoreName: true,
    showTagline: true,
    showAddress: true,
    showStorePhone: true,
    showEmail: true,
    showLogo: true,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: true,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: true,
    showCustomerPhone: true,
    headerLayout: 'centered',
    headerAlignment: 'center',
    footerAlignment: 'center',
    fontSize: 'sm',
    itemDisplayFormat: 'tabular_unit',
    showItemRate: true,
    showItemUnitDetail: true,
    showTotalItemsCount: false,
    showItemsTotal: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSummaryAdjustments: true,
    showInlineQtyOnGrandTotal: false,
    qtyUnitStyle: 'short',
    showFooterMessage: true,
    customFooterText: '*** THANK YOU FOR YOUR BUSINESS ***',
  },
  compact: {
    showStoreName: true,
    showTagline: true,
    showAddress: true,
    showStorePhone: true,
    showEmail: false,
    showLogo: true,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: true,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: true,
    showCustomerPhone: true,
    headerLayout: 'centered',
    headerAlignment: 'center',
    footerAlignment: 'center',
    fontSize: 'xs',
    itemDisplayFormat: 'compact_inline',
    showItemRate: false,
    showItemUnitDetail: false,
    showTotalItemsCount: false,
    showItemsTotal: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSummaryAdjustments: true,
    showInlineQtyOnGrandTotal: false,
    qtyUnitStyle: 'short',
    showFooterMessage: true,
    customFooterText: '*** THANK YOU ***',
  },
  detailed: {
    showStoreName: true,
    showTagline: true,
    showAddress: true,
    showStorePhone: true,
    showEmail: true,
    showLogo: true,
    showFacade: true,
    showInvoiceNumber: true,
    showInvoiceLabel: true,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: true,
    showCustomerPhone: true,
    headerLayout: 'centered',
    headerAlignment: 'center',
    footerAlignment: 'center',
    fontSize: 'md',
    itemDisplayFormat: 'numbered_audit',
    showItemRate: true,
    showItemUnitDetail: true,
    showTotalItemsCount: true,
    showItemsTotal: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSummaryAdjustments: true,
    showInlineQtyOnGrandTotal: false,
    qtyUnitStyle: 'short',
    showFooterMessage: true,
    customFooterText: '*** THANK YOU FOR YOUR BUSINESS ***',
  },
  minimalist: {
    showStoreName: true,
    showTagline: false,
    showAddress: false,
    showStorePhone: true,
    showEmail: false,
    showLogo: true,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: false,
    showDateTime: true,
    dateTimeFormat: 'short_24h',
    showCustomerName: true,
    showCustomerPhone: true,
    headerLayout: 'centered',
    headerAlignment: 'center',
    footerAlignment: 'center',
    fontSize: 'xs',
    itemDisplayFormat: 'compact_inline',
    showItemRate: false,
    showItemUnitDetail: false,
    showTotalItemsCount: false,
    showItemsTotal: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSummaryAdjustments: true,
    showInlineQtyOnGrandTotal: false,
    qtyUnitStyle: 'short',
    showFooterMessage: true,
    customFooterText: 'Thank you!',
  },
  wholesale_bulk: {
    showStoreName: true,
    showTagline: false,
    showAddress: true,
    showStorePhone: true,
    showEmail: true,
    showLogo: true,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: true,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: true,
    showCustomerPhone: true,
    headerLayout: 'centered',
    headerAlignment: 'center',
    footerAlignment: 'center',
    fontSize: 'sm',
    itemDisplayFormat: 'bulk_cards',
    showItemRate: true,
    showItemUnitDetail: true,
    showTotalItemsCount: true,
    showItemsTotal: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSummaryAdjustments: true,
    showInlineQtyOnGrandTotal: false,
    qtyUnitStyle: 'short',
    showFooterMessage: true,
    customFooterText: '* Verify total carton/bundle count before loading delivery *',
  },
  clean_bill: {
    showStoreName: true,
    showTagline: false,
    showAddress: false,
    showStorePhone: true,
    showEmail: false,
    showLogo: false,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: false,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: true,
    showCustomerPhone: true,
    headerLayout: 'split_3line',
    headerAlignment: 'left',
    footerAlignment: 'center',
    fontSize: 'sm',
    itemDisplayFormat: 'tabular_unit',
    showItemRate: true,
    showItemUnitDetail: true,
    showTotalItemsCount: true,
    showItemsTotal: true,
    showPaidAmount: true,
    showBalanceDue: true,
    showSummaryAdjustments: true,
    showInlineQtyOnGrandTotal: false,
    qtyUnitStyle: 'short',
    showFooterMessage: true,
    customFooterText: 'Thank you for business',
  },
  express_total: {
    showStoreName: true,
    showTagline: false,
    showAddress: false,
    showStorePhone: true,
    showEmail: false,
    showLogo: false,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: false,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: false,
    showCustomerPhone: false,
    headerLayout: 'split_3line',
    headerAlignment: 'left',
    footerAlignment: 'center',
    fontSize: 'sm',
    itemDisplayFormat: 'tabular_unit',
    showItemRate: true,
    showItemUnitDetail: true,
    showTotalItemsCount: false,
    showItemsTotal: false,
    showPaidAmount: false,
    showBalanceDue: false,
    showSummaryAdjustments: false,
    showInlineQtyOnGrandTotal: true,
    qtyUnitStyle: 'short',
    showFooterMessage: false,
    customFooterText: '',
  },
  express_units: {
    showStoreName: true,
    showTagline: false,
    showAddress: false,
    showStorePhone: true,
    showEmail: false,
    showLogo: false,
    showFacade: false,
    showInvoiceNumber: true,
    showInvoiceLabel: false,
    showDateTime: true,
    dateTimeFormat: 'date_time',
    showCustomerName: false,
    showCustomerPhone: false,
    headerLayout: 'split_3line',
    headerAlignment: 'left',
    footerAlignment: 'center',
    fontSize: 'sm',
    itemDisplayFormat: 'tabular_unit',
    showItemRate: true,
    showItemUnitDetail: false,
    showTotalItemsCount: false,
    showItemsTotal: false,
    showPaidAmount: false,
    showBalanceDue: false,
    showSummaryAdjustments: false,
    showInlineQtyOnGrandTotal: true,
    qtyUnitStyle: 'code_pie_ban_lar',
    showFooterMessage: false,
    customFooterText: '',
  },
};

export const RECEIPT_PRESET_META: Array<{
  id: ReceiptTemplateType;
  label: string;
  tag: string;
  description: string;
  recommendedRoll: string;
}> = [
  {
    id: 'standard',
    label: 'Standard',
    tag: 'Balanced',
    description: 'Classic 4-column aligned table, packaging details & structured totals.',
    recommendedRoll: '58mm / 80mm daily billing',
  },
  {
    id: 'compact',
    label: 'Compact',
    tag: 'Paper-Saver',
    description: 'Dense single-line items and tight vertical spacing for fast printouts.',
    recommendedRoll: '58mm pocket Bluetooth',
  },
  {
    id: 'detailed',
    label: 'Detailed',
    tag: 'Full Audit',
    description: 'Numbered audit rows, pieces delivered, store logo, facade & item count.',
    recommendedRoll: '80mm desktop printers',
  },
  {
    id: 'minimalist',
    label: 'Minimalist',
    tag: 'Fast Counter',
    description: 'Zero clutter, concise timestamps, and fast one-line totals.',
    recommendedRoll: 'High-speed express queues',
  },
  {
    id: 'wholesale_bulk',
    label: 'Bulk FMCG',
    tag: 'Dispatch',
    description: 'Large carton/bundle badges and total package verification box.',
    recommendedRoll: 'Warehouse & loading slips',
  },
  {
    id: 'clean_bill',
    label: 'Clean Bill',
    tag: '3-Line Header',
    description: 'Store & Bill No. on line 1, Date/Time & mobile on line 2, Total Items count.',
    recommendedRoll: 'Clean customer receipts',
  },
  {
    id: 'express_total',
    label: 'Express Total',
    tag: 'Grand Total + Qty',
    description: 'Store & Bill No., Date/Time & mobile, no customer lines, Grand Total + Qty.',
    recommendedRoll: 'Ultra-clean counter slips',
  },
  {
    id: 'express_units',
    label: 'Express Units',
    tag: 'PIE / BAN / LAR',
    description: 'Express Total layout with PIE, BAN & LAR qty codes and clean item names.',
    recommendedRoll: 'Wholesale counter slips',
  },
];

export const DEFAULT_RECEIPT_BRANDING_EXTRAS: Partial<ReceiptDesignConfig> = {
  showCustomHeaderText: false,
  customHeaderText: '',
  showBarcode: false,
  barcodeFormat: 'code128',
  showQrCode: false,
  qrCodeMode: 'invoice_verify',
  qrUpiId: '',
  qrCustomPayload: '',
  qrCodeLabel: 'Scan Bill QR',
  watermarkEnabled: false,
  watermarkText: 'ORIGINAL',
  watermarkStyle: 'diagonal',
  watermarkOpacity: 12,
};

export function resolveReceiptDesign(settings: ReceiptSettings): ReceiptDesignConfig {
  const base = RECEIPT_PRESET_DESIGNS[settings.template] || RECEIPT_PRESET_DESIGNS.standard;
  if (!settings.design) {
    return {
      ...DEFAULT_RECEIPT_BRANDING_EXTRAS,
      ...base,
      customFooterText:
        settings.template === 'clean_bill'
          ? 'Thank you for business'
          : settings.template === 'express_total' || settings.template === 'express_units'
            ? ''
            : settings.thankYouMessage || base.customFooterText,
    };
  }
  return {
    ...DEFAULT_RECEIPT_BRANDING_EXTRAS,
    ...base,
    ...settings.design,
  };
}

export function formatReceiptDateTime(
  bill: Pick<Bill, 'timestamp' | 'formattedDateTime'>,
  format: ReceiptDateTimeFormat
): string {
  const dateObj = bill.timestamp ? new Date(bill.timestamp) : null;
  if (!dateObj || Number.isNaN(dateObj.getTime())) {
    return bill.formattedDateTime;
  }

  if (format === 'date_only') {
    return new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
    }).format(dateObj);
  }

  if (format === 'short_24h') {
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const yy = String(dateObj.getFullYear()).slice(-2);
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${dd}/${mm}/${yy} ${hh}:${min}`;
  }

  if (format === 'iso_compact') {
    const yyyy = dateObj.getFullYear();
    const mm = String(dateObj.getMonth() + 1).padStart(2, '0');
    const dd = String(dateObj.getDate()).padStart(2, '0');
    const hh = String(dateObj.getHours()).padStart(2, '0');
    const min = String(dateObj.getMinutes()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd} ${hh}:${min}`;
  }

  return (
    bill.formattedDateTime ||
    new Intl.DateTimeFormat('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true,
    }).format(dateObj)
  );
}
