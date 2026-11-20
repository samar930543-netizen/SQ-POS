import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { ViewportLayoutMode, ViewportLayoutPreference } from '../types';

export const VIEWPORT_LAYOUT_STORAGE_KEY = 'sq_viewport_layout_pref_v1';

export const VIEWPORT_BREAKPOINTS = {
  MOBILE_MAX: 639,
  TABLET_MIN: 640,
  TABLET_MAX: 1023,
  DESKTOP_MIN: 1024,
  WIDE_DESKTOP_MIN: 1280,
} as const;

export function detectLayoutFromWidth(width: number): ViewportLayoutMode {
  if (!Number.isFinite(width) || width < VIEWPORT_BREAKPOINTS.TABLET_MIN) {
    return 'mobile';
  }
  if (width < VIEWPORT_BREAKPOINTS.DESKTOP_MIN) {
    return 'tablet';
  }
  return 'desktop';
}

function readInitialWindowWidth(): number {
  if (typeof window === 'undefined') return 1280;
  return Math.max(320, Math.round(window.innerWidth || 1280));
}

function readStoredLayoutPref(): ViewportLayoutPreference {
  if (typeof window === 'undefined') return 'auto';
  try {
    const raw = window.localStorage.getItem(VIEWPORT_LAYOUT_STORAGE_KEY);
    if (raw === 'mobile' || raw === 'tablet' || raw === 'desktop' || raw === 'auto') {
      return raw;
    }
  } catch {
    // Ignore storage read error
  }
  return 'auto';
}

export interface ViewportLayoutContextValue {
  layoutPref: ViewportLayoutPreference;
  autoLayout: ViewportLayoutMode;
  resolvedLayout: ViewportLayoutMode;
  windowWidth: number;
  isMobileLayout: boolean;
  isTabletLayout: boolean;
  isDesktopLayout: boolean;
  isWideDesktop: boolean;
  setLayoutPref: (pref: ViewportLayoutPreference) => void;
  resetToAuto: () => void;
}

const defaultWidth = readInitialWindowWidth();
const defaultAuto = detectLayoutFromWidth(defaultWidth);

const DEFAULT_CONTEXT_VALUE: ViewportLayoutContextValue = {
  layoutPref: 'auto',
  autoLayout: defaultAuto,
  resolvedLayout: defaultAuto,
  windowWidth: defaultWidth,
  isMobileLayout: defaultAuto === 'mobile',
  isTabletLayout: defaultAuto === 'tablet',
  isDesktopLayout: defaultAuto === 'desktop',
  isWideDesktop: defaultAuto === 'desktop' && defaultWidth >= VIEWPORT_BREAKPOINTS.WIDE_DESKTOP_MIN,
  setLayoutPref: () => {},
  resetToAuto: () => {},
};

const ViewportLayoutContext = createContext<ViewportLayoutContextValue>(DEFAULT_CONTEXT_VALUE);

export const LayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [windowWidth, setWindowWidth] = useState<number>(readInitialWindowWidth);
  const [layoutPref, setLayoutPrefState] = useState<ViewportLayoutPreference>(readStoredLayoutPref);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let rafId: number | null = null;

    const handleResize = () => {
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
      rafId = window.requestAnimationFrame(() => {
        const nextWidth = Math.max(320, Math.round(window.innerWidth || 1280));
        setWindowWidth(prev => (prev === nextWidth ? prev : nextWidth));
        rafId = null;
      });
    };

    window.addEventListener('resize', handleResize, { passive: true });
    window.addEventListener('orientationchange', handleResize, { passive: true });

    // Initial sync in case layout mounted before paint
    handleResize();

    return () => {
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (rafId !== null) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, []);

  const setLayoutPref = useCallback((pref: ViewportLayoutPreference) => {
    setLayoutPrefState(pref);
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.setItem(VIEWPORT_LAYOUT_STORAGE_KEY, pref);
      } catch {
        // Ignore storage write errors
      }
    }
  }, []);

  const resetToAuto = useCallback(() => {
    setLayoutPref('auto');
  }, [setLayoutPref]);

  const autoLayout = useMemo(() => detectLayoutFromWidth(windowWidth), [windowWidth]);
  const resolvedLayout: ViewportLayoutMode = layoutPref === 'auto' ? autoLayout : layoutPref;

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.layout = resolvedLayout;
    document.documentElement.dataset.layoutPref = layoutPref;
  }, [resolvedLayout, layoutPref]);

  const value = useMemo<ViewportLayoutContextValue>(() => {
    const isMobileLayout = resolvedLayout === 'mobile';
    const isTabletLayout = resolvedLayout === 'tablet';
    const isDesktopLayout = resolvedLayout === 'desktop';
    const isWideDesktop =
      isDesktopLayout &&
      (layoutPref === 'desktop'
        ? windowWidth >= VIEWPORT_BREAKPOINTS.DESKTOP_MIN
        : windowWidth >= VIEWPORT_BREAKPOINTS.WIDE_DESKTOP_MIN);

    return {
      layoutPref,
      autoLayout,
      resolvedLayout,
      windowWidth,
      isMobileLayout,
      isTabletLayout,
      isDesktopLayout,
      isWideDesktop,
      setLayoutPref,
      resetToAuto,
    };
  }, [layoutPref, autoLayout, resolvedLayout, windowWidth, setLayoutPref, resetToAuto]);

  return (
    <ViewportLayoutContext.Provider value={value}>
      {children}
    </ViewportLayoutContext.Provider>
  );
};

export function useViewportLayout(): ViewportLayoutContextValue {
  return useContext(ViewportLayoutContext);
}
