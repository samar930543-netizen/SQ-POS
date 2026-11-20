import {
  Bill,
  CashFlowEntry,
  DailyCashFlowSummary,
  KhataTransaction,
} from '../types';
import { formatCurrency } from './formatters';

function shiftIsoDate(dateStr: string, deltaDays: number): string {
  const base = new Date(`${dateStr}T00:00:00Z`);
  base.setUTCDate(base.getUTCDate() + deltaDays);
  return base.toISOString().slice(0, 10);
}

/**
 * Resolves the opening cash balance for a given YYYY-MM-DD date.
 * Uses explicit stored opening cash if set, otherwise walks back up to 14 days
 * to carry forward the previous day's closing cash drawer balance.
 */
export function resolveOpeningCashForDate(
  targetDate: string,
  bills: Bill[],
  khata: KhataTransaction[],
  entries: CashFlowEntry[],
  openingCashMap: Record<string, number>,
  depth: number = 0
): { openingCash: number; hasExplicitOpeningCash: boolean } {
  if (Object.prototype.hasOwnProperty.call(openingCashMap, targetDate)) {
    return {
      openingCash: openingCashMap[targetDate],
      hasExplicitOpeningCash: true,
    };
  }

  if (depth >= 14) {
    return { openingCash: 0, hasExplicitOpeningCash: false };
  }

  const prevDate = shiftIsoDate(targetDate, -1);
  const hasPrevActivity =
    Object.prototype.hasOwnProperty.call(openingCashMap, prevDate) ||
    bills.some(b => b.timestamp.slice(0, 10) === prevDate) ||
    khata.some(k => k.timestamp.slice(0, 10) === prevDate) ||
    entries.some(e => e.date === prevDate);

  if (!hasPrevActivity) {
    return resolveOpeningCashForDate(
      prevDate,
      bills,
      khata,
      entries,
      openingCashMap,
      depth + 1
    );
  }

  const prevSummary = computeDailyCashFlow(
    prevDate,
    bills,
    khata,
    entries,
    openingCashMap,
    depth + 1
  );

  return {
    openingCash: prevSummary.closingCashDrawer,
    hasExplicitOpeningCash: false,
  };
}

/**
 * Computes complete cash flow reconciliation for a single date (YYYY-MM-DD).
 */
export function computeDailyCashFlow(
  targetDate: string,
  bills: Bill[],
  khata: KhataTransaction[],
  entries: CashFlowEntry[],
  openingCashMap: Record<string, number>,
  _depth: number = 0
): DailyCashFlowSummary {
  const { openingCash, hasExplicitOpeningCash } = resolveOpeningCashForDate(
    targetDate,
    bills,
    khata,
    entries,
    openingCashMap,
    _depth
  );

  const dateBills = bills
    .filter(b => b.timestamp.slice(0, 10) === targetDate)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const dateKhataPayments = khata
    .filter(k => k.type === 'PAYMENT_COLLECTED' && k.timestamp.slice(0, 10) === targetDate)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  let automatedBillCashIn = 0;
  let automatedBillUpiIn = 0;
  let automatedSalesGross = 0;

  dateBills.forEach(bill => {
    automatedSalesGross += bill.itemsTotal + (bill.totalGstAmount || 0);
    if (bill.paymentMode === 'upi') {
      automatedBillUpiIn += bill.amountReceived;
    } else {
      automatedBillCashIn += bill.amountReceived;
    }
  });

  const automatedKhataCashIn = dateKhataPayments.reduce(
    (sum, tx) => sum + tx.amount,
    0
  );

  const totalAutomatedInflow =
    automatedBillCashIn + automatedBillUpiIn + automatedKhataCashIn;

  const dateEntries = entries
    .filter(e => e.date === targetDate)
    .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  const injectionItems = dateEntries.filter(e => e.type === 'cash_injection');
  const supplierPaymentItems = dateEntries.filter(e => e.type === 'supplier_payment');
  const expenseItems = dateEntries.filter(e => e.type === 'expense');

  const manualCashInjections = injectionItems.reduce((s, e) => s + e.amount, 0);
  const supplierPaymentsTotal = supplierPaymentItems.reduce((s, e) => s + e.amount, 0);
  const manualExpensesTotal = expenseItems.reduce((s, e) => s + e.amount, 0);
  const totalOutflow = supplierPaymentsTotal + manualExpensesTotal;

  // Physical cash drawer flow (excludes UPI/Bank transfers)
  const cashInjectionsOnly = injectionItems
    .filter(e => e.paymentMode === 'cash')
    .reduce((s, e) => s + e.amount, 0);
  const cashOutflowsOnly = [...supplierPaymentItems, ...expenseItems]
    .filter(e => e.paymentMode === 'cash')
    .reduce((s, e) => s + e.amount, 0);

  const closingCashDrawer =
    openingCash +
    automatedBillCashIn +
    automatedKhataCashIn +
    cashInjectionsOnly -
    cashOutflowsOnly;

  const closingBalanceAllModes =
    openingCash +
    totalAutomatedInflow +
    manualCashInjections -
    totalOutflow;

  const netDayChange =
    totalAutomatedInflow + manualCashInjections - totalOutflow;

  return {
    date: targetDate,
    openingCash,
    hasExplicitOpeningCash,
    automatedBillCashIn,
    automatedBillUpiIn,
    automatedKhataCashIn,
    automatedSalesGross,
    totalAutomatedInflow,
    manualCashInjections,
    supplierPaymentsTotal,
    manualExpensesTotal,
    totalOutflow,
    closingCashDrawer,
    closingBalanceAllModes,
    netDayChange,
    supplierPaymentItems,
    injectionItems,
    expenseItems,
    dateBills,
    dateKhataPayments,
  };
}

/**
 * Computes multi-day cash flow snapshots ending on endDate (newest first).
 */
export function computeCashFlowHistory(
  endDate: string,
  days: number,
  bills: Bill[],
  khata: KhataTransaction[],
  entries: CashFlowEntry[],
  openingCashMap: Record<string, number>
): DailyCashFlowSummary[] {
  const result: DailyCashFlowSummary[] = [];
  for (let i = 0; i < days; i++) {
    const dateStr = shiftIsoDate(endDate, -i);
    result.push(
      computeDailyCashFlow(dateStr, bills, khata, entries, openingCashMap)
    );
  }
  return result;
}

/**
 * Generates downloadable CSV for multi-day cash flow ledger & selected day's entries.
 */
export function buildCashFlowCsv(
  summary: DailyCashFlowSummary,
  history: DailyCashFlowSummary[]
): string {
  const lines: string[] = [];
  lines.push('DAILY CASH FLOW SUMMARY');
  lines.push(
    [
      'Date',
      'Opening Cash',
      'Sales Cash In',
      'Sales UPI In',
      'Khata Collections',
      'Manual Injections',
      'Supplier Payments',
      'Operating Expenses',
      'Closing Cash Drawer',
      'Total Closing Balance (All Modes)',
    ].join(',')
  );

  history.forEach(day => {
    lines.push(
      [
        day.date,
        day.openingCash.toFixed(2),
        day.automatedBillCashIn.toFixed(2),
        day.automatedBillUpiIn.toFixed(2),
        day.automatedKhataCashIn.toFixed(2),
        day.manualCashInjections.toFixed(2),
        day.supplierPaymentsTotal.toFixed(2),
        day.manualExpensesTotal.toFixed(2),
        day.closingCashDrawer.toFixed(2),
        day.closingBalanceAllModes.toFixed(2),
      ].join(',')
    );
  });

  lines.push('');
  lines.push(`ITEMIZED ENTRIES FOR ${summary.date}`);
  lines.push(['Timestamp', 'Type', 'Category', 'Title', 'Vendor/PO', 'Mode', 'Amount'].join(','));

  const dayEntries = [
    ...summary.injectionItems,
    ...summary.supplierPaymentItems,
    ...summary.expenseItems,
  ].sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());

  dayEntries.forEach(entry => {
    lines.push(
      [
        entry.timestamp,
        entry.type,
        `"${(entry.category || '').replace(/"/g, '""')}"`,
        `"${entry.title.replace(/"/g, '""')}"`,
        `"${(entry.supplierName || entry.poNumber || '').replace(/"/g, '""')}"`,
        entry.paymentMode.toUpperCase(),
        entry.amount.toFixed(2),
      ].join(',')
    );
  });

  return lines.join('\n');
}

/**
 * Formats a concise WhatsApp Daily Cash Closing report.
 */
export function buildWhatsAppCashFlowText(summary: DailyCashFlowSummary): string {
  const line = '------------------------------';
  let text = `*SQ ENTERPRISES - DAILY CASH FLOW*\n`;
  text += `*Date:* ${summary.date}\n`;
  text += `${line}\n`;
  text += `*Opening Cash:* ${formatCurrency(summary.openingCash)}\n`;
  text += `*+ Sales Inflow (POS + Khata):* ${formatCurrency(summary.totalAutomatedInflow)}\n`;
  text += `  • Cash Bills: ${formatCurrency(summary.automatedBillCashIn)}\n`;
  text += `  • UPI Bills: ${formatCurrency(summary.automatedBillUpiIn)}\n`;
  text += `  • Khata Collected: ${formatCurrency(summary.automatedKhataCashIn)}\n`;
  text += `*+ Cash Injections:* ${formatCurrency(summary.manualCashInjections)}\n`;
  text += `*- Supplier Payments:* ${formatCurrency(summary.supplierPaymentsTotal)}\n`;
  text += `*- Operating Expenses:* ${formatCurrency(summary.manualExpensesTotal)}\n`;
  text += `${line}\n`;
  text += `*Closing Cash Drawer:* *${formatCurrency(summary.closingCashDrawer)}*\n`;
  text += `*Total Closing Balance:* *${formatCurrency(summary.closingBalanceAllModes)}*\n`;
  text += `${line}\n`;
  text += `_SQ ENTERPRISES Wholesale POS_`;
  return text;
}
