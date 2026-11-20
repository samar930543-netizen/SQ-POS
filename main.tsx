import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  registerSW({
    immediate: true,
    onOfflineReady() {
      window.dispatchEvent(new CustomEvent('sq-sw-offline-ready'));
    },
    onRegisteredSW(_swUrl, registration) {
      if (registration && 'sync' in registration) {
        (registration as ServiceWorkerRegistration & { sync?: { register: (tag: string) => Promise<void> } }).sync
          ?.register('sync-sq-pos-queue')
          .catch(() => {});
      }
    },
  });
}

createRoot(document.getElementById('root')!).render(<App />);
