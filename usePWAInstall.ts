import { useEffect, useState } from 'react';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
}

interface PwaStoreState {
  deferredPrompt: BeforeInstallPromptEvent | null;
  isInstalled: boolean;
  isIOS: boolean;
  isAndroid: boolean;
  swSupported: boolean;
  swReady: boolean;
}

const listeners = new Set<(state: PwaStoreState) => void>();

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia?.('(display-mode: standalone)').matches === true ||
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function getInitialStoreState(): PwaStoreState {
  if (typeof window === 'undefined') {
    return {
      deferredPrompt: null,
      isInstalled: false,
      isIOS: false,
      isAndroid: false,
      swSupported: false,
      swReady: false,
    };
  }
  const ua = window.navigator.userAgent.toLowerCase();
  const isIOS =
    /iphone|ipad|ipod/.test(ua) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const isAndroid = /android/.test(ua);
  const swSupported = 'serviceWorker' in navigator;

  return {
    deferredPrompt: null,
    isInstalled: detectStandalone(),
    isIOS,
    isAndroid,
    swSupported,
    swReady: false,
  };
}

let pwaState: PwaStoreState = getInitialStoreState();
let storeInitialized = false;

function updatePwaState(partial: Partial<PwaStoreState>) {
  pwaState = { ...pwaState, ...partial };
  listeners.forEach(listener => listener(pwaState));
}

function initPwaStoreListeners() {
  if (storeInitialized || typeof window === 'undefined') return;
  storeInitialized = true;

  const handleBeforeInstallPrompt = (e: Event) => {
    e.preventDefault();
    updatePwaState({ deferredPrompt: e as BeforeInstallPromptEvent });
  };

  const handleAppInstalled = () => {
    updatePwaState({ isInstalled: true, deferredPrompt: null });
  };

  const handleOfflineReady = () => {
    updatePwaState({ swReady: true });
  };

  window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
  window.addEventListener('appinstalled', handleAppInstalled);
  window.addEventListener('sq-sw-offline-ready', handleOfflineReady);

  const standaloneMedia = window.matchMedia?.('(display-mode: standalone)');
  if (standaloneMedia?.addEventListener) {
    standaloneMedia.addEventListener('change', () => {
      updatePwaState({ isInstalled: detectStandalone() });
    });
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker
      .getRegistration()
      .then(reg => {
        if (reg && (reg.active || reg.waiting || reg.installing)) {
          updatePwaState({ swReady: true });
        }
      })
      .catch(() => {});

    navigator.serviceWorker.ready
      .then(() => {
        updatePwaState({ swReady: true });
      })
      .catch(() => {});
  }
}

if (typeof window !== 'undefined') {
  initPwaStoreListeners();
}

export function usePWAInstall() {
  const [state, setState] = useState<PwaStoreState>(() => pwaState);

  useEffect(() => {
    initPwaStoreListeners();
    setState(pwaState);

    const listener = (nextState: PwaStoreState) => {
      setState(nextState);
    };
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  const install = async (): Promise<boolean> => {
    const promptEvent = pwaState.deferredPrompt;
    if (!promptEvent) return false;
    try {
      await promptEvent.prompt();
      const { outcome } = await promptEvent.userChoice;
      if (outcome === 'accepted') {
        updatePwaState({ isInstalled: true, deferredPrompt: null });
        return true;
      }
      updatePwaState({ deferredPrompt: null });
      return false;
    } catch {
      return false;
    }
  };

  return {
    isInstallable: Boolean(state.deferredPrompt),
    isInstalled: state.isInstalled,
    isIOS: state.isIOS,
    isAndroid: state.isAndroid,
    swSupported: state.swSupported,
    swReady: state.swReady,
    install,
  };
}
