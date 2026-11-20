import { Bill, Customer, KhataTransaction } from '../types';

export const DEFAULT_CREDIT_WARNING_PCT = 80;

export type CreditLimitStatus = 'no_limit' | 'healthy' | 'nearing' | 'exceeded';

export interface CreditLimitEvaluation {
  hasLimit: boolean;
  limit: number;
  warningPct: number;
  warningThresholdAmount: number;
  balance: number;
  utilizationPct: number;
  remainingHeadroom: number;
  excessAmount: number;
  status: CreditLimitStatus;
  statusLabel: string;
}

export interface AutoCreditRatingResult {
  score: number; // 1 to 5
  numericScore: number; // 0 to 100
  label: string;
  summary: string;
  hasHistory: boolean;
  totalBilled: number;
  totalRepaid: number;
  repaymentRatioPct: number | null;
  paymentCount: number;
  billCount: number;
  fullPaidBillCount: number;
}

export interface EffectiveCreditRating {
  score: number; // 1 to 5
  source: 'auto' | 'manual';
  label: string;
  badgeTextClass: string;
  starColorClass: string;
  auto: AutoCreditRatingResult;
}

const RATING_LABELS: Record<number, string> = {
  5: 'Excellent',
  4: 'Reliable',
  3: 'Moderate',
  2: 'Watchlist',
  1: 'High Risk',
};

export function getRatingLabel(score: number): string {
  const clamped = Math.min(5, Math.max(1, Math.round(score)));
  return RATING_LABELS[clamped] || 'Moderate';
}

export function getRatingColorClasses(score: number): {
  badgeTextClass: string;
  starColorClass: string;
} {
  const rounded = Math.round(score);
  if (rounded >= 5) {
    return { badgeTextClass: 'text-emerald-300', starColorClass: 'text-emerald-400' };
  }
  if (rounded >= 4) {
    return { badgeTextClass: 'text-blue-300', starColorClass: 'text-blue-400' };
  }
  if (rounded >= 3) {
    return { badgeTextClass: 'text-amber-300', starColorClass: 'text-amber-400' };
  }
  if (rounded >= 2) {
    return { badgeTextClass: 'text-orange-300', starColorClass: 'text-orange-400' };
  }
  return { badgeTextClass: 'text-rose-300', starColorClass: 'text-rose-400' };
}

export function evaluateCustomerCreditLimit(
  customer: Customer,
  balanceOverride?: number
): CreditLimitEvaluation {
  const rawLimit = Number(customer.creditLimit || 0);
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.round(rawLimit * 100) / 100 : 0;
  const rawWarnPct = Number(customer.creditWarningPct ?? DEFAULT_CREDIT_WARNING_PCT);
  const warningPct =
    Number.isFinite(rawWarnPct) && rawWarnPct >= 50 && rawWarnPct <= 99
      ? Math.round(rawWarnPct)
      : DEFAULT_CREDIT_WARNING_PCT;
  const balance = Math.max(0, Math.round((balanceOverride ?? customer.currentBalance) * 100) / 100);

  if (limit <= 0) {
    return {
      hasLimit: false,
      limit: 0,
      warningPct,
      warningThresholdAmount: 0,
      balance,
      utilizationPct: 0,
      remainingHeadroom: 0,
      excessAmount: 0,
      status: 'no_limit',
      statusLabel: 'No Limit Set',
    };
  }

  const utilizationPct = Math.round((balance / limit) * 1000) / 10;
  const warningThresholdAmount = Math.round((limit * warningPct) / 100);
  const remainingHeadroom = Math.max(0, Math.round((limit - balance) * 100) / 100);
  const excessAmount = Math.max(0, Math.round((balance - limit) * 100) / 100);

  let status: CreditLimitStatus = 'healthy';
  let statusLabel = 'Within Limit';

  if (balance > limit) {
    status = 'exceeded';
    statusLabel = 'Limit Exceeded';
  } else if (balance === limit) {
    status = 'exceeded';
    statusLabel = 'At Limit (100%)';
  } else if (utilizationPct >= warningPct) {
    status = 'nearing';
    statusLabel = `Nearing Limit (${Math.round(utilizationPct)}%)`;
  }

  return {
    hasLimit: true,
    limit,
    warningPct,
    warningThresholdAmount,
    balance,
    utilizationPct,
    remainingHeadroom,
    excessAmount,
    status,
    statusLabel,
  };
}

export function calculateAutoCreditRating(
  customer: Customer,
  bills: Bill[],
  khata: KhataTransaction[]
): AutoCreditRatingResult {
  const customerBills = bills.filter(b => b.customerId === customer.id);
  const customerPayments = khata.filter(
    k => k.customerId === customer.id && k.type === 'PAYMENT_COLLECTED'
  );

  const totalBilled =
    Math.round(
      customerBills.reduce(
        (sum, b) => sum + Math.max(0, b.itemsTotal + (b.totalGstAmount || 0)),
        0
      ) * 100
    ) / 100;

  const paidOnBills =
    Math.round(
      customerBills.reduce((sum, b) => sum + Math.min(b.amountReceived, b.grandTotal), 0) * 100
    ) / 100;

  const directKhataPaid =
    Math.round(customerPayments.reduce((sum, k) => sum + Math.max(0, k.amount), 0) * 100) / 100;

  const totalRepaid = Math.round((paidOnBills + directKhataPaid) * 100) / 100;
  const outstanding = Math.max(0, customer.currentBalance);
  const fullPaidBillCount = customerBills.filter(b => b.remainingBalance <= 0).length;

  const hasHistory = customerBills.length > 0 || customerPayments.length > 0;
  const totalExposure = totalRepaid + outstanding;
  const repaymentRatio = totalExposure > 0 ? totalRepaid / totalExposure : null;
  const repaymentRatioPct =
    repaymentRatio !== null ? Math.min(100, Math.round(repaymentRatio * 100)) : null;

  const creditEval = evaluateCustomerCreditLimit(customer);

  let points = 72;

  if (repaymentRatio !== null) {
    if (repaymentRatio >= 0.9) points += 20;
    else if (repaymentRatio >= 0.75) points += 12;
    else if (repaymentRatio >= 0.5) points += 3;
    else if (repaymentRatio >= 0.25) points -= 10;
    else if (totalRepaid > 0) points -= 20;
    else if (outstanding > 0) points -= 10;
  }

  // Payment discipline bonus
  points += Math.min(10, customerPayments.length * 3 + fullPaidBillCount * 2);

  // Credit limit utilization impact
  if (creditEval.status === 'exceeded') {
    points -= creditEval.excessAmount > 0 ? 30 : 22;
  } else if (creditEval.status === 'nearing') {
    points -= 14;
  } else if (creditEval.status === 'healthy') {
    points += 5;
  }

  if (outstanding === 0) {
    points += 10;
  }

  const numericScore = Math.min(100, Math.max(0, Math.round(points)));

  let score = 3;
  if (numericScore >= 85) score = 5;
  else if (numericScore >= 70) score = 4;
  else if (numericScore >= 50) score = 3;
  else if (numericScore >= 30) score = 2;
  else score = 1;

  // Accounts without any recorded bills/payments cap at 4★ until payment history builds
  if (!hasHistory && score > 4) {
    score = 4;
  }

  let summary = '';
  if (!hasHistory) {
    if (creditEval.status === 'exceeded') {
      summary = 'Opening due exceeds credit limit with no recorded repayments yet.';
    } else if (creditEval.status === 'nearing') {
      summary = `Opening due is at ${Math.round(creditEval.utilizationPct)}% of credit limit.`;
    } else if (outstanding === 0) {
      summary = 'Clean opening account with ₹0 pending due.';
    } else {
      summary = 'Starter rating based on opening balance; updates automatically with payments.';
    }
  } else {
    const parts: string[] = [];
    if (repaymentRatioPct !== null) {
      parts.push(`${repaymentRatioPct}% repaid across ${customerBills.length} bill${customerBills.length === 1 ? '' : 's'}`);
    }
    if (customerPayments.length > 0) {
      parts.push(`${customerPayments.length} Khata settlement${customerPayments.length === 1 ? '' : 's'}`);
    }
    if (creditEval.status === 'exceeded') {
      parts.push('credit limit exceeded');
    } else if (creditEval.status === 'nearing') {
      parts.push(`at ${Math.round(creditEval.utilizationPct)}% of limit`);
    } else if (outstanding === 0) {
      parts.push('zero pending dues');
    }
    summary = parts.join(' · ') + '.';
  }

  return {
    score,
    numericScore,
    label: getRatingLabel(score),
    summary,
    hasHistory,
    totalBilled,
    totalRepaid,
    repaymentRatioPct,
    paymentCount: customerPayments.length,
    billCount: customerBills.length,
    fullPaidBillCount,
  };
}

export function getEffectiveCustomerRating(
  customer: Customer,
  bills: Bill[],
  khata: KhataTransaction[]
): EffectiveCreditRating {
  const auto = calculateAutoCreditRating(customer, bills, khata);
  const hasManualOverride =
    customer.ratingMode === 'manual' &&
    typeof customer.manualCreditRating === 'number' &&
    customer.manualCreditRating >= 1 &&
    customer.manualCreditRating <= 5;

  const score = hasManualOverride ? Math.round(customer.manualCreditRating!) : auto.score;
  const source: 'auto' | 'manual' = hasManualOverride ? 'manual' : 'auto';
  const colors = getRatingColorClasses(score);

  return {
    score,
    source,
    label: getRatingLabel(score),
    badgeTextClass: colors.badgeTextClass,
    starColorClass: colors.starColorClass,
    auto,
  };
}
