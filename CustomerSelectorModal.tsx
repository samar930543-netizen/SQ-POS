import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Customer } from '../types';
import { formatCurrency } from '../utils/formatters';
import { getCustomerPricingLabel } from '../utils/customerPricing';
import { getLoyaltyTierBadgeColor, getLoyaltyTierForPoints } from '../utils/loyaltyProgram';
import { evaluateCustomerCreditLimit } from '../utils/customerCredit';
import { soundManager } from '../utils/soundEffects';
import {
  AlertTriangle,
  Award,
  Check,
  MapPin,
  Phone,
  Search,
  ShieldAlert,
  Star,
  Tag,
  User,
  UserCheck,
  UserPlus,
  X,
} from 'lucide-react';

interface CustomerSelectorModalProps {
  isOpen: boolean;
  onClose: () => void;
  customers: Customer[];
  selectedCustomerId: string;
  onSelectCustomer: (customerId: string) => void;
  walkInLabel?: string;
  walkInSubtitle?: string;
  title?: string;
  onQuickCreateCustomer?: (name: string, phone: string) => Customer;
}

export const CustomerSelectorModal: React.FC<CustomerSelectorModalProps> = ({
  isOpen,
  onClose,
  customers,
  selectedCustomerId,
  onSelectCustomer,
  walkInLabel = 'Walk-in Cash Customer',
  walkInSubtitle = 'Standard catalog rates · No Khata balance',
  title = 'Select Customer Account',
  onQuickCreateCustomer,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newPhone, setNewPhone] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setSearchQuery('');
      setIsCreating(false);
      setNewName('');
      setNewPhone('');
      return;
    }

    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 30);
    return () => window.clearTimeout(timer);
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return customers;
    return customers.filter(c => {
      const tierLabel = getCustomerPricingLabel(c).toLowerCase();
      return (
        c.name.toLowerCase().includes(q) ||
        (c.phone || '').toLowerCase().includes(q) ||
        (c.address || '').toLowerCase().includes(q) ||
        tierLabel.includes(q)
      );
    });
  }, [customers, searchQuery]);

  if (!isOpen) return null;

  const handleChoose = (customerId: string) => {
    soundManager.playMechanicalClick();
    onSelectCustomer(customerId);
    onClose();
  };

  const handleCreateSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!onQuickCreateCustomer || !newName.trim()) return;
    const created = onQuickCreateCustomer(newName.trim(), newPhone.trim());
    soundManager.playScannerBeep();
    onSelectCustomer(created.id);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/75 backdrop-blur-sm p-3 sm:p-4 animate-in fade-in duration-150"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-labelledby="customer-selector-modal-title"
    >
      <div
        className="w-full max-w-lg max-h-[85vh] flex flex-col bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden text-slate-100"
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-4 py-3 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="flex h-8 w-8 items-center justify-center rounded-xl bg-blue-600/20 text-blue-400 flex-shrink-0">
              <UserCheck className="w-4 h-4" />
            </span>
            <div className="min-w-0">
              <h2
                id="customer-selector-modal-title"
                className="text-sm font-black text-white tracking-wide truncate"
              >
                {title}
              </h2>
              <p className="text-[11px] text-slate-400 tabular-nums">
                {searchQuery.trim()
                  ? `${filteredCustomers.length} of ${customers.length} accounts matching`
                  : `${customers.length} saved wholesale accounts`}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5">
            {onQuickCreateCustomer && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setIsCreating(prev => !prev);
                  if (!isCreating && searchQuery.trim() && !newName) {
                    setNewName(searchQuery.trim());
                  }
                }}
                className={`px-2.5 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1 border transition ${
                  isCreating
                    ? 'bg-slate-800 text-slate-200 border-slate-700'
                    : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-500/40'
                }`}
              >
                <UserPlus className="w-3.5 h-3.5" />
                <span>{isCreating ? 'Back to List' : 'New Account'}</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition"
              aria-label="Close customer selection modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Search Bar */}
        {!isCreating && (
          <div className="p-3 bg-slate-950/70 border-b border-slate-800">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                ref={searchInputRef}
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && searchQuery.trim() && filteredCustomers.length > 0) {
                    e.preventDefault();
                    handleChoose(filteredCustomers[0].id);
                  }
                }}
                placeholder="Search customer by name, phone, address, or pricing tier..."
                aria-label="Search customer accounts"
                className="w-full pl-9 pr-9 py-2.5 bg-slate-900 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 focus:ring-1 focus:ring-blue-500 transition"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => {
                    setSearchQuery('');
                    searchInputRef.current?.focus();
                  }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-white rounded-md"
                  aria-label="Clear customer search"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        )}

        {/* Body: Quick Create Form OR Filtered Account List */}
        {isCreating && onQuickCreateCustomer ? (
          <form onSubmit={handleCreateSubmit} className="p-4 space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-300">
                Customer / Shop Name <span className="text-rose-400">*</span>
              </label>
              <input
                type="text"
                required
                autoFocus
                value={newName}
                onChange={e => setNewName(e.target.value)}
                placeholder="e.g. Sharma Kirana Store"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-300">
                Mobile Number (10 digits)
              </label>
              <input
                type="tel"
                value={newPhone}
                onChange={e => setNewPhone(e.target.value)}
                placeholder="e.g. 9876543210"
                className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div className="flex items-center gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsCreating(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold transition"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-black transition"
              >
                Save &amp; Select Account
              </button>
            </div>
          </form>
        ) : (
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {/* Walk-in Default Option */}
            {(!searchQuery.trim() ||
              walkInLabel.toLowerCase().includes(searchQuery.trim().toLowerCase())) && (
              <button
                type="button"
                onClick={() => handleChoose('')}
                className={`w-full text-left p-3 rounded-xl border transition flex items-center justify-between gap-3 ${
                  selectedCustomerId === ''
                    ? 'bg-blue-600/15 border-blue-500/70 ring-1 ring-blue-500/30'
                    : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                }`}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <span className="w-8 h-8 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center text-slate-300 flex-shrink-0">
                    <User className="w-4 h-4" />
                  </span>
                  <div className="min-w-0">
                    <div className="text-xs sm:text-sm font-bold text-white truncate">
                      {walkInLabel}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {walkInSubtitle}
                    </div>
                  </div>
                </div>
                {selectedCustomerId === '' && (
                  <span className="flex h-6 w-6 items-center justify-center rounded-full bg-blue-600 text-white flex-shrink-0">
                    <Check className="w-3.5 h-3.5" />
                  </span>
                )}
              </button>
            )}

            {/* Filtered Customer Accounts */}
            {filteredCustomers.length === 0 ? (
              <div className="py-10 px-4 text-center space-y-2.5">
                <p className="text-sm font-semibold text-slate-300">
                  No accounts matching &ldquo;{searchQuery.trim()}&rdquo;
                </p>
                <p className="text-xs text-slate-500">
                  Try searching by shop name, phone number, address, or rate tier.
                </p>
                <div className="flex items-center justify-center gap-2 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setSearchQuery('');
                      searchInputRef.current?.focus();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700"
                  >
                    Clear Search
                  </button>
                  {onQuickCreateCustomer && (
                    <button
                      type="button"
                      onClick={() => {
                        setNewName(searchQuery.trim());
                        setIsCreating(true);
                      }}
                      className="px-3 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <UserPlus className="w-3.5 h-3.5" />
                      <span>Add &ldquo;{searchQuery.trim()}&rdquo;</span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              filteredCustomers.map(cust => {
                const isSelected = cust.id === selectedCustomerId;
                const pricingLabel = getCustomerPricingLabel(cust);
                const loyaltyTier = getLoyaltyTierForPoints(cust.lifetimeLoyaltyPoints || 0);
                const loyaltyColor = getLoyaltyTierBadgeColor(loyaltyTier.id);
                const creditEval = evaluateCustomerCreditLimit(cust);

                return (
                  <button
                    key={cust.id}
                    type="button"
                    onClick={() => handleChoose(cust.id)}
                    className={`w-full text-left p-3 rounded-xl border transition flex items-start justify-between gap-3 ${
                      isSelected
                        ? 'bg-blue-600/15 border-blue-500/70 ring-1 ring-blue-500/30'
                        : 'bg-slate-950/70 border-slate-800 hover:border-slate-700 hover:bg-slate-800/50'
                    }`}
                  >
                    <div className="min-w-0 flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs sm:text-sm font-bold text-white truncate">
                          {cust.name}
                        </span>
                        {cust.ratingMode === 'manual' && cust.manualCreditRating && (
                          <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-300 tabular-nums">
                            <Star className="w-2.5 h-2.5 fill-current text-amber-400" />
                            {cust.manualCreditRating}/5
                          </span>
                        )}
                        {isSelected && (
                          <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-blue-600 text-white flex-shrink-0">
                            <Check className="w-2.5 h-2.5" />
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-2.5 flex-wrap text-[11px] text-slate-400 tabular-nums">
                        {cust.phone && (
                          <span className="inline-flex items-center gap-1">
                            <Phone className="w-3 h-3 text-slate-500" />
                            {cust.phone}
                          </span>
                        )}
                        {cust.address && (
                          <span className="inline-flex items-center gap-1 truncate max-w-[220px]">
                            <MapPin className="w-3 h-3 text-slate-500 flex-shrink-0" />
                            <span className="truncate">{cust.address}</span>
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-3 flex-wrap text-[11px] pt-0.5 tabular-nums">
                        <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                          <Tag className="w-3 h-3 text-emerald-400" />
                          {pricingLabel}
                        </span>
                        <span className={`inline-flex items-center gap-1 font-semibold ${loyaltyColor}`}>
                          <Award className="w-3 h-3" />
                          {loyaltyTier.name} · {cust.loyaltyPoints || 0} pts
                        </span>
                        {creditEval.hasLimit && (
                          <span
                            className={`inline-flex items-center gap-1 font-bold ${
                              creditEval.status === 'exceeded'
                                ? 'text-rose-300'
                                : creditEval.status === 'nearing'
                                ? 'text-amber-300'
                                : 'text-slate-400'
                            }`}
                          >
                            {creditEval.status === 'exceeded' && (
                              <ShieldAlert className="w-3 h-3 text-rose-400" />
                            )}
                            {creditEval.status === 'nearing' && (
                              <AlertTriangle className="w-3 h-3 text-amber-400" />
                            )}
                            <span>
                              {creditEval.status === 'exceeded'
                                ? creditEval.statusLabel
                                : creditEval.status === 'nearing'
                                ? creditEval.statusLabel
                                : `Limit ${formatCurrency(creditEval.limit)}`}
                            </span>
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="text-right flex-shrink-0 tabular-nums">
                      <div
                        className={`text-xs font-black ${
                          creditEval.status === 'exceeded'
                            ? 'text-rose-400'
                            : cust.currentBalance > 0
                            ? 'text-amber-400'
                            : 'text-emerald-400'
                        }`}
                      >
                        {cust.currentBalance > 0
                          ? `Due ${formatCurrency(cust.currentBalance)}`
                          : '₹0 Due'}
                      </div>
                      <div className="text-[10px] text-slate-500 mt-0.5">
                        {isSelected ? 'Selected' : 'Tap to select'}
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </div>
    </div>
  );
};
