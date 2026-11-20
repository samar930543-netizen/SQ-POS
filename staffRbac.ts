import {
  Bill,
  RolePermissionMatrix,
  StaffActivityDomain,
  StaffActivityLog,
  StaffMember,
  StaffPermission,
  StaffRole,
} from '../types';

export const ALL_STAFF_ROLES: StaffRole[] = [
  'Store Owner / Admin',
  'Counter Cashier',
  'Godown Manager',
  'Delivery Driver',
  'Sales Executive',
  'Helper',
];

export interface StaffPermissionDefinition {
  key: StaffPermission;
  label: string;
  shortLabel: string;
  description: string;
  group: 'modules' | 'actions';
}

export const STAFF_PERMISSION_DEFINITIONS: StaffPermissionDefinition[] = [
  {
    key: 'billing',
    label: 'POS Billing & Checkout',
    shortLabel: 'Billing',
    description: 'Create bills, edit cart prices, and apply loyalty points.',
    group: 'modules',
  },
  {
    key: 'khata',
    label: 'Khata & Credit Ledger',
    shortLabel: 'Khata',
    description: 'View Udhar balances, record cash settlements, and adjust credit limits.',
    group: 'modules',
  },
  {
    key: 'inventory',
    label: 'Stock & Inventory',
    shortLabel: 'Inventory',
    description: 'Add/edit SKUs and restock incoming shipments.',
    group: 'modules',
  },
  {
    key: 'categories',
    label: 'Category Management',
    shortLabel: 'Categories',
    description: 'Create, rename, and remove unused product categories.',
    group: 'modules',
  },
  {
    key: 'suppliers',
    label: 'Suppliers & Purchase Orders',
    shortLabel: 'Suppliers',
    description: 'Create vendor purchase orders and receive deliveries.',
    group: 'modules',
  },
  {
    key: 'cashflow',
    label: 'Cash Flow & Expenses',
    shortLabel: 'Cash Flow',
    description: 'View drawer cashflow, record expenses, and supplier payouts.',
    group: 'modules',
  },
  {
    key: 'reports',
    label: 'Sales Analytics & Reports',
    shortLabel: 'Analytics',
    description: 'Access profit/revenue reports, demand spikes, and exports.',
    group: 'modules',
  },
  {
    key: 'staff_loyalty',
    label: 'Team, Attendance & Loyalty',
    shortLabel: 'Team',
    description: 'View staff attendance, order tracking, activity logs, and loyalty tiers.',
    group: 'modules',
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp Orders & Automation',
    shortLabel: 'WhatsApp',
    description: 'Review inbound WhatsApp orders, inquiries, and stock auto-sync.',
    group: 'modules',
  },
  {
    key: 'store_profile',
    label: 'Store Profile & Settings',
    shortLabel: 'Store Config',
    description: 'Modify store branding, GSTIN, and module visibility.',
    group: 'modules',
  },
  {
    key: 'delete_records',
    label: 'Delete SKUs / Vendors / Cash Entries',
    shortLabel: 'Delete Records',
    description: 'Permanently delete products, categories, suppliers, or cash entries.',
    group: 'actions',
  },
  {
    key: 'manage_rbac',
    label: 'Manage Staff & Role Permissions',
    shortLabel: 'Manage RBAC',
    description: 'Add/remove staff, change PINs, and edit role access rules.',
    group: 'actions',
  },
];

export const DEFAULT_ROLE_PERMISSIONS: RolePermissionMatrix = {
  'Store Owner / Admin': {
    billing: true,
    khata: true,
    inventory: true,
    categories: true,
    suppliers: true,
    cashflow: true,
    reports: true,
    staff_loyalty: true,
    whatsapp: true,
    store_profile: true,
    delete_records: true,
    manage_rbac: true,
  },
  'Counter Cashier': {
    billing: true,
    khata: true,
    inventory: true,
    categories: false,
    suppliers: false,
    cashflow: false,
    reports: false,
    staff_loyalty: false,
    whatsapp: true,
    store_profile: false,
    delete_records: false,
    manage_rbac: false,
  },
  'Godown Manager': {
    billing: true,
    khata: false,
    inventory: true,
    categories: true,
    suppliers: true,
    cashflow: false,
    reports: false,
    staff_loyalty: false,
    whatsapp: true,
    store_profile: false,
    delete_records: false,
    manage_rbac: false,
  },
  'Delivery Driver': {
    billing: true,
    khata: true,
    inventory: false,
    categories: false,
    suppliers: false,
    cashflow: false,
    reports: false,
    staff_loyalty: false,
    whatsapp: false,
    store_profile: false,
    delete_records: false,
    manage_rbac: false,
  },
  'Sales Executive': {
    billing: true,
    khata: true,
    inventory: true,
    categories: false,
    suppliers: false,
    cashflow: false,
    reports: true,
    staff_loyalty: false,
    whatsapp: true,
    store_profile: false,
    delete_records: false,
    manage_rbac: false,
  },
  Helper: {
    billing: false,
    khata: false,
    inventory: true,
    categories: false,
    suppliers: false,
    cashflow: false,
    reports: false,
    staff_loyalty: false,
    whatsapp: false,
    store_profile: false,
    delete_records: false,
    manage_rbac: false,
  },
};

export function normalizeRolePermissionMatrix(
  partial?: Partial<Record<StaffRole, Partial<Record<StaffPermission, boolean>>>>
): RolePermissionMatrix {
  const next = {} as RolePermissionMatrix;
  for (const role of ALL_STAFF_ROLES) {
    const defaults = DEFAULT_ROLE_PERMISSIONS[role];
    const saved = partial?.[role] || {};
    next[role] = {
      ...defaults,
      ...saved,
    };
  }
  // Ensure Store Owner / Admin cannot lock themselves out of RBAC or Team views
  next['Store Owner / Admin'].manage_rbac = true;
  next['Store Owner / Admin'].staff_loyalty = true;
  next['Store Owner / Admin'].store_profile = true;
  return next;
}

export function getEffectiveStaffPermissions(
  staff: StaffMember | null | undefined,
  matrix: RolePermissionMatrix
): Record<StaffPermission, boolean> {
  if (!staff) {
    return { ...DEFAULT_ROLE_PERMISSIONS['Store Owner / Admin'] };
  }
  const roleBase = matrix[staff.role] || DEFAULT_ROLE_PERMISSIONS[staff.role];
  const merged = {
    ...roleBase,
    ...(staff.customPermissions || {}),
  };
  if (staff.role === 'Store Owner / Admin') {
    merged.manage_rbac = true;
    merged.staff_loyalty = true;
    merged.store_profile = true;
  }
  return merged;
}

export function canStaffPerform(
  staff: StaffMember | null | undefined,
  matrix: RolePermissionMatrix,
  permission: StaffPermission
): boolean {
  return Boolean(getEffectiveStaffPermissions(staff, matrix)[permission]);
}

export function countGrantedPermissions(perms: Record<StaffPermission, boolean>): number {
  return STAFF_PERMISSION_DEFINITIONS.filter(def => perms[def.key]).length;
}

export interface StaffOrderMetric {
  staffId: string;
  staffName: string;
  staffRole: StaffRole | 'Unassigned';
  ordersCount: number;
  grossSales: number;
  cashCollected: number;
  udharIssued: number;
  avgOrderValue: number;
  lastOrderAt?: string;
}

export function computeStaffOrderMetrics(
  staffMembers: StaffMember[],
  bills: Bill[]
): {
  perStaff: StaffOrderMetric[];
  attributedBillsCount: number;
  unassignedBillsCount: number;
} {
  const metricMap = new Map<string, StaffOrderMetric>();

  for (const member of staffMembers) {
    metricMap.set(member.id, {
      staffId: member.id,
      staffName: member.name,
      staffRole: member.role,
      ordersCount: 0,
      grossSales: 0,
      cashCollected: 0,
      udharIssued: 0,
      avgOrderValue: 0,
    });
  }

  let attributedBillsCount = 0;
  let unassignedBillsCount = 0;

  for (const bill of bills) {
    const key = bill.staffId || '__unassigned__';
    if (bill.staffId) {
      attributedBillsCount += 1;
    } else {
      unassignedBillsCount += 1;
    }

    const existing = metricMap.get(key) || {
      staffId: key,
      staffName: bill.staffName || 'Unassigned / Legacy Bills',
      staffRole: bill.staffRole || 'Unassigned',
      ordersCount: 0,
      grossSales: 0,
      cashCollected: 0,
      udharIssued: 0,
      avgOrderValue: 0,
    };

    const billSale = bill.itemsTotal + (bill.totalGstAmount || 0);
    const newUdhar = Math.max(0, bill.remainingBalance - bill.previousBalance);

    existing.ordersCount += 1;
    existing.grossSales += billSale;
    existing.cashCollected += bill.amountReceived;
    existing.udharIssued += newUdhar;
    if (!existing.lastOrderAt || bill.timestamp > existing.lastOrderAt) {
      existing.lastOrderAt = bill.timestamp;
    }

    metricMap.set(key, existing);
  }

  const perStaff = Array.from(metricMap.values())
    .map(m => ({
      ...m,
      avgOrderValue: m.ordersCount > 0 ? m.grossSales / m.ordersCount : 0,
    }))
    .sort((a, b) => b.grossSales - a.grossSales || b.ordersCount - a.ordersCount);

  return {
    perStaff,
    attributedBillsCount,
    unassignedBillsCount,
  };
}

export function getActivityDomainLabel(domain: StaffActivityDomain): string {
  switch (domain) {
    case 'sales':
      return 'Sales';
    case 'inventory':
      return 'Inventory';
    case 'team_rbac':
      return 'Team & RBAC';
  }
}

export function buildActivityLogsCsv(logs: StaffActivityLog[]): string {
  const headers = [
    'Timestamp',
    'Domain',
    'Action',
    'Staff Name',
    'Role',
    'Target',
    'Amount (INR)',
    'Qty Delta (pcs)',
    'Details',
  ];
  const esc = (val: string | number | undefined) =>
    `"${String(val ?? '').replace(/"/g, '""')}"`;

  const rows = logs.map(log => [
    log.timestamp,
    getActivityDomainLabel(log.domain),
    log.action,
    esc(log.staffName),
    esc(log.staffRole),
    esc(log.targetLabel),
    log.amount !== undefined ? log.amount.toFixed(2) : '',
    log.quantityDelta !== undefined ? log.quantityDelta : '',
    esc(log.details),
  ]);

  return [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
}
