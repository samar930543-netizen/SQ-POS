import React, { useState } from 'react';
import { usePWAInstall } from '../hooks/usePWAInstall';
import { soundManager } from '../utils/soundEffects';
import {
  CheckCircle2,
  ChevronDown,
  Download,
  ExternalLink,
  MoreVertical,
  PlusSquare,
  Share,
  Smartphone,
  WifiOff,
} from 'lucide-react';

interface SettingsInstallCardProps {
  onOpenApkGuide?: () => void;
}

export const SettingsInstallCard: React.FC<SettingsInstallCardProps> = ({
  onOpenApkGuide,
}) => {
  const { isInstallable, isInstalled, isIOS, isAndroid, swSupported, swReady, install } =
    usePWAInstall();
  const [showInstructions, setShowInstructions] = useState(false);
  const [promptDismissed, setPromptDismissed] = useState(false);

  // Suppress for users already running the installed standalone PWA
  if (isInstalled) {
    return null;
  }

  const handleInstallClick = async () => {
    soundManager.playMechanicalClick();
    if (isInstallable) {
      const accepted = await install();
      if (!accepted) {
        setPromptDismissed(true);
        setShowInstructions(true);
      }
      return;
    }
    setShowInstructions(prev => !prev);
  };

  return (
    <section
      aria-label="Install POS App to Home Screen"
      className="rounded-2xl bg-gradient-to-r from-emerald-950/75 via-slate-900 to-blue-950/60 border border-emerald-500/40 p-4 sm:p-5 shadow-lg space-y-3"
    >
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3.5">
        <div className="flex items-start gap-3 min-w-0">
          <div className="w-11 h-11 rounded-xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-300 flex-shrink-0">
            <Smartphone className="w-5 h-5" />
          </div>

          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="text-sm sm:text-base font-black text-white">
                Install SQ POS on Your Home Screen
              </h3>
              {swReady ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-300">
                  <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
                  Offline Service Worker Active
                </span>
              ) : swSupported ? (
                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-sky-300">
                  <WifiOff className="w-3.5 h-3.5 text-sky-400" />
                  Offline Service Worker Configured
                </span>
              ) : null}
            </div>

            <p className="text-xs text-slate-300 leading-relaxed">
              Add this POS system directly to your mobile home screen for full-screen billing without browser bars, instant launch, and offline asset caching.
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 flex-shrink-0">
          <button
            type="button"
            onClick={handleInstallClick}
            className="px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-bold text-xs shadow-lg shadow-emerald-950/50 transition active:scale-95 flex items-center gap-2 whitespace-nowrap"
          >
            <Download className="w-4 h-4" />
            <span>Install App</span>
            {!isInstallable && (
              <ChevronDown
                className={`w-3.5 h-3.5 transition-transform ${
                  showInstructions ? 'rotate-180' : ''
                }`}
              />
            )}
          </button>

          {onOpenApkGuide && (
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                onOpenApkGuide();
              }}
              className="px-3 py-2.5 rounded-xl bg-slate-900/90 hover:bg-slate-800 text-slate-200 border border-slate-700 font-semibold text-xs transition active:scale-95 flex items-center gap-1.5 whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5 text-blue-400" />
              <span>APK &amp; Setup Guide</span>
            </button>
          )}
        </div>
      </div>

      {/* Guided Home-Screen Installation Instructions when native prompt is unavailable or dismissed */}
      {(showInstructions || promptDismissed) && (
        <div className="pt-3 border-t border-emerald-500/20 grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
          {/* iPhone / iPad Safari Guide */}
          <div
            className={`p-3.5 rounded-xl border space-y-2 ${
              isIOS
                ? 'bg-slate-950 border-emerald-500/50'
                : 'bg-slate-950/75 border-slate-800'
            }`}
          >
            <div className="font-bold text-white flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <Share className="w-4 h-4 text-blue-400" />
                iPhone &amp; iPad (Safari)
              </span>
              {isIOS && (
                <span className="text-[10px] font-bold uppercase text-emerald-400">
                  Your Device
                </span>
              )}
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed">
              <li>
                Open this page in <strong className="text-white">Safari</strong>.
              </li>
              <li>
                Tap the <strong className="text-white">Share</strong> button in the browser toolbar.
              </li>
              <li>
                Scroll down and tap <strong className="text-emerald-300">Add to Home Screen</strong>, then tap <strong className="text-white">Add</strong>.
              </li>
            </ol>
          </div>

          {/* Android Chrome / Chromium Guide */}
          <div
            className={`p-3.5 rounded-xl border space-y-2 ${
              isAndroid || !isIOS
                ? 'bg-slate-950 border-emerald-500/50'
                : 'bg-slate-950/75 border-slate-800'
            }`}
          >
            <div className="font-bold text-white flex items-center justify-between gap-2">
              <span className="flex items-center gap-1.5">
                <PlusSquare className="w-4 h-4 text-emerald-400" />
                Android Chrome &amp; Mobile Browsers
              </span>
              {isAndroid && (
                <span className="text-[10px] font-bold uppercase text-emerald-400">
                  Your Device
                </span>
              )}
            </div>
            <ol className="list-decimal list-inside space-y-1 text-slate-300 leading-relaxed">
              <li>
                Tap the browser menu icon (<MoreVertical className="w-3 h-3 inline text-slate-200" />) in the top-right corner of Chrome.
              </li>
              <li>
                Tap <strong className="text-emerald-300">Install app</strong> or <strong className="text-emerald-300">Add to Home screen</strong>.
              </li>
              <li>
                Confirm <strong className="text-white">Install</strong> to launch <strong className="text-white">SQ POS</strong> full-screen with offline caching.
              </li>
            </ol>
          </div>
        </div>
      )}
    </section>
  );
};
