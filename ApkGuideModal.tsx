import React, { useState } from 'react';
import {
  Smartphone,
  Download,
  Copy,
  Check,
  ExternalLink,
  X,
  FileCode,
  ShieldCheck,
  Upload,
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { exportAllData, importDataFromJson, resetToDemoData } from '../utils/storage';
import { soundManager } from '../utils/soundEffects';

interface ApkGuideModalProps {
  isOpen: boolean;
  onClose: () => void;
  onDataRefreshed: () => void;
}

export const ApkGuideModal: React.FC<ApkGuideModalProps> = ({
  isOpen,
  onClose,
  onDataRefreshed,
}) => {
  const [activeTab, setActiveTab] = useState<'pwabuilder' | 'chrome' | 'capacitor' | 'backup'>('pwabuilder');
  const [copiedUrl, setCopiedUrl] = useState(false);
  const [copiedCmd, setCopiedCmd] = useState(false);
  const [backupStatus, setBackupStatus] = useState<string | null>(null);

  if (!isOpen) return null;

  const currentUrl = typeof window !== 'undefined' ? window.location.origin : '';

  const handleCopyUrl = () => {
    soundManager.playMechanicalClick();
    navigator.clipboard.writeText(currentUrl);
    setCopiedUrl(true);
    setTimeout(() => setCopiedUrl(false), 2000);
  };

  const handleExportJson = () => {
    soundManager.playCheckoutSuccess();
    const jsonStr = exportAllData();
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `SQ_ENTERPRISES_BACKUP_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    setBackupStatus('Backup downloaded successfully!');
    setTimeout(() => setBackupStatus(null), 3000);
  };

  const handleImportJson = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = event => {
      const content = event.target?.result as string;
      if (content) {
        const success = importDataFromJson(content);
        if (success) {
          soundManager.playCheckoutSuccess();
          setBackupStatus('Data restored successfully!');
          onDataRefreshed();
        } else {
          soundManager.playAlertSound();
          setBackupStatus('Error restoring data. Invalid JSON file.');
        }
        setTimeout(() => setBackupStatus(null), 3500);
      }
    };
    reader.readAsText(file);
  };

  const handleResetData = () => {
    if (confirm('Are you sure you want to reset to initial FMCG wholesale demo catalog?')) {
      soundManager.playAlertSound();
      resetToDemoData();
      onDataRefreshed();
      setBackupStatus('Demo data restored!');
      setTimeout(() => setBackupStatus(null), 3000);
    }
  };

  const capacitorCommands = `npm install @capacitor/core @capacitor/cli @capacitor/android
npx cap init "SQ ENTERPRISES" "com.sqenterprises.pos" --web-dir dist
npm run build
npx cap add android
npx cap open android
# In Android Studio: Build > Build Bundle(s) / APK(s) > Build APK(s)`;

  const handleCopyCmd = () => {
    soundManager.playMechanicalClick();
    navigator.clipboard.writeText(capacitorCommands);
    setCopiedCmd(true);
    setTimeout(() => setCopiedCmd(false), 2000);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 sm:p-4 backdrop-blur-sm overflow-y-auto">
      <div className="w-full max-w-lg my-auto bg-slate-900 border border-slate-700 rounded-2xl shadow-2xl flex flex-col max-h-[92vh] overflow-hidden text-slate-100 animate-in fade-in zoom-in-95 duration-200">
        
        {/* Header */}
        <div className="px-5 py-4 bg-slate-950 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/20 text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </span>
            <div>
              <h3 className="font-bold text-sm sm:text-base text-white tracking-wide">
                GET ANDROID .APK FILE
              </h3>
              <p className="text-xs text-slate-400">Step-by-step instructions to install on Android phone</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-950/80 border-b border-slate-800 px-3 pt-2 gap-1 text-xs overflow-x-auto scrollbar-none">
          <button
            onClick={() => setActiveTab('pwabuilder')}
            className={`py-2 px-3 font-bold rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'pwabuilder'
                ? 'bg-slate-900 text-blue-400 border-t border-x border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            1. PWABuilder (Instant .APK)
          </button>
          <button
            onClick={() => setActiveTab('chrome')}
            className={`py-2 px-3 font-bold rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'chrome'
                ? 'bg-slate-900 text-emerald-400 border-t border-x border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            2. Chrome Install (No PC)
          </button>
          <button
            onClick={() => setActiveTab('capacitor')}
            className={`py-2 px-3 font-bold rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'capacitor'
                ? 'bg-slate-900 text-amber-400 border-t border-x border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            3. Standalone Android Studio
          </button>
          <button
            onClick={() => setActiveTab('backup')}
            className={`py-2 px-3 font-bold rounded-t-xl transition whitespace-nowrap ${
              activeTab === 'backup'
                ? 'bg-slate-900 text-purple-400 border-t border-x border-slate-700'
                : 'text-slate-400 hover:text-white'
            }`}
          >
            Data Backup & Restore
          </button>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-5 overflow-y-auto flex-1 space-y-4 text-xs">
          
          {backupStatus && (
            <div className="p-2.5 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 font-bold flex items-center gap-2">
              <Check className="w-4 h-4" />
              {backupStatus}
            </div>
          )}

          {/* TAB 1: PWABUILDER */}
          {activeTab === 'pwabuilder' && (
            <div className="space-y-3.5 leading-relaxed">
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-xl text-blue-300">
                <p className="font-bold text-white mb-1">Recommended for You: 1-Click .APK Generation</p>
                This POS app includes a certified PWA manifest and service worker. You can generate a signed, installable Android <strong className="text-white">.apk</strong> file for free in 2 minutes using Microsoft's official PWABuilder.
              </div>

              {/* App URL Copy Box */}
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1.5">
                <span className="text-slate-400 font-semibold block text-[11px]">
                  YOUR POS APP URL:
                </span>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={currentUrl}
                    className="flex-1 bg-slate-900 border border-slate-700 px-2.5 py-1.5 rounded-lg text-white font-mono text-xs select-all"
                  />
                  <button
                    onClick={handleCopyUrl}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white font-bold rounded-lg flex items-center gap-1 transition"
                  >
                    {copiedUrl ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedUrl ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>

              {/* Exact Step-by-Step */}
              <div className="space-y-2.5">
                <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                  Exact Steps to download your .apk:
                </h4>
                
                <ol className="list-decimal list-inside space-y-2 text-slate-300 pl-1">
                  <li>
                    Click here to open{' '}
                    <a
                      href="https://www.pwabuilder.com"
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-400 font-bold underline inline-flex items-center gap-0.5"
                    >
                      pwabuilder.com <ExternalLink className="w-3 h-3" />
                    </a>{' '}
                    in your browser.
                  </li>
                  <li>
                    Paste your copied POS App URL in the box and click <strong className="text-white">Start</strong>.
                  </li>
                  <li>
                    PWABuilder will verify the app (Manifest, Icons, Offline Service Worker). All checks will pass green!
                  </li>
                  <li>
                    Click <strong className="text-white">Package for Stores</strong> &gt; Select <strong className="text-emerald-400">Android</strong>.
                  </li>
                  <li>
                    Select <strong className="text-white">"Download APK"</strong> (or Google Play .aab package).
                  </li>
                  <li>
                    Send the downloaded <strong className="text-white">.apk</strong> file to your Android phone via WhatsApp, USB, or Google Drive.
                  </li>
                  <li>
                    Tap on the .apk file on your phone and click <strong className="text-emerald-400">Install</strong>! It installs just like any native app.
                  </li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 2: CHROME NATIVE INSTALL */}
          {activeTab === 'chrome' && (
            <div className="space-y-3.5 leading-relaxed">
              <div className="p-3 bg-emerald-500/10 border border-emerald-500/30 rounded-xl text-emerald-300">
                <p className="font-bold text-white mb-1">Fastest Option (Zero PC Needed):</p>
                Android Google Chrome has built-in <strong className="text-white">WebAPK</strong> technology. It turns this POS web app directly into a native Android app in your phone's app drawer with its own app icon and splash screen.
              </div>

              <div className="space-y-2 text-slate-300">
                <h4 className="font-bold text-white uppercase tracking-wider text-[11px]">
                  How to install directly on phone:
                </h4>
                <ol className="list-decimal list-inside space-y-2 text-slate-300 pl-1">
                  <li>Open Google Chrome on your Android phone.</li>
                  <li>Visit this exact POS link: <code className="text-blue-300 font-mono text-[11px]">{currentUrl}</code></li>
                  <li>
                    Tap the green <strong className="text-emerald-400">"Install POS App"</strong> button inside the app bar (or tap Chrome's 3 dots in the top right &gt; <strong className="text-white">"Install app"</strong> / <strong className="text-white">"Add to Home Screen"</strong>).
                  </li>
                  <li>Tap <strong className="text-emerald-400">Install</strong> on the confirmation popup.</li>
                  <li>
                    Android OS generates the native package in the background. Look at your phone's home screen or app drawer: the <strong className="text-white">SQ POS</strong> app is ready!
                  </li>
                  <li>It runs full-screen, offline-enabled, without any browser URL bar.</li>
                </ol>
              </div>
            </div>
          )}

          {/* TAB 3: CAPACITOR STANDALONE */}
          {activeTab === 'capacitor' && (
            <div className="space-y-3.5 leading-relaxed">
              <p className="text-slate-300">
                If you are a developer or want to build a completely standalone offline APK using Android Studio and Gradle:
              </p>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-slate-400 font-semibold text-[11px]">RUN IN TERMINAL:</span>
                  <button
                    onClick={handleCopyCmd}
                    className="px-2.5 py-1 bg-slate-800 hover:bg-slate-700 text-blue-400 text-xs font-semibold rounded-lg flex items-center gap-1"
                  >
                    {copiedCmd ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                    <span>{copiedCmd ? 'Copied' : 'Copy Commands'}</span>
                  </button>
                </div>
                <pre className="text-[11px] font-mono text-emerald-400 whitespace-pre overflow-x-auto p-2 bg-slate-900 rounded-lg">
                  {capacitorCommands}
                </pre>
              </div>

              <div className="text-slate-300 space-y-1">
                <p>• In Android Studio, open the generated <code>android</code> folder.</p>
                <p>• Click <strong>Build &gt; Build Bundle(s) / APK(s) &gt; Build APK(s)</strong>.</p>
                <p>• Your final file will be located at: <code>android/app/build/outputs/apk/debug/app-debug.apk</code></p>
              </div>
            </div>
          )}

          {/* TAB 4: BACKUP & RESTORE */}
          {activeTab === 'backup' && (
            <div className="space-y-4">
              <div className="p-3 bg-purple-500/10 border border-purple-500/30 rounded-xl text-purple-300">
                <p className="font-bold text-white mb-1">Safe Merchant Khata & Inventory Backup</p>
                Export all your customer ledger dues, bills, and wholesale inventory to a JSON file. Keep it in Google Drive or WhatsApp, and easily restore it whenever you switch phones.
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <button
                  onClick={handleExportJson}
                  className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-purple-500/60 flex flex-col items-center justify-center text-center gap-2 transition group"
                >
                  <Download className="w-6 h-6 text-purple-400 group-hover:scale-110 transition" />
                  <span className="font-bold text-white text-xs">Export Backup (JSON)</span>
                  <span className="text-[10px] text-slate-400">Download complete catalog & Khata records</span>
                </button>

                <label className="p-4 rounded-xl bg-slate-950 border border-slate-800 hover:border-blue-500/60 flex flex-col items-center justify-center text-center gap-2 transition cursor-pointer group">
                  <Upload className="w-6 h-6 text-blue-400 group-hover:scale-110 transition" />
                  <span className="font-bold text-white text-xs">Restore Backup (JSON)</span>
                  <span className="text-[10px] text-slate-400">Upload a saved JSON backup file</span>
                  <input
                    type="file"
                    accept=".json"
                    onChange={handleImportJson}
                    className="hidden"
                  />
                </label>
              </div>

              <div className="pt-2 border-t border-slate-800 flex justify-between items-center">
                <span className="text-[11px] text-slate-400">Reset catalog to default wholesale FMCG:</span>
                <button
                  onClick={handleResetData}
                  className="px-3 py-1.5 rounded-lg bg-rose-500/20 text-rose-300 border border-rose-500/30 font-semibold text-xs hover:bg-rose-500/30 transition"
                >
                  Reset Demo Data
                </button>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="p-4 bg-slate-950 border-t border-slate-800 flex justify-end">
          <button
            onClick={onClose}
            className="px-5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-white font-bold text-xs"
          >
            Close Guide
          </button>
        </div>

      </div>
    </div>
  );
};
