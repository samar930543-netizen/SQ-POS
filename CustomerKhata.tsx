import React, { useState, useMemo, useEffect } from 'react';
import { Customer, KhataTransaction, Bill } from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import { getCustomerPricingLabel } from '../utils/customerPricing';
import { getLoyaltyTierBadgeColor, getLoyaltyTierForPoints } from '../utils/loyaltyProgram';
import {
  DEFAULT_CREDIT_WARNING_PCT,
  evaluateCustomerCreditLimit,
  getEffectiveCustomerRating,
  getRatingLabel,
} from '../utils/customerCredit';
import {
  Users,
  Search,
  Plus,
  Phone,
  ArrowDownLeft,
  Share2,
  X,
  History,
  Tag,
  Award,
  ShoppingBag,
  ShieldAlert,
  ShieldCheck,
  AlertTriangle,
  Star,
  SlidersHorizontal,
  Check,
} from 'lucide-react';

export type CustomerCreditProfileUpdates = Partial<
  Pick<
    Customer,
    'creditLimit' | 'creditWarningPct' | 'ratingMode' | 'manualCreditRating' | 'creditRatingNote'
  >
>;

interface CustomerKhataProps {
  customers: Customer[];
  bills: Bill[];
  khata: KhataTransaction[];
  onAddNewCustomer: (
    name: string,
    phone: string,
    address?: string,
    creditLimit?: number
  ) => Customer;
  onRecordPayment: (customerId: string, amount: number, notes?: string) => void;
  onUpdateCustomerCreditProfile?: (
    customerId: string,
    updates: CustomerCreditProfileUpdates
  ) => void;
  onSelectCustomerForBilling?: (customer: Customer) => void;
  onOpenCustomerRewards?: (customerId: string) => void;
  onViewBillDetails?: (bill: Bill) => void;
  focusCustomerId?: string | null;
  onClearFocusCustomer?: () => void;
}

type KhataFilterMode = 'due' | 'alerts' | 'all';

export const CustomerKhata: React.FC<CustomerKhataProps> = ({
  customers,
  bills,
  khata,
  onAddNewCustomer,
  onRecordPayment,
  onUpdateCustomerCreditProfile,
  onSelectCustomerForBilling,
  onOpenCustomerRewards,
  onViewBillDetails,
  focusCustomerId,
  onClearFocusCustomer,
}) => {
  const { isMobileLayout } = useViewportLayout();
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<KhataFilterMode>('due');
  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(null);
  const [isAddCustomerOpen, setIsAddCustomerOpen] = useState(false);
  const [isCollectPaymentOpen, setIsCollectPaymentOpen] = useState(false);

  // Add customer form states
  const [newCustName, setNewCustName] = useState('');
  const [newCustPhone, setNewCustPhone] = useState('');
  const [newCustAddress, setNewCustAddress] = useState('');
  const [newCustCreditLimit, setNewCustCreditLimit] = useState('');

  // Payment form states
  const [paymentAmount, setPaymentAmount] = useState('');
  const [paymentNotes, setPaymentNotes] = useState('Cash Received');

  // Credit Limit & Rating editor states (for activeCustomer)
  const [creditLimitDraft, setCreditLimitDraft] = useState('');
  const [warningPctDraft, setWarningPctDraft] = useState<number>(DEFAULT_CREDIT_WARNING_PCT);
  const [ratingModeDraft, setRatingModeDraft] = useState<'auto' | 'manual'>('auto');
  const [manualRatingDraft, setManualRatingDraft] = useState<number>(4);
  const [ratingNoteDraft, setRatingNoteDraft] = useState('');
  const [savedNotice, setSavedNotice] = useState<'limit' | 'rating' | null>(null);

  // Focus customer if opened via Notification Center
  useEffect(() => {
    if (focusCustomerId) {
      const target = customers.find(c => c.id === focusCustomerId);
      if (target) {
        setSelectedCustomerId(target.id);
        setFilterMode('all');
      }
      onClearFocusCustomer?.();
    }
  }, [focusCustomerId, customers, onClearFocusCustomer]);

  // Total Outstanding Udhar across all customers
  const totalOutstandingDue = useMemo(() => {
    return customers.reduce((sum, c) => sum + c.currentBalance, 0);
  }, [customers]);

  // Selected customer
  const activeCustomer = useMemo(() => {
    return customers.find(c => c.id === selectedCustomerId) || null;
  }, [customers, selectedCustomerId]);

  // Sync editor drafts when selected customer changes
  useEffect(() => {
    if (!activeCustomer) return;
    setCreditLimitDraft(
      activeCustomer.creditLimit && activeCustomer.creditLimit > 0
        ? String(activeCustomer.creditLimit)
        : ''
    );
    setWarningPctDraft(activeCustomer.creditWarningPct ?? DEFAULT_CREDIT_WARNING_PCT);
    setRatingModeDraft(activeCustomer.ratingMode === 'manual' ? 'manual' : 'auto');
    setManualRatingDraft(
      activeCustomer.manualCreditRating &&
        activeCustomer.manualCreditRating >= 1 &&
        activeCustomer.manualCreditRating <= 5
        ? Math.round(activeCustomer.manualCreditRating)
        : 4
    );
    setRatingNoteDraft(activeCustomer.creditRatingNote || '');
    setSavedNotice(null);
  }, [activeCustomer?.id]);

  // Precompute credit limit evaluation + rating for every customer
  const customerInsightsById = useMemo(() => {
    const map = new Map<
      string,
      {
        credit: ReturnType<typeof evaluateCustomerCreditLimit>;
        rating: ReturnType<typeof getEffectiveCustomerRating>;
      }
    >();
    customers.forEach(c => {
      map.set(c.id, {
        credit: evaluateCustomerCreditLimit(c),
        rating: getEffectiveCustomerRating(c, bills, khata),
      });
    });
    return map;
  }, [customers, bills, khata]);

  const limitAlertCustomers = useMemo(() => {
    return customers.filter(c => {
      const status = customerInsightsById.get(c.id)?.credit.status;
      return status === 'nearing' || status === 'exceeded';
    });
  }, [customers, customerInsightsById]);

  const exceededCount = useMemo(
    () =>
      customers.filter(
        c => customerInsightsById.get(c.id)?.credit.status === 'exceeded'
      ).length,
    [customers, customerInsightsById]
  );

  // Selected customer's bills & payments
  const customerBills = useMemo(() => {
    if (!selectedCustomerId) return [];
    return bills.filter(b => b.customerId === selectedCustomerId);
  }, [bills, selectedCustomerId]);

  const customerPayments = useMemo(() => {
    if (!selectedCustomerId) return [];
    return khata.filter(k => k.customerId === selectedCustomerId);
  }, [khata, selectedCustomerId]);

  // Filtered customer list
  const filteredCustomers = useMemo(() => {
    return customers.filter(c => {
      if (filterMode === 'due' && c.currentBalance <= 0) return false;
      if (filterMode === 'alerts') {
        const status = customerInsightsById.get(c.id)?.credit.status;
        if (status !== 'nearing' && status !== 'exceeded') return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        return (
          c.name.toLowerCase().includes(q) ||
          c.phone.includes(q) ||
          (c.address || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [customers, filterMode, searchQuery, customerInsightsById]);

  // Add customer submit
  const handleAddCustomerSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCustName.trim()) return;

    const parsedLimit = parseFloat(newCustCreditLimit);
    const validLimit =
      Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.round(parsedLimit) : undefined;

    soundManager.playScannerBeep();
    const created = onAddNewCustomer(
      newCustName.trim(),
      newCustPhone.trim(),
      newCustAddress.trim(),
      validLimit
    );
    setSelectedCustomerId(created.id);
    setIsAddCustomerOpen(false);
    setNewCustName('');
    setNewCustPhone('');
    setNewCustAddress('');
    setNewCustCreditLimit('');
  };

  // Collect Payment submit
  const handleCollectPaymentSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedCustomerId) return;
    const amount = parseFloat(paymentAmount);
    if (!amount || amount <= 0) return;

    soundManager.playCheckoutSuccess();
    onRecordPayment(selectedCustomerId, amount, paymentNotes);
    setIsCollectPaymentOpen(false);
    setPaymentAmount('');
  };

  // Save Credit Limit settings
  const handleSaveCreditLimit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeCustomer || !onUpdateCustomerCreditProfile) return;

    const parsed = parseFloat(creditLimitDraft);
    const nextLimit = Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : undefined;

    soundManager.playCheckoutSuccess();
    onUpdateCustomerCreditProfile(activeCustomer.id, {
      creditLimit: nextLimit,
      creditWarningPct: warningPctDraft,
    });
    setSavedNotice('limit');
    window.setTimeout(() => setSavedNotice(prev => (prev === 'limit' ? null : prev)), 2000);
  };

  // Save Rating Mode / Manual Score / Note
  const handleSaveRatingProfile = (
    nextMode: 'auto' | 'manual',
    nextScore: number,
    nextNote: string
  ) => {
    if (!activeCustomer || !onUpdateCustomerCreditProfile) return;
    soundManager.playMechanicalClick();
    onUpdateCustomerCreditProfile(activeCustomer.id, {
      ratingMode: nextMode,
      manualCreditRating: nextMode === 'manual' ? nextScore : activeCustomer.manualCreditRating,
      creditRatingNote: nextNote.trim() || undefined,
    });
    setSavedNotice('rating');
    window.setTimeout(() => setSavedNotice(prev => (prev === 'rating' ? null : prev)), 2000);
  };

  // WhatsApp Reminder
  const handleSendWhatsAppReminder = (customer: Customer) => {
    const cleanPhone = customer.phone.replace(/\D/g, '');
    const targetPhone = cleanPhone.length === 10 ? `91${cleanPhone}` : cleanPhone;
    const message = `*SQ ENTERPRISES - Payment Reminder*\n\nDear ${customer.name},\nThis is a polite reminder regarding your pending Khata balance of *₹${customer.currentBalance}* at SQ ENTERPRISES.\n\nPlease arrange to clear the pending dues.\n\nThank you for your business!`;
    const url = targetPhone
      ? `https://wa.me/${targetPhone}?text=${encodeURIComponent(message)}`
      : `https://wa.me/?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  };

  const activeInsight = activeCustomer ? customerInsightsById.get(activeCustomer.id) : undefined;

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950">
      {/* Top Summary Banner */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <Users className="w-5 h-5 text-blue-400" />
              CUSTOMER KHATA (UDHAR)
            </h2>
            <p className="text-xs text-slate-400">
              Credit limits, payment history ratings, pending dues &amp; settlements
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setIsAddCustomerOpen(true);
            }}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-bold shadow-md shadow-blue-900/30 transition active:scale-95 whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            Add Customer
          </button>
        </div>

        {/* Total Outstanding Due + Limit Alert Summary Card */}
        <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-3'} gap-2.5`}>
          <div
            className={`${
              isMobileLayout ? '' : 'col-span-2'
            } p-3.5 rounded-xl bg-gradient-to-r from-rose-950/60 to-amber-950/40 border border-rose-800/40 flex items-center justify-between`}
          >
            <div>
              <span className="text-[11px] font-bold uppercase tracking-wider text-rose-300 block">
                TOTAL OUTSTANDING UDHAR
              </span>
              <span className="text-2xl font-black text-rose-400 tabular-nums">
                {formatCurrency(totalOutstandingDue)}
              </span>
            </div>
            <div className="text-right tabular-nums">
              <span className="text-xs text-slate-200 font-semibold block">
                {customers.filter(c => c.currentBalance > 0).length} Accounts
              </span>
              <span className="text-[10px] text-slate-400">with pending balance</span>
            </div>
          </div>

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setFilterMode(prev => (prev === 'alerts' ? 'due' : 'alerts'));
            }}
            className={`p-3.5 rounded-xl border text-left transition flex items-center justify-between gap-2 ${
              limitAlertCustomers.length > 0
                ? exceededCount > 0
                  ? 'bg-rose-950/40 border-rose-500/40 hover:border-rose-400/60'
                  : 'bg-amber-950/35 border-amber-500/40 hover:border-amber-400/60'
                : 'bg-slate-950 border-slate-800 hover:border-slate-700'
            }`}
          >
            <div className="min-w-0">
              <span className="text-[11px] font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                {limitAlertCustomers.length > 0 ? (
                  <AlertTriangle
                    className={`w-3.5 h-3.5 flex-shrink-0 ${
                      exceededCount > 0 ? 'text-rose-400' : 'text-amber-400'
                    }`}
                  />
                ) : (
                  <ShieldCheck className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                )}
                <span className="truncate">Credit Limit Alerts</span>
              </span>
              <div
                className={`text-lg font-black tabular-nums mt-0.5 ${
                  exceededCount > 0
                    ? 'text-rose-300'
                    : limitAlertCustomers.length > 0
                    ? 'text-amber-300'
                    : 'text-emerald-400'
                }`}
              >
                {limitAlertCustomers.length === 0
                  ? 'All Healthy'
                  : `${limitAlertCustomers.length} Flagged`}
              </div>
              <span className="text-[10px] text-slate-400 tabular-nums">
                {limitAlertCustomers.length === 0
                  ? 'No accounts near limit'
                  : `${exceededCount} exceeded · ${limitAlertCustomers.length - exceededCount} nearing`}
              </span>
            </div>
          </button>
        </div>

        {/* Search & Filter Controls */}
        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              placeholder="Search customer by name, phone, or area..."
              className="w-full pl-9 pr-4 py-2 bg-slate-950 border border-slate-700/80 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto scrollbar-none">
            {(
              [
                {
                  id: 'due',
                  label: `Pending Dues (${customers.filter(c => c.currentBalance > 0).length})`,
                },
                {
                  id: 'alerts',
                  label: `Limit Alerts (${limitAlertCustomers.length})`,
                },
                {
                  id: 'all',
                  label: `All (${customers.length})`,
                },
              ] as Array<{ id: KhataFilterMode; label: string }>
            ).map(tab => {
              const active = filterMode === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setFilterMode(tab.id);
                  }}
                  className={`px-3 py-2 rounded-xl text-xs font-bold border transition whitespace-nowrap tabular-nums active:scale-95 ${
                    active
                      ? tab.id === 'alerts'
                        ? 'bg-amber-500/20 text-amber-200 border-amber-500/50'
                        : 'bg-blue-600 text-white border-blue-500'
                      : 'bg-slate-800 text-slate-300 border-slate-700 hover:text-white'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Main Customers List */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 divide-y divide-slate-800/60">
        {filteredCustomers.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center text-slate-400">
            <Users className="w-12 h-12 text-slate-600 mb-2 stroke-[1.5]" />
            <p className="font-semibold text-slate-300">No customers found</p>
            <p className="text-xs text-slate-500 mt-1">
              {filterMode === 'alerts'
                ? 'No customers are nearing or exceeding their credit limit.'
                : filterMode === 'due'
                ? 'No customers currently have pending Udhar!'
                : 'Add a customer to begin tracking Udhar and credit limits.'}
            </p>
          </div>
        ) : (
          filteredCustomers.map(customer => {
            const hasDue = customer.currentBalance > 0;
            const insight = customerInsightsById.get(customer.id);
            const credit = insight?.credit || evaluateCustomerCreditLimit(customer);
            const rating = insight?.rating;

            return (
              <div
                key={customer.id}
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setSelectedCustomerId(customer.id);
                }}
                className="py-3 px-2.5 rounded-xl hover:bg-slate-900/70 cursor-pointer transition flex items-start justify-between gap-3 group"
              >
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div
                    className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm shadow-md flex-shrink-0 ${
                      credit.status === 'exceeded'
                        ? 'bg-rose-500/25 text-rose-200 border border-rose-500/45'
                        : credit.status === 'nearing'
                        ? 'bg-amber-500/20 text-amber-200 border border-amber-500/40'
                        : hasDue
                        ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                        : 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30'
                    }`}
                  >
                    {customer.name.slice(0, 2).toUpperCase()}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <h4 className="font-bold text-white text-sm truncate group-hover:text-blue-400 transition">
                        {customer.name}
                      </h4>
                      {rating && (
                        <span
                          className={`inline-flex items-center gap-1 text-[11px] font-bold tabular-nums ${rating.badgeTextClass}`}
                          title={
                            rating.source === 'manual'
                              ? `Manual rating override (${rating.score}/5)`
                              : rating.auto.summary
                          }
                        >
                          <Star className={`w-3 h-3 fill-current ${rating.starColorClass}`} />
                          <span>
                            {rating.score}/5 · {rating.label}
                          </span>
                          <span className="text-[10px] font-medium text-slate-400">
                            ({rating.source === 'manual' ? 'Manual' : 'Auto'})
                          </span>
                        </span>
                      )}
                    </div>

                    <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 text-xs text-slate-400 mt-0.5 tabular-nums">
                      <span className="flex items-center gap-1">
                        <Phone className="w-3 h-3 text-slate-500" />
                        {customer.phone || 'No phone'}
                      </span>
                      <span className="text-[11px] text-emerald-300 font-medium">
                        · {getCustomerPricingLabel(customer)}
                      </span>
                      <span
                        className={`text-[11px] font-medium ${getLoyaltyTierBadgeColor(
                          getLoyaltyTierForPoints(customer.lifetimeLoyaltyPoints).id
                        )}`}
                      >
                        · {getLoyaltyTierForPoints(customer.lifetimeLoyaltyPoints).name} (
                        {customer.loyaltyPoints || 0} pts)
                      </span>
                    </div>

                    {/* Credit Limit Utilization Bar */}
                    {credit.hasLimit ? (
                      <div className="mt-2 max-w-sm space-y-1">
                        <div className="flex items-center justify-between text-[11px] tabular-nums">
                          <span
                            className={`font-bold flex items-center gap-1 ${
                              credit.status === 'exceeded'
                                ? 'text-rose-300'
                                : credit.status === 'nearing'
                                ? 'text-amber-300'
                                : 'text-slate-300'
                            }`}
                          >
                            {credit.status === 'exceeded' && (
                              <ShieldAlert className="w-3 h-3 text-rose-400" />
                            )}
                            {credit.status === 'nearing' && (
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            )}
                            <span>
                              {credit.status === 'exceeded'
                                ? `${credit.statusLabel}${
                                    credit.excessAmount > 0
                                      ? ` (+${formatCurrency(credit.excessAmount)})`
                                      : ''
                                  }`
                                : credit.status === 'nearing'
                                ? credit.statusLabel
                                : `Credit Limit ${formatCurrency(credit.limit)}`}
                            </span>
                          </span>
                          <span className="text-slate-400">
                            {Math.round(credit.utilizationPct)}% used
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${
                              credit.status === 'exceeded'
                                ? 'bg-rose-500'
                                : credit.status === 'nearing'
                                ? 'bg-amber-400'
                                : 'bg-emerald-500'
                            }`}
                            style={{ width: `${Math.min(100, Math.max(2, credit.utilizationPct))}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <div className="text-[11px] text-slate-500 mt-1">
                        No credit limit set · Tap to configure
                      </div>
                    )}
                  </div>
                </div>

                <div className="text-right flex-shrink-0 tabular-nums">
                  <div
                    className={`text-sm font-black ${
                      credit.status === 'exceeded'
                        ? 'text-rose-400'
                        : credit.status === 'nearing'
                        ? 'text-amber-300'
                        : hasDue
                        ? 'text-rose-400'
                        : 'text-emerald-400'
                    }`}
                  >
                    {hasDue ? formatCurrency(customer.currentBalance) : 'Clear (₹0)'}
                  </div>
                  <span className="text-[10px] text-slate-400 uppercase tracking-wider font-semibold block">
                    {credit.hasLimit
                      ? `/ ${formatCurrency(credit.limit)}`
                      : hasDue
                      ? 'Pending Due'
                      : 'No Due'}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Customer Detail & Ledger Drawer */}
      {activeCustomer && activeInsight && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm animate-in fade-in duration-200">
          <div className="w-full max-w-md bg-slate-900 border-l border-slate-800 h-full flex flex-col text-slate-100 shadow-2xl">
            {/* Header */}
            <div className="p-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h3 className="font-bold text-white text-base truncate">
                    {activeCustomer.name}
                  </h3>
                  <span
                    className={`inline-flex items-center gap-1 text-xs font-bold tabular-nums ${activeInsight.rating.badgeTextClass}`}
                  >
                    <Star
                      className={`w-3.5 h-3.5 fill-current ${activeInsight.rating.starColorClass}`}
                    />
                    {activeInsight.rating.score}/5
                  </span>
                </div>
                <p className="text-xs text-slate-400 flex items-center gap-1 mt-0.5">
                  <Phone className="w-3 h-3 text-slate-500" />
                  {activeCustomer.phone || 'No phone entered'}
                </p>
              </div>

              <button
                type="button"
                onClick={() => setSelectedCustomerId(null)}
                aria-label="Close customer ledger drawer"
                className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Scrollable Body: Balance, Limit Alerts, Credit Limit Editor, Rating System, Ledger */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3.5">
              {/* Automated Credit Alert Banner inside Khata Drawer */}
              {(activeInsight.credit.status === 'exceeded' ||
                activeInsight.credit.status === 'nearing') && (
                <div
                  className={`p-3 rounded-xl border flex items-start gap-2.5 ${
                    activeInsight.credit.status === 'exceeded'
                      ? 'bg-rose-950/50 border-rose-500/45 text-rose-200'
                      : 'bg-amber-950/40 border-amber-500/40 text-amber-200'
                  }`}
                >
                  {activeInsight.credit.status === 'exceeded' ? (
                    <ShieldAlert className="w-4 h-4 text-rose-400 mt-0.5 flex-shrink-0" />
                  ) : (
                    <AlertTriangle className="w-4 h-4 text-amber-400 mt-0.5 flex-shrink-0" />
                  )}
                  <div className="text-xs space-y-0.5 tabular-nums">
                    <div className="font-bold">
                      {activeInsight.credit.status === 'exceeded'
                        ? activeInsight.credit.excessAmount > 0
                          ? `Credit Limit Exceeded by ${formatCurrency(activeInsight.credit.excessAmount)}`
                          : 'Credit Limit Fully Utilized (100%)'
                        : `Nearing Credit Limit (${Math.round(activeInsight.credit.utilizationPct)}% used)`}
                    </div>
                    <p className="text-[11px] opacity-90">
                      Outstanding balance of {formatCurrency(activeCustomer.currentBalance)} against{' '}
                      {formatCurrency(activeInsight.credit.limit)} limit. Collect cash or review
                      credit terms before issuing more Udhar.
                    </p>
                  </div>
                </div>
              )}

              {/* Current Due Card */}
              <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <span className="text-xs text-slate-400 font-medium block">
                    Current Pending Udhar:
                  </span>
                  <span
                    className={`text-2xl font-black tabular-nums ${
                      activeCustomer.currentBalance > 0 ? 'text-rose-400' : 'text-emerald-400'
                    }`}
                  >
                    {formatCurrency(activeCustomer.currentBalance)}
                  </span>
                </div>

                <div className="flex gap-2">
                  {activeCustomer.currentBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => handleSendWhatsAppReminder(activeCustomer)}
                      className="p-2.5 rounded-xl bg-emerald-600/20 text-emerald-300 hover:bg-emerald-600/30 border border-emerald-500/40 transition active:scale-95"
                      title="Send WhatsApp Reminder"
                    >
                      <Share2 className="w-4 h-4" />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsCollectPaymentOpen(true)}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md transition active:scale-95"
                  >
                    + Collect Cash
                  </button>
                </div>
              </div>

              {/* Rate Tier & Loyalty Summary Strip */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="space-y-0.5">
                  <div className="flex items-center gap-1.5 text-emerald-300 font-bold">
                    <Tag className="w-3.5 h-3.5" />
                    <span>{getCustomerPricingLabel(activeCustomer)}</span>
                  </div>
                  <div
                    className={`flex items-center gap-1.5 text-[11px] font-semibold tabular-nums ${getLoyaltyTierBadgeColor(
                      getLoyaltyTierForPoints(activeCustomer.lifetimeLoyaltyPoints).id
                    )}`}
                  >
                    <Award className="w-3.5 h-3.5" />
                    <span>
                      {getLoyaltyTierForPoints(activeCustomer.lifetimeLoyaltyPoints).name} Tier ·{' '}
                      {activeCustomer.loyaltyPoints || 0} pts avail
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-1.5">
                  {onSelectCustomerForBilling && (
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        onSelectCustomerForBilling(activeCustomer);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white font-bold text-[11px] flex items-center gap-1"
                    >
                      <ShoppingBag className="w-3 h-3" />
                      Bill
                    </button>
                  )}
                  {onOpenCustomerRewards && (
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        onOpenCustomerRewards(activeCustomer.id);
                      }}
                      className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 font-semibold text-[11px]"
                    >
                      Edit Tier / Pts
                    </button>
                  )}
                </div>
              </div>

              {/* Customizable Credit Limit Card */}
              <form
                onSubmit={handleSaveCreditLimit}
                className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                    <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" />
                    <span>Customizable Credit Limit</span>
                  </div>
                  {savedNotice === 'limit' ? (
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Saved
                    </span>
                  ) : (
                    <span
                      className={`text-[11px] font-bold tabular-nums ${
                        activeInsight.credit.status === 'exceeded'
                          ? 'text-rose-300'
                          : activeInsight.credit.status === 'nearing'
                          ? 'text-amber-300'
                          : activeInsight.credit.hasLimit
                          ? 'text-emerald-300'
                          : 'text-slate-400'
                      }`}
                    >
                      {activeInsight.credit.statusLabel}
                    </span>
                  )}
                </div>

                {activeInsight.credit.hasLimit && (
                  <div className="space-y-1.5 tabular-nums">
                    <div className="flex justify-between text-[11px] text-slate-400">
                      <span>
                        Used: {formatCurrency(activeCustomer.currentBalance)} (
                        {Math.round(activeInsight.credit.utilizationPct)}%)
                      </span>
                      <span>
                        {activeInsight.credit.excessAmount > 0
                          ? `Over by ${formatCurrency(activeInsight.credit.excessAmount)}`
                          : `Available: ${formatCurrency(activeInsight.credit.remainingHeadroom)}`}
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all ${
                          activeInsight.credit.status === 'exceeded'
                            ? 'bg-rose-500'
                            : activeInsight.credit.status === 'nearing'
                            ? 'bg-amber-400'
                            : 'bg-emerald-500'
                        }`}
                        style={{
                          width: `${Math.min(100, Math.max(2, activeInsight.credit.utilizationPct))}%`,
                        }}
                      />
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-5 gap-2">
                  <div className="col-span-3">
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Credit Limit (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      step="100"
                      value={creditLimitDraft}
                      onChange={e => setCreditLimitDraft(e.target.value)}
                      placeholder="e.g. 5000 (blank = none)"
                      className="w-full px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white tabular-nums focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <div className="col-span-2">
                    <label className="text-[11px] text-slate-400 block mb-1">
                      Alert At (%)
                    </label>
                    <select
                      value={warningPctDraft}
                      onChange={e => setWarningPctDraft(Number(e.target.value))}
                      className="w-full px-2 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs font-bold text-white tabular-nums focus:outline-none focus:border-blue-500"
                    >
                      <option value={70}>70%</option>
                      <option value={75}>75%</option>
                      <option value={80}>80% (Std)</option>
                      <option value={85}>85%</option>
                      <option value={90}>90%</option>
                    </select>
                  </div>
                </div>

                <div className="flex items-center justify-between gap-2 pt-0.5">
                  <button
                    type="button"
                    onClick={() => {
                      setCreditLimitDraft('');
                      if (onUpdateCustomerCreditProfile) {
                        soundManager.playMechanicalClick();
                        onUpdateCustomerCreditProfile(activeCustomer.id, {
                          creditLimit: undefined,
                        });
                      }
                    }}
                    className="text-[11px] text-slate-400 hover:text-slate-200 underline"
                  >
                    Remove Limit
                  </button>
                  <button
                    type="submit"
                    className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold transition"
                  >
                    Save Limit
                  </button>
                </div>
              </form>

              {/* Automatic & Manual Credit Rating Card */}
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-slate-300">
                    <Star className="w-3.5 h-3.5 text-amber-400" />
                    <span>Customer Credit Rating</span>
                  </div>
                  {savedNotice === 'rating' && (
                    <span className="text-[11px] font-bold text-emerald-400 flex items-center gap-1">
                      <Check className="w-3.5 h-3.5" />
                      Updated
                    </span>
                  )}
                </div>

                {/* Mode Switcher: Auto vs Manual */}
                <div className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-900 border border-slate-800">
                  <button
                    type="button"
                    onClick={() => {
                      setRatingModeDraft('auto');
                      handleSaveRatingProfile('auto', manualRatingDraft, ratingNoteDraft);
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition ${
                      ratingModeDraft === 'auto'
                        ? 'bg-blue-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Auto (Payment History)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRatingModeDraft('manual');
                      handleSaveRatingProfile('manual', manualRatingDraft, ratingNoteDraft);
                    }}
                    className={`py-1.5 px-2 rounded-lg text-xs font-bold transition ${
                      ratingModeDraft === 'manual'
                        ? 'bg-amber-600 text-white shadow-sm'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    Manual Override
                  </button>
                </div>

                {/* Effective Rating Display */}
                <div className="p-2.5 rounded-xl bg-slate-900/90 border border-slate-800 flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5">
                    {[1, 2, 3, 4, 5].map(starVal => {
                      const filled = starVal <= activeInsight.rating.score;
                      return (
                        <Star
                          key={starVal}
                          className={`w-4 h-4 ${
                            filled
                              ? `fill-current ${activeInsight.rating.starColorClass}`
                              : 'text-slate-700'
                          }`}
                        />
                      );
                    })}
                  </div>
                  <div className="text-right tabular-nums">
                    <span className={`text-xs font-black ${activeInsight.rating.badgeTextClass}`}>
                      {activeInsight.rating.score}/5 · {activeInsight.rating.label}
                    </span>
                    <span className="block text-[10px] text-slate-400">
                      {activeInsight.rating.source === 'manual'
                        ? `Manual override (Auto: ${activeInsight.rating.auto.score}/5)`
                        : 'Calculated from payment history'}
                    </span>
                  </div>
                </div>

                {/* Payment History Breakdown */}
                <div className="space-y-1.5 text-[11px] text-slate-300">
                  <div className="grid grid-cols-3 gap-2 tabular-nums">
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Repayment Rate</span>
                      <span className="font-bold text-white">
                        {activeInsight.rating.auto.repaymentRatioPct !== null
                          ? `${activeInsight.rating.auto.repaymentRatioPct}%`
                          : 'N/A'}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Total Repaid</span>
                      <span className="font-bold text-emerald-300">
                        {formatCurrency(activeInsight.rating.auto.totalRepaid)}
                      </span>
                    </div>
                    <div className="p-2 rounded-lg bg-slate-900 border border-slate-800/80">
                      <span className="text-[10px] text-slate-400 block">Activity</span>
                      <span className="font-bold text-slate-200">
                        {activeInsight.rating.auto.billCount}B ·{' '}
                        {activeInsight.rating.auto.paymentCount}P
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-slate-400 leading-relaxed">
                    {activeInsight.rating.auto.summary}
                  </p>
                </div>

                {/* Manual Override Controls */}
                {ratingModeDraft === 'manual' && (
                  <div className="pt-2 border-t border-slate-800 space-y-2.5">
                    <div>
                      <span className="text-[11px] text-slate-300 font-semibold block mb-1.5">
                        Select Manual Rating ({manualRatingDraft}/5 ·{' '}
                        {getRatingLabel(manualRatingDraft)}):
                      </span>
                      <div className="grid grid-cols-5 gap-1.5">
                        {[1, 2, 3, 4, 5].map(val => (
                          <button
                            key={val}
                            type="button"
                            onClick={() => {
                              setManualRatingDraft(val);
                              handleSaveRatingProfile('manual', val, ratingNoteDraft);
                            }}
                            className={`py-1.5 rounded-lg border text-xs font-bold flex items-center justify-center gap-1 transition ${
                              manualRatingDraft === val
                                ? 'bg-amber-500/25 border-amber-400 text-amber-200'
                                : 'bg-slate-900 border-slate-700 text-slate-300 hover:border-slate-500'
                            }`}
                          >
                            <span>{val}</span>
                            <Star
                              className={`w-3 h-3 ${
                                manualRatingDraft >= val
                                  ? 'fill-current text-amber-400'
                                  : 'text-slate-600'
                              }`}
                            />
                          </button>
                        ))}
                      </div>
                    </div>

                    <div className="flex gap-2">
                      <input
                        type="text"
                        value={ratingNoteDraft}
                        onChange={e => setRatingNoteDraft(e.target.value)}
                        placeholder="Optional note (e.g. Verified trusted buyer)..."
                        className="flex-1 px-2.5 py-1.5 bg-slate-900 border border-slate-700 rounded-lg text-xs text-white placeholder-slate-500 focus:outline-none focus:border-amber-500"
                      />
                      <button
                        type="button"
                        onClick={() =>
                          handleSaveRatingProfile('manual', manualRatingDraft, ratingNoteDraft)
                        }
                        className="px-3 py-1.5 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold whitespace-nowrap"
                      >
                        Save
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Transaction Ledger Feed */}
              <div className="space-y-2.5 pt-1">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                  <History className="w-3.5 h-3.5 text-blue-400" />
                  Khata History &amp; Bills
                </h4>

                {customerBills.length === 0 && customerPayments.length === 0 ? (
                  <div className="py-6 text-center text-slate-500 text-xs bg-slate-950/60 rounded-xl border border-slate-800/70">
                    No bills or payment records for this customer yet.
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {/* Direct Payments Recorded */}
                    {customerPayments.map(pay => (
                      <div
                        key={pay.id}
                        className="p-3 rounded-xl bg-slate-950 border border-emerald-800/40 space-y-1"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-emerald-400 flex items-center gap-1">
                            <ArrowDownLeft className="w-3.5 h-3.5" />
                            Cash Payment Collected
                          </span>
                          <span className="text-sm font-black text-emerald-400 tabular-nums">
                            - {formatCurrency(pay.amount)}
                          </span>
                        </div>
                        <div className="flex justify-between text-[11px] text-slate-400 tabular-nums">
                          <span>{pay.formattedDateTime}</span>
                          <span>New Due: ₹{pay.newBalance}</span>
                        </div>
                      </div>
                    ))}

                    {/* Bills Recorded */}
                    {customerBills.map(bill => (
                      <div
                        key={bill.id}
                        className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-1.5"
                      >
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-bold text-white">
                            Bill #{bill.billNumber}
                          </span>
                          <span className="text-xs font-black text-blue-400 tabular-nums">
                            {formatCurrency(bill.itemsTotal)}
                          </span>
                        </div>

                        <div className="text-[11px] text-slate-400">
                          {bill.items
                            .map(
                              i =>
                                `${i.productName} (${i.quantity} ${
                                  i.unit === 'bundle' ? 'Bndl' : 'Pc'
                                })`
                            )
                            .join(', ')}
                        </div>

                        <div className="flex justify-between text-[11px] text-slate-400 pt-1 border-t border-slate-800/60 tabular-nums">
                          <span>Paid: ₹{bill.amountReceived}</span>
                          <span
                            className={`font-semibold ${
                              bill.remainingBalance > 0 ? 'text-rose-400' : 'text-emerald-400'
                            }`}
                          >
                            Due: ₹{bill.remainingBalance}
                          </span>
                        </div>

                        {onViewBillDetails && (
                          <button
                            type="button"
                            onClick={() => onViewBillDetails(bill)}
                            className="w-full mt-1 py-1 text-center text-[11px] font-semibold text-blue-400 hover:text-blue-300 bg-slate-900 rounded-lg"
                          >
                            View Full Bill Receipt
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Collect Payment Modal */}
      {isCollectPaymentOpen && activeCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">RECEIVE CASH PAYMENT</h3>
              <button
                type="button"
                onClick={() => setIsCollectPaymentOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleCollectPaymentSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">Customer:</label>
                <div className="text-sm font-bold text-white">{activeCustomer.name}</div>
                <div className="text-xs text-rose-400 font-semibold mt-0.5 tabular-nums">
                  Current Due: {formatCurrency(activeCustomer.currentBalance)}
                </div>
              </div>

              <div>
                <label className="text-xs font-bold text-emerald-400 block mb-1">
                  Cash Amount Received (₹) *
                </label>
                <input
                  type="number"
                  required
                  min="1"
                  step="any"
                  value={paymentAmount}
                  onChange={e => setPaymentAmount(e.target.value)}
                  placeholder="e.g. 500"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-lg font-black text-white focus:outline-none focus:border-emerald-500"
                />
              </div>

              {activeCustomer.currentBalance > 0 && (
                <button
                  type="button"
                  onClick={() => setPaymentAmount(activeCustomer.currentBalance.toString())}
                  className="text-xs text-blue-400 underline font-medium"
                >
                  Clear Full Due ({formatCurrency(activeCustomer.currentBalance)})
                </button>
              )}

              <div>
                <label className="text-xs text-slate-400 block mb-1">Payment Note:</label>
                <input
                  type="text"
                  value={paymentNotes}
                  onChange={e => setPaymentNotes(e.target.value)}
                  className="w-full px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsCollectPaymentOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-xs font-bold text-white shadow-md shadow-emerald-900/40"
                >
                  Record Cash
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add New Customer Modal */}
      {isAddCustomerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">ADD NEW CUSTOMER</h3>
              <button
                type="button"
                onClick={() => setIsAddCustomerOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleAddCustomerSubmit} className="mt-4 space-y-3">
              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Customer / Shop Name *
                </label>
                <input
                  type="text"
                  required
                  value={newCustName}
                  onChange={e => setNewCustName(e.target.value)}
                  placeholder="e.g. Ramesh Kirana"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Phone Number (10 digits)
                </label>
                <input
                  type="tel"
                  value={newCustPhone}
                  onChange={e => setNewCustPhone(e.target.value)}
                  placeholder="e.g. 9876543210"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Address / Market Location
                </label>
                <input
                  type="text"
                  value={newCustAddress}
                  onChange={e => setNewCustAddress(e.target.value)}
                  placeholder="e.g. Main Market, Shop #4"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white focus:outline-none focus:border-blue-500"
                />
              </div>

              <div>
                <label className="text-xs text-slate-400 block mb-1">
                  Customizable Credit Limit (₹)
                </label>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={newCustCreditLimit}
                  onChange={e => setNewCustCreditLimit(e.target.value)}
                  placeholder="Optional e.g. 5000 (blank = unlimited)"
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white tabular-nums focus:outline-none focus:border-blue-500"
                />
              </div>

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setIsAddCustomerOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-xs font-semibold text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-xs font-bold text-white shadow-md shadow-blue-900/40"
                >
                  Save Customer
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
