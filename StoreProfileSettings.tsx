import React, { useState, useRef, useEffect } from 'react';
import {
  ExternalApiConfig,
  HeaderIconKey,
  HeaderIconVisibility,
  ManageableTabKey,
  PaperWidthType,
  PerformanceSettings,
  PosUiElementKey,
  PosUiVisibility,
  ReceiptSettings,
  ServerSyncStatus,
  StoreModuleVisibility,
  StoreProfile,
  StoreBranch,
  MultiBranchSyncConfig,
  BranchStockTransfer,
  Product,
  AppLockSettings,
  ViewportLayoutPreference,
  WhatsAppAutomationConfig,
} from '../types';
import { ReceiptCustomizer } from './ReceiptCustomizer';
import { SettingsAccordion } from './SettingsAccordion';
import { PerformanceManagerPanel } from './PerformanceManagerPanel';
import { SettingsInstallCard } from './SettingsInstallCard';
import { PrinterConnectionsPanel } from './PrinterConnectionsPanel';
import { MultiStoreManagerPanel } from './MultiStoreManagerPanel';
import { AppLockSettingsPanel } from './AppLockSettingsPanel';
import { RECEIPT_PRESET_META, resolveReceiptDesign } from '../utils/receiptPresets';
import {
  getEnabledHardwarePrinters,
  getRemainingPaperMeters,
  isThermalPaperLow,
} from '../utils/printerManager';
import {
  DEFAULT_ENABLED_MODULES,
  DEFAULT_EXTERNAL_API_CONFIG,
  DEFAULT_HEADER_ICON_VISIBILITY,
  DEFAULT_PERFORMANCE_SETTINGS,
  DEFAULT_POS_UI_VISIBILITY,
  DEFAULT_STORE_PROFILE,
  DEFAULT_WHATSAPP_CONFIG,
} from '../utils/storage';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  Building2,
  Phone,
  Mail,
  MapPin,
  Upload,
  Trash2,
  Check,
  RotateCcw,
  Image as ImageIcon,
  Store,
  Eye,
  FileText,
  AlertCircle,
  SlidersHorizontal,
  Layers,
  Truck,
  Wallet,
  Award,
  BarChart3,
  Package,
  LayoutGrid,
  UserCheck,
  AlertTriangle,
  Tags,
  MessageSquare,
  Copy,
  Globe,
  RefreshCw,
  ShieldCheck,
  Code2,
  Smartphone,
  Tablet,
  Monitor,
  Sparkles,
  Palette,
  Printer,
  Zap,
  BellRing,
  Percent,
  ReceiptText,
  Share2,
  Send,
  ChevronsDownUp,
  ChevronsUpDown,
  Gauge,
  Vibrate,
  GitBranch,
  Lock,
  Bell,
  Wifi,
  Volume2,
  Download,
  AudioWaveform,
  Mic,
  Camera,
  ShoppingCart,
  PanelTopClose,
} from 'lucide-react';

interface StoreProfileSettingsProps {
  profile: StoreProfile;
  onSaveProfile: (profile: StoreProfile) => void;
  onUpdateEnabledModules?: (modules: StoreModuleVisibility) => void;
  onUpdatePosUiVisibility?: (visibility: PosUiVisibility) => void;
  onUpdateHeaderIconVisibility?: (visibility: HeaderIconVisibility) => void;
  onToggleHeaderBranding?: (show: boolean) => void;
  onUpdateWhatsappConfig?: (config: WhatsAppAutomationConfig) => void;
  onUpdateExternalApiConfig?: (config: ExternalApiConfig) => void;
  onUpdatePerformanceSettings?: (settings: PerformanceSettings) => void;
  onOpenWhatsappInbox?: () => void;
  onOpenReceiptSettings?: () => void;
  onOpenApkGuide?: () => void;
  receiptSettings?: ReceiptSettings;
  onSaveReceiptSettings?: (settings: ReceiptSettings) => void;
  hasServerWhatsappToken?: boolean;
  serverStatus?: ServerSyncStatus;
  isSyncingServer?: boolean;
  onPushFullSnapshot?: () => Promise<unknown>;
  onPullServerSnapshot?: () => Promise<unknown>;
  localCounts?: {
    products: number;
    customers: number;
    orders: number;
  };
  branches?: StoreBranch[];
  multiBranchConfig?: MultiBranchSyncConfig;
  branchTransfers?: BranchStockTransfer[];
  products?: Product[];
  isSyncingBranches?: boolean;
  onToggleMultiBranchSync?: (enabled: boolean) => void | Promise<void>;
  onUpdateMultiBranchConfig?: (nextConfig: MultiBranchSyncConfig) => void | Promise<void>;
  onSwitchBranch?: (branchId: string) => void | Promise<void>;
  onSaveBranch?: (
    input: {
      id?: string;
      code: string;
      name: string;
      city?: string;
      address?: string;
      phone?: string;
      managerName?: string;
    },
    options?: {
      copyCatalog?: boolean;
      initialStockMode?: 'zero' | 'copy';
      copyCustomers?: boolean;
    }
  ) => Promise<{ ok: boolean; error?: string }>;
  onDeleteBranch?: (branchId: string) => Promise<{ ok: boolean; error?: string }>;
  onSyncAllBranches?: () => Promise<{ ok: boolean; error?: string; syncDisabled?: boolean }>;
  onTransferBranchStock?: (params: {
    fromBranchId: string;
    toBranchId: string;
    productId: string;
    productName: string;
    pieces: number;
    note?: string;
  }) => Promise<{ ok: boolean; error?: string; syncDisabled?: boolean }>;
  appLockSettings?: AppLockSettings;
  onUpdateAppLockSettings?: (next: AppLockSettings) => void;
  onLockAppNow?: () => void;
}

type SettingsGroupKey =
  | 'store_profile'
  | 'app_lock'
  | 'multi_store'
  | 'receipt_customization'
  | 'printer_settings'
  | 'workspace_layout'
  | 'automation'
  | 'performance_manager'
  | 'external_api';

const HEADER_MODULES: Array<{
  key: ManageableTabKey;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'billing',
    label: 'Billing',
    description: 'POS catalog, cart & invoice checkout',
    icon: <Store className="w-4 h-4 text-blue-400" />,
  },
  {
    key: 'khata',
    label: 'Khata (Udhar)',
    description: 'Customer ledger, dues & repayments',
    icon: <Layers className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'inventory',
    label: 'Stock',
    description: 'Inventory counts & reorder alerts',
    icon: <Package className="w-4 h-4 text-amber-400" />,
  },
  {
    key: 'suppliers',
    label: 'Suppliers',
    description: 'Distributors & purchase orders',
    icon: <Truck className="w-4 h-4 text-indigo-400" />,
  },
  {
    key: 'cashflow',
    label: 'Cash Flow',
    description: 'Opening float, expenses & drawer',
    icon: <Wallet className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'reports',
    label: 'Analytics',
    description: 'Daily reports & demand forecast',
    icon: <BarChart3 className="w-4 h-4 text-purple-400" />,
  },
  {
    key: 'staff_loyalty',
    label: 'Team & Rewards',
    description: 'Staff shifts, tiers & loyalty points',
    icon: <Award className="w-4 h-4 text-amber-300" />,
  },
  {
    key: 'whatsapp',
    label: 'WhatsApp',
    description: 'Automated customer orders & inquiries',
    icon: <MessageSquare className="w-4 h-4 text-emerald-400" />,
  },
];

const POS_UI_ELEMENTS: Array<{
  key: PosUiElementKey;
  label: string;
  description: string;
  icon: React.ReactNode;
}> = [
  {
    key: 'walkInCustomerSelector',
    label: 'Walk-in Customer Dropdown',
    description: 'Billing screen customer & rate tier selector button',
    icon: <UserCheck className="w-4 h-4 text-blue-400" />,
  },
  {
    key: 'lowStockAlertBanner',
    label: 'Low Stock Warnings (Alerts Center)',
    description: 'Collect low stock reorder alerts inside Notification Center',
    icon: <AlertTriangle className="w-4 h-4 text-amber-400" />,
  },
  {
    key: 'categoryFilterTabs',
    label: 'Category Filter Tabs',
    description: 'Horizontal category filter row in catalog views',
    icon: <Tags className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'catalogDisplayBar',
    label: 'Catalog Display Bar',
    description: 'View-mode switcher bar (Grid, Compact Grid, List, Scan) & Add Item CTA',
    icon: <LayoutGrid className="w-4 h-4 text-sky-400" />,
  },
];

const HEADER_ICON_CONTROLS: Array<{
  key: HeaderIconKey;
  label: string;
  description: string;
  group: 'Status' | 'Control';
  icon: React.ReactNode;
}> = [
  {
    key: 'appLock',
    label: 'Lock Terminal',
    description: 'Quick-lock POS button when App Lock security is active',
    group: 'Control',
    icon: <Lock className="w-4 h-4 text-amber-400" />,
  },
  {
    key: 'multiStore',
    label: 'Branch Switcher',
    description: 'Active branch code, branch count & multi-store sync badge',
    group: 'Status',
    icon: <GitBranch className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'operatorSwitcher',
    label: 'Operator Switcher',
    description: 'Active cashier / staff name and role switcher trigger',
    group: 'Status',
    icon: <UserCheck className="w-4 h-4 text-blue-400" />,
  },
  {
    key: 'notifications',
    label: 'Alerts & Bell',
    description: 'Notification Center trigger and unread alert counter',
    group: 'Status',
    icon: <Bell className="w-4 h-4 text-amber-400" />,
  },
  {
    key: 'offlineSync',
    label: 'Online / Sync Status',
    description: 'Network connectivity state, sync spinner & queued count',
    group: 'Status',
    icon: <Wifi className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'sound',
    label: 'Audio Feedback',
    description: 'Cycle POS scanner beep, click feedback, or mute',
    group: 'Control',
    icon: <Volume2 className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'haptics',
    label: 'Haptic Vibration',
    description: 'Quick toggle for tactile mobile vibration feedback',
    group: 'Control',
    icon: <Vibrate className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'pwaInstall',
    label: 'Install App CTA',
    description: 'Quick install button shown when browser PWA prompt is ready',
    group: 'Control',
    icon: <Download className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'liveVoice',
    label: 'Live Voice Assistant',
    description: 'Real-time voice conversation trigger in top header',
    group: 'Control',
    icon: <AudioWaveform className="w-4 h-4 text-emerald-400" />,
  },
  {
    key: 'audioTranscribe',
    label: 'Audio List Transcribe',
    description: 'Upload or record voice notes to build item lists',
    group: 'Control',
    icon: <Mic className="w-4 h-4 text-sky-400" />,
  },
  {
    key: 'scanBill',
    label: 'Scan Bill OCR',
    description: 'Camera / handwritten bill scanner shortcut',
    group: 'Control',
    icon: <Camera className="w-4 h-4 text-purple-400" />,
  },
  {
    key: 'receiptSettings',
    label: 'Receipt & Printer',
    description: 'Shortcut to thermal layout and paper width settings',
    group: 'Control',
    icon: <SlidersHorizontal className="w-4 h-4 text-blue-400" />,
  },
  {
    key: 'apkGuide',
    label: 'Get .APK Guide',
    description: 'Desktop / tablet shortcut for Android APK packaging guide',
    group: 'Control',
    icon: <Smartphone className="w-4 h-4 text-blue-400" />,
  },
  {
    key: 'cart',
    label: 'Cart & Live Total',
    description: 'Shopping cart button with running amount and item badge',
    group: 'Status',
    icon: <ShoppingCart className="w-4 h-4 text-blue-400" />,
  },
  {
    key: 'navDrawerToggle',
    label: 'Nav Bar Collapse',
    description: 'Show/hide the header tab bar collapse button (keeps bar pinned open when hidden)',
    group: 'Control',
    icon: <PanelTopClose className="w-4 h-4 text-slate-300" />,
  },
];

const MINIMAL_HEADER_ICON_PRESET: HeaderIconVisibility = {
  appLock: true,
  multiStore: false,
  operatorSwitcher: false,
  notifications: true,
  offlineSync: true,
  sound: false,
  haptics: false,
  pwaInstall: false,
  liveVoice: false,
  audioTranscribe: false,
  scanBill: true,
  receiptSettings: false,
  apkGuide: false,
  cart: true,
  navDrawerToggle: true,
};

interface CompressOptions {
  maxWidth: number;
  maxHeight: number;
  preserveTransparency?: boolean;
  jpegQuality?: number;
}

function estimateDataUrlKb(dataUrl?: string): number {
  if (!dataUrl) return 0;
  const base64Part = dataUrl.split(',')[1] || '';
  return Math.max(1, Math.round((base64Part.length * 0.75) / 1024));
}

async function compressImageFile(
  file: File,
  options: CompressOptions
): Promise<string> {
  if (!file.type.startsWith('image/')) {
    throw new Error('Please choose a valid image file (PNG, JPG, or WEBP).');
  }

  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Could not read the selected image file.'));
    reader.readAsDataURL(file);
  });

  const img = await new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Selected file could not be decoded as an image.'));
    image.src = dataUrl;
  });

  const scale = Math.min(
    1,
    options.maxWidth / Math.max(1, img.width),
    options.maxHeight / Math.max(1, img.height)
  );
  const targetWidth = Math.max(1, Math.round(img.width * scale));
  const targetHeight = Math.max(1, Math.round(img.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = targetWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    throw new Error('Browser canvas is unavailable for image resizing.');
  }

  ctx.clearRect(0, 0, targetWidth, targetHeight);
  ctx.drawImage(img, 0, 0, targetWidth, targetHeight);

  const supportsTransparency =
    options.preserveTransparency &&
    (file.type === 'image/png' || file.type === 'image/webp' || file.type === 'image/svg+xml');

  if (supportsTransparency) {
    const pngUrl = canvas.toDataURL('image/png');
    if (pngUrl.length <= 260_000) {
      return pngUrl;
    }
  }

  // Fill white backing before JPEG conversion so transparent PNGs don't turn black
  const jpegCanvas = document.createElement('canvas');
  jpegCanvas.width = targetWidth;
  jpegCanvas.height = targetHeight;
  const jCtx = jpegCanvas.getContext('2d');
  if (!jCtx) {
    return canvas.toDataURL('image/jpeg', options.jpegQuality ?? 0.82);
  }
  jCtx.fillStyle = '#ffffff';
  jCtx.fillRect(0, 0, targetWidth, targetHeight);
  jCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
  return jpegCanvas.toDataURL('image/jpeg', options.jpegQuality ?? 0.82);
}

export const StoreProfileSettings: React.FC<StoreProfileSettingsProps> = ({
  profile,
  onSaveProfile,
  onUpdateEnabledModules,
  onUpdatePosUiVisibility,
  onUpdateHeaderIconVisibility,
  onToggleHeaderBranding,
  onUpdateWhatsappConfig,
  onUpdateExternalApiConfig,
  onUpdatePerformanceSettings,
  onOpenWhatsappInbox,
  onOpenReceiptSettings,
  onOpenApkGuide,
  receiptSettings,
  onSaveReceiptSettings,
  hasServerWhatsappToken = false,
  serverStatus,
  isSyncingServer = false,
  onPushFullSnapshot,
  onPullServerSnapshot,
  localCounts,
  branches = [],
  multiBranchConfig,
  branchTransfers = [],
  products = [],
  isSyncingBranches = false,
  onToggleMultiBranchSync,
  onUpdateMultiBranchConfig,
  onSwitchBranch,
  onSaveBranch,
  onDeleteBranch,
  onSyncAllBranches,
  onTransferBranchStock,
  appLockSettings,
  onUpdateAppLockSettings,
  onLockAppNow,
}) => {
  const {
    layoutPref,
    autoLayout,
    resolvedLayout,
    windowWidth,
    isMobileLayout,
    isDesktopLayout,
    setLayoutPref,
  } = useViewportLayout();
  const [form, setForm] = useState<StoreProfile>(profile);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [savedToast, setSavedToast] = useState(false);
  const [copiedWebhook, setCopiedWebhook] = useState(false);
  const [copiedEndpointKey, setCopiedEndpointKey] = useState<string | null>(null);
  const [processingTarget, setProcessingTarget] = useState<'logo' | 'facade' | null>(null);
  const [renderInvoicePreviewOnce, setRenderInvoicePreviewOnce] = useState(false);
  const [hapticsEnabled, setHapticsEnabled] = useState<boolean>(soundManager.isHapticsEnabled());
  const hapticsSupported = soundManager.isHapticsSupported();

  // All configuration groups are collapsed by default until clicked by the user
  const [openGroups, setOpenGroups] = useState<Partial<Record<SettingsGroupKey, boolean>>>({});

  const logoInputRef = useRef<HTMLInputElement>(null);
  const facadeInputRef = useRef<HTMLInputElement>(null);
  const prevProfileSnapshotRef = useRef<string>('');

  useEffect(() => {
    return soundManager.subscribeHapticsChange(setHapticsEnabled);
  }, []);

  const stripModuleMeta = (p: StoreProfile) => ({
    storeName: p.storeName,
    tagline: p.tagline || '',
    contactNumber: p.contactNumber,
    email: p.email,
    address: p.address,
    gstin: p.gstin || '',
    logoDataUrl: p.logoDataUrl || '',
    facadePhotoDataUrl: p.facadePhotoDataUrl || '',
    showLogoOnInvoices: p.showLogoOnInvoices,
    showFacadeOnInvoices: p.showFacadeOnInvoices,
    showBrandingInHeader: p.showBrandingInHeader !== false,
  });

  useEffect(() => {
    const nextSnap = JSON.stringify(stripModuleMeta(profile));
    if (prevProfileSnapshotRef.current !== nextSnap) {
      prevProfileSnapshotRef.current = nextSnap;
      setForm(profile);
    }
  }, [profile]);

  const toggleGroup = (key: SettingsGroupKey) => {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));
  };

  const hasMultiStoreProps = Boolean(
    multiBranchConfig &&
      onToggleMultiBranchSync &&
      onUpdateMultiBranchConfig &&
      onSwitchBranch &&
      onSaveBranch &&
      onDeleteBranch &&
      onSyncAllBranches &&
      onTransferBranchStock
  );

  const hasAppLockProps = Boolean(appLockSettings && onUpdateAppLockSettings && onLockAppNow);

  const allGroupKeys: SettingsGroupKey[] = [
    'store_profile',
    ...(hasAppLockProps ? (['app_lock'] as SettingsGroupKey[]) : []),
    ...(hasMultiStoreProps ? (['multi_store'] as SettingsGroupKey[]) : []),
    ...(receiptSettings && onSaveReceiptSettings
      ? (['receipt_customization', 'printer_settings'] as SettingsGroupKey[])
      : []),
    'workspace_layout',
    'automation',
    'performance_manager',
    'external_api',
  ];
  const anyGroupExpanded = allGroupKeys.some(k => Boolean(openGroups[k]));

  const handleToggleAllGroups = () => {
    soundManager.playMechanicalClick();
    const nextVal = !anyGroupExpanded;
    const nextMap: Partial<Record<SettingsGroupKey, boolean>> = {};
    for (const k of allGroupKeys) {
      nextMap[k] = nextVal;
    }
    setOpenGroups(nextMap);
  };

  const updateReceiptField = (patch: Partial<ReceiptSettings>) => {
    if (!receiptSettings || !onSaveReceiptSettings) return;
    onSaveReceiptSettings({
      ...receiptSettings,
      ...patch,
    });
  };

  const enabledModules: StoreModuleVisibility = {
    ...DEFAULT_ENABLED_MODULES,
    ...(profile.enabledModules || {}),
  };

  const posUiVisibility: PosUiVisibility = {
    ...DEFAULT_POS_UI_VISIBILITY,
    ...(profile.posUiVisibility || {}),
  };

  const headerIconVisibility: HeaderIconVisibility = {
    ...DEFAULT_HEADER_ICON_VISIBILITY,
    ...(profile.headerIconVisibility || {}),
  };

  const whatsappConfig: WhatsAppAutomationConfig = {
    ...DEFAULT_WHATSAPP_CONFIG,
    ...(profile.whatsappConfig || {}),
  };

  const externalApiConfig: ExternalApiConfig = {
    ...DEFAULT_EXTERNAL_API_CONFIG,
    ...(profile.externalApiConfig || {}),
  };

  const performanceSettings: PerformanceSettings = {
    ...DEFAULT_PERFORMANCE_SETTINGS,
    ...(profile.performanceSettings || {}),
  };

  const handleUpdatePerformanceSettings = (nextPerf: PerformanceSettings) => {
    setForm(prev => ({ ...prev, performanceSettings: nextPerf }));
    if (onUpdatePerformanceSettings) {
      onUpdatePerformanceSettings(nextPerf);
    } else {
      onSaveProfile({
        ...profile,
        performanceSettings: nextPerf,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleToggleExternalApi = () => {
    const nextConfig: ExternalApiConfig = {
      enabled: !externalApiConfig.enabled,
    };
    setForm(prev => ({ ...prev, externalApiConfig: nextConfig }));
    if (onUpdateExternalApiConfig) {
      onUpdateExternalApiConfig(nextConfig);
    } else {
      onSaveProfile({
        ...profile,
        externalApiConfig: nextConfig,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const showBrandingInHeader = form.showBrandingInHeader !== false;

  const handleToggleHeaderBranding = () => {
    soundManager.playMechanicalClick();
    const nextShow = !showBrandingInHeader;
    setForm(prev => ({ ...prev, showBrandingInHeader: nextShow }));
    if (onToggleHeaderBranding) {
      onToggleHeaderBranding(nextShow);
    } else {
      onSaveProfile({
        ...profile,
        showBrandingInHeader: nextShow,
        enabledModules,
        posUiVisibility,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const visibleModuleCount = HEADER_MODULES.filter(m => enabledModules[m.key] !== false).length;
  const visiblePosUiCount = POS_UI_ELEMENTS.filter(el => posUiVisibility[el.key] !== false).length;
  const visibleHeaderIconCount = HEADER_ICON_CONTROLS.filter(
    iconItem => headerIconVisibility[iconItem.key] !== false
  ).length;

  const isDirty =
    JSON.stringify(stripModuleMeta(form)) !== JSON.stringify(stripModuleMeta(profile));

  const handleToggleHeaderModule = (key: ManageableTabKey) => {
    soundManager.playMechanicalClick();
    const nextModules: StoreModuleVisibility = {
      ...enabledModules,
      [key]: !(enabledModules[key] !== false),
    };
    setForm(prev => ({ ...prev, enabledModules: nextModules }));
    if (onUpdateEnabledModules) {
      onUpdateEnabledModules(nextModules);
    } else {
      onSaveProfile({
        ...profile,
        enabledModules: nextModules,
        posUiVisibility,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleShowAllModules = () => {
    soundManager.playCheckoutSuccess();
    const nextModules: StoreModuleVisibility = { ...DEFAULT_ENABLED_MODULES };
    setForm(prev => ({ ...prev, enabledModules: nextModules }));
    if (onUpdateEnabledModules) {
      onUpdateEnabledModules(nextModules);
    } else {
      onSaveProfile({
        ...profile,
        enabledModules: nextModules,
        posUiVisibility,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleTogglePosUiElement = (key: PosUiElementKey) => {
    soundManager.playMechanicalClick();
    const nextVisibility: PosUiVisibility = {
      ...posUiVisibility,
      [key]: !(posUiVisibility[key] !== false),
    };
    setForm(prev => ({ ...prev, posUiVisibility: nextVisibility }));
    if (onUpdatePosUiVisibility) {
      onUpdatePosUiVisibility(nextVisibility);
    } else {
      onSaveProfile({
        ...profile,
        enabledModules,
        posUiVisibility: nextVisibility,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleShowAllPosUiElements = () => {
    soundManager.playCheckoutSuccess();
    const nextVisibility: PosUiVisibility = { ...DEFAULT_POS_UI_VISIBILITY };
    setForm(prev => ({ ...prev, posUiVisibility: nextVisibility }));
    if (onUpdatePosUiVisibility) {
      onUpdatePosUiVisibility(nextVisibility);
    } else {
      onSaveProfile({
        ...profile,
        enabledModules,
        posUiVisibility: nextVisibility,
        headerIconVisibility,
        whatsappConfig,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const applyHeaderIconVisibility = (nextVisibility: HeaderIconVisibility) => {
    setForm(prev => ({ ...prev, headerIconVisibility: nextVisibility }));
    if (onUpdateHeaderIconVisibility) {
      onUpdateHeaderIconVisibility(nextVisibility);
    } else {
      onSaveProfile({
        ...profile,
        enabledModules,
        posUiVisibility,
        headerIconVisibility: nextVisibility,
        whatsappConfig,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const handleToggleHeaderIcon = (key: HeaderIconKey) => {
    soundManager.playMechanicalClick();
    const nextVisibility: HeaderIconVisibility = {
      ...headerIconVisibility,
      [key]: !(headerIconVisibility[key] !== false),
    };
    applyHeaderIconVisibility(nextVisibility);
  };

  const handleShowAllHeaderIcons = () => {
    soundManager.playCheckoutSuccess();
    applyHeaderIconVisibility({ ...DEFAULT_HEADER_ICON_VISIBILITY });
  };

  const handleApplyMinimalHeaderIcons = () => {
    soundManager.playMechanicalClick();
    applyHeaderIconVisibility({ ...MINIMAL_HEADER_ICON_PRESET });
  };

  const updateWhatsappField = (updates: Partial<WhatsAppAutomationConfig>) => {
    const nextConfig: WhatsAppAutomationConfig = {
      ...whatsappConfig,
      ...updates,
    };
    setForm(prev => ({ ...prev, whatsappConfig: nextConfig }));
    if (onUpdateWhatsappConfig) {
      onUpdateWhatsappConfig(nextConfig);
    } else {
      onSaveProfile({
        ...profile,
        enabledModules,
        posUiVisibility,
        whatsappConfig: nextConfig,
        updatedAt: new Date().toISOString(),
      });
    }
  };

  const webhookEndpointUrl =
    typeof window !== 'undefined'
      ? `${window.location.origin}/api/whatsapp/webhook`
      : '/api/whatsapp/webhook';

  const storeInitials =
    (form.storeName || 'SQ')
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase() || '')
      .join('') || 'SQ';

  const handleFieldChange = <K extends keyof StoreProfile>(
    key: K,
    value: StoreProfile[K]
  ) => {
    setErrorMsg(null);
    setSavedToast(false);
    setForm(prev => ({ ...prev, [key]: value }));
  };

  const handleUploadLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setProcessingTarget('logo');
    try {
      const compressed = await compressImageFile(file, {
        maxWidth: 360,
        maxHeight: 360,
        preserveTransparency: true,
        jpegQuality: 0.88,
      });
      soundManager.playScannerBeep();
      setForm(prev => ({
        ...prev,
        logoDataUrl: compressed,
        showLogoOnInvoices: true,
      }));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process store logo.');
    } finally {
      setProcessingTarget(null);
    }
  };

  const handleUploadFacade = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setErrorMsg(null);
    setProcessingTarget('facade');
    try {
      const compressed = await compressImageFile(file, {
        maxWidth: 900,
        maxHeight: 480,
        preserveTransparency: false,
        jpegQuality: 0.82,
      });
      soundManager.playScannerBeep();
      setForm(prev => ({
        ...prev,
        facadePhotoDataUrl: compressed,
        showFacadeOnInvoices: true,
      }));
    } catch (err: any) {
      setErrorMsg(err?.message || 'Failed to process store facade photo.');
    } finally {
      setProcessingTarget(null);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const trimmedName = form.storeName.trim();
    if (!trimmedName) {
      setErrorMsg('Store Name is required and appears on all invoices and receipts.');
      return;
    }

    const updatedProfile: StoreProfile = {
      ...form,
      storeName: trimmedName,
      tagline: form.tagline?.trim() || '',
      contactNumber: form.contactNumber.trim(),
      email: form.email.trim(),
      address: form.address.trim(),
      gstin: form.gstin?.trim().toUpperCase() || '',
      enabledModules,
      posUiVisibility,
      headerIconVisibility,
      whatsappConfig,
      externalApiConfig,
      performanceSettings,
      updatedAt: new Date().toISOString(),
    };

    soundManager.playCheckoutSuccess();
    onSaveProfile(updatedProfile);
    setForm(updatedProfile);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  const handleResetBranding = () => {
    soundManager.playMechanicalClick();
    const resetProfile: StoreProfile = {
      ...DEFAULT_STORE_PROFILE,
      logoDataUrl: undefined,
      facadePhotoDataUrl: undefined,
      enabledModules,
      posUiVisibility,
      headerIconVisibility,
      performanceSettings,
      updatedAt: new Date().toISOString(),
    };
    setForm(resetProfile);
    onSaveProfile(resetProfile);
    setErrorMsg(null);
    setSavedToast(true);
    setTimeout(() => setSavedToast(false), 3000);
  };

  const logoSizeKb = estimateDataUrlKb(form.logoDataUrl);
  const facadeSizeKb = estimateDataUrlKb(form.facadePhotoDataUrl);

  // Accordion Summaries
  const storeSummary = `${form.storeName.trim() || 'SQ ENTERPRISES'} · ${
    form.contactNumber?.trim() || 'No phone'
  } · ${form.logoDataUrl ? 'Custom logo' : 'Default badge'}${isDirty ? ' · Unsaved changes' : ''}`;

  const activeCustomPreset = receiptSettings?.activeCustomPresetId
    ? (receiptSettings.savedCustomPresets || []).find(
        p => p.id === receiptSettings.activeCustomPresetId
      )
    : undefined;
  const activePresetMeta = receiptSettings
    ? RECEIPT_PRESET_META.find(p => p.id === receiptSettings.template)
    : undefined;
  const resolvedPreviewDesign = receiptSettings ? resolveReceiptDesign(receiptSettings) : undefined;
  const receiptExtras = resolvedPreviewDesign
    ? [
        resolvedPreviewDesign.showBarcode ? 'Barcode' : '',
        resolvedPreviewDesign.showQrCode ? 'QR' : '',
        resolvedPreviewDesign.watermarkEnabled ? 'Watermark' : '',
      ].filter(Boolean)
    : [];
  const receiptCustomizationSummary = receiptSettings
    ? `${
        activeCustomPreset
          ? `${activeCustomPreset.name} (Custom)`
          : activePresetMeta?.label || receiptSettings.template
      } · ${receiptSettings.paperWidth}${
        receiptExtras.length > 0 ? ` · ${receiptExtras.join(' + ')}` : ''
      } · ${receiptSettings.savedCustomPresets?.length || 0} custom saved`
    : '';

  const enabledPrinters = receiptSettings
    ? getEnabledHardwarePrinters(receiptSettings.printers)
    : [];
  const printerShortMap = {
    bluetooth: 'BT',
    usb: 'USB',
    network_ip: 'IP',
    wifi: 'WiFi',
  } as const;
  const printerChannelsLabel =
    enabledPrinters.length > 0
      ? `${enabledPrinters.length}/4 Printers On (${enabledPrinters.map(t => printerShortMap[t]).join(', ')})`
      : 'Browser Print';

  const resolvedPrintersCfg = receiptSettings?.printers;
  const rollMetrics = getRemainingPaperMeters(resolvedPrintersCfg);
  const isRollLow = isThermalPaperLow(resolvedPrintersCfg);
  const rollPct = Math.round(rollMetrics.remainingPct);
  const autoCutSummary =
    resolvedPrintersCfg?.autoCutPaper !== false
      ? resolvedPrintersCfg?.autoCutMode === 'full'
        ? 'Full Cut'
        : 'Partial Cut'
      : 'Cut Off';

  const printerSettingsSummary = receiptSettings
    ? `${receiptSettings.paperWidth} Roll · ${printerChannelsLabel} · ${autoCutSummary} · ${
        isRollLow
          ? `Low Paper (${rollMetrics.remainingMeters.toFixed(1)}m / ${rollMetrics.totalMeters}m · ${rollPct}%)`
          : `${rollMetrics.remainingMeters.toFixed(1)}m / ${rollMetrics.totalMeters}m (${rollPct}%)`
      } · ${
        receiptSettings.enableGst
          ? `GST ${receiptSettings.gstRate || 18}% (${receiptSettings.gstNumber || 'No GSTIN'})`
          : 'Non-GST Mode'
      }`
    : '';

  const workspaceSummary = `${resolvedLayout.charAt(0).toUpperCase() + resolvedLayout.slice(1)} (${
    layoutPref === 'auto' ? `Auto · ${windowWidth}px` : 'Manual'
  }) · ${visibleModuleCount}/${HEADER_MODULES.length} tabs · ${visibleHeaderIconCount}/${
    HEADER_ICON_CONTROLS.length
  } icons · Branding ${showBrandingInHeader ? 'On' : 'Off'}`;

  const automationSummary = `WhatsApp Bot ${whatsappConfig.enabled ? 'On' : 'Off'} · Auto-Receipt ${
    receiptSettings?.autoSendWhatsApp ? 'On' : 'Off'
  } · Udhar Alerts ${
    (receiptSettings?.autoUdharWhatsApp ?? true) || (receiptSettings?.autoUdharSMS ?? true)
      ? 'On'
      : 'Off'
  }`;

  const activePerfCount = [
    performanceSettings.enablePredictiveAnalytics,
    performanceSettings.enableAutoCloudSync,
    performanceSettings.enableLiveReceiptRendering,
  ].filter(Boolean).length;

  const performanceSummary = `${activePerfCount}/3 active · Predictive ${
    performanceSettings.enablePredictiveAnalytics ? 'On' : 'Paused'
  } · Auto-Sync ${
    performanceSettings.enableAutoCloudSync ? 'On' : 'Paused'
  } · Live Receipt ${
    performanceSettings.enableLiveReceiptRendering ? 'On' : 'Paused'
  }`;

  const externalApiSummary = `${externalApiConfig.enabled ? 'Enabled' : 'Disabled'} · ${
    serverStatus?.totalSyncedProducts ?? 0
  } SKUs · ${serverStatus?.totalSyncedBills ?? 0} Orders · rev #${serverStatus?.revision ?? 0}`;

  const activeBranchObj =
    branches.find(b => b.id === multiBranchConfig?.activeBranchId) || branches[0];
  const multiStoreSummary = multiBranchConfig
    ? `${branches.length} Branch${branches.length === 1 ? '' : 'es'} · Active: ${
        activeBranchObj?.code || 'HQ-01'
      } · Sync ${multiBranchConfig.enabled ? 'ON' : 'OFF (Standalone)'}`
    : '';

  const appLockSummary = appLockSettings
    ? appLockSettings.enabled
      ? `Enabled · ${
          appLockSettings.biometricEnabled && appLockSettings.biometricCredentials.length > 0
            ? 'Biometric + 4-Digit PIN'
            : '4-Digit Master PIN'
        } · ${appLockSettings.requireOnLaunch ? 'Lock on Launch' : 'Manual Lock'}`
      : 'Disabled · Open Access'
    : '';

  return (
    <div className="h-full overflow-y-auto bg-slate-950 text-slate-100 p-3 sm:p-5">
      <div className="w-full max-w-none m-0 space-y-3.5 pb-10">
        {/* Top Page Title Bar */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-900 border border-slate-800 rounded-2xl p-4 sm:p-5">
          <div className="flex items-start sm:items-center gap-3">
            <div className="w-11 h-11 rounded-xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center text-blue-400 flex-shrink-0">
              <Building2 className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-white tracking-wide">
                Store Settings &amp; Configuration
              </h2>
              <p className="text-xs text-slate-400">
                Select any configuration group below to expand and customize its settings.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={handleToggleAllGroups}
              className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-200 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap"
            >
              {anyGroupExpanded ? (
                <>
                  <ChevronsDownUp className="w-3.5 h-3.5 text-slate-400" />
                  <span>Collapse All</span>
                </>
              ) : (
                <>
                  <ChevronsUpDown className="w-3.5 h-3.5 text-slate-400" />
                  <span>Expand All</span>
                </>
              )}
            </button>
            {onOpenReceiptSettings && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onOpenReceiptSettings();
                }}
                className="px-3 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap"
              >
                <SlidersHorizontal className="w-3.5 h-3.5 text-blue-400" />
                Quick Printer Modal
              </button>
            )}
            <button
              type="button"
              onClick={handleResetBranding}
              className="px-3 py-2 rounded-xl bg-slate-950 hover:bg-slate-800 text-slate-300 border border-slate-700 text-xs font-semibold flex items-center gap-1.5 transition whitespace-nowrap"
              title="Restore default store profile and clear uploaded branding"
            >
              <RotateCcw className="w-3.5 h-3.5 text-slate-400" />
              Reset Branding
            </button>
          </div>
        </div>

        {/* Non-PWA Install App Call-to-Action */}
        <SettingsInstallCard onOpenApkGuide={onOpenApkGuide} />

        {/* Inline Status / Error Feedback */}
        {errorMsg && (
          <div className="p-3.5 rounded-xl bg-rose-950/70 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center gap-2">
            <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0" />
            <span>{errorMsg}</span>
          </div>
        )}

        {savedToast && (
          <div className="p-3.5 rounded-xl bg-emerald-950/70 border border-emerald-500/40 text-emerald-200 text-xs font-bold flex items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              Store profile saved! Updated branding is now active across the header, receipts, and WhatsApp bills.
            </span>
          </div>
        )}

        {/* ===================================================================== */}
        {/* GROUP 1: STORE PROFILE & BRANDING */}
        {/* ===================================================================== */}
        <SettingsAccordion
          id="settings-store-profile"
          title="Store Profile & Branding"
          summary={storeSummary}
          description="Business identity, contact details, GSTIN, logo & storefront facade photo"
          icon={<Store className="w-4 h-4 text-blue-400" />}
          isOpen={Boolean(openGroups.store_profile)}
          onToggle={() => toggleGroup('store_profile')}
        >
          <div className={`grid ${isDesktopLayout ? 'grid-cols-12' : 'grid-cols-1'} gap-5 items-start`}>
            {/* Left Column: Form & Asset Uploaders */}
            <form onSubmit={handleSubmit} className={`${isDesktopLayout ? 'col-span-7' : ''} space-y-5`}>
              {/* Business Details */}
              <div className="space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <Store className="w-4 h-4 text-blue-400" />
                    Business Identity &amp; Contact Info
                  </h4>
                  {isDirty && (
                    <span className="text-[11px] font-bold text-amber-400">
                      Unsaved changes
                    </span>
                  )}
                </div>

                <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'} gap-3.5`}>
                  <div className={`${isMobileLayout ? '' : 'col-span-2'} space-y-1.5`}>
                    <label className="block text-xs font-bold text-slate-300">
                      Store / Business Name <span className="text-rose-400">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={80}
                      value={form.storeName}
                      onChange={e => handleFieldChange('storeName', e.target.value)}
                      placeholder="e.g. SQ ENTERPRISES"
                      className="w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-sm font-bold text-white focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className={`${isMobileLayout ? '' : 'col-span-2'} space-y-1.5`}>
                    <label className="block text-xs font-bold text-slate-300">
                      Store Tagline / Distribution Subtitle
                    </label>
                    <input
                      type="text"
                      maxLength={90}
                      value={form.tagline || ''}
                      onChange={e => handleFieldChange('tagline', e.target.value)}
                      placeholder="e.g. Wholesale FMCG & Bulk Distribution"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <Phone className="w-3.5 h-3.5 text-emerald-400" />
                      Contact Number
                    </label>
                    <input
                      type="tel"
                      maxLength={24}
                      value={form.contactNumber}
                      onChange={e => handleFieldChange('contactNumber', e.target.value)}
                      placeholder="+91 98110 44210"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 font-mono focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <Mail className="w-3.5 h-3.5 text-sky-400" />
                      Email Address
                    </label>
                    <input
                      type="email"
                      maxLength={80}
                      value={form.email}
                      onChange={e => handleFieldChange('email', e.target.value)}
                      placeholder="billing@sqenterprises.in"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>

                  <div className={`${isMobileLayout ? '' : 'col-span-2'} space-y-1.5`}>
                    <label className="text-xs font-bold text-slate-300 flex items-center gap-1.5">
                      <MapPin className="w-3.5 h-3.5 text-amber-400" />
                      Store / Godown Address
                    </label>
                    <textarea
                      rows={2}
                      maxLength={200}
                      value={form.address}
                      onChange={e => handleFieldChange('address', e.target.value)}
                      placeholder="Shop / Plot No., Market, City, PIN Code"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-slate-100 focus:outline-none focus:border-blue-500 resize-none"
                    />
                  </div>

                  <div className={`${isMobileLayout ? '' : 'col-span-2'} space-y-1.5`}>
                    <label className="block text-xs font-bold text-slate-300">
                      Store GSTIN (Synced with GST Tax Invoices)
                    </label>
                    <input
                      type="text"
                      maxLength={20}
                      value={form.gstin || ''}
                      onChange={e => handleFieldChange('gstin', e.target.value.toUpperCase())}
                      placeholder="07AABCS1429B1Z1"
                      className="w-full px-3.5 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs font-mono uppercase text-slate-100 focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
              </div>

              {/* Visual Assets Upload Section */}
              <div className="pt-4 border-t border-slate-800 space-y-4">
                <div className="flex items-center justify-between">
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <ImageIcon className="w-4 h-4 text-purple-400" />
                    Store Logo &amp; Facade Photo
                  </h4>
                  <span className="text-[11px] text-slate-400 tabular-nums">
                    Auto-compressed for offline storage
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {/* Store Logo Uploader */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Store Logo</span>
                        {form.logoDataUrl && (
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                            {logoSizeKb} KB
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Square PNG or JPG badge shown in the top POS bar and invoice headers (max 360&times;360px).
                      </p>

                      <div className="h-28 rounded-xl border border-dashed border-slate-700 bg-slate-900/70 flex items-center justify-center overflow-hidden">
                        {form.logoDataUrl ? (
                          <img
                            src={form.logoDataUrl}
                            alt="Store logo preview"
                            className="max-h-24 max-w-full object-contain p-1.5"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1.5 text-slate-500">
                            <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white font-black text-sm">
                              {storeInitials}
                            </div>
                            <span className="text-[10px]">Default Initials Badge</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <input
                        ref={logoInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        onChange={handleUploadLogo}
                        className="hidden"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={processingTarget === 'logo'}
                          onClick={() => logoInputRef.current?.click()}
                          className="flex-1 py-2 px-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {processingTarget === 'logo'
                            ? 'Compressing...'
                            : form.logoDataUrl
                            ? 'Replace Logo'
                            : 'Upload Logo'}
                        </button>
                        {form.logoDataUrl && (
                          <button
                            type="button"
                            onClick={() => handleFieldChange('logoDataUrl', undefined)}
                            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 transition"
                            title="Remove store logo"
                            aria-label="Remove store logo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <label className="flex items-center justify-between gap-2 text-[11px] text-slate-300 pt-1 border-t border-slate-800/80 cursor-pointer">
                        <span>Print logo on invoices</span>
                        <input
                          type="checkbox"
                          checked={form.showLogoOnInvoices}
                          onChange={e =>
                            handleFieldChange('showLogoOnInvoices', e.target.checked)
                          }
                          className="w-4 h-4 accent-blue-500 rounded"
                        />
                      </label>
                    </div>
                  </div>

                  {/* Store Facade Photo Uploader */}
                  <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col justify-between gap-3">
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-bold text-white">Store Facade Photo</span>
                        {form.facadePhotoDataUrl && (
                          <span className="text-[10px] font-mono text-slate-400 tabular-nums">
                            {facadeSizeKb} KB
                          </span>
                        )}
                      </div>
                      <p className="text-[11px] text-slate-400 leading-snug">
                        Wide storefront banner shown on Detailed Invoices &amp; Store Profile cards (max 900&times;480px).
                      </p>

                      <div className="h-28 rounded-xl border border-dashed border-slate-700 bg-slate-900/70 flex items-center justify-center overflow-hidden">
                        {form.facadePhotoDataUrl ? (
                          <img
                            src={form.facadePhotoDataUrl}
                            alt="Store facade preview"
                            className="w-full h-full object-cover"
                          />
                        ) : (
                          <div className="flex flex-col items-center gap-1 text-slate-500 px-3 text-center">
                            <Building2 className="w-7 h-7 text-slate-600" />
                            <span className="text-[10px]">No facade photo uploaded</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="space-y-2.5">
                      <input
                        ref={facadeInputRef}
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        onChange={handleUploadFacade}
                        className="hidden"
                      />
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          disabled={processingTarget === 'facade'}
                          onClick={() => facadeInputRef.current?.click()}
                          className="flex-1 py-2 px-3 rounded-xl bg-indigo-600 hover:bg-indigo-500 disabled:opacity-60 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
                        >
                          <Upload className="w-3.5 h-3.5" />
                          {processingTarget === 'facade'
                            ? 'Compressing...'
                            : form.facadePhotoDataUrl
                            ? 'Replace Photo'
                            : 'Upload Facade'}
                        </button>
                        {form.facadePhotoDataUrl && (
                          <button
                            type="button"
                            onClick={() =>
                              handleFieldChange('facadePhotoDataUrl', undefined)
                            }
                            className="p-2 rounded-xl bg-slate-800 hover:bg-rose-950 text-slate-300 hover:text-rose-300 border border-slate-700 transition"
                            title="Remove facade photo"
                            aria-label="Remove facade photo"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        )}
                      </div>

                      <label className="flex items-center justify-between gap-2 text-[11px] text-slate-300 pt-1 border-t border-slate-800/80 cursor-pointer">
                        <span>Show facade on Detailed Invoices</span>
                        <input
                          type="checkbox"
                          checked={form.showFacadeOnInvoices}
                          onChange={e =>
                            handleFieldChange('showFacadeOnInvoices', e.target.checked)
                          }
                          className="w-4 h-4 accent-indigo-500 rounded"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              </div>

              {/* Primary Save Bar */}
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-slate-950 border border-slate-800 rounded-xl p-3.5">
                <div className="text-xs text-slate-400">
                  Last saved:{' '}
                  <span className="text-slate-200 font-semibold">
                    {profile.updatedAt
                      ? new Date(profile.updatedAt).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })
                      : 'Default'}
                  </span>
                </div>

                <button
                  type="submit"
                  className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs sm:text-sm font-black shadow-lg shadow-emerald-950/50 flex items-center justify-center gap-2 transition active:scale-95"
                >
                  <Check className="w-4 h-4" />
                  Save Store Profile
                </button>
              </div>
            </form>

            {/* Right Column: Live Branding & Invoice Preview */}
            <div className={`${isDesktopLayout ? 'col-span-5 sticky top-4' : ''} space-y-4`}>
              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                  <Eye className="w-4 h-4 text-blue-400" />
                  Live POS Header Preview
                </span>

                <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 flex items-center gap-3">
                  {form.logoDataUrl ? (
                    <img
                      src={form.logoDataUrl}
                      alt="Header logo"
                      className="w-10 h-10 rounded-xl object-contain bg-white p-0.5 flex-shrink-0"
                    />
                  ) : (
                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white font-black text-sm flex-shrink-0">
                      {storeInitials}
                    </div>
                  )}
                  <div className="min-w-0">
                    <div className="font-black text-sm text-white tracking-wider truncate">
                      {form.storeName.trim() || 'SQ ENTERPRISES'}
                    </div>
                    <div className="text-[11px] text-slate-400 truncate">
                      {form.tagline?.trim() || 'Wholesale FMCG • GST / Non-GST'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="p-3.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2.5">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-black uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                    <FileText className="w-4 h-4 text-emerald-400" />
                    Live Invoice Branding Preview
                  </span>
                  {performanceSettings.enableLiveReceiptRendering || renderInvoicePreviewOnce ? (
                    <div className="flex items-center gap-2">
                      {!performanceSettings.enableLiveReceiptRendering && (
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playMechanicalClick();
                            setRenderInvoicePreviewOnce(false);
                          }}
                          className="text-[10px] font-bold text-amber-300 underline"
                        >
                          Pause
                        </button>
                      )}
                      <span className="text-[10px] text-slate-400">80mm Invoice</span>
                    </div>
                  ) : (
                    <span className="text-[10px] font-bold text-amber-400">Paused</span>
                  )}
                </div>

                {!performanceSettings.enableLiveReceiptRendering && !renderInvoicePreviewOnce ? (
                  <div className="p-3.5 rounded-xl bg-slate-900 border border-slate-800 space-y-2.5 text-xs">
                    <p className="text-[11px] text-slate-400 leading-snug">
                      Live invoice DOM rendering is paused in Performance Manager. Store profile details are still applied directly to printed bills.
                    </p>
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setRenderInvoicePreviewOnce(true);
                      }}
                      className="w-full py-2 px-3 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-white flex items-center justify-center gap-1.5 transition"
                    >
                      <Eye className="w-3.5 h-3.5 text-emerald-400" />
                      Render Invoice Preview
                    </button>
                  </div>
                ) : (
                <div className="bg-white text-black rounded-xl p-3.5 font-mono text-[10px] leading-tight shadow-inner border border-slate-300 space-y-2">
                  {form.facadePhotoDataUrl && form.showFacadeOnInvoices && (
                    <div className="w-full h-24 rounded-lg overflow-hidden border border-gray-300">
                      <img
                        src={form.facadePhotoDataUrl}
                        alt="Storefront banner on invoice"
                        className="w-full h-full object-cover"
                      />
                    </div>
                  )}

                  <div className="text-center pb-2 border-b-2 border-black space-y-1">
                    {form.logoDataUrl && form.showLogoOnInvoices && (
                      <div className="flex justify-center pb-0.5">
                        <img
                          src={form.logoDataUrl}
                          alt="Invoice logo"
                          className="h-11 max-w-[140px] object-contain"
                        />
                      </div>
                    )}
                    <div className="text-sm font-black uppercase tracking-wider">
                      {form.storeName.trim() || 'SQ ENTERPRISES'}
                    </div>
                    {form.tagline?.trim() && (
                      <div className="text-[9px] font-bold text-gray-800">
                        {form.tagline.trim()}
                      </div>
                    )}
                    {form.address.trim() && (
                      <div className="text-[8.5px] text-gray-700 leading-snug">
                        {form.address.trim()}
                      </div>
                    )}
                    {(form.contactNumber.trim() || form.email.trim()) && (
                      <div className="text-[8.5px] font-semibold text-gray-800">
                        {[
                          form.contactNumber.trim()
                            ? `Ph: ${form.contactNumber.trim()}`
                            : '',
                          form.email.trim() || '',
                        ]
                          .filter(Boolean)
                          .join(' | ')}
                      </div>
                    )}
                    {form.gstin?.trim() && (
                      <div className="text-[8px] font-bold text-gray-700 uppercase">
                        GSTIN: {form.gstin.trim()}
                      </div>
                    )}
                  </div>

                  <div className="flex justify-between text-[9px] border-b border-dashed border-gray-400 pb-1">
                    <span>
                      Bill: <strong>#SQ-882104</strong>
                    </span>
                    <span>12 Nov 2026, 02:15 PM</span>
                  </div>

                  <div className="space-y-1 border-b border-dashed border-gray-400 pb-1.5 text-[9px]">
                    <div className="flex justify-between font-semibold">
                      <span>Gold Flake King (2 Bndl)</span>
                      <span className="tabular-nums font-bold">₹8,700</span>
                    </div>
                    <div className="flex justify-between font-semibold">
                      <span>Dettol Soap 75g (6 Pcs)</span>
                      <span className="tabular-nums font-bold">₹252</span>
                    </div>
                  </div>

                  <div className="flex justify-between font-black text-[11px] tabular-nums">
                    <span>GRAND TOTAL:</span>
                    <span>₹8,952.00</span>
                  </div>

                  <div className="text-center pt-1.5 border-t border-black text-[8.5px] font-bold text-gray-700">
                    *** THANK YOU • {form.storeName.trim() || 'SQ ENTERPRISES'} ***
                  </div>
                </div>
                )}
              </div>
            </div>
          </div>
        </SettingsAccordion>

        {/* ===================================================================== */}
        {/* GROUP 2: RECEIPT CUSTOMIZATION */}
        {/* ===================================================================== */}
        {receiptSettings && onSaveReceiptSettings && (
          <SettingsAccordion
            id="settings-receipt-customization"
            title="Receipt Customization"
            summary={receiptCustomizationSummary}
            description="Presets, saved custom designs, header field toggles, fonts, alignment & item formatting"
            icon={<Palette className="w-4 h-4 text-cyan-400" />}
            isOpen={Boolean(openGroups.receipt_customization)}
            onToggle={() => toggleGroup('receipt_customization')}
          >
            <ReceiptCustomizer
              embedded
              enableLiveReceiptRendering={performanceSettings.enableLiveReceiptRendering}
              printers={receiptSettings.printers}
              settings={receiptSettings}
              storeProfile={{ ...profile, ...form }}
              onSaveSettings={onSaveReceiptSettings}
            />
          </SettingsAccordion>
        )}

        {/* ===================================================================== */}
        {/* GROUP 3: PRINTER & TAX SETTINGS */}
        {/* ===================================================================== */}
        {receiptSettings && onSaveReceiptSettings && (
          <SettingsAccordion
            id="settings-printer-tax"
            title="Printer & Tax Settings"
            summary={printerSettingsSummary}
            description="Bluetooth, USB, Network IP & WiFi printer switches, thermal paper width (58mm / 80mm), GST Tax Invoice & footer"
            icon={<Printer className="w-4 h-4 text-emerald-400" />}
            isOpen={Boolean(openGroups.printer_settings)}
            onToggle={() => toggleGroup('printer_settings')}
          >
            <div className="space-y-4">
              <PrinterConnectionsPanel
                printers={receiptSettings.printers}
                paperWidth={receiptSettings.paperWidth}
                storeProfile={{ ...profile, ...form }}
                onChange={nextPrinters => updateReceiptField({ printers: nextPrinters })}
              />

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-emerald-400" />
                    Thermal Paper Roll Width
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Select your connected thermal printer roll size (applied across all bills).
                  </p>
                  <div className="grid grid-cols-2 gap-2 pt-0.5">
                    {(['58mm', '80mm'] as PaperWidthType[]).map(w => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          updateReceiptField({ paperWidth: w });
                        }}
                        className={`py-2 px-3 rounded-lg border text-xs font-bold transition ${
                          receiptSettings.paperWidth === w
                            ? 'bg-emerald-600/25 border-emerald-500 text-white'
                            : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                        }`}
                      >
                        {w} Roll {w === '58mm' ? '(2 inch)' : '(3 inch)'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="p-3.5 rounded-xl bg-slate-950/80 border border-slate-800 space-y-2">
                  <label className="font-bold text-slate-200 text-xs block">
                    Default Receipt Thank-You Message
                  </label>
                  <p className="text-[11px] text-slate-400">
                    Fallback footer note when a custom receipt design leaves the footer blank.
                  </p>
                  <input
                    type="text"
                    value={receiptSettings.thankYouMessage || ''}
                    onChange={e => updateReceiptField({ thankYouMessage: e.target.value })}
                    placeholder="Thank you for your business!"
                    className="w-full px-3 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500"
                  />
                </div>
              </div>

              {/* Global GST Calculation */}
              <div className="p-3.5 bg-slate-950/80 rounded-xl border border-slate-800 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800/80 pb-2">
                  <label className="font-bold text-slate-200 text-xs flex items-center gap-1.5">
                    <ReceiptText className="w-4 h-4 text-emerald-400" />
                    Global GST Calculation &amp; Tax Invoice Setting
                  </label>
                  <span className="text-[11px] font-semibold text-slate-300">
                    {receiptSettings.enableGst ? 'GST Mode Active' : 'Non-GST Wholesale Mode'}
                  </span>
                </div>

                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="font-bold text-white text-xs">
                      Enable GST Calculation on Bills
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-relaxed">
                      Dynamically calculate CGST + SGST on bills and print Tax Invoices, or toggle off for pure Non-GST wholesale bills.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(receiptSettings.enableGst)}
                    aria-label="Enable GST calculation on bills"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateReceiptField({ enableGst: !receiptSettings.enableGst });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                      receiptSettings.enableGst ? 'bg-emerald-600' : 'bg-slate-700'
                    }`}
                  >
                    <span
                      aria-hidden="true"
                      className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                        receiptSettings.enableGst ? 'translate-x-5' : 'translate-x-0'
                      }`}
                    />
                  </button>
                </div>

                {receiptSettings.enableGst && (
                  <div className="pt-2.5 border-t border-slate-800/80 grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-300 flex items-center gap-1">
                        <Percent className="w-3.5 h-3.5 text-blue-400" /> Default GST Rate Percentage
                      </label>
                      <div className="grid grid-cols-4 gap-1.5">
                        {[5, 12, 18, 28].map(rate => (
                          <button
                            key={rate}
                            type="button"
                            onClick={() => {
                              soundManager.playMechanicalClick();
                              updateReceiptField({ gstRate: rate });
                            }}
                            className={`py-1.5 px-2 rounded-lg text-center font-bold text-xs transition border tabular-nums ${
                              (receiptSettings.gstRate || 18) === rate
                                ? 'bg-blue-600 text-white border-blue-500 shadow-sm'
                                : 'bg-slate-900 text-slate-300 border-slate-800 hover:border-slate-700'
                            }`}
                          >
                            {rate}%
                          </button>
                        ))}
                      </div>
                      <div className="text-[10px] text-slate-400 pt-0.5 tabular-nums">
                        Split: {((receiptSettings.gstRate || 18) / 2).toFixed(1)}% CGST +{' '}
                        {((receiptSettings.gstRate || 18) / 2).toFixed(1)}% SGST
                      </div>
                    </div>

                    <div className="space-y-1.5">
                      <label className="text-[11px] font-bold text-slate-300">
                        Shop GSTIN / Tax Number (Printed on Bills)
                      </label>
                      <input
                        type="text"
                        value={receiptSettings.gstNumber || ''}
                        onChange={e =>
                          updateReceiptField({ gstNumber: e.target.value.toUpperCase() })
                        }
                        placeholder="e.g. 07AABCS1429B1Z1"
                        className="w-full px-3 py-1.5 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white font-mono uppercase focus:outline-none focus:border-blue-500"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          </SettingsAccordion>
        )}

        {/* ===================================================================== */}
        {/* GROUP 4: WORKSPACE LAYOUT, HEADER BRANDING & MODULES */}
        {/* ===================================================================== */}
        <SettingsAccordion
          id="settings-workspace-layout"
          title="Workspace Layout, Header & Modules"
          summary={workspaceSummary}
          description="Responsive layout mode (Auto / Mobile / Tablet / Desktop), header branding & module visibility"
          icon={<Monitor className="w-4 h-4 text-sky-400" />}
          isOpen={Boolean(openGroups.workspace_layout)}
          onToggle={() => toggleGroup('workspace_layout')}
        >
          <div className="space-y-5">
            {/* Viewport & Responsive Layout Mode */}
            <div className="space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-2.5">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <Monitor className="w-4 h-4 text-sky-400" />
                    Viewport &amp; Responsive Layout Mode
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Switch between automatic screen-width detection or lock a Mobile, Tablet, or Desktop workspace layout.
                  </p>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-auto">
                  <span className="text-[11px] font-semibold text-sky-300 tabular-nums">
                    Active: <span className="capitalize font-bold">{resolvedLayout}</span>
                    {layoutPref === 'auto' ? ` (Auto · ${windowWidth}px)` : ` (Manual)`}
                  </span>
                  {layoutPref !== 'auto' && (
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setLayoutPref('auto');
                      }}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold transition"
                    >
                      Reset to Auto
                    </button>
                  )}
                </div>
              </div>

              <div
                role="radiogroup"
                aria-label="Viewport layout mode"
                className={`grid ${
                  isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
                } gap-2.5`}
              >
                {(
                  [
                    {
                      id: 'auto' as ViewportLayoutPreference,
                      label: 'Auto (Responsive)',
                      subtitle: `Detected: ${autoLayout} (${windowWidth}px)`,
                      description: 'Adapts automatically on window resize',
                      Icon: Sparkles,
                    },
                    {
                      id: 'mobile' as ViewportLayoutPreference,
                      label: 'Mobile Layout',
                      subtitle: 'Compact density · 100% width',
                      description: 'Single-column cards & compact tab bar',
                      Icon: Smartphone,
                    },
                    {
                      id: 'tablet' as ViewportLayoutPreference,
                      label: 'Tablet Layout',
                      subtitle: 'Balanced density · 100% width',
                      description: 'Balanced 2-column grids & side drawer',
                      Icon: Tablet,
                    },
                    {
                      id: 'desktop' as ViewportLayoutPreference,
                      label: 'Desktop Layout',
                      subtitle: '≥ 1024px · Full width',
                      description: 'Multi-column catalog & split workspaces',
                      Icon: Monitor,
                    },
                  ] as const
                ).map(opt => {
                  const isSelected = layoutPref === opt.id;
                  const isAutoMatch =
                    opt.id !== 'auto' && layoutPref === 'auto' && resolvedLayout === opt.id;
                  const IconComp = opt.Icon;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={isSelected}
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        setLayoutPref(opt.id);
                      }}
                      className={`p-3 rounded-xl border text-left transition flex items-start justify-between gap-2.5 ${
                        isSelected
                          ? 'bg-blue-600/20 border-blue-500 text-white shadow-sm'
                          : isAutoMatch
                          ? 'bg-slate-950/90 border-sky-500/40 text-slate-100'
                          : 'bg-slate-950/80 border-slate-800 text-slate-300 hover:border-slate-700 hover:text-white'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div
                          className={`mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg border flex items-center justify-center ${
                            isSelected
                              ? 'bg-blue-600 border-blue-500 text-white'
                              : isAutoMatch
                              ? 'bg-sky-500/15 border-sky-500/30 text-sky-300'
                              : 'bg-slate-900 border-slate-800 text-slate-400'
                          }`}
                        >
                          <IconComp className="w-4 h-4" />
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold truncate">{opt.label}</div>
                          <div className="text-[10px] text-sky-300/90 font-semibold tabular-nums truncate">
                            {opt.subtitle}
                          </div>
                          <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                            {opt.description}
                          </div>
                        </div>
                      </div>
                      <span
                        className={`mt-0.5 w-4 h-4 rounded-full border flex items-center justify-center flex-shrink-0 ${
                          isSelected
                            ? 'bg-blue-500 border-blue-400 text-white'
                            : 'border-slate-600 bg-slate-900'
                        }`}
                      >
                        {isSelected && <Check className="w-2.5 h-2.5" />}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Module Management · Header Tabs & Branding */}
            <div className="pt-4 border-t border-slate-800 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <LayoutGrid className="w-4 h-4 text-blue-400" />
                    Module Management &middot; Header Tabs
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Toggle switches to show or hide navigation tabs and branding in the top POS bar.
                  </p>
                </div>

                <div className="flex items-center gap-2.5 self-start sm:self-auto">
                  <span className="text-[11px] font-semibold text-slate-300 tabular-nums">
                    {visibleModuleCount} of {HEADER_MODULES.length} tabs active
                  </span>
                  {visibleModuleCount < HEADER_MODULES.length && (
                    <button
                      type="button"
                      onClick={handleShowAllModules}
                      className="px-2.5 py-1 rounded-lg bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/40 text-[11px] font-bold transition"
                    >
                      Show All Tabs
                    </button>
                  )}
                </div>
              </div>

              {/* Top Header Store Name & Branding Toggle */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition ${
                  showBrandingInHeader
                    ? 'bg-slate-950/90 border-sky-500/40'
                    : 'bg-slate-950/40 border-slate-800/80'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                    <Store
                      className={`w-4 h-4 ${
                        showBrandingInHeader ? 'text-sky-400' : 'text-slate-500'
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span>Show Store Name &amp; Branding in Header</span>
                      <span className="text-[11px] font-semibold text-slate-400">
                        · {showBrandingInHeader ? 'Visible' : 'Hidden'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                      Toggle visibility of the store logo, store name, badge, and distribution tagline in the top header bar.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={showBrandingInHeader}
                  aria-label="Show or hide store name and branding in header"
                  onClick={handleToggleHeaderBranding}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                    showBrandingInHeader
                      ? 'bg-emerald-600 border-emerald-500'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      showBrandingInHeader ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>

              <div
                className={`grid ${
                  isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
                } gap-2.5`}
              >
                {HEADER_MODULES.map(mod => {
                  const isEnabled = enabledModules[mod.key] !== false;
                  return (
                    <div
                      key={mod.key}
                      className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition ${
                        isEnabled
                          ? 'bg-slate-950/90 border-slate-700/80'
                          : 'bg-slate-950/40 border-slate-800/70 opacity-75'
                      }`}
                    >
                      <div className="flex items-start gap-2.5 min-w-0">
                        <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                          {mod.icon}
                        </div>
                        <div className="min-w-0">
                          <div className="text-xs font-bold text-white truncate">
                            {mod.label}
                          </div>
                          <div className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                            {mod.description}
                          </div>
                        </div>
                      </div>

                      <button
                        type="button"
                        role="switch"
                        aria-checked={isEnabled}
                        aria-label={`Toggle ${mod.label} header tab`}
                        onClick={() => handleToggleHeaderModule(mod.key)}
                        className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                          isEnabled
                            ? 'bg-emerald-600 border-emerald-500'
                            : 'bg-slate-800 border-slate-700'
                        }`}
                      >
                        <span
                          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                            isEnabled ? 'translate-x-6' : 'translate-x-1'
                          }`}
                        />
                      </button>
                    </div>
                  );
                })}

                <div className="p-3 rounded-xl border bg-slate-950/60 border-slate-800 flex items-center justify-between gap-3">
                  <div className="flex items-start gap-2.5 min-w-0">
                    <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                      <Building2 className="w-4 h-4 text-sky-400" />
                    </div>
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-white truncate">
                        Store Profile
                      </div>
                      <div className="text-[10px] text-slate-400 leading-snug">
                        Always visible to manage store settings
                      </div>
                    </div>
                  </div>
                  <span className="text-[10px] font-bold uppercase tracking-wide text-sky-400 flex-shrink-0">
                    Always On
                  </span>
                </div>
              </div>

              {/* Header Icon Customizer */}
              <div
                id="header-icon-customizer"
                className="pt-4 border-t border-slate-800 space-y-3"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                      <Eye className="w-3.5 h-3.5 text-sky-400" />
                      Header Icon Customizer
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Toggle individual status indicators and quick-action buttons in the top POS header bar.
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 self-start sm:self-auto">
                    <span className="text-[11px] font-semibold text-slate-300 tabular-nums">
                      {visibleHeaderIconCount} of {HEADER_ICON_CONTROLS.length} icons visible
                    </span>
                    <button
                      type="button"
                      onClick={handleApplyMinimalHeaderIcons}
                      className="px-2.5 py-1 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold transition whitespace-nowrap shrink-0"
                    >
                      Minimal Bar
                    </button>
                    {visibleHeaderIconCount < HEADER_ICON_CONTROLS.length && (
                      <button
                        type="button"
                        onClick={handleShowAllHeaderIcons}
                        className="px-2.5 py-1 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 text-sky-300 border border-sky-500/40 text-[11px] font-bold transition whitespace-nowrap shrink-0"
                      >
                        Show All
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`grid ${
                    isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-3' : 'grid-cols-2'
                  } gap-2.5`}
                >
                  {HEADER_ICON_CONTROLS.map(item => {
                    const isVisible = headerIconVisibility[item.key] !== false;
                    return (
                      <div
                        key={item.key}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition ${
                          isVisible
                            ? 'bg-slate-950/90 border-slate-700/80'
                            : 'bg-slate-950/40 border-slate-800/70 opacity-75'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                            {item.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">
                              {item.label}
                              <span className="ml-1.5 text-[10px] font-semibold text-slate-400">
                                · {item.group}
                              </span>
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                              {item.description}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={isVisible}
                          aria-label={`Toggle ${item.label} header icon`}
                          onClick={() => handleToggleHeaderIcon(item.key)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                            isVisible
                              ? 'bg-emerald-600 border-emerald-500'
                              : 'bg-slate-800 border-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              isVisible ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Billing Screen UI Elements */}
              <div className="pt-3 border-t border-slate-800 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                  <div>
                    <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                      <SlidersHorizontal className="w-3.5 h-3.5 text-emerald-400" />
                      Billing Screen UI Elements
                    </h4>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Independently show or hide toolbar controls on the Billing screen.
                    </p>
                  </div>

                  <div className="flex items-center gap-2.5 self-start sm:self-auto">
                    <span className="text-[11px] font-semibold text-slate-300 tabular-nums">
                      {visiblePosUiCount} of {POS_UI_ELEMENTS.length} elements visible
                    </span>
                    {visiblePosUiCount < POS_UI_ELEMENTS.length && (
                      <button
                        type="button"
                        onClick={handleShowAllPosUiElements}
                        className="px-2.5 py-1 rounded-lg bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 text-[11px] font-bold transition"
                      >
                        Show All
                      </button>
                    )}
                  </div>
                </div>

                <div
                  className={`grid ${
                    isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
                  } gap-2.5`}
                >
                  {POS_UI_ELEMENTS.map(item => {
                    const isVisible = posUiVisibility[item.key] !== false;
                    return (
                      <div
                        key={item.key}
                        className={`p-3 rounded-xl border flex items-center justify-between gap-3 transition ${
                          isVisible
                            ? 'bg-slate-950/90 border-slate-700/80'
                            : 'bg-slate-950/40 border-slate-800/70 opacity-75'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <div className="mt-0.5 flex-shrink-0 w-7 h-7 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                            {item.icon}
                          </div>
                          <div className="min-w-0">
                            <div className="text-xs font-bold text-white truncate">
                              {item.label}
                            </div>
                            <div className="text-[10px] text-slate-400 leading-snug line-clamp-2">
                              {item.description}
                            </div>
                          </div>
                        </div>

                        <button
                          type="button"
                          role="switch"
                          aria-checked={isVisible}
                          aria-label={`Toggle ${item.label}`}
                          onClick={() => handleTogglePosUiElement(item.key)}
                          className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                            isVisible
                              ? 'bg-emerald-600 border-emerald-500'
                              : 'bg-slate-800 border-slate-700'
                          }`}
                        >
                          <span
                            className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                              isVisible ? 'translate-x-6' : 'translate-x-1'
                            }`}
                          />
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Mobile POS Tactile Haptic Feedback */}
              <div
                className={`p-3.5 rounded-xl border flex items-center justify-between gap-3 transition ${
                  hapticsEnabled
                    ? 'bg-slate-950/90 border-emerald-500/40'
                    : 'bg-slate-950/40 border-slate-800/80'
                }`}
              >
                <div className="flex items-start gap-2.5 min-w-0">
                  <div className="mt-0.5 flex-shrink-0 w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center">
                    <Vibrate
                      className={`w-4 h-4 ${
                        hapticsEnabled ? 'text-emerald-400' : 'text-slate-500'
                      }`}
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-2 flex-wrap">
                      <span>Tactile Haptic Feedback (Mobile POS)</span>
                      <span
                        className={`text-[11px] font-semibold ${
                          hapticsSupported ? 'text-emerald-400' : 'text-slate-400'
                        }`}
                      >
                        · {hapticsSupported ? 'Supported' : 'Not Supported on Browser'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
                      Trigger tactile vibration via navigator.vibrate when adding items to the cart or completing a sale.
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={hapticsEnabled}
                  aria-label="Toggle tactile haptic feedback"
                  onClick={() => {
                    const next = !hapticsEnabled;
                    soundManager.setHapticsEnabled(next);
                    setHapticsEnabled(next);
                    soundManager.playMechanicalClick();
                    if (next) {
                      soundManager.vibrateTap();
                    }
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                    hapticsEnabled
                      ? 'bg-emerald-600 border-emerald-500'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      hapticsEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>
        </SettingsAccordion>

        {/* ===================================================================== */}
        {/* GROUP 5: AUTOMATION & MESSAGING (WHATSAPP BOT + RECEIPT/UDHAR ALERTS) */}
        {/* ===================================================================== */}
        <SettingsAccordion
          id="settings-automation"
          title="Automation & Messaging"
          summary={automationSummary}
          description="WhatsApp order bot, auto-deduct stock, auto-receipt dispatch & Khata Udhar WhatsApp/SMS alerts"
          icon={<Zap className="w-4 h-4 text-amber-400" />}
          isOpen={Boolean(openGroups.automation)}
          onToggle={() => toggleGroup('automation')}
        >
          <div className="space-y-4">
            {/* Receipt & Khata Messaging Toggles */}
            {receiptSettings && onSaveReceiptSettings && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-2.5">
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Share2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                      <span className="truncate">Auto-Send WhatsApp Receipt</span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                      Open WhatsApp with formatted bill automatically when phone number is present
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={Boolean(receiptSettings.autoSendWhatsApp)}
                    aria-label="Toggle automatic WhatsApp receipt sending"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateReceiptField({ autoSendWhatsApp: !receiptSettings.autoSendWhatsApp });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      receiptSettings.autoSendWhatsApp
                        ? 'bg-emerald-600 border-emerald-500'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        receiptSettings.autoSendWhatsApp ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <BellRing className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                      <span className="truncate">WhatsApp Udhar Alert</span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                      Notify customers via WhatsApp when credit (Udhar) is added to Khata
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={receiptSettings.autoUdharWhatsApp ?? true}
                    aria-label="Toggle WhatsApp Udhar credit alert"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateReceiptField({
                        autoUdharWhatsApp: !(receiptSettings.autoUdharWhatsApp ?? true),
                      });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      receiptSettings.autoUdharWhatsApp ?? true
                        ? 'bg-emerald-600 border-emerald-500'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        receiptSettings.autoUdharWhatsApp ?? true ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white flex items-center gap-1.5">
                      <Send className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                      <span className="truncate">Standard SMS Udhar Alert</span>
                    </div>
                    <div className="text-[10px] text-slate-400 leading-snug mt-0.5">
                      Send carrier SMS credit alert to customer&apos;s linked mobile number
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={receiptSettings.autoUdharSMS ?? true}
                    aria-label="Toggle standard SMS Udhar alert"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateReceiptField({
                        autoUdharSMS: !(receiptSettings.autoUdharSMS ?? true),
                      });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      receiptSettings.autoUdharSMS ?? true
                        ? 'bg-blue-600 border-blue-500'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        receiptSettings.autoUdharSMS ?? true ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* WhatsApp Business API & Order Automation */}
            <div className="pt-3 border-t border-slate-800 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-emerald-400" />
                    WhatsApp Business API &amp; Order Automation
                  </h4>
                  <p className="text-[11px] text-slate-400 mt-0.5">
                    Receive WhatsApp customer orders and inquiries directly in POS, update stock, and sync bills to Khata.
                  </p>
                </div>

                <div className="flex items-center gap-3 self-start sm:self-auto">
                  {onOpenWhatsappInbox && (
                    <button
                      type="button"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        onOpenWhatsappInbox();
                      }}
                      className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-bold transition whitespace-nowrap"
                    >
                      Open WhatsApp Inbox
                    </button>
                  )}

                  <div className="flex items-center gap-2">
                    <span className="text-xs font-bold text-slate-200">
                      {whatsappConfig.enabled ? 'Enabled' : 'Disabled'}
                    </span>
                    <button
                      type="button"
                      role="switch"
                      aria-checked={whatsappConfig.enabled}
                      aria-label="Enable WhatsApp automation integration"
                      onClick={() => {
                        soundManager.playMechanicalClick();
                        updateWhatsappField({ enabled: !whatsappConfig.enabled });
                      }}
                      className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                        whatsappConfig.enabled
                          ? 'bg-emerald-600 border-emerald-500'
                          : 'bg-slate-800 border-slate-700'
                      }`}
                    >
                      <span
                        className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                          whatsappConfig.enabled ? 'translate-x-6' : 'translate-x-1'
                        }`}
                      />
                    </button>
                  </div>
                </div>
              </div>

              <div
                className={`grid grid-cols-1 md:grid-cols-3 gap-2.5 transition-opacity ${
                  whatsappConfig.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
                }`}
              >
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">Auto-Bill Inbound Orders</div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      Automatically convert verified WhatsApp orders into POS bills on arrival
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={whatsappConfig.autoConfirmOrders}
                    aria-label="Toggle auto-bill inbound WhatsApp orders"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateWhatsappField({
                        autoConfirmOrders: !whatsappConfig.autoConfirmOrders,
                      });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      whatsappConfig.autoConfirmOrders
                        ? 'bg-emerald-600 border-emerald-500'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        whatsappConfig.autoConfirmOrders ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">Auto-Deduct Stock Levels</div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      Immediately update POS product stock when WhatsApp orders confirm
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={whatsappConfig.autoDeductStock}
                    aria-label="Toggle automatic stock deduction for WhatsApp orders"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateWhatsappField({ autoDeductStock: !whatsappConfig.autoDeductStock });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      whatsappConfig.autoDeductStock
                        ? 'bg-emerald-600 border-emerald-500'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        whatsappConfig.autoDeductStock ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>

                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-white">Auto-Reply Stock &amp; Rate Asks</div>
                    <div className="text-[10px] text-slate-400 leading-snug">
                      Draft &amp; dispatch live rate, stock &amp; Khata due replies automatically
                    </div>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={whatsappConfig.autoReplyInquiries}
                    aria-label="Toggle auto-reply for WhatsApp customer inquiries"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      updateWhatsappField({
                        autoReplyInquiries: !whatsappConfig.autoReplyInquiries,
                      });
                    }}
                    className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                      whatsappConfig.autoReplyInquiries
                        ? 'bg-emerald-600 border-emerald-500'
                        : 'bg-slate-800 border-slate-700'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                        whatsappConfig.autoReplyInquiries ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-300">
                    Meta Phone Number ID (Optional)
                  </label>
                  <input
                    type="text"
                    value={whatsappConfig.businessPhoneNumberId || ''}
                    onChange={e =>
                      updateWhatsappField({ businessPhoneNumberId: e.target.value.trim() })
                    }
                    placeholder="e.g. 104928172635412"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-300">
                    Webhook Verify Token
                  </label>
                  <input
                    type="text"
                    value={whatsappConfig.verifyToken || ''}
                    onChange={e => updateWhatsappField({ verifyToken: e.target.value.trim() })}
                    placeholder="sq_pos_whatsapp_verify"
                    className="w-full px-3 py-2 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono text-white focus:outline-none focus:border-emerald-500"
                  />
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-slate-300">
                    Default Auto-Bill Settlement
                  </label>
                  <div className="grid grid-cols-2 gap-1.5">
                    <button
                      type="button"
                      onClick={() => updateWhatsappField({ defaultOrderPaymentMode: 'credit' })}
                      className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border transition ${
                        whatsappConfig.defaultOrderPaymentMode === 'credit'
                          ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Khata (Udhar)
                    </button>
                    <button
                      type="button"
                      onClick={() => updateWhatsappField({ defaultOrderPaymentMode: 'cash' })}
                      className={`py-2 px-2.5 rounded-lg text-[11px] font-bold border transition ${
                        whatsappConfig.defaultOrderPaymentMode === 'cash'
                          ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                          : 'bg-slate-950 border-slate-800 text-slate-400 hover:text-white'
                      }`}
                    >
                      Cash / Paid
                    </button>
                  </div>
                </div>
              </div>

              <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-[11px]">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-bold text-slate-400 whitespace-nowrap">Webhook URL:</span>
                  <code className="font-mono text-emerald-300 truncate">{webhookEndpointUrl}</code>
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  <span className="text-[10px] text-slate-400">
                    {hasServerWhatsappToken
                      ? 'Cloud API token active'
                      : 'Server token via WHATSAPP_ACCESS_TOKEN'}
                  </span>
                  <button
                    type="button"
                    onClick={() => {
                      navigator.clipboard?.writeText(webhookEndpointUrl).catch(() => {});
                      soundManager.playMechanicalClick();
                      setCopiedWebhook(true);
                      setTimeout(() => setCopiedWebhook(false), 2000);
                    }}
                    className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold flex items-center gap-1"
                  >
                    {copiedWebhook ? (
                      <Check className="w-3 h-3 text-emerald-400" />
                    ) : (
                      <Copy className="w-3 h-3" />
                    )}
                    {copiedWebhook ? 'Copied' : 'Copy URL'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </SettingsAccordion>

        {/* ===================================================================== */}
        {/* GROUP 6: PERFORMANCE MANAGER (SPEED & RESOURCE TOGGLES) */}
        {/* ===================================================================== */}
        <SettingsAccordion
          id="settings-performance-manager"
          title="Performance Manager"
          summary={performanceSummary}
          description="Master switches to pause Predictive Analytics, Automatic Cloud Syncing & Live Receipt Rendering"
          icon={<Gauge className="w-4 h-4 text-amber-400" />}
          isOpen={Boolean(openGroups.performance_manager)}
          onToggle={() => toggleGroup('performance_manager')}
        >
          <PerformanceManagerPanel
            settings={performanceSettings}
            onUpdate={handleUpdatePerformanceSettings}
          />
        </SettingsAccordion>

        {/* ===================================================================== */}
        {/* GROUP 7: EXTERNAL APP INTEGRATION API (REST v1) */}
        {/* ===================================================================== */}
        <SettingsAccordion
          id="settings-external-api"
          title="External App Integration API · REST v1"
          summary={externalApiSummary}
          description="CORS-enabled JSON endpoints for syncing product catalog, stock levels, customers & external orders"
          icon={<Globe className="w-4 h-4 text-sky-400" />}
          isOpen={Boolean(openGroups.external_api)}
          onToggle={() => toggleGroup('external_api')}
        >
          <div className="space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2.5 border-b border-slate-800 pb-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={`px-2.5 py-1 rounded-md border text-[11px] font-bold flex items-center gap-1.5 whitespace-nowrap ${
                    serverStatus?.externalApiAuthConfigured
                      ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-300'
                      : 'bg-slate-950 border-slate-700 text-slate-300'
                  }`}
                >
                  <ShieldCheck className="w-3.5 h-3.5 text-sky-400" />
                  {serverStatus?.externalApiAuthConfigured
                    ? 'Bearer / X-API-Key Protected'
                    : 'Open Mode (Set EXTERNAL_API_KEY in Secrets)'}
                </span>

                {onPushFullSnapshot && (
                  <button
                    type="button"
                    disabled={isSyncingServer || !externalApiConfig.enabled}
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      void onPushFullSnapshot();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-sky-600/20 hover:bg-sky-600/30 border border-sky-500/40 text-sky-200 text-[11px] font-bold flex items-center gap-1.5 transition whitespace-nowrap disabled:opacity-50"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${isSyncingServer ? 'animate-spin' : ''}`} />
                    Sync Snapshot to API
                  </button>
                )}

                {onPullServerSnapshot && (
                  <button
                    type="button"
                    disabled={isSyncingServer || !externalApiConfig.enabled}
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      void onPullServerSnapshot();
                    }}
                    className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1.5 transition whitespace-nowrap disabled:opacity-50"
                  >
                    Pull Server Updates
                  </button>
                )}
              </div>

              {/* Master Enable / Disable Toggle Switch */}
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold text-slate-200">
                  {externalApiConfig.enabled ? 'Enabled' : 'Disabled'}
                </span>
                <button
                  type="button"
                  role="switch"
                  aria-checked={externalApiConfig.enabled}
                  aria-label="Enable external API endpoints"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    handleToggleExternalApi();
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-sky-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                    externalApiConfig.enabled
                      ? 'bg-sky-600 border-sky-500'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      externalApiConfig.enabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            {!externalApiConfig.enabled && (
              <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30 text-amber-200 text-[11px] font-semibold flex items-center gap-2">
                <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
                <span>
                  External API integration is disabled. Requests to <code>/api/v1/*</code> endpoints currently return HTTP 403 until re-enabled.
                </span>
              </div>
            )}

            <div
              className={`space-y-3 transition-opacity ${
                externalApiConfig.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
              }`}
            >
              <div
                className={`grid ${
                  isMobileLayout ? 'grid-cols-1' : isDesktopLayout ? 'grid-cols-4' : 'grid-cols-2'
                } gap-2.5`}
              >
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Catalog SKUs (API / POS)
                  </div>
                  <div className="text-base font-black text-white tabular-nums mt-0.5">
                    {serverStatus?.totalSyncedProducts ?? 0}
                    <span className="text-xs font-semibold text-slate-400 ml-1">
                      / {localCounts?.products ?? 0}
                    </span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Customers (API / POS)
                  </div>
                  <div className="text-base font-black text-white tabular-nums mt-0.5">
                    {serverStatus?.totalSyncedCustomers ?? 0}
                    <span className="text-xs font-semibold text-slate-400 ml-1">
                      / {localCounts?.customers ?? 0}
                    </span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Synced Orders / Bills
                  </div>
                  <div className="text-base font-black text-white tabular-nums mt-0.5">
                    {serverStatus?.totalSyncedBills ?? 0}
                    <span className="text-xs font-semibold text-slate-400 ml-1">
                      / {localCounts?.orders ?? 0}
                    </span>
                  </div>
                </div>
                <div className="p-3 rounded-xl bg-slate-950 border border-slate-800">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                    Sync Revision
                  </div>
                  <div className="text-base font-black text-sky-300 tabular-nums mt-0.5">
                    rev #{serverStatus?.revision ?? 0}
                  </div>
                </div>
              </div>

              <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'} gap-2`}>
                {[
                  {
                    key: 'products',
                    method: 'GET / POST',
                    path: '/api/v1/products',
                    desc: 'Filter, search, barcode-lookup, or bulk-upsert SKUs',
                  },
                  {
                    key: 'inventory',
                    method: 'GET',
                    path: '/api/v1/inventory',
                    desc: 'Live piece/bundle stock counts & low-stock flags',
                  },
                  {
                    key: 'adjust',
                    method: 'POST',
                    path: '/api/v1/inventory/adjust',
                    desc: 'Atomic deltaPieces or setStockPieces stock adjustment',
                  },
                  {
                    key: 'orders',
                    method: 'GET / POST',
                    path: '/api/v1/orders',
                    desc: 'Submit external orders (deducts stock) or query bills',
                  },
                  {
                    key: 'customers',
                    method: 'GET / POST',
                    path: '/api/v1/customers',
                    desc: 'Lookup Khata customers by phone or upsert buyers',
                  },
                  {
                    key: 'openapi',
                    method: 'GET',
                    path: '/api/v1/openapi.json',
                    desc: 'OpenAPI 3.0.3 schema for external SDK generation',
                  },
                ].map(ep => {
                  const origin =
                    typeof window !== 'undefined' ? window.location.origin : '';
                  const fullUrl = `${origin}${ep.path}`;
                  const isCopied = copiedEndpointKey === ep.key;
                  return (
                    <div
                      key={ep.key}
                      className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 flex items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="text-[10px] font-black font-mono text-sky-300 uppercase">
                            {ep.method}
                          </span>
                          <code className="text-[11px] font-mono text-white truncate">
                            {ep.path}
                          </code>
                        </div>
                        <div className="text-[10px] text-slate-400 truncate mt-0.5">
                          {ep.desc}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {ep.key === 'openapi' && (
                          <a
                            href={ep.path}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-sky-300 text-[10px] font-bold flex items-center gap-1 whitespace-nowrap"
                          >
                            <Code2 className="w-3 h-3" />
                            Schema
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            navigator.clipboard?.writeText(fullUrl).catch(() => {});
                            soundManager.playMechanicalClick();
                            setCopiedEndpointKey(ep.key);
                            setTimeout(() => setCopiedEndpointKey(null), 1800);
                          }}
                          className="px-2 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[10px] font-bold flex items-center gap-1 whitespace-nowrap"
                        >
                          {isCopied ? (
                            <Check className="w-3 h-3 text-emerald-400" />
                          ) : (
                            <Copy className="w-3 h-3" />
                          )}
                          {isCopied ? 'Copied' : 'Copy'}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </SettingsAccordion>

        {/* ===================================================================== */}
        {/* GROUP 8: MULTI-STORE & MULTI-BRANCH SYNCHRONIZATION */}
        {/* ===================================================================== */}
        {hasMultiStoreProps && multiBranchConfig && (
          <SettingsAccordion
            id="settings-multi-store"
            title="Multi-Store &amp; Branch Synchronization"
            summary={multiStoreSummary}
            description="Manage multiple store branches, toggle cross-branch sync ON/OFF, and transfer stock between locations"
            icon={<GitBranch className="w-4 h-4 text-emerald-400" />}
            isOpen={Boolean(openGroups.multi_store)}
            onToggle={() => toggleGroup('multi_store')}
          >
            <MultiStoreManagerPanel
              branches={branches}
              config={multiBranchConfig}
              transfers={branchTransfers}
              products={products}
              isSyncingBranches={isSyncingBranches}
              onToggleMultiBranchSync={onToggleMultiBranchSync!}
              onUpdateMultiBranchConfig={onUpdateMultiBranchConfig!}
              onSwitchBranch={onSwitchBranch!}
              onSaveBranch={onSaveBranch!}
              onDeleteBranch={onDeleteBranch!}
              onSyncAllBranches={onSyncAllBranches!}
              onTransferStock={onTransferBranchStock!}
            />
          </SettingsAccordion>
        )}

        {/* ===================================================================== */}
        {/* GROUP 9: MASTER PIN & BIOMETRIC APP LOCK SECURITY */}
        {/* ===================================================================== */}
        {hasAppLockProps && appLockSettings && (
          <SettingsAccordion
            id="settings-app-lock"
            title="Security · Master PIN &amp; Biometric App Lock"
            summary={appLockSummary}
            description="Require Fingerprint / Face ID or 4-digit Master PIN authentication on POS launch"
            icon={<Lock className="w-4 h-4 text-amber-400" />}
            isOpen={Boolean(openGroups.app_lock)}
            onToggle={() => toggleGroup('app_lock')}
          >
            <AppLockSettingsPanel
              settings={appLockSettings}
              storeEmail={profile.email}
              storeName={profile.storeName}
              onUpdateSettings={onUpdateAppLockSettings!}
              onLockNow={onLockAppNow!}
            />
          </SettingsAccordion>
        )}
      </div>
    </div>
  );
};
