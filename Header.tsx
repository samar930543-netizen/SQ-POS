import React, { useState, useEffect } from 'react';
import { soundManager } from '../utils/soundEffects';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { useViewportLayout } from '../hooks/useViewportLayout';
import { formatCurrency } from '../utils/formatters';
import { HeaderIconKey, StoreProfile, StaffMember, StoreBranch } from '../types';
import { DEFAULT_HEADER_ICON_VISIBILITY } from '../utils/storage';
import {
  Volume2,
  VolumeX,
  Volume1,
  Smartphone,
  ShoppingCart,
  Download,
  SlidersHorizontal,
  Camera,
  Wifi,
  WifiOff,
  RefreshCw,
  Store,
  Layers,
  Truck,
  Wallet,
  Award,
  Building2,
  ChevronDown,
  PanelTopClose,
  PanelTopOpen,
  Bell,
  UserCheck,
  MessageSquare,
  Vibrate,
  Mic,
  AudioWaveform,
  GitBranch,
  Lock,
} from 'lucide-react';

export type AppTab =
  | 'billing'
  | 'khata'
  | 'inventory'
  | 'suppliers'
  | 'cashflow'
  | 'reports'
  | 'staff_loyalty'
  | 'whatsapp'
  | 'store_profile';

interface HeaderProps {
  activeTab: AppTab;
  setActiveTab: (tab: AppTab) => void;
  cartCount: number;
  cartTotal: number;
  lowStockCount: number;
  pendingPoAlertCount?: number;
  pendingWhatsappCount?: number;
  onOpenCart: () => void;
  onOpenApkGuide: () => void;
  onOpenReceiptSettings: () => void;
  onOpenScanBill?: () => void;
  onOpenAudioTranscribe?: () => void;
  onOpenLiveVoice?: () => void;
  onOpenOfflineSync?: () => void;
  onOpenNotifications?: () => void;
  unreadAlertCount?: number;
  isOffline?: boolean;
  isSyncing?: boolean;
  pendingSyncCount?: number;
  storeProfile?: StoreProfile;
  activeStaff?: StaffMember | null;
  onOpenOperatorSwitcher?: () => void;
  rbacAllowedTabs?: Partial<Record<AppTab, boolean>>;
  activeBranch?: StoreBranch | null;
  multiBranchSyncEnabled?: boolean;
  branchCount?: number;
  onOpenMultiStore?: () => void;
  appLockEnabled?: boolean;
  onLockApp?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  activeTab,
  setActiveTab,
  cartCount,
  cartTotal,
  lowStockCount,
  pendingPoAlertCount = 0,
  pendingWhatsappCount = 0,
  onOpenCart,
  onOpenApkGuide,
  onOpenReceiptSettings,
  onOpenScanBill,
  onOpenAudioTranscribe,
  onOpenLiveVoice,
  onOpenOfflineSync,
  onOpenNotifications,
  unreadAlertCount = 0,
  isOffline = false,
  isSyncing = false,
  pendingSyncCount = 0,
  storeProfile,
  activeStaff,
  onOpenOperatorSwitcher,
  rbacAllowedTabs,
  activeBranch,
  multiBranchSyncEnabled = true,
  branchCount = 1,
  onOpenMultiStore,
  appLockEnabled = false,
  onLockApp,
}) => {
  const { isInstallable, isInstalled, install } = usePWAInstall();
  const { isMobileLayout, isDesktopLayout } = useViewportLayout();
  const [soundEnabled, setSoundEnabled] = useState(soundManager.isSoundEnabled());
  const [soundMode, setSoundMode] = useState<'beep' | 'click'>(soundManager.getSoundMode());
  const [hapticsEnabled, setHapticsEnabled] = useState(soundManager.isHapticsEnabled());
  const hapticsSupported = soundManager.isHapticsSupported();
  const [logoImgFailed, setLogoImgFailed] = useState(false);
  const [isNavOpen, setIsNavOpen] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('sq_header_nav_open_v1');
      return saved === null ? true : saved === 'true';
    } catch {
      return true;
    }
  });
  const [dragOffsetY, setDragOffsetY] = useState<number>(0);
  const handlePointerStateRef = React.useRef<{
    active: boolean;
    startX: number;
    startY: number;
    swiped: boolean;
  }>({ active: false, startX: 0, startY: 0, swiped: false });
  const touchSwipeRef = React.useRef<{ startX: number; startY: number } | null>(null);

  useEffect(() => {
    setLogoImgFailed(false);
  }, [storeProfile?.logoDataUrl]);

  useEffect(() => {
    return soundManager.subscribeHapticsChange(setHapticsEnabled);
  }, []);

  const setNavDrawerOpen = (next: boolean) => {
    setIsNavOpen(prev => {
      if (prev !== next) {
        soundManager.playMechanicalClick();
      }
      try {
        localStorage.setItem('sq_header_nav_open_v1', String(next));
      } catch {
        // Ignore storage write errors
      }
      return next;
    });
  };

  const handleToggleNav = () => {
    if (handlePointerStateRef.current.swiped) {
      handlePointerStateRef.current.swiped = false;
      return;
    }
    setNavDrawerOpen(!isNavOpen);
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if (e.pointerType === 'touch') return; // Handled smoothly via touch events
    handlePointerStateRef.current = {
      active: true,
      startX: e.clientX,
      startY: e.clientY,
      swiped: false,
    };
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLElement>) => {
    if (!handlePointerStateRef.current.active) return;
    const dx = e.clientX - handlePointerStateRef.current.startX;
    const dy = e.clientY - handlePointerStateRef.current.startY;
    if (Math.abs(dy) > 5 && Math.abs(dy) > Math.abs(dx)) {
      setDragOffsetY(Math.max(-14, Math.min(14, dy * 0.4)));
    }
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLElement>) => {
    if (!handlePointerStateRef.current.active) return;
    const dx = e.clientX - handlePointerStateRef.current.startX;
    const dy = e.clientY - handlePointerStateRef.current.startY;
    handlePointerStateRef.current.active = false;
    setDragOffsetY(0);

    if (Math.abs(dy) >= 20 && Math.abs(dy) > Math.abs(dx) * 1.2) {
      handlePointerStateRef.current.swiped = true;
      if (dy < 0 && isNavOpen) {
        setNavDrawerOpen(false);
      } else if (dy > 0 && !isNavOpen) {
        setNavDrawerOpen(true);
      }
    }
  };

  const handleHeaderPointerCancel = () => {
    handlePointerStateRef.current.active = false;
    setDragOffsetY(0);
  };

  const handleHeaderTouchStart = (e: React.TouchEvent<HTMLElement>) => {
    if (e.touches.length !== 1) return;
    touchSwipeRef.current = {
      startX: e.touches[0].clientX,
      startY: e.touches[0].clientY,
    };
  };

  const handleHeaderTouchEnd = (e: React.TouchEvent<HTMLElement>) => {
    if (!touchSwipeRef.current || e.changedTouches.length === 0) return;
    const dx = e.changedTouches[0].clientX - touchSwipeRef.current.startX;
    const dy = e.changedTouches[0].clientY - touchSwipeRef.current.startY;
    touchSwipeRef.current = null;

    if (Math.abs(dy) >= 26 && Math.abs(dy) > Math.abs(dx) * 1.3) {
      if (dy < 0 && isNavOpen) {
        setNavDrawerOpen(false);
      } else if (dy > 0 && !isNavOpen) {
        setNavDrawerOpen(true);
      }
    }
  };

  const ACTIVE_TAB_LABELS: Record<AppTab, string> = {
    billing: 'Billing',
    khata: 'Khata (Udhar)',
    inventory: 'Stock',
    suppliers: 'Suppliers',
    cashflow: 'Cash Flow',
    reports: 'Analytics',
    staff_loyalty: 'Team & Rewards',
    whatsapp: 'WhatsApp',
    store_profile: 'Store Profile',
  };

  const displayStoreName = storeProfile?.storeName?.trim() || 'SQ ENTERPRISES';
  const displayTagline = storeProfile?.tagline?.trim() || 'Wholesale FMCG • GST / Non-GST • Multi-Unit';
  const storeInitials =
    displayStoreName
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase() || '')
      .join('') || 'SQ';

  const handleToggleSound = () => {
    if (!soundEnabled) {
      soundManager.setSoundEnabled(true);
      setSoundEnabled(true);
      soundManager.playScannerBeep();
    } else if (soundMode === 'beep') {
      soundManager.setSoundMode('click');
      setSoundMode('click');
      soundManager.playMechanicalClick();
    } else {
      soundManager.setSoundEnabled(false);
      setSoundEnabled(false);
    }
  };

  const handleToggleHaptics = () => {
    const next = !hapticsEnabled;
    soundManager.setHapticsEnabled(next);
    setHapticsEnabled(next);
    soundManager.playMechanicalClick();
    if (next) {
      soundManager.vibrateTap();
    }
  };

  const enabledModules = storeProfile?.enabledModules;
  const isTabVisible = (tab: Exclude<AppTab, 'store_profile'>): boolean => {
    const storeEnabled = enabledModules ? enabledModules[tab] !== false : true;
    const rbacEnabled = rbacAllowedTabs ? rbacAllowedTabs[tab] !== false : true;
    return storeEnabled && rbacEnabled;
  };
  const isStoreProfileVisible = rbacAllowedTabs ? rbacAllowedTabs.store_profile !== false : true;

  const handleTabChange = (tab: AppTab) => {
    soundManager.playMechanicalClick();
    setActiveTab(tab);
  };

  const showHeaderBranding = storeProfile?.showBrandingInHeader !== false;
  const headerIconVisibility = storeProfile?.headerIconVisibility;
  const showIcon = (key: HeaderIconKey): boolean =>
    headerIconVisibility
      ? headerIconVisibility[key] !== false
      : DEFAULT_HEADER_ICON_VISIBILITY[key] !== false;
  const showNavToggle = showIcon('navDrawerToggle');
  const effectiveIsNavOpen = isNavOpen || !showNavToggle;

  return (
    <header
      onPointerDown={handleHeaderPointerDown}
      onPointerMove={handleHeaderPointerMove}
      onPointerUp={handleHeaderPointerUp}
      onPointerCancel={handleHeaderPointerCancel}
      onTouchStart={handleHeaderTouchStart}
      onTouchEnd={handleHeaderTouchEnd}
      className="bg-slate-950 border-b border-slate-800 sticky top-0 z-40 select-none"
    >
      {/* Top Main Bar */}
      <div
        className={`flex items-center ${
          showHeaderBranding ? 'justify-between' : 'justify-end'
        } gap-2 ${
          isMobileLayout ? 'flex-wrap gap-y-1.5 px-2.5 py-2' : 'px-4 py-2.5'
        }`}
      >
        
        {/* Brand & Store Name */}
        {showHeaderBranding && (
          <button
            type="button"
            onClick={() => handleTabChange('store_profile')}
            className="flex items-center gap-2.5 text-left group rounded-xl pr-1.5 py-0.5 hover:bg-slate-900/70 transition"
            title="Open Store Profile & Branding Settings"
          >
            {storeProfile?.logoDataUrl && !logoImgFailed ? (
              <img
                src={storeProfile.logoDataUrl}
                alt={`${displayStoreName} logo`}
                onError={() => setLogoImgFailed(true)}
                className="w-9 h-9 rounded-xl object-contain bg-white p-0.5 shadow-md border border-slate-700 flex-shrink-0"
              />
            ) : (
              <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white font-black text-sm shadow-md shadow-blue-900/30 flex-shrink-0">
                {storeInitials}
              </div>
            )}
            <div className="min-w-0">
              <h1
                className={`font-black text-white tracking-wider flex items-center gap-1.5 leading-tight truncate ${
                  isMobileLayout ? 'text-sm max-w-[140px]' : 'text-base max-w-xs'
                }`}
              >
                <span className="truncate">{displayStoreName}</span>
                {!isMobileLayout && (
                  <span className="inline-block px-1.5 py-0.2 rounded text-[10px] font-bold uppercase bg-blue-500/20 text-blue-300 border border-blue-500/30 flex-shrink-0">
                    Wholesale POS
                  </span>
                )}
              </h1>
              <p
                className={`text-[10px] text-slate-400 leading-tight truncate ${
                  isMobileLayout ? 'max-w-[150px]' : 'max-w-sm'
                }`}
              >
                {displayTagline}
              </p>
            </div>
          </button>
        )}

        {/* Action Controls */}
        <div
          className={`flex items-center flex-wrap justify-end ${
            isMobileLayout ? 'gap-1' : 'gap-1.5'
          } flex-shrink-0`}
        >

          {/* App Lock Terminal Trigger */}
          {showIcon('appLock') && appLockEnabled && onLockApp && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onLockApp();
              }}
              className="px-2 py-1.5 rounded-xl text-xs font-bold border bg-slate-800 hover:bg-slate-700 text-amber-300 border-slate-700 transition active:scale-95 flex items-center gap-1 whitespace-nowrap"
              title="Lock POS Terminal Now (Require Master PIN / Biometric)"
              aria-label="Lock POS Terminal"
            >
              <Lock className="w-3.5 h-3.5 text-amber-400" />
              {isDesktopLayout && <span>Lock</span>}
            </button>
          )}

          {/* Multi-Store Branch Switcher & Sync Status */}
          {showIcon('multiStore') && onOpenMultiStore && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenMultiStore();
              }}
              className={`px-2 py-1.5 rounded-xl text-xs font-bold border transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap ${
                multiBranchSyncEnabled
                  ? 'bg-slate-800 hover:bg-slate-700 text-sky-300 border-slate-700'
                  : 'bg-amber-950/50 hover:bg-amber-900/50 text-amber-300 border-amber-500/40'
              }`}
              title={`Active Branch: ${activeBranch?.name || 'Main HQ'} (${
                multiBranchSyncEnabled ? 'Multi-Branch Sync ON' : 'Standalone Mode · Sync OFF'
              })`}
              aria-label={`Open Multi-Store Branch Switcher (${activeBranch?.code || 'HQ-01'})`}
            >
              <GitBranch
                className={`w-3.5 h-3.5 ${
                  multiBranchSyncEnabled ? 'text-sky-400' : 'text-amber-400'
                }`}
              />
              <span className="font-mono">{activeBranch?.code || 'HQ-01'}</span>
              {isDesktopLayout && branchCount > 1 && (
                <span className="text-[10px] font-semibold text-slate-400 tabular-nums">
                  ({branchCount})
                </span>
              )}
              {!isMobileLayout && !multiBranchSyncEnabled && (
                <span className="text-[9px] uppercase font-black text-amber-300">
                  Off
                </span>
              )}
            </button>
          )}

          {/* Active Operator Switcher */}
          {showIcon('operatorSwitcher') && onOpenOperatorSwitcher && activeStaff && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenOperatorSwitcher();
              }}
              className="px-2 py-1.5 rounded-xl text-xs font-bold border bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700 transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
              title={`Active Operator: ${activeStaff.name} (${activeStaff.role}) — click to switch`}
              aria-label={`Switch active staff operator (${activeStaff.name})`}
            >
              <UserCheck className="w-3.5 h-3.5 text-blue-400" />
              {!isMobileLayout && (
                <span className="max-w-[92px] truncate">
                  {activeStaff.name.split(' ')[0]}
                </span>
              )}
              {isDesktopLayout && (
                <span className="text-[10px] font-medium text-slate-400 truncate max-w-[84px]">
                  · {activeStaff.role === 'Store Owner / Admin' ? 'Owner' : activeStaff.role.split(' ')[0]}
                </span>
              )}
            </button>
          )}

          {/* Notification Center Trigger Button */}
          {showIcon('notifications') && onOpenNotifications && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenNotifications();
              }}
              className={`relative px-2 py-1.5 rounded-xl text-xs font-bold border transition active:scale-95 flex items-center gap-1 whitespace-nowrap ${
                unreadAlertCount > 0
                  ? 'bg-amber-500/15 hover:bg-amber-500/25 text-amber-200 border-amber-500/40'
                  : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700'
              }`}
              title="Open Notification Center & System Alert Log"
              aria-label={`Open Notification Center (${unreadAlertCount} active alerts)`}
            >
              <Bell className={`w-3.5 h-3.5 ${unreadAlertCount > 0 ? 'text-amber-400' : 'text-slate-300'}`} />
              {isDesktopLayout && <span>Alerts</span>}
              {unreadAlertCount > 0 && (
                <span className="px-1 py-0.2 rounded bg-amber-400 text-slate-950 text-[10px] font-black tabular-nums">
                  {unreadAlertCount > 99 ? '99+' : unreadAlertCount}
                </span>
              )}
            </button>
          )}

          {/* Offline Mode & Background Sync Status Button */}
          {showIcon('offlineSync') && onOpenOfflineSync && (
            <button
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenOfflineSync();
              }}
              className={`px-2 py-1.5 rounded-xl text-xs font-bold border transition active:scale-95 flex items-center gap-1 whitespace-nowrap ${
                isOffline
                  ? 'bg-amber-500/20 text-amber-300 border-amber-500/40 hover:bg-amber-500/30'
                  : pendingSyncCount > 0 || isSyncing
                  ? 'bg-blue-600/20 text-blue-300 border-blue-500/40 hover:bg-blue-600/30'
                  : 'bg-slate-800 text-emerald-300 border-slate-700 hover:bg-slate-700'
              }`}
              title="Offline Mode & Background Synchronization"
              aria-label="Offline Mode and Sync Status"
            >
              {isSyncing ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin text-blue-400" />
              ) : isOffline ? (
                <WifiOff className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <Wifi className="w-3.5 h-3.5 text-emerald-400" />
              )}
              {!isMobileLayout && (
                <span>
                  {isSyncing ? 'Syncing' : isOffline ? 'Offline' : 'Online'}
                </span>
              )}
              {pendingSyncCount > 0 && (
                <span className="px-1 py-0.2 rounded bg-amber-400 text-slate-950 text-[10px] font-black tabular-nums">
                  {pendingSyncCount}
                </span>
              )}
            </button>
          )}
          
          {/* Sound Toggle */}
          {showIcon('sound') && (
            <button
              onClick={handleToggleSound}
              className={`${
                isMobileLayout ? 'p-1.5' : 'p-2'
              } rounded-xl text-xs font-semibold border transition active:scale-95 flex items-center gap-1 ${
                soundEnabled
                  ? 'bg-slate-800 text-blue-400 border-slate-700 hover:bg-slate-700'
                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-400'
              }`}
              title={`Sound: ${!soundEnabled ? 'Muted' : soundMode === 'beep' ? 'Beep' : 'Click'}`}
              aria-label="Toggle Sound"
            >
              {!soundEnabled ? (
                <VolumeX className="w-4 h-4" />
              ) : soundMode === 'beep' ? (
                <>
                  <Volume2 className="w-4 h-4 text-emerald-400" />
                  {!isMobileLayout && (
                    <span className="text-[10px] uppercase font-bold text-emerald-400">Beep</span>
                  )}
                </>
              ) : (
                <>
                  <Volume1 className="w-4 h-4 text-blue-400" />
                  {!isMobileLayout && (
                    <span className="text-[10px] uppercase font-bold text-blue-400">Click</span>
                  )}
                </>
              )}
            </button>
          )}

          {/* Haptics Vibration Toggle */}
          {showIcon('haptics') && (
            <button
              type="button"
              onClick={handleToggleHaptics}
              className={`${
                isMobileLayout ? 'p-1.5' : 'p-2'
              } rounded-xl text-xs font-semibold border transition active:scale-95 flex items-center gap-1 ${
                hapticsEnabled
                  ? 'bg-slate-800 text-emerald-400 border-slate-700 hover:bg-slate-700'
                  : 'bg-slate-900 text-slate-500 border-slate-800 hover:text-slate-400'
              }`}
              title={
                !hapticsSupported
                  ? `Haptics: ${hapticsEnabled ? 'Enabled' : 'Off'} (Browser does not expose navigator.vibrate)`
                  : `Haptics (Vibration): ${hapticsEnabled ? 'On' : 'Off'}`
              }
              aria-label={`Toggle Haptic Vibration (${hapticsEnabled ? 'On' : 'Off'})`}
              aria-pressed={hapticsEnabled}
            >
              <Vibrate
                className={`w-4 h-4 ${
                  hapticsEnabled ? 'text-emerald-400' : 'text-slate-500'
                }`}
              />
              {isDesktopLayout && (
                <span
                  className={`text-[10px] uppercase font-bold ${
                    hapticsEnabled ? 'text-emerald-400' : 'text-slate-500'
                  }`}
                >
                  {hapticsEnabled ? 'Vibe' : 'Off'}
                </span>
              )}
            </button>
          )}

          {/* In-App PWA Install Prompt Button (Android / Desktop) */}
          {showIcon('pwaInstall') && isInstallable && !isInstalled && (
            <button
              onClick={install}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-md shadow-emerald-900/30 transition active:scale-95"
            >
              <Download className="w-3.5 h-3.5" />
              {!isMobileLayout && <span>Install</span>}
            </button>
          )}

          {/* Live Voice Conversation Button */}
          {showIcon('liveVoice') && onOpenLiveVoice && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenLiveVoice();
              }}
              className={`${
                isMobileLayout ? 'p-1.5' : 'p-2'
              } rounded-xl text-xs font-semibold bg-emerald-950/60 hover:bg-emerald-900/60 text-emerald-300 hover:text-white border border-emerald-500/40 transition active:scale-95 flex items-center gap-1 shadow-sm`}
              title="Real-time voice conversation with store assistant (Gemini 3.8 Live)"
              aria-label="Live Voice Conversation"
            >
              <AudioWaveform className="w-4 h-4 text-emerald-400" />
              {isDesktopLayout && (
                <span className="text-[10px] uppercase font-bold text-emerald-300">Live Voice</span>
              )}
            </button>
          )}

          {/* Audio Transcribe & Item List Button */}
          {showIcon('audioTranscribe') && onOpenAudioTranscribe && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenAudioTranscribe();
              }}
              className={`${
                isMobileLayout ? 'p-1.5' : 'p-2'
              } rounded-xl text-xs font-semibold bg-sky-950/60 hover:bg-sky-900/60 text-sky-300 hover:text-white border border-sky-500/40 transition active:scale-95 flex items-center gap-1 shadow-sm`}
              title="Record microphone or upload audio to transcribe item lists (Gemini 3.5)"
              aria-label="Audio Transcribe Item List"
            >
              <Mic className="w-4 h-4 text-sky-400" />
              {isDesktopLayout && (
                <span className="text-[10px] uppercase font-bold text-sky-300">Audio List</span>
              )}
            </button>
          )}

          {/* Scan Bill OCR Button */}
          {showIcon('scanBill') && onOpenScanBill && (
            <button
              onClick={() => {
                soundManager.playScannerBeep();
                onOpenScanBill();
              }}
              className={`${
                isMobileLayout ? 'p-1.5' : 'p-2'
              } rounded-xl text-xs font-semibold bg-purple-950/60 hover:bg-purple-900/60 text-purple-300 hover:text-white border border-purple-500/40 transition active:scale-95 flex items-center gap-1 shadow-sm`}
              title="Scan handwritten or printed English & Hindi bills via AI OCR"
              aria-label="Scan Bill OCR"
            >
              <Camera className="w-4 h-4 text-purple-400" />
              {isDesktopLayout && (
                <span className="text-[10px] uppercase font-bold text-purple-300">Scan Bill</span>
              )}
            </button>
          )}

          {/* Receipt Settings Button */}
          {showIcon('receiptSettings') && (
            <button
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenReceiptSettings();
              }}
              className={`${
                isMobileLayout ? 'p-1.5' : 'p-2'
              } rounded-xl text-xs font-semibold bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition active:scale-95 flex items-center gap-1`}
              title="Receipt & Thermal Printer Settings (Compact / Standard / Detailed)"
              aria-label="Receipt Settings"
            >
              <SlidersHorizontal className="w-4 h-4 text-blue-400" />
              {!isMobileLayout && (
                <span className="text-[10px] uppercase font-bold text-slate-300">Receipt</span>
              )}
            </button>
          )}

          {/* APK Guide Button */}
          {showIcon('apkGuide') && !isMobileLayout && (
            <button
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenApkGuide();
              }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-gradient-to-r from-blue-600/30 to-indigo-600/30 hover:from-blue-600/40 hover:to-indigo-600/40 border border-blue-500/40 text-blue-300 font-bold text-xs transition active:scale-95 whitespace-nowrap"
              title="Convert to Android .APK"
            >
              <Smartphone className="w-3.5 h-3.5 text-blue-400" />
              {isDesktopLayout && <span>Get</span>} .APK
            </button>
          )}

          {/* Cart Drawer Trigger Button */}
          {showIcon('cart') && (
            <button
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenCart();
              }}
              className={`relative flex items-center gap-1.5 ${
                isMobileLayout ? 'px-2.5' : 'px-3'
              } py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-xs shadow-lg shadow-blue-900/40 transition active:scale-95 whitespace-nowrap`}
            >
              <ShoppingCart className="w-4 h-4" />
              <span className="font-mono tabular-nums">
                {formatCurrency(cartTotal)}
              </span>
              {cartCount > 0 && (
                <span className="flex h-5 min-w-[20px] px-1 items-center justify-center rounded-full bg-amber-400 text-slate-950 text-[10px] font-black tabular-nums">
                  {cartCount}
                </span>
              )}
            </button>
          )}

          {/* Compact Integrated Navigation Drawer Toggle (Click or Slide Header Up/Down) */}
          {showNavToggle && (
            <button
              type="button"
              onClick={handleToggleNav}
              aria-expanded={isNavOpen}
              aria-controls="header-navigation-drawer"
              title={isNavOpen ? 'Hide tab bar (or slide header up)' : 'Show tab bar (or slide header down)'}
              className={`flex items-center gap-1 px-2 py-1.5 rounded-xl text-xs font-bold border transition active:scale-95 whitespace-nowrap ${
                isNavOpen
                  ? 'bg-slate-800 hover:bg-slate-700 text-slate-200 border-slate-700'
                  : 'bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border-blue-500/40'
              }`}
            >
              {isNavOpen ? (
                <PanelTopClose className="w-3.5 h-3.5 text-slate-300" />
              ) : (
                <PanelTopOpen className="w-3.5 h-3.5 text-blue-400" />
              )}
              {!isNavOpen && !isMobileLayout && (
                <span className="truncate max-w-[90px]">
                  {ACTIVE_TAB_LABELS[activeTab]}
                </span>
              )}
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform duration-300 motion-reduce:transition-none ${
                  isNavOpen ? 'rotate-180' : 'rotate-0'
                }`}
              />
            </button>
          )}
        </div>

      </div>

      {/* Collapsible Primary POS Header Navigation Drawer */}
      <div
        id="header-navigation-drawer"
        aria-hidden={!effectiveIsNavOpen}
        className={`grid transition-[grid-template-rows,opacity] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none ${
          effectiveIsNavOpen
            ? 'grid-rows-[1fr] opacity-100'
            : 'grid-rows-[0fr] opacity-0 pointer-events-none'
        }`}
      >
        <div
          className="overflow-hidden min-h-0"
          style={
            dragOffsetY !== 0
              ? { transform: `translateY(${dragOffsetY}px)`, transition: 'none' }
              : undefined
          }
        >
          <nav
            aria-label="Primary POS navigation"
            className="flex items-center justify-between gap-1 overflow-x-auto scrollbar-none bg-slate-900/90 border-t border-slate-800 text-xs px-2 py-1"
          >
        {isTabVisible('billing') && (
          <button
            type="button"
            onClick={() => handleTabChange('billing')}
            className={`flex-1 min-w-[72px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition ${
              activeTab === 'billing'
                ? 'text-blue-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Store className="w-4 h-4" />
            <span>Billing</span>
          </button>
        )}

        {isTabVisible('khata') && (
          <button
            type="button"
            onClick={() => handleTabChange('khata')}
            className={`flex-1 min-w-[84px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition ${
              activeTab === 'khata'
                ? 'text-blue-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>Khata (Udhar)</span>
          </button>
        )}

        {isTabVisible('inventory') && (
          <button
            type="button"
            onClick={() => handleTabChange('inventory')}
            className={`flex-1 min-w-[72px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition relative ${
              activeTab === 'inventory'
                ? 'text-blue-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className={isMobileLayout ? 'text-base' : 'text-xs'}>📦</span>
            <span>Stock</span>
            {lowStockCount > 0 && (
              <span className="ml-1 px-1 py-0.2 bg-slate-800 text-amber-300 text-[9px] font-black rounded border border-slate-700 tabular-nums">
                {lowStockCount}
              </span>
            )}
          </button>
        )}

        {isTabVisible('suppliers') && (
          <button
            type="button"
            onClick={() => handleTabChange('suppliers')}
            className={`flex-1 min-w-[76px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition relative ${
              activeTab === 'suppliers'
                ? 'text-blue-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Truck className="w-4 h-4" />
            <span>Suppliers</span>
            {pendingPoAlertCount > 0 && (
              <span className="ml-0.5 px-1.5 py-0.2 bg-amber-500/20 text-amber-300 text-[9px] font-black rounded-full border border-amber-500/30 tabular-nums">
                {pendingPoAlertCount}
              </span>
            )}
          </button>
        )}

        {isTabVisible('cashflow') && (
          <button
            type="button"
            onClick={() => handleTabChange('cashflow')}
            className={`flex-1 min-w-[78px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition ${
              activeTab === 'cashflow'
                ? 'text-emerald-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Wallet className="w-4 h-4" />
            <span>Cash Flow</span>
          </button>
        )}

        {isTabVisible('reports') && (
          <button
            type="button"
            onClick={() => handleTabChange('reports')}
            className={`flex-1 min-w-[72px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition ${
              activeTab === 'reports'
                ? 'text-blue-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <span className={isMobileLayout ? 'text-base' : 'text-xs'}>📊</span>
            <span>Analytics</span>
          </button>
        )}

        {isTabVisible('staff_loyalty') && (
          <button
            type="button"
            onClick={() => handleTabChange('staff_loyalty')}
            className={`flex-1 min-w-[84px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition ${
              activeTab === 'staff_loyalty'
                ? 'text-amber-300 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Award className="w-4 h-4" />
            <span>Team &amp; Rewards</span>
          </button>
        )}

        {isTabVisible('whatsapp') && (
          <button
            type="button"
            onClick={() => handleTabChange('whatsapp')}
            className={`flex-1 min-w-[84px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition relative ${
              activeTab === 'whatsapp'
                ? 'text-emerald-400 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <MessageSquare className="w-4 h-4" />
            <span>WhatsApp</span>
            {storeProfile?.whatsappConfig?.enabled === false ? (
              <span className="ml-0.5 px-1 py-0.2 bg-slate-800 text-slate-400 text-[9px] font-bold rounded border border-slate-700">
                OFF
              </span>
            ) : pendingWhatsappCount > 0 ? (
              <span className="ml-0.5 px-1.5 py-0.2 bg-emerald-500/20 text-emerald-300 text-[9px] font-black rounded border border-emerald-500/30 tabular-nums">
                {pendingWhatsappCount}
              </span>
            ) : null}
          </button>
        )}

        {isStoreProfileVisible && (
          <button
            type="button"
            onClick={() => handleTabChange('store_profile')}
            className={`flex-1 min-w-[82px] whitespace-nowrap py-1.5 px-2 rounded-lg flex ${
              isMobileLayout ? 'flex-col' : 'flex-row'
            } items-center justify-center gap-1 font-bold transition ${
              activeTab === 'store_profile'
                ? 'text-sky-300 bg-slate-800/80 shadow-sm'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            <Building2 className="w-4 h-4" />
            <span>Store Profile</span>
          </button>
        )}
      </nav>
        </div>
      </div>
    </header>
  );
};
