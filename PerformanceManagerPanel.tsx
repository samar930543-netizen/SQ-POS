import React from 'react';
import { PerformanceSettings } from '../types';
import { soundManager } from '../utils/soundEffects';
import {
  BarChart3,
  Cloud,
  Eye,
  Gauge,
  RotateCcw,
  Zap,
} from 'lucide-react';

interface PerformanceManagerPanelProps {
  settings: PerformanceSettings;
  onUpdate: (next: PerformanceSettings) => void;
}

const PERFORMANCE_FEATURES: Array<{
  key: keyof PerformanceSettings;
  title: string;
  resourceImpact: string;
  description: string;
  pausedNote: string;
  Icon: React.FC<{ className?: string }>;
  accentClass: string;
}> = [
  {
    key: 'enablePredictiveAnalytics',
    title: 'Predictive Analytics & Forecasting',
    resourceImpact: 'CPU · 60-Day Seasonality & Z-Score Demand Spikes',
    description:
      'Continuously computes 60-day weekday multipliers, demand surge detection, and 7D/30D inventory reorder projections in Analytics.',
    pausedNote:
      'Analytics opens instantly with core revenue/unit totals; predictive projections remain available via 1-click "Run Predictive Analysis Once".',
    Icon: BarChart3,
    accentClass: 'text-purple-400',
  },
  {
    key: 'enableAutoCloudSync',
    title: 'Automatic Cloud Syncing',
    resourceImpact: 'Network & Storage · 20s Background Loop & Bulk Mirror',
    description:
      'Automatically polls the sync server every 20s, auto-flushes queued operations after billing/reconnect, and mirrors full bill history into IndexedDB.',
    pausedNote:
      'Bills continue saving safely to local queue & storage; background polling pauses while manual "Sync Now" & Backup stay active.',
    Icon: Cloud,
    accentClass: 'text-sky-400',
  },
  {
    key: 'enableLiveReceiptRendering',
    title: 'Live Receipt Rendering',
    resourceImpact: 'DOM & Layout · Continuous Thermal Paper Previews',
    description:
      'Continuously renders live pixel-accurate 58mm/80mm thermal receipts and store invoice previews as you toggle fields or open bills.',
    pausedNote:
      'Shows fast lightweight receipt specs & itemized summaries with on-demand "Render Preview" and full automatic rendering on Print.',
    Icon: Eye,
    accentClass: 'text-emerald-400',
  },
];

export const PerformanceManagerPanel: React.FC<PerformanceManagerPanelProps> = ({
  settings,
  onUpdate,
}) => {
  const activeCount = [
    settings.enablePredictiveAnalytics,
    settings.enableAutoCloudSync,
    settings.enableLiveReceiptRendering,
  ].filter(Boolean).length;

  const isAllOn = activeCount === 3;
  const isMaxSpeed = activeCount === 0;

  const handleToggle = (key: keyof PerformanceSettings) => {
    soundManager.playMechanicalClick();
    onUpdate({
      ...settings,
      [key]: !settings[key],
    });
  };

  const handleApplyPreset = (enabled: boolean) => {
    soundManager.playCheckoutSuccess();
    onUpdate({
      enablePredictiveAnalytics: enabled,
      enableAutoCloudSync: enabled,
      enableLiveReceiptRendering: enabled,
    });
  };

  return (
    <div className="space-y-3.5">
      {/* Header Summary & One-Click Speed Presets */}
      <div className="p-3.5 rounded-xl bg-slate-950/90 border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-start gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
            <Gauge
              className={`w-4 h-4 ${
                isAllOn
                  ? 'text-emerald-400'
                  : isMaxSpeed
                  ? 'text-amber-400'
                  : 'text-blue-400'
              }`}
            />
          </div>
          <div className="min-w-0">
            <div className="text-xs font-bold text-white flex items-center gap-2">
              <span>Resource &amp; Speed Profile</span>
              <span className="font-mono text-[11px] font-semibold text-slate-300 tabular-nums">
                · {activeCount} of 3 active
              </span>
            </div>
            <p className="text-[11px] text-slate-400 mt-0.5 leading-snug">
              Pause heavy background engines individually to optimize POS responsiveness on low-power devices without removing any features.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap">
          <button
            type="button"
            onClick={() => handleApplyPreset(true)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition flex items-center gap-1.5 whitespace-nowrap ${
              isAllOn
                ? 'bg-emerald-600/20 border-emerald-500 text-emerald-200'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <RotateCcw className="w-3 h-3" />
            Full Features (3/3)
          </button>
          <button
            type="button"
            onClick={() => handleApplyPreset(false)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-bold border transition flex items-center gap-1.5 whitespace-nowrap ${
              isMaxSpeed
                ? 'bg-amber-600/20 border-amber-500 text-amber-200'
                : 'bg-slate-900 hover:bg-slate-800 border-slate-700 text-slate-300 hover:text-white'
            }`}
          >
            <Zap className="w-3 h-3 text-amber-400" />
            Max Speed Mode (0/3)
          </button>
        </div>
      </div>

      {/* Individual Master Feature Toggles */}
      <div className="space-y-2.5">
        {PERFORMANCE_FEATURES.map(feat => {
          const isEnabled = settings[feat.key];
          const IconComp = feat.Icon;
          return (
            <div
              key={feat.key}
              className={`p-3.5 rounded-xl border transition ${
                isEnabled
                  ? 'bg-slate-950/90 border-slate-800'
                  : 'bg-slate-950/50 border-amber-500/30'
              }`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="flex items-start gap-3 min-w-0">
                  <div className="mt-0.5 w-8 h-8 rounded-lg bg-slate-900 border border-slate-800 flex items-center justify-center flex-shrink-0">
                    <IconComp
                      className={`w-4 h-4 ${
                        isEnabled ? feat.accentClass : 'text-slate-500'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-xs font-bold text-white">
                        {feat.title}
                      </span>
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          isEnabled ? 'text-emerald-400' : 'text-amber-400'
                        }`}
                      >
                        {isEnabled ? 'Active' : 'Paused (Fast Mode)'}
                      </span>
                    </div>
                    <div className="text-[10.5px] font-mono text-slate-400">
                      {feat.resourceImpact}
                    </div>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {isEnabled ? feat.description : feat.pausedNote}
                    </p>
                  </div>
                </div>

                <button
                  type="button"
                  role="switch"
                  aria-checked={isEnabled}
                  aria-label={`Toggle ${feat.title}`}
                  onClick={() => handleToggle(feat.key)}
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
            </div>
          );
        })}
      </div>
    </div>
  );
};
