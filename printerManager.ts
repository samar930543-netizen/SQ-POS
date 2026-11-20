import {
  Bill,
  PaperWidthType,
  PrinterConnectionsConfig,
  PrinterConnectionType,
  ReceiptDesignConfig,
  ReceiptSettings,
  StoreProfile,
  ThermalPaperRollConfig,
} from '../types';
import { resolveReceiptDesign, formatReceiptDateTime } from './receiptPresets';
import { buildReceiptQrPayload } from './receiptCodes';
import { resolvePrinterConnectionsConfig } from './storage';

// Common BLE Thermal Printer Service & Characteristic UUIDs
const BLE_PRINTER_SERVICES = [
  '000018f0-0000-1000-8000-00805f9b34fb', // Standard BLE ESC/POS service
  'e7810a71-73ae-499d-8c15-faa9aef0c3f2', // Star / Xprinter / generic BLE printer
  '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC / Microchip transparent UART
  '0000ff00-0000-1000-8000-00805f9b34fb', // Common Chinese 58mm/80mm thermal printer
  '0000ffe0-0000-1000-8000-00805f9b34fb', // HM-10 serial BLE
  '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART Service
];

interface LiveBluetoothState {
  device: any | null;
  characteristic: any | null;
  deviceName?: string;
  deviceId?: string;
  serviceUuid?: string;
  characteristicUuid?: string;
}

interface LiveUsbState {
  transport: 'webusb' | 'serial';
  usbDevice: any | null;
  serialPort: any | null;
  deviceName?: string;
  vendorId?: number;
  productId?: number;
  interfaceNumber: number;
  endpointNumber: number;
}

const liveBluetooth: LiveBluetoothState = {
  device: null,
  characteristic: null,
};

const liveUsb: LiveUsbState = {
  transport: 'webusb',
  usbDevice: null,
  serialPort: null,
  interfaceNumber: 0,
  endpointNumber: 1,
};

type Listener = () => void;
const listeners = new Set<Listener>();

function notifyHardwareChange() {
  listeners.forEach(fn => {
    try {
      fn();
    } catch {
      // ignore listener errors
    }
  });
}

export function subscribePrinterHardwareState(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getPrinterBrowserCapabilities() {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : undefined;
  return {
    bluetoothSupported: Boolean(nav?.bluetooth?.requestDevice),
    webUsbSupported: Boolean(nav?.usb?.requestDevice),
    webSerialSupported: Boolean(nav?.serial?.requestPort),
    isSecureContext: typeof window !== 'undefined' ? window.isSecureContext : false,
  };
}

export function getLiveHardwareStatus() {
  const btConnected = Boolean(
    liveBluetooth.device?.gatt?.connected && liveBluetooth.characteristic
  );
  const usbConnected = Boolean(
    (liveUsb.transport === 'webusb' && liveUsb.usbDevice?.opened) ||
      (liveUsb.transport === 'serial' && liveUsb.serialPort?.writable)
  );
  return {
    bluetoothConnected: btConnected,
    bluetoothDeviceName: btConnected ? liveBluetooth.deviceName : undefined,
    usbConnected,
    usbDeviceName: usbConnected ? liveUsb.deviceName : undefined,
    usbTransport: usbConnected ? liveUsb.transport : undefined,
  };
}

// =========================================================================
// ESC/POS BINARY COMMAND GENERATOR (58mm = 32 chars, 80mm = 48 chars)
// =========================================================================

function sanitizeThermalAscii(input: string): string {
  return String(input || '')
    .replace(/₹/g, 'Rs.')
    .replace(/[•·]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/–|—/g, '-')
    .replace(/[^\x20-\x7E\n]/g, ' ');
}

function padTwoColumn(left: string, right: string, width: number): string {
  const l = sanitizeThermalAscii(left).trim();
  const r = sanitizeThermalAscii(right).trim();
  const minGap = 1;
  const maxLeft = Math.max(4, width - r.length - minGap);
  const clippedLeft = l.length > maxLeft ? l.slice(0, maxLeft - 1) + '.' : l;
  const spaces = Math.max(1, width - clippedLeft.length - r.length);
  return clippedLeft + ' '.repeat(spaces) + r;
}

function wrapTextLines(text: string, width: number): string[] {
  const clean = sanitizeThermalAscii(text).trim();
  if (!clean) return [];
  const words = clean.split(/\s+/);
  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    if (!current) {
      current = word.length > width ? word.slice(0, width) : word;
    } else if (current.length + 1 + word.length <= width) {
      current += ' ' + word;
    } else {
      lines.push(current);
      current = word.length > width ? word.slice(0, width) : word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function pushAscii(bytes: number[], text: string) {
  const clean = sanitizeThermalAscii(text);
  for (let i = 0; i < clean.length; i++) {
    bytes.push(clean.charCodeAt(i) & 0x7f);
  }
}

function pushLine(bytes: number[], text = '') {
  pushAscii(bytes, text);
  bytes.push(0x0a); // LF
}

function pushAlign(bytes: number[], align: 'left' | 'center' | 'right') {
  const n = align === 'center' ? 1 : align === 'right' ? 2 : 0;
  bytes.push(0x1b, 0x61, n); // ESC a n
}

function pushBold(bytes: number[], on: boolean) {
  bytes.push(0x1b, 0x45, on ? 1 : 0); // ESC E n
}

function pushDoubleSize(bytes: number[], on: boolean) {
  bytes.push(0x1d, 0x21, on ? 0x11 : 0x00); // GS ! n
}

function pushEscPosBarcode(
  bytes: number[],
  value: string,
  format: 'code128' | 'code39' = 'code128'
) {
  const clean = sanitizeThermalAscii(value).trim().slice(0, 24);
  if (!clean) return;
  pushAlign(bytes, 'center');
  // Set barcode HRI text below (GS H 2) and height 48 dots (GS h 48), width 2 (GS w 2)
  bytes.push(0x1d, 0x48, 2);
  bytes.push(0x1d, 0x68, 48);
  bytes.push(0x1d, 0x77, 2);

  if (format === 'code39') {
    const c39 = clean.toUpperCase().replace(/[^0-9A-Z\-. $/+%]/g, '-');
    bytes.push(0x1d, 0x6b, 4); // GS k 4 (CODE39 NUL-terminated)
    for (let i = 0; i < c39.length; i++) {
      bytes.push(c39.charCodeAt(i) & 0x7f);
    }
    bytes.push(0x00);
  } else {
    // GS k 73 n { B <data> (CODE128 subset B)
    const payload = `{B${clean}`;
    bytes.push(0x1d, 0x6b, 73, payload.length);
    for (let i = 0; i < payload.length; i++) {
      bytes.push(payload.charCodeAt(i) & 0x7f);
    }
  }
  bytes.push(0x0a);
}

function pushEscPosQrCode(bytes: number[], payload: string) {
  const clean = sanitizeThermalAscii(payload).trim().slice(0, 220);
  if (!clean) return;
  pushAlign(bytes, 'center');
  // Model 2: GS ( k 4 0 49 65 50 0
  bytes.push(0x1d, 0x28, 0x6b, 0x04, 0x00, 0x31, 0x41, 0x32, 0x00);
  // Module size 5: GS ( k 3 0 49 67 5
  bytes.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x43, 0x05);
  // Error correction M (49): GS ( k 3 0 49 69 49
  bytes.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x45, 0x31);
  // Store data: GS ( k pL pH 49 80 48 <data>
  const len = clean.length + 3;
  const pL = len & 0xff;
  const pH = (len >> 8) & 0xff;
  bytes.push(0x1d, 0x28, 0x6b, pL, pH, 0x31, 0x50, 0x30);
  for (let i = 0; i < clean.length; i++) {
    bytes.push(clean.charCodeAt(i) & 0x7f);
  }
  // Print stored QR symbol: GS ( k 3 0 49 81 48
  bytes.push(0x1d, 0x28, 0x6b, 0x03, 0x00, 0x31, 0x51, 0x30);
  bytes.push(0x0a);
}

function finalizeEscPosBytes(
  bytes: number[],
  printers: PrinterConnectionsConfig
): Uint8Array {
  const feedLines = Math.min(8, Math.max(1, printers.feedLinesAfterPrint || 3));
  bytes.push(0x1b, 0x64, feedLines); // ESC d n (feed n lines)

  if (printers.autoCutPaper) {
    const cutFunction = printers.autoCutMode === 'full' ? 0x41 : 0x42; // 65=full cut, 66=partial cut
    bytes.push(0x1d, 0x56, cutFunction, 0x00); // GS V m 0
  }

  if (printers.openCashDrawer) {
    bytes.push(0x1b, 0x70, 0x00, 0x19, 0xfa); // ESC p 0 25 250 (kick drawer pin 2)
  }

  return new Uint8Array(bytes);
}

export function buildEscPosReceiptBytes(
  bill: Bill,
  storeProfile: StoreProfile,
  receiptSettings: ReceiptSettings
): Uint8Array {
  const printers = resolvePrinterConnectionsConfig(receiptSettings.printers);
  const design = resolveReceiptDesign(receiptSettings);
  const paperWidth: PaperWidthType = receiptSettings.paperWidth || '58mm';
  const colWidth = paperWidth === '80mm' ? 48 : 32;
  const divider = '-'.repeat(colWidth);
  const doubleDivider = '='.repeat(colWidth);

  const bytes: number[] = [];
  // Initialize ESC/POS printer
  bytes.push(0x1b, 0x40); // ESC @

  const storeName = storeProfile.storeName?.trim() || 'SQ ENTERPRISES';
  const effectiveGstin = bill.gstNumber || storeProfile.gstin || '';
  const formattedDate = formatReceiptDateTime(bill, design.dateTimeFormat);

  // Header
  pushAlign(bytes, design.headerAlignment || 'center');
  if (design.showCustomHeaderText && design.customHeaderText?.trim()) {
    pushBold(bytes, true);
    design.customHeaderText
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(line => wrapTextLines(line, colWidth).forEach(w => pushLine(bytes, w)));
    pushBold(bytes, false);
  }
  if (design.showStoreName) {
    pushBold(bytes, true);
    pushDoubleSize(bytes, true);
    pushLine(bytes, storeName.toUpperCase());
    pushDoubleSize(bytes, false);
    pushBold(bytes, false);
  }
  if (design.showTagline) {
    const tagline = bill.isGstBill
      ? 'TAX INVOICE (GST GOODS)'
      : storeProfile.tagline?.trim() || 'WHOLESALE FMCG GOODS';
    wrapTextLines(tagline, colWidth).forEach(line => pushLine(bytes, line));
  }
  if (design.showAddress && storeProfile.address?.trim()) {
    wrapTextLines(storeProfile.address.trim(), colWidth).forEach(line => pushLine(bytes, line));
  }
  const contactParts = [
    design.showStorePhone && storeProfile.contactNumber?.trim()
      ? `Ph: ${storeProfile.contactNumber.trim()}`
      : '',
    design.showEmail && storeProfile.email?.trim() ? storeProfile.email.trim() : '',
  ].filter(Boolean);
  if (contactParts.length > 0) {
    wrapTextLines(contactParts.join(' | '), colWidth).forEach(line => pushLine(bytes, line));
  }
  if (bill.isGstBill && effectiveGstin) {
    pushBold(bytes, true);
    pushLine(bytes, `GSTIN: ${effectiveGstin}`);
    pushBold(bytes, false);
  }
  if (design.watermarkEnabled && design.watermarkText?.trim()) {
    pushLine(bytes, `[ ${design.watermarkText.trim().toUpperCase()} ]`);
  }

  pushAlign(bytes, 'left');
  pushLine(bytes, doubleDivider);

  // Invoice & Customer Metadata
  if (design.showInvoiceNumber || design.showDateTime) {
    const billLabel = design.showInvoiceNumber
      ? `${design.showInvoiceLabel ? 'Bill: #' : ''}${bill.billNumber}`
      : '';
    const dateLabel = design.showDateTime ? formattedDate : '';
    if (billLabel && dateLabel && billLabel.length + dateLabel.length + 1 <= colWidth) {
      pushLine(bytes, padTwoColumn(billLabel, dateLabel, colWidth));
    } else {
      if (billLabel) pushLine(bytes, billLabel);
      if (dateLabel) pushLine(bytes, dateLabel);
    }
  }

  if (design.showCustomerName || design.showCustomerPhone) {
    const custLabel = design.showCustomerName
      ? `Cust: ${bill.customerName || 'Walk-in'}`
      : '';
    const phoneLabel =
      design.showCustomerPhone && bill.customerPhone ? bill.customerPhone : '';
    if (custLabel && phoneLabel && custLabel.length + phoneLabel.length + 1 <= colWidth) {
      pushLine(bytes, padTwoColumn(custLabel, phoneLabel, colWidth));
    } else {
      if (custLabel) pushLine(bytes, custLabel);
      if (phoneLabel) pushLine(bytes, `Ph: ${phoneLabel}`);
    }
  }

  pushLine(bytes, divider);
  pushBold(bytes, true);
  pushLine(bytes, padTwoColumn('ITEM / QTY', 'AMOUNT', colWidth));
  pushBold(bytes, false);
  pushLine(bytes, divider);

  // Line Items
  for (const item of bill.items) {
    const unitShort = item.unit === 'bundle' ? item.bundleUnitName : 'Pcs';
    const qtyText = `${item.quantity} ${unitShort}`;
    const amtText = `Rs.${item.itemTotal.toFixed(2)}`;
    const firstLine = `${item.productName} (${qtyText})`;

    if (firstLine.length + amtText.length + 1 <= colWidth) {
      pushLine(bytes, padTwoColumn(firstLine, amtText, colWidth));
    } else {
      wrapTextLines(item.productName, colWidth).forEach(l => pushLine(bytes, l));
      const detailLeft = design.showItemRate
        ? `  ${qtyText} x Rs.${item.unitPrice}`
        : `  ${qtyText}`;
      pushLine(bytes, padTwoColumn(detailLeft, amtText, colWidth));
    }

    if (design.showItemRate && firstLine.length + amtText.length + 1 <= colWidth) {
      pushLine(bytes, `  Rate: Rs.${item.unitPrice}/${unitShort} (${item.totalPieces} pcs)`);
    }
  }

  pushLine(bytes, divider);

  // Summary Totals
  if (design.showTotalItemsCount) {
    const totalUnits = bill.items.reduce((sum, i) => sum + i.quantity, 0);
    pushLine(bytes, padTwoColumn('Total Items:', `${bill.items.length} (${totalUnits} units)`, colWidth));
  }
  if (design.showItemsTotal !== false) {
    pushLine(
      bytes,
      padTwoColumn(
        bill.isGstBill ? 'Taxable Subtotal:' : 'Items Total:',
        `Rs.${bill.itemsTotal.toFixed(2)}`,
        colWidth
      )
    );
  }
  if (design.showSummaryAdjustments !== false) {
    if (bill.pricingTierLabel && (bill.pricingSavings || 0) > 0) {
      pushLine(
        bytes,
        padTwoColumn(`Tier (${bill.pricingTierLabel}):`, `-Rs.${(bill.pricingSavings || 0).toFixed(2)}`, colWidth)
      );
    }
    if ((bill.loyaltyDiscountAmount || 0) > 0) {
      pushLine(
        bytes,
        padTwoColumn('Loyalty Redeemed:', `-Rs.${(bill.loyaltyDiscountAmount || 0).toFixed(2)}`, colWidth)
      );
    }
    if (bill.isGstBill && (bill.totalGstAmount || 0) > 0) {
      const halfRate = ((bill.gstRate || 18) / 2).toFixed(1);
      pushLine(bytes, padTwoColumn(`CGST (${halfRate}%):`, `Rs.${(bill.cgstAmount || 0).toFixed(2)}`, colWidth));
      pushLine(bytes, padTwoColumn(`SGST (${halfRate}%):`, `Rs.${(bill.sgstAmount || 0).toFixed(2)}`, colWidth));
    }
    if (bill.previousBalance > 0) {
      pushLine(bytes, padTwoColumn('Previous Due:', `Rs.${bill.previousBalance.toFixed(2)}`, colWidth));
    }
  }

  pushLine(bytes, doubleDivider);
  pushBold(bytes, true);
  pushLine(bytes, padTwoColumn('GRAND TOTAL:', `Rs.${bill.grandTotal.toFixed(2)}`, colWidth));
  pushBold(bytes, false);

  if (design.showPaidAmount !== false) {
    pushLine(bytes, padTwoColumn('Paid:', `Rs.${bill.amountReceived.toFixed(2)}`, colWidth));
  }
  if (design.showBalanceDue !== false && bill.remainingBalance > 0) {
    pushBold(bytes, true);
    pushLine(bytes, padTwoColumn('Balance Due:', `Rs.${bill.remainingBalance.toFixed(2)}`, colWidth));
    pushBold(bytes, false);
  }

  if (design.showBarcode) {
    pushLine(bytes, divider);
    pushEscPosBarcode(bytes, bill.billNumber, design.barcodeFormat || 'code128');
  }

  if (design.showQrCode) {
    const qrPayload = buildReceiptQrPayload(bill, storeProfile, design);
    pushLine(bytes, divider);
    pushEscPosQrCode(bytes, qrPayload);
    if (design.qrCodeLabel?.trim()) {
      pushAlign(bytes, 'center');
      wrapTextLines(design.qrCodeLabel.trim(), colWidth).forEach(line => pushLine(bytes, line));
    }
  }

  if (design.showFooterMessage) {
    pushLine(bytes, divider);
    pushAlign(bytes, design.footerAlignment || 'center');
    const footer =
      design.customFooterText?.trim() ||
      receiptSettings.thankYouMessage ||
      'Thank you for your business!';
    footer
      .split(/\r?\n/)
      .map(l => l.trim())
      .filter(Boolean)
      .forEach(line => wrapTextLines(line, colWidth).forEach(w => pushLine(bytes, w)));
  }

  return finalizeEscPosBytes(bytes, printers);
}

export function buildEscPosTestPageBytes(
  channelLabel: string,
  paperWidth: PaperWidthType,
  storeProfile: StoreProfile,
  printers: PrinterConnectionsConfig
): Uint8Array {
  const colWidth = paperWidth === '80mm' ? 48 : 32;
  const divider = '-'.repeat(colWidth);
  const bytes: number[] = [0x1b, 0x40];

  pushAlign(bytes, 'center');
  pushBold(bytes, true);
  pushDoubleSize(bytes, true);
  pushLine(bytes, (storeProfile.storeName?.trim() || 'SQ ENTERPRISES').toUpperCase());
  pushDoubleSize(bytes, false);
  pushBold(bytes, false);
  pushLine(bytes, 'THERMAL PRINTER TEST PAGE');
  pushLine(bytes, divider);

  pushAlign(bytes, 'left');
  pushLine(bytes, padTwoColumn('Channel:', channelLabel, colWidth));
  pushLine(bytes, padTwoColumn('Paper Width:', `${paperWidth} (${colWidth} cols)`, colWidth));
  pushLine(
    bytes,
    padTwoColumn(
      'Auto-Cut:',
      printers.autoCutPaper ? `On (${printers.autoCutMode === 'full' ? 'Full' : 'Partial'})` : 'Off',
      colWidth
    )
  );
  pushLine(bytes, padTwoColumn('Cash Drawer:', printers.openCashDrawer ? 'Pulse On' : 'Off', colWidth));
  if (printers.paperRoll) {
    const { remainingMeters, totalMeters, remainingPct } = getRemainingPaperMeters(printers);
    pushLine(
      bytes,
      padTwoColumn(
        'Paper Roll:',
        `${Math.round(remainingPct)}% (${remainingMeters.toFixed(1)}m / ${totalMeters}m)`,
        colWidth
      )
    );
  }
  pushLine(bytes, padTwoColumn('Time:', new Date().toLocaleTimeString('en-IN'), colWidth));
  pushLine(bytes, divider);

  pushAlign(bytes, 'center');
  pushBold(bytes, true);
  pushLine(bytes, 'Printer alignment & ESC/POS OK');
  pushBold(bytes, false);

  return finalizeEscPosBytes(bytes, printers);
}

export function normalizeRollLengthMeters(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 30;
  return Math.min(500, Math.max(1, Math.round(value * 10) / 10));
}

export function estimateReceiptLengthMeters(
  bill: Pick<Bill, 'items'>,
  design: ReceiptDesignConfig,
  feedLinesAfterPrint = 3
): number {
  const baseMm = 68;
  const perItemMm = design.itemDisplayFormat === 'bulk_cards' ? 14 : 7;
  const extrasMm =
    (design.showCustomHeaderText ? 8 : 0) +
    (design.showBarcode ? 18 : 0) +
    (design.showQrCode ? 28 : 0) +
    Math.max(0, feedLinesAfterPrint) * 4;
  const totalMm = baseMm + bill.items.length * perItemMm + extrasMm;
  return Number((totalMm / 1000).toFixed(4));
}

export function estimateReceiptPaperConsumptionPct(
  bill: Pick<Bill, 'items'>,
  design: ReceiptDesignConfig,
  rollLengthMeters = 30,
  feedLinesAfterPrint = 3
): number {
  const safeRollMeters = normalizeRollLengthMeters(rollLengthMeters);
  const receiptMeters = estimateReceiptLengthMeters(bill, design, feedLinesAfterPrint);
  const pct = (receiptMeters / safeRollMeters) * 100;
  return Math.max(0.05, Math.min(100, Number(pct.toFixed(2))));
}

export function recalculatePaperRollRemaining(
  roll: ThermalPaperRollConfig,
  nextRollLengthMeters?: number
): ThermalPaperRollConfig {
  const prevLength = normalizeRollLengthMeters(roll.rollLengthMeters);
  const targetLength = normalizeRollLengthMeters(nextRollLengthMeters ?? roll.rollLengthMeters);
  const usedMeters =
    typeof roll.usedMetersSinceReset === 'number' &&
    Number.isFinite(roll.usedMetersSinceReset) &&
    roll.usedMetersSinceReset >= 0
      ? roll.usedMetersSinceReset
      : Math.max(0, Number((prevLength * (1 - roll.estimatedRemainingPct / 100)).toFixed(4)));

  const clampedRemainingMeters = Math.max(0, targetLength - usedMeters);
  const nextRemainingPct = Math.max(
    0,
    Math.min(100, Number(((clampedRemainingMeters / targetLength) * 100).toFixed(2)))
  );

  return {
    ...roll,
    rollLengthMeters: targetLength,
    usedMetersSinceReset: Number(usedMeters.toFixed(4)),
    estimatedRemainingPct: nextRemainingPct,
  };
}

export function getRemainingPaperMeters(
  printers?: Partial<PrinterConnectionsConfig>,
  customPaperLengthMeters?: number
): {
  totalMeters: number;
  usedMeters: number;
  remainingMeters: number;
  remainingPct: number;
} {
  const resolved = resolvePrinterConnectionsConfig(printers);
  const roll = recalculatePaperRollRemaining(
    resolved.paperRoll!,
    customPaperLengthMeters
  );
  const totalMeters = roll.rollLengthMeters;
  const usedMeters = Math.min(totalMeters, roll.usedMetersSinceReset || 0);
  const remainingMeters = Math.max(0, Number((totalMeters - usedMeters).toFixed(2)));
  return {
    totalMeters,
    usedMeters: Number(usedMeters.toFixed(2)),
    remainingMeters,
    remainingPct: roll.estimatedRemainingPct,
  };
}

export function consumeThermalPaperRoll(
  printers: PrinterConnectionsConfig,
  bill: Pick<Bill, 'items'>,
  design: ReceiptDesignConfig,
  customPaperLengthMeters?: number
): PrinterConnectionsConfig {
  const resolved = resolvePrinterConnectionsConfig(printers);
  const roll = recalculatePaperRollRemaining(
    resolved.paperRoll!,
    customPaperLengthMeters
  );
  const printedMeters = estimateReceiptLengthMeters(
    bill,
    design,
    resolved.feedLinesAfterPrint
  );
  const nextUsedMeters = Number(((roll.usedMetersSinceReset || 0) + printedMeters).toFixed(4));
  const nextRoll = recalculatePaperRollRemaining(
    {
      ...roll,
      usedMetersSinceReset: nextUsedMeters,
      billsPrintedSinceReset: (roll.billsPrintedSinceReset || 0) + 1,
    },
    roll.rollLengthMeters
  );
  return {
    ...resolved,
    paperRoll: nextRoll,
  };
}

export function isThermalPaperLow(
  printers?: Partial<PrinterConnectionsConfig>,
  customPaperLengthMeters?: number
): boolean {
  const resolved = resolvePrinterConnectionsConfig(printers);
  const roll = resolved.paperRoll;
  if (!roll || !roll.lowPaperAlertEnabled) return false;
  const { remainingPct } = getRemainingPaperMeters(resolved, customPaperLengthMeters);
  return remainingPct <= roll.lowPaperThresholdPct;
}

// =========================================================================
// BLUETOOTH BLE TRANSPORT
// =========================================================================

export async function connectBluetoothPrinter(): Promise<{
  deviceId: string;
  deviceName: string;
  serviceUuid: string;
  characteristicUuid: string;
}> {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
  if (!nav?.bluetooth?.requestDevice) {
    throw new Error(
      'Web Bluetooth is not supported in this browser. Use Chrome or Edge on desktop/Android over HTTPS.'
    );
  }

  const device = await nav.bluetooth.requestDevice({
    acceptAllDevices: true,
    optionalServices: BLE_PRINTER_SERVICES,
  });

  if (!device.gatt) {
    throw new Error('Selected Bluetooth device does not expose a GATT thermal print service.');
  }

  const server = await device.gatt.connect();
  let services: any[] = [];
  try {
    services = await server.getPrimaryServices();
  } catch {
    for (const uuid of BLE_PRINTER_SERVICES) {
      try {
        const svc = await server.getPrimaryService(uuid);
        if (svc) services.push(svc);
      } catch {
        // try next known printer service UUID
      }
    }
  }

  let writableChar: any = null;
  let foundServiceUuid = '';

  for (const svc of services) {
    try {
      const chars = await svc.getCharacteristics();
      const match = chars.find(
        (c: any) => c.properties?.writeWithoutResponse || c.properties?.write
      );
      if (match) {
        writableChar = match;
        foundServiceUuid = svc.uuid;
        break;
      }
    } catch {
      // ignore inaccessible service
    }
  }

  if (!writableChar) {
    try {
      device.gatt.disconnect();
    } catch {
      // ignore
    }
    throw new Error(
      `Connected to "${device.name || 'Bluetooth Device'}", but no writable ESC/POS BLE characteristic was found.`
    );
  }

  device.addEventListener?.('gattserverdisconnected', () => {
    liveBluetooth.characteristic = null;
    notifyHardwareChange();
  });

  const deviceName = String(device.name || 'Bluetooth Thermal Printer');
  liveBluetooth.device = device;
  liveBluetooth.characteristic = writableChar;
  liveBluetooth.deviceId = device.id;
  liveBluetooth.deviceName = deviceName;
  liveBluetooth.serviceUuid = foundServiceUuid;
  liveBluetooth.characteristicUuid = writableChar.uuid;
  notifyHardwareChange();

  return {
    deviceId: String(device.id || ''),
    deviceName,
    serviceUuid: foundServiceUuid,
    characteristicUuid: String(writableChar.uuid || ''),
  };
}

export async function disconnectBluetoothPrinter(): Promise<void> {
  try {
    if (liveBluetooth.device?.gatt?.connected) {
      liveBluetooth.device.gatt.disconnect();
    }
  } catch {
    // ignore
  }
  liveBluetooth.device = null;
  liveBluetooth.characteristic = null;
  liveBluetooth.deviceName = undefined;
  liveBluetooth.deviceId = undefined;
  notifyHardwareChange();
}

async function sendBytesViaBluetooth(bytes: Uint8Array, chunkSize = 100): Promise<void> {
  if (!liveBluetooth.device || !liveBluetooth.characteristic) {
    throw new Error('Bluetooth printer is not connected. Pair & connect it first.');
  }

  if (!liveBluetooth.device.gatt?.connected) {
    const server = await liveBluetooth.device.gatt.connect();
    if (liveBluetooth.serviceUuid && liveBluetooth.characteristicUuid) {
      const svc = await server.getPrimaryService(liveBluetooth.serviceUuid);
      liveBluetooth.characteristic = await svc.getCharacteristic(
        liveBluetooth.characteristicUuid
      );
    }
    notifyHardwareChange();
  }

  const char = liveBluetooth.characteristic;
  const step = Math.min(240, Math.max(20, chunkSize));
  for (let offset = 0; offset < bytes.length; offset += step) {
    const chunk = bytes.slice(offset, offset + step);
    if (char.properties?.writeWithoutResponse && typeof char.writeValueWithoutResponse === 'function') {
      await char.writeValueWithoutResponse(chunk);
    } else {
      await char.writeValue(chunk);
    }
    await new Promise(r => setTimeout(r, 12));
  }
}

// =========================================================================
// USB TRANSPORT (WEBUSB + WEB SERIAL)
// =========================================================================

export async function connectUsbPrinter(
  transport: 'webusb' | 'serial',
  baudRate = 9600
): Promise<{
  transport: 'webusb' | 'serial';
  deviceName: string;
  vendorId?: number;
  productId?: number;
  interfaceNumber: number;
  endpointNumber: number;
}> {
  const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;

  if (transport === 'serial') {
    if (!nav?.serial?.requestPort) {
      throw new Error(
        'Web Serial is not supported in this browser. Use Chrome or Edge on desktop, or switch USB transport to WebUSB.'
      );
    }
    const port = await nav.serial.requestPort();
    await port.open({ baudRate });
    const info = typeof port.getInfo === 'function' ? port.getInfo() : {};

    liveUsb.transport = 'serial';
    liveUsb.serialPort = port;
    liveUsb.usbDevice = null;
    liveUsb.vendorId = info.usbVendorId;
    liveUsb.productId = info.usbProductId;
    liveUsb.deviceName = info.usbVendorId
      ? `USB Serial (${info.usbVendorId.toString(16).toUpperCase()}:${(
          info.usbProductId || 0
        )
          .toString(16)
          .toUpperCase()})`
      : 'USB Serial Thermal Printer';
    liveUsb.interfaceNumber = 0;
    liveUsb.endpointNumber = 1;
    notifyHardwareChange();

    return {
      transport: 'serial',
      deviceName: liveUsb.deviceName,
      vendorId: liveUsb.vendorId,
      productId: liveUsb.productId,
      interfaceNumber: 0,
      endpointNumber: 1,
    };
  }

  if (!nav?.usb?.requestDevice) {
    throw new Error(
      'WebUSB is not supported in this browser. Use Chrome/Edge over HTTPS or Android USB-OTG.'
    );
  }

  const device = await nav.usb.requestDevice({ filters: [] });
  await device.open();
  if (!device.configuration) {
    await device.selectConfiguration(1);
  }

  let selectedInterface = 0;
  let selectedEndpoint = 1;
  let found = false;

  const interfaces = device.configuration?.interfaces || [];
  // Prefer USB Printer Class (0x07), then any interface with a bulk OUT endpoint
  const sortedInterfaces = [...interfaces].sort((a: any, b: any) => {
    const aIsPrinter = a.alternates?.some((alt: any) => alt.interfaceClass === 7) ? 0 : 1;
    const bIsPrinter = b.alternates?.some((alt: any) => alt.interfaceClass === 7) ? 0 : 1;
    return aIsPrinter - bIsPrinter;
  });

  for (const iface of sortedInterfaces) {
    for (const alt of iface.alternates || []) {
      const outEp = (alt.endpoints || []).find(
        (ep: any) => ep.direction === 'out' && ep.type === 'bulk'
      );
      if (outEp) {
        selectedInterface = iface.interfaceNumber;
        selectedEndpoint = outEp.endpointNumber;
        found = true;
        break;
      }
    }
    if (found) break;
  }

  await device.claimInterface(selectedInterface);

  liveUsb.transport = 'webusb';
  liveUsb.usbDevice = device;
  liveUsb.serialPort = null;
  liveUsb.vendorId = device.vendorId;
  liveUsb.productId = device.productId;
  liveUsb.deviceName =
    [device.manufacturerName, device.productName].filter(Boolean).join(' ') ||
    `USB Printer (${device.vendorId?.toString(16).toUpperCase()})`;
  liveUsb.interfaceNumber = selectedInterface;
  liveUsb.endpointNumber = selectedEndpoint;
  notifyHardwareChange();

  return {
    transport: 'webusb',
    deviceName: liveUsb.deviceName,
    vendorId: device.vendorId,
    productId: device.productId,
    interfaceNumber: selectedInterface,
    endpointNumber: selectedEndpoint,
  };
}

export async function disconnectUsbPrinter(): Promise<void> {
  try {
    if (liveUsb.usbDevice?.opened) {
      await liveUsb.usbDevice.close();
    }
  } catch {
    // ignore
  }
  try {
    if (liveUsb.serialPort) {
      await liveUsb.serialPort.close();
    }
  } catch {
    // ignore
  }
  liveUsb.usbDevice = null;
  liveUsb.serialPort = null;
  liveUsb.deviceName = undefined;
  notifyHardwareChange();
}

async function sendBytesViaUsb(
  bytes: Uint8Array,
  transport: 'webusb' | 'serial'
): Promise<void> {
  if (transport === 'serial' || (liveUsb.serialPort && !liveUsb.usbDevice)) {
    if (!liveUsb.serialPort?.writable) {
      throw new Error('USB Serial printer is not connected. Connect the USB port first.');
    }
    const writer = liveUsb.serialPort.writable.getWriter();
    try {
      await writer.write(bytes);
    } finally {
      writer.releaseLock();
    }
    return;
  }

  if (!liveUsb.usbDevice?.opened) {
    throw new Error('USB printer is not connected. Connect the USB printer first.');
  }
  await liveUsb.usbDevice.transferOut(liveUsb.endpointNumber, bytes);
}

// =========================================================================
// NETWORK IP & WIFI RAW TCP BRIDGE
// =========================================================================

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const slice = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...slice);
  }
  return btoa(binary);
}

export async function testTcpPrinterConnection(
  host: string,
  port: number,
  timeoutMs = 4000
): Promise<{ reachable: boolean; latencyMs?: number; error?: string }> {
  const res = await fetch('/api/printers/tcp/test', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ host, port, timeoutMs }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.reachable) {
    return {
      reachable: false,
      error: data?.error || `Could not connect to ${host}:${port}`,
    };
  }
  return {
    reachable: true,
    latencyMs: data.latencyMs,
  };
}

async function sendBytesViaTcp(
  bytes: Uint8Array,
  host: string,
  port: number,
  timeoutMs = 4000,
  channel: 'network_ip' | 'wifi' = 'network_ip'
): Promise<{ bytesSent: number; latencyMs?: number }> {
  const res = await fetch('/api/printers/tcp/print', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      host,
      port,
      timeoutMs,
      channel,
      payloadBase64: uint8ArrayToBase64(bytes),
    }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data?.success) {
    throw new Error(data?.error || `Failed to print via ${host}:${port}`);
  }
  return {
    bytesSent: data.bytesSent || bytes.length,
    latencyMs: data.latencyMs,
  };
}

// =========================================================================
// UNIFIED DISPATCHERS
// =========================================================================

export const PRINTER_TYPE_LABELS: Record<PrinterConnectionType | 'browser', string> = {
  bluetooth: 'Bluetooth Printer',
  usb: 'USB Printer',
  network_ip: 'Network IP Printer',
  wifi: 'WiFi Printer',
  browser: 'System / Browser Print',
};

export function getEnabledHardwarePrinters(
  printers?: Partial<PrinterConnectionsConfig>
): PrinterConnectionType[] {
  const resolved = resolvePrinterConnectionsConfig(printers);
  const active: PrinterConnectionType[] = [];
  if (resolved.bluetooth.enabled) active.push('bluetooth');
  if (resolved.usb.enabled) active.push('usb');
  if (resolved.networkIp.enabled) active.push('network_ip');
  if (resolved.wifi.enabled) active.push('wifi');
  return active;
}

export async function dispatchEscPosPayload(
  target: PrinterConnectionType | 'browser',
  bytes: Uint8Array,
  printers: PrinterConnectionsConfig,
  onBrowserPrintFallback?: () => void
): Promise<{ message: string }> {
  if (target === 'browser') {
    if (onBrowserPrintFallback) {
      onBrowserPrintFallback();
    } else if (typeof window !== 'undefined') {
      window.print();
    }
    return { message: 'Opened system print dialog.' };
  }

  if (target === 'bluetooth') {
    if (!printers.bluetooth.enabled) {
      throw new Error('Bluetooth printer is disabled. Turn ON its switch in Printer Settings.');
    }
    await sendBytesViaBluetooth(bytes, printers.bluetooth.chunkSizeBytes || 100);
    return {
      message: `Sent ${bytes.length} bytes to Bluetooth printer (${
        liveBluetooth.deviceName || printers.bluetooth.deviceName || 'BLE'
      }).`,
    };
  }

  if (target === 'usb') {
    if (!printers.usb.enabled) {
      throw new Error('USB printer is disabled. Turn ON its switch in Printer Settings.');
    }
    await sendBytesViaUsb(bytes, printers.usb.transport);
    return {
      message: `Sent ${bytes.length} bytes to USB printer (${
        liveUsb.deviceName || printers.usb.deviceName || printers.usb.transport.toUpperCase()
      }).`,
    };
  }

  if (target === 'network_ip') {
    if (!printers.networkIp.enabled) {
      throw new Error('Network IP printer is disabled. Turn ON its switch in Printer Settings.');
    }
    const result = await sendBytesViaTcp(
      bytes,
      printers.networkIp.host,
      printers.networkIp.port || 9100,
      printers.networkIp.timeoutMs || 4000,
      'network_ip'
    );
    return {
      message: `Printed ${result.bytesSent} bytes via Network IP ${printers.networkIp.host}:${
        printers.networkIp.port
      }${result.latencyMs !== undefined ? ` (${result.latencyMs}ms)` : ''}.`,
    };
  }

  // WiFi Printer
  if (!printers.wifi.enabled) {
    throw new Error('WiFi printer is disabled. Turn ON its switch in Printer Settings.');
  }
  if (printers.wifi.mode === 'system_wifi') {
    if (onBrowserPrintFallback) {
      onBrowserPrintFallback();
    } else if (typeof window !== 'undefined') {
      window.print();
    }
    return {
      message: `Sent receipt to WiFi system print sheet (${
        printers.wifi.ssidLabel || printers.wifi.label || 'AirPrint / Mopria'
      }).`,
    };
  }

  const wifiResult = await sendBytesViaTcp(
    bytes,
    printers.wifi.host,
    printers.wifi.port || 9100,
    printers.wifi.timeoutMs || 4500,
    'wifi'
  );
  return {
    message: `Printed ${wifiResult.bytesSent} bytes via WiFi (${printers.wifi.host}:${
      printers.wifi.port
    }${wifiResult.latencyMs !== undefined ? ` · ${wifiResult.latencyMs}ms` : ''}).`,
  };
}
