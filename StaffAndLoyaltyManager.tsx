import React, { useEffect, useMemo, useState } from 'react';
import {
  AttendanceRecord,
  Bill,
  Customer,
  CustomerCustomProductRate,
  LoyaltyMilestone,
  LoyaltyTransaction,
  PricingTierId,
  Product,
  RolePermissionMatrix,
  StaffActivityDomain,
  StaffActivityLog,
  StaffMember,
  StaffPermission,
  StaffRole,
} from '../types';
import { formatCurrency } from '../utils/formatters';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  PRICING_TIERS,
  getCustomerPricingLabel,
} from '../utils/customerPricing';
import {
  hasConfiguredBundleTier,
  hasConfiguredPieceTier,
} from '../utils/unitSpecs';
import {
  LOYALTY_MILESTONES,
  LOYALTY_TIERS,
  getClaimableMilestones,
  getLoyaltyTierBadgeColor,
  getLoyaltyTierForPoints,
  getNextLoyaltyTier,
} from '../utils/loyaltyProgram';
import {
  ALL_STAFF_ROLES,
  STAFF_PERMISSION_DEFINITIONS,
  buildActivityLogsCsv,
  canStaffPerform,
  computeStaffOrderMetrics,
  countGrantedPermissions,
  getActivityDomainLabel,
  getEffectiveStaffPermissions,
} from '../utils/staffRbac';
import {
  Users,
  Clock,
  LogIn,
  LogOut,
  Plus,
  Award,
  Gift,
  Tag,
  Download,
  Edit2,
  X,
  Search,
  Wallet,
  SlidersHorizontal,
  ShieldCheck,
  Receipt,
  Activity,
  Lock,
  Check,
  RotateCcw,
  UserCheck,
  Package,
  ShoppingBag,
  KeyRound,
  Eye,
} from 'lucide-react';

type StaffModuleSubTab = 'staff_rbac' | 'orders' | 'activity' | 'attendance' | 'loyalty';

interface StaffAndLoyaltyManagerProps {
  customers: Customer[];
  products: Product[];
  bills: Bill[];
  loyaltyTransactions: LoyaltyTransaction[];
  staffMembers: StaffMember[];
  attendanceRecords: AttendanceRecord[];
  rolePermissions: RolePermissionMatrix;
  activeStaff: StaffMember | null;
  activityLogs: StaffActivityLog[];
  onSaveCustomerPricing: (
    customerId: string,
    pricingTier: PricingTierId,
    customDiscountPct: number,
    customProductRates: Record<string, CustomerCustomProductRate>
  ) => void;
  onClaimMilestone: (customerId: string, milestone: LoyaltyMilestone) => void;
  onAdjustLoyaltyPoints: (customerId: string, pointsDelta: number, note: string) => void;
  onSaveStaffMember: (staff: StaffMember) => void;
  onDeleteStaffMember: (staffId: string) => void;
  onClockInStaff: (staff: StaffMember, note?: string) => void;
  onClockOutStaff: (recordId: string, note?: string) => void;
  onPostWagesToCashFlow?: (date: string, amount: number, staffSummary: string) => void;
  onUpdateRolePermission: (role: StaffRole, permission: StaffPermission, allowed: boolean) => void;
  onResetRolePermissions: () => void;
  onOpenOperatorSwitcher: () => void;
  onViewBillReceipt: (bill: Bill) => void;
  focusCustomerId?: string | null;
  onClearFocusCustomer?: () => void;
}

function formatDurationMinutes(minutes?: number): string {
  if (!minutes || minutes <= 0) return '0m';
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

function formatShortTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export const StaffAndLoyaltyManager: React.FC<StaffAndLoyaltyManagerProps> = ({
  customers,
  products,
  bills,
  loyaltyTransactions,
  staffMembers,
  attendanceRecords,
  rolePermissions,
  activeStaff,
  activityLogs,
  onSaveCustomerPricing,
  onClaimMilestone,
  onAdjustLoyaltyPoints,
  onSaveStaffMember,
  onDeleteStaffMember,
  onClockInStaff,
  onClockOutStaff,
  onPostWagesToCashFlow,
  onUpdateRolePermission,
  onResetRolePermissions,
  onOpenOperatorSwitcher,
  onViewBillReceipt,
  focusCustomerId = null,
  onClearFocusCustomer,
}) => {
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const todayStr = new Date().toISOString().slice(0, 10);
  const [activeTab, setActiveTab] = useState<StaffModuleSubTab>(
    focusCustomerId ? 'loyalty' : 'staff_rbac'
  );
  const [selectedDate, setSelectedDate] = useState<string>(todayStr);
  const [searchQuery, setSearchQuery] = useState('');
  const [toast, setToast] = useState<string | null>(null);

  // Order tracking filters
  const [orderStaffFilter, setOrderStaffFilter] = useState<string>('ALL');
  const [orderRoleFilter, setOrderRoleFilter] = useState<string>('ALL');
  const [orderSearch, setOrderSearch] = useState<string>('');

  // Activity log filters
  const [activityDomainFilter, setActivityDomainFilter] = useState<'ALL' | StaffActivityDomain>('ALL');
  const [activityStaffFilter, setActivityStaffFilter] = useState<string>('ALL');
  const [activitySearch, setActivitySearch] = useState<string>('');

  // Staff Modal state
  const [isStaffModalOpen, setIsStaffModalOpen] = useState(false);
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [sName, setSName] = useState('');
  const [sPhone, setSPhone] = useState('');
  const [sRole, setSRole] = useState<StaffRole>('Counter Cashier');
  const [sWage, setSWage] = useState('600');
  const [sShiftStart, setSShiftStart] = useState('09:00');
  const [sPin, setSPin] = useState('');
  const [sActive, setSActive] = useState(true);
  const [sCustomPerms, setSCustomPerms] = useState<Partial<Record<StaffPermission, boolean>>>({});
  const [confirmRemoveStaff, setConfirmRemoveStaff] = useState(false);
  const [shiftNoteInput, setShiftNoteInput] = useState('');

  // Customer Pricing Modal state
  const [pricingModalCustomerId, setPricingModalCustomerId] = useState<string | null>(null);
  const [editTier, setEditTier] = useState<PricingTierId>('standard');
  const [editCustomPct, setEditCustomPct] = useState('0');
  const [editSkuRates, setEditSkuRates] = useState<Record<string, CustomerCustomProductRate>>({});
  const [skuPickId, setSkuPickId] = useState('');
  const [skuBundleRate, setSkuBundleRate] = useState('');
  const [skuPieceRate, setSkuPieceRate] = useState('');

  // Loyalty Adjust Modal state
  const [adjustModalCustomerId, setAdjustModalCustomerId] = useState<string | null>(null);
  const [adjustPointsInput, setAdjustPointsInput] = useState('100');
  const [adjustNoteInput, setAdjustNoteInput] = useState('Promotional loyalty bonus');

  const canManageRbac = canStaffPerform(activeStaff, rolePermissions, 'manage_rbac');

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  // Staff Order Metrics & Filterable Bill Ledger
  const orderAnalytics = useMemo(
    () => computeStaffOrderMetrics(staffMembers, bills),
    [staffMembers, bills]
  );

  const filteredStaffOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return bills.filter(bill => {
      if (orderStaffFilter === '__unassigned__' && bill.staffId) return false;
      if (
        orderStaffFilter !== 'ALL' &&
        orderStaffFilter !== '__unassigned__' &&
        bill.staffId !== orderStaffFilter
      ) {
        return false;
      }
      if (orderRoleFilter !== 'ALL' && (bill.staffRole || 'Unassigned') !== orderRoleFilter) {
        return false;
      }
      if (q) {
        return (
          bill.billNumber.toLowerCase().includes(q) ||
          bill.customerName.toLowerCase().includes(q) ||
          (bill.staffName || '').toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [bills, orderStaffFilter, orderRoleFilter, orderSearch]);

  // Activity Log KPIs & Filtered Stream
  const activityStats = useMemo(() => {
    const salesCount = activityLogs.filter(l => l.domain === 'sales').length;
    const inventoryCount = activityLogs.filter(l => l.domain === 'inventory').length;
    const teamCount = activityLogs.filter(l => l.domain === 'team_rbac').length;
    const last24hCount = activityLogs.filter(
      l => Date.now() - new Date(l.timestamp).getTime() <= 24 * 3600000
    ).length;
    return { salesCount, inventoryCount, teamCount, last24hCount };
  }, [activityLogs]);

  const filteredActivityLogs = useMemo(() => {
    const q = activitySearch.trim().toLowerCase();
    return activityLogs.filter(log => {
      if (activityDomainFilter !== 'ALL' && log.domain !== activityDomainFilter) return false;
      if (activityStaffFilter !== 'ALL' && log.staffId !== activityStaffFilter) return false;
      if (q) {
        return (
          log.action.toLowerCase().includes(q) ||
          log.staffName.toLowerCase().includes(q) ||
          log.targetLabel.toLowerCase().includes(q) ||
          log.details.toLowerCase().includes(q)
        );
      }
      return true;
    });
  }, [activityLogs, activityDomainFilter, activityStaffFilter, activitySearch]);

  // Attendance stats for selectedDate
  const dateAttendance = useMemo(
    () =>
      attendanceRecords
        .filter(r => r.date === selectedDate)
        .sort((a, b) => new Date(b.clockInTime).getTime() - new Date(a.clockInTime).getTime()),
    [attendanceRecords, selectedDate]
  );

  const activeShiftByStaffId = useMemo(() => {
    const map = new Map<string, AttendanceRecord>();
    attendanceRecords.forEach(r => {
      if (r.date === todayStr && r.status === 'clocked_in') {
        map.set(r.staffId, r);
      }
    });
    return map;
  }, [attendanceRecords, todayStr]);

  const attendanceStats = useMemo(() => {
    const clockedInNow = Array.from(activeShiftByStaffId.values()).length;
    const completedToday = dateAttendance.filter(r => r.status === 'completed').length;
    const presentStaffIds = new Set(dateAttendance.map(r => r.staffId));
    const totalMinutes = dateAttendance.reduce((sum, r) => {
      if (r.durationMinutes) return sum + r.durationMinutes;
      if (r.status === 'clocked_in') {
        return sum + Math.max(1, Math.round((Date.now() - new Date(r.clockInTime).getTime()) / 60000));
      }
      return sum;
    }, 0);

    const estimatedWages = staffMembers
      .filter(s => presentStaffIds.has(s.id))
      .reduce((sum, s) => sum + s.dailyWage, 0);

    return {
      clockedInNow,
      completedToday,
      presentCount: presentStaffIds.size,
      totalHoursLabel: formatDurationMinutes(totalMinutes),
      estimatedWages,
      presentStaffNames: staffMembers
        .filter(s => presentStaffIds.has(s.id))
        .map(s => s.name)
        .join(', '),
    };
  }, [activeShiftByStaffId, dateAttendance, staffMembers]);

  // Loyalty KPIs
  const loyaltyStats = useMemo(() => {
    const totalActivePoints = customers.reduce((s, c) => s + (c.loyaltyPoints || 0), 0);
    const goldPlusCount = customers.filter(c => {
      const tier = getLoyaltyTierForPoints(c.lifetimeLoyaltyPoints || 0);
      return tier.id === 'gold' || tier.id === 'platinum';
    }).length;
    const customPricingCount = customers.filter(
      c => (c.pricingTier && c.pricingTier !== 'standard') || Object.keys(c.customProductRates || {}).length > 0
    ).length;
    const totalDiscountRedeemed = loyaltyTransactions
      .filter(t => t.type === 'REDEEM')
      .reduce((s, t) => s + (t.discountValue || Math.abs(t.points)), 0);

    return {
      totalActivePoints,
      goldPlusCount,
      customPricingCount,
      totalDiscountRedeemed,
    };
  }, [customers, loyaltyTransactions]);

  const filteredCustomers = useMemo(() => {
    const sorted = [...customers].sort(
      (a, b) => (b.lifetimeLoyaltyPoints || 0) - (a.lifetimeLoyaltyPoints || 0)
    );
    if (!searchQuery.trim()) return sorted;
    const q = searchQuery.toLowerCase();
    return sorted.filter(
      c => c.name.toLowerCase().includes(q) || c.phone.includes(q)
    );
  }, [customers, searchQuery]);

  const pricingCustomer = useMemo(
    () => customers.find(c => c.id === pricingModalCustomerId) || null,
    [customers, pricingModalCustomerId]
  );

  const adjustCustomer = useMemo(
    () => customers.find(c => c.id === adjustModalCustomerId) || null,
    [customers, adjustModalCustomerId]
  );

  const openStaffModal = (staff?: StaffMember) => {
    if (!canManageRbac) {
      soundManager.playAlertSound();
      onOpenOperatorSwitcher();
      return;
    }
    soundManager.playMechanicalClick();
    setConfirmRemoveStaff(false);
    if (staff) {
      setEditingStaff(staff);
      setSName(staff.name);
      setSPhone(staff.phone);
      setSRole(staff.role);
      setSWage(String(staff.dailyWage));
      setSShiftStart(staff.shiftStart);
      setSPin(staff.pin || '');
      setSActive(staff.active);
      setSCustomPerms({ ...(staff.customPermissions || {}) });
    } else {
      setEditingStaff(null);
      setSName('');
      setSPhone('');
      setSRole('Counter Cashier');
      setSWage('600');
      setSShiftStart('09:00');
      setSPin('');
      setSActive(true);
      setSCustomPerms({});
    }
    setIsStaffModalOpen(true);
  };

  const handleStaffSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!sName.trim()) return;
    const cleanOverrides: Partial<Record<StaffPermission, boolean>> = {};
    const roleDefaults = rolePermissions[sRole];
    for (const def of STAFF_PERMISSION_DEFINITIONS) {
      const overrideVal = sCustomPerms[def.key];
      if (overrideVal !== undefined && overrideVal !== roleDefaults[def.key]) {
        cleanOverrides[def.key] = overrideVal;
      }
    }

    const member: StaffMember = {
      id: editingStaff ? editingStaff.id : `staff_${Date.now()}`,
      name: sName.trim(),
      phone: sPhone.trim(),
      role: sRole,
      dailyWage: Math.max(0, parseFloat(sWage) || 0),
      shiftStart: sShiftStart || '09:00',
      active: editingStaff?.role === 'Store Owner / Admin' ? true : sActive,
      pin: sPin.trim() || undefined,
      customPermissions: Object.keys(cleanOverrides).length > 0 ? cleanOverrides : undefined,
      createdAt: editingStaff ? editingStaff.createdAt : new Date().toISOString(),
    };
    soundManager.playCheckoutSuccess();
    onSaveStaffMember(member);
    setIsStaffModalOpen(false);
    showToast(editingStaff ? `Updated ${member.name}` : `Added ${member.name} to staff roster`);
  };

  const openPricingModal = (cust: Customer) => {
    soundManager.playMechanicalClick();
    setPricingModalCustomerId(cust.id);
    setEditTier(cust.pricingTier || 'standard');
    setEditCustomPct(String(cust.customDiscountPct || 0));
    setEditSkuRates({ ...(cust.customProductRates || {}) });
    const firstProd = products[0];
    setSkuPickId(firstProd?.id || '');
    setSkuBundleRate(
      firstProd && hasConfiguredBundleTier(firstProd) ? String(firstProd.bundlePrice) : ''
    );
    setSkuPieceRate(
      firstProd && hasConfiguredPieceTier(firstProd) ? String(firstProd.piecePrice) : ''
    );
  };

  useEffect(() => {
    if (!focusCustomerId) return;
    const target = customers.find(c => c.id === focusCustomerId);
    if (target) {
      setActiveTab('loyalty');
      setSearchQuery(target.name);
      openPricingModal(target);
      onClearFocusCustomer?.();
    }
  }, [focusCustomerId]);

  const handleAddSkuOverride = () => {
    if (!skuPickId) return;
    const prod = products.find(p => p.id === skuPickId);
    const allowBundle = !prod || hasConfiguredBundleTier(prod);
    const allowPiece = !prod || hasConfiguredPieceTier(prod);
    const bRate = allowBundle ? parseFloat(skuBundleRate) : 0;
    const pRate = allowPiece ? parseFloat(skuPieceRate) : 0;
    if ((!bRate || bRate <= 0) && (!pRate || pRate <= 0)) return;
    setEditSkuRates(prev => ({
      ...prev,
      [skuPickId]: {
        bundlePrice: bRate > 0 ? bRate : undefined,
        piecePrice: pRate > 0 ? pRate : undefined,
      },
    }));
    soundManager.playItemAdded();
  };

  const handleSavePricingModal = (e: React.FormEvent) => {
    e.preventDefault();
    if (!pricingCustomer) return;
    soundManager.playCheckoutSuccess();
    onSaveCustomerPricing(
      pricingCustomer.id,
      editTier,
      Math.min(50, Math.max(0, parseFloat(editCustomPct) || 0)),
      editSkuRates
    );
    setPricingModalCustomerId(null);
    showToast(`Saved pricing tier for ${pricingCustomer.name}`);
  };

  const handleExportAttendanceCsv = () => {
    soundManager.playMechanicalClick();
    const headers = ['Date', 'Staff Name', 'Role', 'Clock In', 'Clock Out', 'Duration', 'Status', 'Notes'];
    const rows = dateAttendance.map(r => [
      r.date,
      `"${r.staffName.replace(/"/g, '""')}"`,
      r.role,
      new Date(r.clockInTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' }),
      r.clockOutTime
        ? new Date(r.clockOutTime).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
        : '',
      formatDurationMinutes(r.durationMinutes),
      r.status,
      `"${(r.notes || '').replace(/"/g, '""')}"`,
    ]);
    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sq-enterprises-attendance-${selectedDate}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported attendance CSV for ${selectedDate}`);
  };

  const handleExportActivityCsv = () => {
    soundManager.playMechanicalClick();
    const csv = buildActivityLogsCsv(filteredActivityLogs);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `sq-enterprises-staff-activity-${todayStr}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    showToast(`Exported ${filteredActivityLogs.length} activity logs to CSV`);
  };

  const headerMeta: Record<StaffModuleSubTab, { title: string; subtitle: string }> = {
    staff_rbac: {
      title: 'Staff Management & Role Access Control (RBAC)',
      subtitle: 'Manage team members, operator PINs & role-based permissions matrix',
    },
    orders: {
      title: 'Staff-Specific Order Tracking',
      subtitle: 'Per-staff sales attribution, Udhar issued & invoice drilldown',
    },
    activity: {
      title: 'Sales & Inventory Activity Logs',
      subtitle: 'Chronological audit trail of billing, Khata collections, stock edits & RBAC',
    },
    attendance: {
      title: 'Staff Attendance & Shift Register',
      subtitle: 'Live clock-in / clock-out · Shift duration tracking · Daily wage payroll sync',
    },
    loyalty: {
      title: 'Loyalty Rewards & Customer Rate Tiers',
      subtitle: 'Customer-specific rate tiers · Multi-tier loyalty accrual · Milestone bonuses',
    },
  };

  return (
    <div className="flex flex-col h-full overflow-hidden bg-slate-950 text-slate-100">
      {/* Top Bar */}
      <div className="p-4 bg-slate-900 border-b border-slate-800 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              {activeTab === 'staff_rbac' && <ShieldCheck className="w-5 h-5 text-blue-400" />}
              {activeTab === 'orders' && <Receipt className="w-5 h-5 text-emerald-400" />}
              {activeTab === 'activity' && <Activity className="w-5 h-5 text-amber-400" />}
              {activeTab === 'attendance' && <Clock className="w-5 h-5 text-blue-400" />}
              {activeTab === 'loyalty' && <Award className="w-5 h-5 text-amber-400" />}
              <span>{headerMeta[activeTab].title}</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{headerMeta[activeTab].subtitle}</p>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            {activeStaff && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onOpenOperatorSwitcher();
                }}
                className="px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-200 flex items-center gap-1.5 whitespace-nowrap"
              >
                <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                <span>{activeStaff.name}</span>
                <span className="text-slate-500">·</span>
                <span className="text-blue-300">
                  {activeStaff.role === 'Store Owner / Admin' ? 'Owner' : activeStaff.role}
                </span>
              </button>
            )}
          </div>
        </div>

        {/* Sub-navigation tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-slate-950 border border-slate-800 overflow-x-auto scrollbar-none">
          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setActiveTab('staff_rbac');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 ${
              activeTab === 'staff_rbac'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Staff &amp; RBAC</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setActiveTab('orders');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 tabular-nums ${
              activeTab === 'orders'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Receipt className="w-3.5 h-3.5" />
            <span>Staff Orders ({bills.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setActiveTab('activity');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 tabular-nums ${
              activeTab === 'activity'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Activity className="w-3.5 h-3.5" />
            <span>Activity Logs ({activityLogs.length})</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setActiveTab('attendance');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 ${
              activeTab === 'attendance'
                ? 'bg-blue-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Clock className="w-3.5 h-3.5" />
            <span>Attendance</span>
          </button>

          <button
            type="button"
            onClick={() => {
              soundManager.playMechanicalClick();
              setActiveTab('loyalty');
            }}
            className={`px-3 py-1.5 rounded-lg text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap shrink-0 ${
              activeTab === 'loyalty'
                ? 'bg-amber-600 text-white'
                : 'text-slate-400 hover:text-white hover:bg-slate-900'
            }`}
          >
            <Award className="w-3.5 h-3.5" />
            <span>Loyalty &amp; Rate Tiers</span>
          </button>
        </div>

        {toast && (
          <div className="px-3 py-2 rounded-xl bg-emerald-500/15 border border-emerald-500/30 text-emerald-300 text-xs font-semibold flex items-center justify-between">
            <span>{toast}</span>
            <button type="button" onClick={() => setToast(null)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}
      </div>

      {/* Main Content */}
      <div className="flex-1 overflow-y-auto p-3 sm:p-4 space-y-4">
        {/* ================= 1. STAFF & RBAC MATRIX TAB ================= */}
        {activeTab === 'staff_rbac' && (
          <div className="space-y-4">
            {/* Summary Strip */}
            <div
            className={`grid ${
              isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
            } gap-2.5`}
          >
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Active Team Members</div>
                <div className="text-xl font-bold text-white tabular-nums mt-0.5">
                  {staffMembers.filter(s => s.active).length} / {staffMembers.length}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Active Operator</div>
                <div className="text-sm font-bold text-blue-300 truncate mt-1">
                  {activeStaff ? activeStaff.name : 'Unselected'}
                </div>
                <div className="text-[11px] text-slate-400 truncate">
                  {activeStaff?.role || '—'}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Orders Attributed</div>
                <div className="text-xl font-bold text-emerald-400 tabular-nums mt-0.5">
                  {orderAnalytics.attributedBillsCount} bills
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Audit Events Logged</div>
                <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
                  {activityLogs.length} events
                </div>
              </div>
            </div>

            {!canManageRbac && (
              <div className="p-3.5 rounded-xl bg-amber-950/40 border border-amber-500/35 flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2 text-amber-200">
                  <Lock className="w-4 h-4 text-amber-400 flex-shrink-0" />
                  <span>
                    Read-only view: <strong>{activeStaff?.role}</strong> does not have permission to
                    modify staff accounts or role access rules.
                  </span>
                </div>
                <button
                  type="button"
                  onClick={onOpenOperatorSwitcher}
                  className="px-3 py-1.5 rounded-lg bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold whitespace-nowrap"
                >
                  Switch to Owner / Admin
                </button>
              </div>
            )}

            {/* Staff Directory */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <Users className="w-4 h-4 text-blue-400" />
                    Staff Accounts &amp; Role Assignments
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Assign roles, set optional operator PINs &amp; per-staff permission overrides
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={onOpenOperatorSwitcher}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <UserCheck className="w-3.5 h-3.5 text-blue-400" />
                    <span>Switch Operator</span>
                  </button>
                  {canManageRbac && (
                    <button
                      type="button"
                      onClick={() => openStaffModal()}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Staff</span>
                    </button>
                  )}
                </div>
              </div>

              <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'} gap-3 p-3.5`}>
                {staffMembers.map(member => {
                  const isActiveOperator = activeStaff?.id === member.id;
                  const effectivePerms = getEffectiveStaffPermissions(member, rolePermissions);
                  const grantedCount = countGrantedPermissions(effectivePerms);
                  const orderMetric = orderAnalytics.perStaff.find(m => m.staffId === member.id);
                  const customOverrideCount = Object.keys(member.customPermissions || {}).length;

                  return (
                    <div
                      key={member.id}
                      className={`p-3.5 rounded-xl border flex flex-col justify-between gap-3 ${
                        isActiveOperator
                          ? 'bg-blue-950/25 border-blue-500/50'
                          : 'bg-slate-950 border-slate-800'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-bold text-sm text-white truncate">
                              {member.name}
                            </span>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span
                              className={`text-xs font-semibold ${
                                member.role === 'Store Owner / Admin'
                                  ? 'text-amber-300'
                                  : 'text-blue-300'
                              }`}
                            >
                              {member.role}
                            </span>
                            {!member.active && (
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 text-[10px] font-semibold">
                                Inactive
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-400 tabular-nums flex items-center gap-2 flex-wrap">
                            <span>{member.phone || 'No phone'}</span>
                            <span>·</span>
                            <span>Shift {member.shiftStart}</span>
                            {member.dailyWage > 0 && (
                              <>
                                <span>·</span>
                                <span>{formatCurrency(member.dailyWage)}/day</span>
                              </>
                            )}
                            {member.pin && (
                              <>
                                <span>·</span>
                                <span className="inline-flex items-center gap-1 text-slate-300">
                                  <KeyRound className="w-3 h-3 text-amber-400" />
                                  PIN set
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {isActiveOperator && (
                          <span className="px-2 py-0.5 rounded-lg bg-blue-600 text-white text-[10px] font-bold whitespace-nowrap shrink-0">
                            Active Now
                          </span>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-800/80 text-[11px]">
                        <div className="text-slate-400 tabular-nums">
                          <span className="text-slate-200 font-semibold">
                            {grantedCount}/{STAFF_PERMISSION_DEFINITIONS.length}
                          </span>{' '}
                          permissions
                          {customOverrideCount > 0 && (
                            <span className="text-amber-300 ml-1">
                              ({customOverrideCount} custom)
                            </span>
                          )}
                          {' · '}
                          <span className="text-emerald-400 font-semibold">
                            {orderMetric?.ordersCount || 0} orders
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => {
                              setOrderStaffFilter(member.id);
                              setActiveTab('orders');
                            }}
                            className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 font-semibold"
                          >
                            Orders
                          </button>
                          {canManageRbac && (
                            <button
                              type="button"
                              onClick={() => openStaffModal(member)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-blue-300 border border-slate-700 font-semibold flex items-center gap-1"
                            >
                              <Edit2 className="w-3 h-3" />
                              <span>Edit</span>
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Role-Based Access Control (RBAC) Matrix */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <ShieldCheck className="w-4 h-4 text-emerald-400" />
                    Role-Based Access Control (RBAC) Matrix
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Configure which modules &amp; critical actions each staff role can access across the POS
                  </p>
                </div>
                {canManageRbac && (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      onResetRolePermissions();
                      showToast('Reset role permissions to factory defaults');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reset Defaults</span>
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-300 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold min-w-[210px]">
                        Permission / Module
                      </th>
                      {ALL_STAFF_ROLES.map(role => (
                        <th
                          key={role}
                          className="py-2.5 px-2.5 font-semibold text-center whitespace-nowrap"
                        >
                          {role === 'Store Owner / Admin'
                            ? 'Owner / Admin'
                            : role === 'Counter Cashier'
                            ? 'Cashier'
                            : role === 'Godown Manager'
                            ? 'Godown'
                            : role === 'Delivery Driver'
                            ? 'Driver'
                            : role === 'Sales Executive'
                            ? 'Sales Exec'
                            : role}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70">
                    {STAFF_PERMISSION_DEFINITIONS.map(def => (
                      <tr key={def.key} className="hover:bg-slate-900/60">
                        <td className="py-2.5 px-3">
                          <div className="font-semibold text-white flex items-center gap-1.5">
                            <span>{def.label}</span>
                            {def.group === 'actions' && (
                              <span className="text-[10px] font-bold text-amber-300 uppercase">
                                Action
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400">{def.description}</div>
                        </td>
                        {ALL_STAFF_ROLES.map(role => {
                          const allowed = Boolean(rolePermissions[role]?.[def.key]);
                          const isLockedAdminPerm =
                            role === 'Store Owner / Admin' &&
                            (def.key === 'manage_rbac' ||
                              def.key === 'staff_loyalty' ||
                              def.key === 'store_profile');
                          const disabled = !canManageRbac || isLockedAdminPerm;

                          return (
                            <td key={role} className="py-2.5 px-2 text-center">
                              <button
                                type="button"
                                disabled={disabled}
                                onClick={() => {
                                  soundManager.playMechanicalClick();
                                  onUpdateRolePermission(role, def.key, !allowed);
                                }}
                                title={
                                  isLockedAdminPerm
                                    ? 'Owner retains admin safeguards'
                                    : `${role}: ${def.label} (${allowed ? 'Allowed' : 'Denied'})`
                                }
                                className={`inline-flex items-center justify-center w-8 h-7 rounded-lg border transition ${
                                  allowed
                                    ? 'bg-emerald-600/20 border-emerald-500/50 text-emerald-300'
                                    : 'bg-slate-950 border-slate-800 text-slate-600'
                                } ${
                                  disabled
                                    ? 'opacity-70 cursor-not-allowed'
                                    : 'hover:border-blue-400 active:scale-95'
                                }`}
                              >
                                {isLockedAdminPerm ? (
                                  <Lock className="w-3.5 h-3.5 text-amber-300" />
                                ) : allowed ? (
                                  <Check className="w-3.5 h-3.5" />
                                ) : (
                                  <X className="w-3.5 h-3.5" />
                                )}
                              </button>
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          </div>
        )}

        {/* ================= 2. STAFF-SPECIFIC ORDER TRACKING TAB ================= */}
        {activeTab === 'orders' && (
          <div className="space-y-4">
            {/* Per-Staff Performance Breakdown Table */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                    <ShoppingBag className="w-4 h-4 text-emerald-400" />
                    Staff Order Performance Summary
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Click any staff row to filter bills handled by that team member
                  </p>
                </div>
                {orderStaffFilter !== 'ALL' && (
                  <button
                    type="button"
                    onClick={() => setOrderStaffFilter('ALL')}
                    className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
                  >
                    Show All Staff Orders
                  </button>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left">
                  <thead className="bg-slate-950 text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3 font-semibold">Staff Member</th>
                      <th className="py-2.5 px-3 font-semibold">Role</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Orders</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Gross Sales</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Cash Collected</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Udhar Issued</th>
                      <th className="py-2.5 px-3 font-semibold text-right">Avg Bill</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/70 tabular-nums">
                    {orderAnalytics.perStaff.map(metric => {
                      const isSelected = orderStaffFilter === metric.staffId;
                      return (
                        <tr
                          key={metric.staffId}
                          onClick={() =>
                            setOrderStaffFilter(prev =>
                              prev === metric.staffId ? 'ALL' : metric.staffId
                            )
                          }
                          className={`cursor-pointer transition ${
                            isSelected ? 'bg-blue-600/15' : 'hover:bg-slate-900'
                          }`}
                        >
                          <td className="py-2.5 px-3 font-bold text-white">
                            {metric.staffName}
                          </td>
                          <td className="py-2.5 px-3 text-blue-300">{metric.staffRole}</td>
                          <td className="py-2.5 px-3 text-right font-semibold text-white">
                            {metric.ordersCount}
                          </td>
                          <td className="py-2.5 px-3 text-right font-bold text-emerald-400">
                            {formatCurrency(metric.grossSales)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-200">
                            {formatCurrency(metric.cashCollected)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-amber-300">
                            {formatCurrency(metric.udharIssued)}
                          </td>
                          <td className="py-2.5 px-3 text-right text-slate-300">
                            {formatCurrency(metric.avgOrderValue)}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </section>

            {/* Filterable Order Ledger */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="p-3.5 border-b border-slate-800 flex flex-col sm:flex-row gap-2">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                  <input
                    type="text"
                    value={orderSearch}
                    onChange={e => setOrderSearch(e.target.value)}
                    placeholder="Search by bill #, customer name, or staff..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                  />
                </div>

                <select
                  value={orderStaffFilter}
                  onChange={e => setOrderStaffFilter(e.target.value)}
                  aria-label="Filter orders by staff member"
                  className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white"
                >
                  <option value="ALL">All Staff Members</option>
                  {staffMembers.map(s => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                  {orderAnalytics.unassignedBillsCount > 0 && (
                    <option value="__unassigned__">Unassigned / Legacy Bills</option>
                  )}
                </select>

                <select
                  value={orderRoleFilter}
                  onChange={e => setOrderRoleFilter(e.target.value)}
                  aria-label="Filter orders by role"
                  className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white"
                >
                  <option value="ALL">All Roles</option>
                  {ALL_STAFF_ROLES.map(r => (
                    <option key={r} value={r}>
                      {r}
                    </option>
                  ))}
                </select>
              </div>

              {filteredStaffOrders.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No orders match the selected staff or search filter. Create a bill in Billing to
                  see real-time staff attribution.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {filteredStaffOrders.slice(0, 80).map(bill => {
                    const billSale = bill.itemsTotal + (bill.totalGstAmount || 0);
                    return (
                      <div
                        key={bill.id}
                        className="p-3.5 hover:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="font-mono font-bold text-xs text-blue-300">
                              #{bill.billNumber}
                            </span>
                            <span className="font-bold text-sm text-white truncate">
                              {bill.customerName}
                            </span>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span className="text-xs font-semibold text-emerald-300">
                              Handled by: {bill.staffName || 'Unassigned'}
                            </span>
                            {bill.staffRole && (
                              <span className="text-[11px] text-slate-400">
                                ({bill.staffRole})
                              </span>
                            )}
                          </div>
                          <div className="text-[11px] text-slate-400 tabular-nums">
                            {bill.formattedDateTime} · {bill.items.length} item
                            {bill.items.length === 1 ? '' : 's'} · Paid{' '}
                            <span className="text-slate-200 font-semibold">
                              {formatCurrency(bill.amountReceived)}
                            </span>
                            {bill.remainingBalance > 0 && (
                              <span className="text-amber-300 ml-2">
                                · Udhar Due {formatCurrency(bill.remainingBalance)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between sm:justify-end gap-3 flex-shrink-0">
                          <div className="text-right tabular-nums">
                            <div className="text-sm font-black text-white">
                              {formatCurrency(billSale)}
                            </div>
                            <div className="text-[10px] text-slate-500 uppercase">
                              {bill.paymentMode}
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              onViewBillReceipt(bill);
                            }}
                            className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 whitespace-nowrap"
                          >
                            <Eye className="w-3.5 h-3.5 text-blue-400" />
                            <span>Receipt</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================= 3. SALES & INVENTORY ACTIVITY LOGS TAB ================= */}
        {activeTab === 'activity' && (
          <div className="space-y-4">
            {/* KPI Strip */}
            <div
              className={`grid ${
                isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
              } gap-2.5`}
            >
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Last 24h Activity</div>
                <div className="text-xl font-bold text-white tabular-nums mt-0.5">
                  {activityStats.last24hCount} events
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Sales &amp; Khata Events</div>
                <div className="text-xl font-bold text-emerald-400 tabular-nums mt-0.5">
                  {activityStats.salesCount}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Inventory &amp; Stock Events</div>
                <div className="text-xl font-bold text-blue-300 tabular-nums mt-0.5">
                  {activityStats.inventoryCount}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Team &amp; RBAC Changes</div>
                <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
                  {activityStats.teamCount}
                </div>
              </div>
            </div>

            {/* Filter Toolbar */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="p-3.5 border-b border-slate-800 space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="inline-flex p-1 rounded-xl bg-slate-950 border border-slate-800">
                    {(
                      [
                        { id: 'ALL', label: 'All Actions' },
                        { id: 'sales', label: 'Sales & Billing' },
                        { id: 'inventory', label: 'Inventory & Stock' },
                        { id: 'team_rbac', label: 'Team & RBAC' },
                      ] as const
                    ).map(item => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setActivityDomainFilter(item.id);
                        }}
                        className={`px-3 py-1 rounded-lg text-xs font-bold transition whitespace-nowrap ${
                          activityDomainFilter === item.id
                            ? 'bg-blue-600 text-white'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>

                  <button
                    type="button"
                    onClick={handleExportActivityCsv}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export CSV</span>
                  </button>
                </div>

                <div className="flex flex-col sm:flex-row gap-2">
                  <div className="relative flex-1">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                    <input
                      type="text"
                      value={activitySearch}
                      onChange={e => setActivitySearch(e.target.value)}
                      placeholder="Search activity by SKU, customer, bill #, or action..."
                      className="w-full pl-9 pr-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                  <select
                    value={activityStaffFilter}
                    onChange={e => setActivityStaffFilter(e.target.value)}
                    aria-label="Filter activity logs by staff member"
                    className="px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-xs font-semibold text-white"
                  >
                    <option value="ALL">All Staff Members</option>
                    {staffMembers.map(s => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.role === 'Store Owner / Admin' ? 'Owner' : s.role})
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {filteredActivityLogs.length === 0 ? (
                <div className="p-8 text-center text-xs text-slate-400">
                  No activity log entries match the current filters.
                </div>
              ) : (
                <div className="divide-y divide-slate-800/70">
                  {filteredActivityLogs.slice(0, 120).map(log => {
                    const matchedBill = log.billId
                      ? bills.find(b => b.id === log.billId)
                      : undefined;
                    return (
                      <div
                        key={log.id}
                        className="p-3.5 hover:bg-slate-900 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex items-center gap-2 flex-wrap">
                            <span
                              className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-bold uppercase ${
                                log.domain === 'sales'
                                  ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                  : log.domain === 'inventory'
                                  ? 'bg-blue-500/15 text-blue-300 border border-blue-500/30'
                                  : 'bg-amber-500/15 text-amber-300 border border-amber-500/30'
                              }`}
                            >
                              {log.domain === 'sales' && <ShoppingBag className="w-3 h-3" />}
                              {log.domain === 'inventory' && <Package className="w-3 h-3" />}
                              {log.domain === 'team_rbac' && <ShieldCheck className="w-3 h-3" />}
                              {getActivityDomainLabel(log.domain)}
                            </span>
                            <span className="font-mono text-[11px] font-bold text-slate-200">
                              {log.action}
                            </span>
                            <span className="text-slate-600" aria-hidden="true">
                              ·
                            </span>
                            <span className="font-bold text-xs text-white truncate">
                              {log.targetLabel}
                            </span>
                          </div>

                          <div className="text-xs text-slate-300">{log.details}</div>

                          <div className="text-[11px] text-slate-400 tabular-nums flex items-center gap-2 flex-wrap">
                            <span className="text-blue-300 font-semibold">{log.staffName}</span>
                            <span>({log.staffRole})</span>
                            <span>·</span>
                            <span>{formatShortTimestamp(log.timestamp)}</span>
                          </div>
                        </div>

                        <div className="flex items-center gap-2.5 flex-shrink-0 tabular-nums">
                          {log.amount !== undefined && (
                            <span className="text-xs font-bold text-emerald-400">
                              {formatCurrency(log.amount)}
                            </span>
                          )}
                          {log.quantityDelta !== undefined && (
                            <span
                              className={`text-xs font-mono font-bold ${
                                log.quantityDelta >= 0 ? 'text-blue-300' : 'text-amber-300'
                              }`}
                            >
                              {log.quantityDelta >= 0 ? '+' : ''}
                              {log.quantityDelta} pcs
                            </span>
                          )}
                          {matchedBill && (
                            <button
                              type="button"
                              onClick={() => onViewBillReceipt(matchedBill)}
                              className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-semibold"
                            >
                              Receipt
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================= 4. STAFF ATTENDANCE TAB ================= */}
        {activeTab === 'attendance' && (
          <div className="space-y-4">
            {/* KPI Summary + Actions */}
            <div
              className={`grid ${
                isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
              } gap-2.5`}
            >
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Clocked In Now</div>
                <div className="text-xl font-bold text-emerald-400 tabular-nums mt-0.5">
                  {attendanceStats.clockedInNow} / {staffMembers.filter(s => s.active).length}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Present ({selectedDate})</div>
                <div className="text-xl font-bold text-white tabular-nums mt-0.5">
                  {attendanceStats.presentCount} staff
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Logged Hours ({selectedDate})</div>
                <div className="text-xl font-bold text-blue-300 tabular-nums mt-0.5">
                  {attendanceStats.totalHoursLabel}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Estimated Daily Wages</div>
                <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
                  {formatCurrency(attendanceStats.estimatedWages)}
                </div>
              </div>
            </div>

            {/* Staff Roster Clock-In / Clock-Out Controls */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">
                    Live Shift Clock-In / Clock-Out
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Tap Clock In when staff arrives and Clock Out at shift end
                  </p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={shiftNoteInput}
                    onChange={e => setShiftNoteInput(e.target.value)}
                    placeholder="Optional shift note..."
                    className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-blue-500"
                  />
                  {onPostWagesToCashFlow && attendanceStats.estimatedWages > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playCheckoutSuccess();
                        onPostWagesToCashFlow(
                          selectedDate,
                          attendanceStats.estimatedWages,
                          attendanceStats.presentStaffNames || 'Daily Staff Wages'
                        );
                        showToast(
                          `Posted ${formatCurrency(attendanceStats.estimatedWages)} wages to Cash Flow (${selectedDate})`
                        );
                      }}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 text-xs font-bold flex items-center gap-1.5"
                    >
                      <Wallet className="w-3.5 h-3.5" />
                      <span>Post Wages to Cash Flow</span>
                    </button>
                  )}
                  {canManageRbac && (
                    <button
                      type="button"
                      onClick={() => openStaffModal()}
                      className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center gap-1"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>Add Staff</span>
                    </button>
                  )}
                </div>
              </div>

              <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'} gap-3 p-3.5`}>
                {staffMembers.map(member => {
                  const activeRecord = activeShiftByStaffId.get(member.id);
                  const elapsedMins = activeRecord
                    ? Math.max(
                        1,
                        Math.round(
                          (Date.now() - new Date(activeRecord.clockInTime).getTime()) / 60000
                        )
                      )
                    : 0;

                  return (
                    <div
                      key={member.id}
                      className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3"
                    >
                      <div className="min-w-0 space-y-1">
                        <div className="flex items-center gap-2">
                          <span className="font-bold text-sm text-white truncate">
                            {member.name}
                          </span>
                          <span className="text-slate-600" aria-hidden="true">·</span>
                          <span className="text-xs text-blue-300 font-semibold">
                            {member.role}
                          </span>
                        </div>
                        <div className="text-[11px] text-slate-400 tabular-nums">
                          Shift {member.shiftStart} · Wage {formatCurrency(member.dailyWage)}/day ·{' '}
                          {member.phone}
                        </div>
                        <div className="text-[11px] font-semibold">
                          {activeRecord ? (
                            <span className="text-emerald-400">
                              On Duty since{' '}
                              {new Date(activeRecord.clockInTime).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}{' '}
                              ({formatDurationMinutes(elapsedMins)})
                            </span>
                          ) : (
                            <span className="text-slate-500">Not clocked in today</span>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {canManageRbac && (
                          <button
                            type="button"
                            onClick={() => openStaffModal(member)}
                            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700"
                            title="Edit Staff"
                          >
                            <Edit2 className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {activeRecord ? (
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playCheckoutSuccess();
                              onClockOutStaff(
                                activeRecord.id,
                                shiftNoteInput.trim() || undefined
                              );
                              setShiftNoteInput('');
                              showToast(`${member.name} clocked out`);
                            }}
                            className="px-3 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center gap-1.5"
                          >
                            <LogOut className="w-3.5 h-3.5" />
                            <span>Clock Out</span>
                          </button>
                        ) : (
                          <button
                            type="button"
                            onClick={() => {
                              soundManager.playScannerBeep();
                              onClockInStaff(member, shiftNoteInput.trim() || undefined);
                              setShiftNoteInput('');
                              showToast(`${member.name} clocked in`);
                            }}
                            className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center gap-1.5"
                          >
                            <LogIn className="w-3.5 h-3.5" />
                            <span>Clock In</span>
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>

            {/* Attendance History Table */}
            <section className="rounded-2xl bg-slate-900/70 border border-slate-800 overflow-hidden">
              <div className="px-4 py-3 border-b border-slate-800 flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-bold text-white">Attendance Log</h3>
                  <p className="text-[11px] text-slate-400">
                    Shift clock-in / clock-out audit trail
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={selectedDate}
                    onChange={e => e.target.value && setSelectedDate(e.target.value)}
                    className="px-3 py-1.5 bg-slate-950 border border-slate-700 rounded-xl text-xs font-mono text-white"
                  />
                  <button
                    type="button"
                    onClick={handleExportAttendanceCsv}
                    className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>CSV</span>
                  </button>
                </div>
              </div>

              {dateAttendance.length === 0 ? (
                <div className="p-6 text-center text-xs text-slate-500">
                  No attendance entries recorded on {selectedDate}.
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-xs text-left">
                    <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800">
                      <tr>
                        <th className="py-2.5 px-3 font-semibold">Staff</th>
                        <th className="py-2.5 px-3 font-semibold">Role</th>
                        <th className="py-2.5 px-3 font-semibold">Clock In</th>
                        <th className="py-2.5 px-3 font-semibold">Clock Out</th>
                        <th className="py-2.5 px-3 font-semibold text-right">Duration</th>
                        <th className="py-2.5 px-3 font-semibold">Notes</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/70 tabular-nums">
                      {dateAttendance.map(rec => (
                        <tr key={rec.id} className="hover:bg-slate-900">
                          <td className="py-2.5 px-3 font-semibold text-white">
                            {rec.staffName}
                          </td>
                          <td className="py-2.5 px-3 text-slate-300">{rec.role}</td>
                          <td className="py-2.5 px-3 font-mono text-emerald-400">
                            {new Date(rec.clockInTime).toLocaleTimeString('en-IN', {
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2.5 px-3 font-mono text-slate-300">
                            {rec.clockOutTime
                              ? new Date(rec.clockOutTime).toLocaleTimeString('en-IN', {
                                  hour: '2-digit',
                                  minute: '2-digit',
                                })
                              : 'Active'}
                          </td>
                          <td className="py-2.5 px-3 text-right font-semibold text-blue-300">
                            {rec.durationMinutes
                              ? formatDurationMinutes(rec.durationMinutes)
                              : 'In progress'}
                          </td>
                          <td className="py-2.5 px-3 text-slate-400">{rec.notes || '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}

        {/* ================= 5. LOYALTY & CUSTOMER PRICING TAB ================= */}
        {activeTab === 'loyalty' && (
          <div className="space-y-4">
            {/* Summary Strip */}
            <div
              className={`grid ${
                isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
              } gap-2.5`}
            >
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Active Redeemable Points</div>
                <div className="text-xl font-bold text-amber-300 tabular-nums mt-0.5">
                  {loyaltyStats.totalActivePoints.toLocaleString('en-IN')} pts
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Gold &amp; Platinum Members</div>
                <div className="text-xl font-bold text-cyan-300 tabular-nums mt-0.5">
                  {loyaltyStats.goldPlusCount} accounts
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Custom Pricing Accounts</div>
                <div className="text-xl font-bold text-blue-300 tabular-nums mt-0.5">
                  {loyaltyStats.customPricingCount} / {customers.length}
                </div>
              </div>
              <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800">
                <div className="text-[11px] text-slate-400">Discounts Redeemed</div>
                <div className="text-xl font-bold text-emerald-400 tabular-nums mt-0.5">
                  {formatCurrency(loyaltyStats.totalDiscountRedeemed)}
                </div>
              </div>
            </div>

            {/* Tier Definitions */}
            <div
              className={`grid ${
                isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
              } gap-2.5`}
            >
              {LOYALTY_TIERS.map(tier => (
                <div
                  key={tier.id}
                  className="p-3 rounded-xl bg-slate-900/50 border border-slate-800 space-y-1"
                >
                  <div className="flex items-center justify-between">
                    <span className={`text-sm font-bold ${getLoyaltyTierBadgeColor(tier.id)}`}>
                      {tier.name}
                    </span>
                    <span className="text-xs font-mono font-bold text-slate-300">
                      {tier.earnMultiplier}x pts
                    </span>
                  </div>
                  <div className="text-[11px] text-slate-400">{tier.description}</div>
                </div>
              ))}
            </div>

            {/* Search Customers */}
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                placeholder="Search wholesale customers by name or phone..."
                className="w-full pl-9 pr-4 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs text-white placeholder-slate-400 focus:outline-none focus:border-blue-500"
              />
            </div>

            {/* Customer Pricing & Loyalty Table */}
            <div className="divide-y divide-slate-800 rounded-2xl bg-slate-900/70 border border-slate-800">
              {filteredCustomers.map(cust => {
                const lifetime = cust.lifetimeLoyaltyPoints || 0;
                const available = cust.loyaltyPoints || 0;
                const tier = getLoyaltyTierForPoints(lifetime);
                const nextInfo = getNextLoyaltyTier(lifetime);
                const claimable = getClaimableMilestones(cust);
                const pricingLabel = getCustomerPricingLabel(cust);

                return (
                  <div
                    key={cust.id}
                    className={`p-4 flex ${
                      isDesktopLayout ? 'flex-row items-center' : 'flex-col'
                    } justify-between gap-3`}
                  >
                    <div className="space-y-1.5 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-bold text-sm text-white">{cust.name}</span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className={`text-xs font-bold ${getLoyaltyTierBadgeColor(tier.id)}`}>
                          {tier.name} Tier ({tier.earnMultiplier}x)
                        </span>
                        <span className="text-slate-600" aria-hidden="true">·</span>
                        <span className="text-xs font-semibold text-blue-300">{pricingLabel}</span>
                      </div>

                      <div className="text-xs text-slate-400 tabular-nums flex items-center gap-2 flex-wrap">
                        <span>{cust.phone || 'No phone'}</span>
                        <span aria-hidden="true">·</span>
                        <span className="text-amber-300 font-semibold">
                          {available.toLocaleString('en-IN')} redeemable pts (₹{available})
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{lifetime.toLocaleString('en-IN')} lifetime pts</span>
                      </div>

                      <div className="max-w-md flex items-center gap-2">
                        <div className="flex-1 h-1.5 rounded-full bg-slate-800 overflow-hidden">
                          <div
                            className="h-full bg-amber-400"
                            style={{ width: `${nextInfo.progressPct}%` }}
                          />
                        </div>
                        <span className="text-[11px] text-slate-400 tabular-nums whitespace-nowrap">
                          {nextInfo.nextTier
                            ? `${nextInfo.pointsNeeded} pts to ${nextInfo.nextTier.name}`
                            : 'Top Tier Unlocked'}
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {claimable.length > 0 && (
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playCheckoutSuccess();
                            onClaimMilestone(cust.id, claimable[0]);
                            showToast(
                              `Claimed ${claimable[0].title} (+${claimable[0].rewardPointsBonus} pts) for ${cust.name}`
                            );
                          }}
                          className="px-3 py-1.5 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 text-xs font-bold flex items-center gap-1"
                        >
                          <Gift className="w-3.5 h-3.5" />
                          <span>Claim +{claimable[0].rewardPointsBonus} pts</span>
                        </button>
                      )}

                      <button
                        type="button"
                        onClick={() => {
                          setAdjustModalCustomerId(cust.id);
                          setAdjustPointsInput('100');
                          setAdjustNoteInput('Loyalty milestone / goodwill bonus');
                        }}
                        className="px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold"
                      >
                        Adjust Points
                      </button>

                      <button
                        type="button"
                        onClick={() => openPricingModal(cust)}
                        className="px-3 py-1.5 rounded-xl bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 text-xs font-bold flex items-center gap-1"
                      >
                        <Tag className="w-3.5 h-3.5" />
                        <span>Rate Tier</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Milestones & Recent Loyalty Ledger */}
            <div className={`grid ${isDesktopLayout ? 'grid-cols-2' : 'grid-cols-1'} gap-4`}>
              <section className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 space-y-2.5">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Gift className="w-4 h-4 text-amber-400" />
                  Milestone Rewards Schedule
                </h3>
                <div className="divide-y divide-slate-800/70">
                  {LOYALTY_MILESTONES.map(ms => (
                    <div key={ms.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                      <div>
                        <div className="font-semibold text-white">{ms.title}</div>
                        <div className="text-[11px] text-slate-400">{ms.description}</div>
                      </div>
                      <span className="font-mono font-bold text-emerald-400 whitespace-nowrap">
                        +{ms.rewardPointsBonus} pts
                      </span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-2xl bg-slate-900/70 border border-slate-800 p-4 space-y-2.5">
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-blue-400" />
                  Recent Loyalty Points Activity
                </h3>
                {loyaltyTransactions.length === 0 ? (
                  <div className="py-6 text-center text-xs text-slate-500">
                    No loyalty transactions yet.
                  </div>
                ) : (
                  <div className="divide-y divide-slate-800/70 max-h-60 overflow-y-auto">
                    {loyaltyTransactions.slice(0, 20).map(tx => (
                      <div key={tx.id} className="py-2 flex items-center justify-between gap-2 text-xs">
                        <div className="min-w-0">
                          <div className="font-semibold text-white truncate">
                            {tx.customerName} · {tx.type}
                          </div>
                          <div className="text-[11px] text-slate-400 truncate">{tx.note}</div>
                        </div>
                        <div className="text-right tabular-nums whitespace-nowrap">
                          <span
                            className={`font-bold ${
                              tx.points >= 0 ? 'text-emerald-400' : 'text-amber-300'
                            }`}
                          >
                            {tx.points >= 0 ? '+' : ''}
                            {tx.points} pts
                          </span>
                          <div className="text-[10px] text-slate-500">
                            {new Date(tx.timestamp).toLocaleDateString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                            })}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>
        )}
      </div>

      {/* ================= ADD / EDIT STAFF MODAL (WITH PIN & RBAC OVERRIDES) ================= */}
      {isStaffModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">
                {editingStaff ? `Edit Staff: ${editingStaff.name}` : 'Add Staff Member'}
              </h3>
              <button
                type="button"
                onClick={() => setIsStaffModalOpen(false)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleStaffSubmit} className="mt-4 space-y-3 text-xs">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Full Name *</label>
                  <input
                    type="text"
                    required
                    value={sName}
                    onChange={e => setSName(e.target.value)}
                    placeholder="e.g. Mohan Verma"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Role</label>
                  <select
                    value={sRole}
                    onChange={e => setSRole(e.target.value as StaffRole)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                  >
                    {ALL_STAFF_ROLES.map(r => (
                      <option key={r} value={r}>
                        {r}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="col-span-2 sm:col-span-1">
                  <label className="block text-slate-300 font-semibold mb-1">Phone</label>
                  <input
                    type="tel"
                    value={sPhone}
                    onChange={e => setSPhone(e.target.value)}
                    placeholder="10-digit"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Daily Wage (₹)</label>
                  <input
                    type="number"
                    min="0"
                    value={sWage}
                    onChange={e => setSWage(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">Shift Start</label>
                  <input
                    type="time"
                    value={sShiftStart}
                    onChange={e => setSShiftStart(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono"
                  />
                </div>
                <div>
                  <label className="block text-slate-300 font-semibold mb-1">
                    Operator PIN
                  </label>
                  <input
                    type="text"
                    inputMode="numeric"
                    maxLength={6}
                    value={sPin}
                    onChange={e => setSPin(e.target.value.replace(/\s+/g, ''))}
                    placeholder="Optional"
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono"
                  />
                </div>
              </div>

              {editingStaff?.role !== 'Store Owner / Admin' && (
                <label className="flex items-center justify-between p-2.5 rounded-xl bg-slate-950 border border-slate-800 cursor-pointer">
                  <span className="text-slate-200 font-semibold">
                    Account Active (can switch in &amp; operate POS)
                  </span>
                  <input
                    type="checkbox"
                    checked={sActive}
                    onChange={e => setSActive(e.target.checked)}
                    className="w-4 h-4 accent-blue-500"
                  />
                </label>
              )}

              {/* Per-Staff Permission Overrides */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-slate-200">
                    Individual Permission Overrides (inherits {sRole})
                  </span>
                  {Object.keys(sCustomPerms).length > 0 && (
                    <button
                      type="button"
                      onClick={() => setSCustomPerms({})}
                      className="text-[11px] text-blue-300 hover:underline"
                    >
                      Reset to Role Default
                    </button>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  {STAFF_PERMISSION_DEFINITIONS.map(def => {
                    const roleDefault = Boolean(rolePermissions[sRole]?.[def.key]);
                    const effectiveVal =
                      sCustomPerms[def.key] !== undefined ? Boolean(sCustomPerms[def.key]) : roleDefault;
                    const isOverridden =
                      sCustomPerms[def.key] !== undefined && sCustomPerms[def.key] !== roleDefault;

                    return (
                      <button
                        key={def.key}
                        type="button"
                        onClick={() =>
                          setSCustomPerms(prev => ({
                            ...prev,
                            [def.key]: !effectiveVal,
                          }))
                        }
                        className={`px-2.5 py-1.5 rounded-lg border text-left flex items-center justify-between gap-2 transition ${
                          effectiveVal
                            ? 'bg-emerald-500/10 border-emerald-500/35 text-emerald-200'
                            : 'bg-slate-900 border-slate-800 text-slate-500'
                        }`}
                      >
                        <span className="truncate font-semibold">{def.shortLabel}</span>
                        <span className="text-[10px] font-bold flex items-center gap-1 shrink-0">
                          {isOverridden && <span className="text-amber-300">*</span>}
                          {effectiveVal ? 'Allow' : 'Deny'}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="pt-2 flex flex-wrap gap-2">
                {editingStaff &&
                  editingStaff.role !== 'Store Owner / Admin' &&
                  editingStaff.id !== activeStaff?.id &&
                  (confirmRemoveStaff ? (
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          onDeleteStaffMember(editingStaff.id);
                          setIsStaffModalOpen(false);
                          showToast(`Removed ${editingStaff.name}`);
                        }}
                        className="px-3 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-bold"
                      >
                        Confirm Remove
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmRemoveStaff(false)}
                        className="px-2.5 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                      >
                        Keep
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setConfirmRemoveStaff(true)}
                      className="px-3 py-2.5 rounded-xl bg-rose-600/20 hover:bg-rose-600/30 text-rose-300 border border-rose-500/30 font-semibold"
                    >
                      Remove
                    </button>
                  ))}

                <button
                  type="button"
                  onClick={() => setIsStaffModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
                >
                  Save Staff
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= CUSTOMER RATE TIER & SKU CONTRACT PRICING MODAL ================= */}
      {pricingCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-white flex items-center gap-1.5">
                  <SlidersHorizontal className="w-4 h-4 text-blue-400" />
                  Customer-Specific Pricing: {pricingCustomer.name}
                </h3>
                <p className="text-[11px] text-slate-400">
                  Applies automatically during billing when this customer is selected
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPricingModalCustomerId(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePricingModal} className="mt-4 space-y-4 text-xs">
              <div className="space-y-2">
                <label className="block font-semibold text-slate-200">Select Rate Tier</label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {PRICING_TIERS.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setEditTier(t.id)}
                      className={`p-3 rounded-xl border text-left transition ${
                        editTier === t.id
                          ? 'bg-blue-600/20 border-blue-500 text-white'
                          : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                      }`}
                    >
                      <div className="font-bold flex justify-between">
                        <span>{t.name}</span>
                        {t.discountPercent > 0 && (
                          <span className="text-emerald-400">-{t.discountPercent}%</span>
                        )}
                      </div>
                      <div className="text-[11px] text-slate-400 mt-0.5">{t.description}</div>
                    </button>
                  ))}
                </div>
              </div>

              {editTier === 'custom' && (
                <div>
                  <label className="block font-semibold text-slate-300 mb-1">
                    Custom Blanket Discount (%)
                  </label>
                  <input
                    type="number"
                    min="0"
                    max="50"
                    step="0.5"
                    value={editCustomPct}
                    onChange={e => setEditCustomPct(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono"
                  />
                </div>
              )}

              {/* Per-SKU Fixed Contract Rates */}
              <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="font-semibold text-slate-200">
                  SKU-Specific Contract Rates (Optional)
                </div>
                {(() => {
                  const selectedSkuProd = products.find(p => p.id === skuPickId);
                  const showBundleRateInput =
                    !selectedSkuProd || hasConfiguredBundleTier(selectedSkuProd);
                  const showPieceRateInput =
                    !selectedSkuProd || hasConfiguredPieceTier(selectedSkuProd);
                  const gridColsClass =
                    showBundleRateInput && showPieceRateInput
                      ? 'sm:grid-cols-4'
                      : 'sm:grid-cols-3';

                  return (
                    <div className={`grid grid-cols-1 ${gridColsClass} gap-2`}>
                      <select
                        value={skuPickId}
                        onChange={e => {
                          const pid = e.target.value;
                          setSkuPickId(pid);
                          const prod = products.find(p => p.id === pid);
                          if (prod) {
                            setSkuBundleRate(
                              hasConfiguredBundleTier(prod) ? String(prod.bundlePrice) : ''
                            );
                            setSkuPieceRate(
                              hasConfiguredPieceTier(prod) ? String(prod.piecePrice) : ''
                            );
                          }
                        }}
                        className="sm:col-span-2 px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white"
                      >
                        {products.map(p => (
                          <option key={p.id} value={p.id}>
                            {p.name}
                          </option>
                        ))}
                      </select>
                      {showBundleRateInput && (
                        <input
                          type="number"
                          min="1"
                          value={skuBundleRate}
                          onChange={e => setSkuBundleRate(e.target.value)}
                          placeholder={`${selectedSkuProd?.bundleUnitName || 'Bundle'} ₹`}
                          className="px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                          title={`Custom ${selectedSkuProd?.bundleUnitName || 'Bundle'} Price`}
                        />
                      )}
                      <div className="flex gap-1.5">
                        {showPieceRateInput && (
                          <input
                            type="number"
                            min="1"
                            value={skuPieceRate}
                            onChange={e => setSkuPieceRate(e.target.value)}
                            placeholder="Pc ₹"
                            className="w-full px-2.5 py-2 bg-slate-900 border border-slate-700 rounded-lg text-white font-mono"
                            title="Custom Piece Price"
                          />
                        )}
                        <button
                          type="button"
                          onClick={handleAddSkuOverride}
                          className={`px-3 py-2 rounded-lg bg-blue-600 text-white font-bold ${
                            !showPieceRateInput ? 'w-full' : ''
                          }`}
                        >
                          Add
                        </button>
                      </div>
                    </div>
                  );
                })()}

                {Object.keys(editSkuRates).length > 0 && (
                  <div className="divide-y divide-slate-800 pt-1">
                    {Object.entries(editSkuRates).map(([pid, rate]) => {
                      const prod = products.find(p => p.id === pid);
                      return (
                        <div key={pid} className="py-1.5 flex items-center justify-between">
                          <span className="text-slate-200 font-medium">
                            {prod?.name || pid}
                          </span>
                          <div className="flex items-center gap-3">
                            <span className="font-mono text-emerald-300">
                              {rate.bundlePrice !== undefined
                                ? `Bundle ${formatCurrency(rate.bundlePrice)}`
                                : ''}{' '}
                              {rate.piecePrice !== undefined
                                ? `Pc ${formatCurrency(rate.piecePrice)}`
                                : ''}
                            </span>
                            <button
                              type="button"
                              onClick={() =>
                                setEditSkuRates(prev => {
                                  const next = { ...prev };
                                  delete next[pid];
                                  return next;
                                })
                              }
                              className="text-slate-500 hover:text-rose-400"
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

              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPricingModalCustomerId(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold"
                >
                  Save Customer Pricing
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= ADJUST LOYALTY POINTS MODAL ================= */}
      {adjustCustomer && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm bg-slate-900 border border-slate-700 rounded-2xl p-5 text-slate-100 shadow-2xl">
            <div className="flex items-center justify-between pb-3 border-b border-slate-800">
              <h3 className="font-bold text-sm text-white">
                Adjust Points: {adjustCustomer.name}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustModalCustomerId(null)}
                className="text-slate-400 hover:text-white"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form
              onSubmit={e => {
                e.preventDefault();
                const delta = parseInt(adjustPointsInput, 10);
                if (!delta) return;
                soundManager.playCheckoutSuccess();
                onAdjustLoyaltyPoints(
                  adjustCustomer.id,
                  delta,
                  adjustNoteInput.trim() || 'Manual points adjustment'
                );
                setAdjustModalCustomerId(null);
                showToast(`Updated points for ${adjustCustomer.name}`);
              }}
              className="mt-4 space-y-3 text-xs"
            >
              <div className="text-slate-400">
                Current Balance:{' '}
                <span className="font-bold text-amber-300">
                  {adjustCustomer.loyaltyPoints || 0} pts
                </span>
              </div>
              <div>
                <label className="block font-semibold text-slate-300 mb-1">
                  Points Delta (positive to add, negative to deduct)
                </label>
                <input
                  type="number"
                  required
                  value={adjustPointsInput}
                  onChange={e => setAdjustPointsInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white font-mono text-base font-bold"
                />
              </div>
              <div>
                <label className="block font-semibold text-slate-300 mb-1">Reason / Note</label>
                <input
                  type="text"
                  value={adjustNoteInput}
                  onChange={e => setAdjustNoteInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-700 rounded-xl text-white"
                />
              </div>
              <div className="pt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setAdjustModalCustomerId(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-800 text-slate-300 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="flex-1 py-2 rounded-xl bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold"
                >
                  Apply Points
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
