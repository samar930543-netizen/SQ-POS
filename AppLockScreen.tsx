import React, { useCallback, useEffect, useRef, useState } from 'react';
import { AppLockSettings, StoreBranch, StoreProfile } from '../types';
import {
  BiometricCapabilityStatus,
  authenticateWithBiometric,
  checkBiometricCapability,
  verifyMasterPin,
} from '../utils/appLock';
import { DEFAULT_APP_LOCK_PIN } from '../utils/storage';
import { soundManager } from '../utils/soundEffects';
import { ForgotPinRecoveryPanel } from './ForgotPinRecoveryPanel';
import {
  AlertTriangle,
  Delete,
  Fingerprint,
  HelpCircle,
  KeyRound,
  Lock,
  ScanFace,
  ShieldCheck,
} from 'lucide-react';

interface AppLockScreenProps {
  settings: AppLockSettings;
  storeProfile: StoreProfile;
  activeBranch?: StoreBranch | null;
  onUnlock: (method: 'pin' | 'biometric', credentialId?: string) => void;
  onResetPin: (newPin: string, recoveryMethodSummary: string) => void;
}

const MAX_PIN_ATTEMPTS = 5;
const LOCKOUT_SECONDS = 30;

export const AppLockScreen: React.FC<AppLockScreenProps> = ({
  settings,
  storeProfile,
  activeBranch,
  onUnlock,
  onResetPin,
}) => {
  const [pinDigits, setPinDigits] = useState('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [cooldownRemaining, setCooldownRemaining] = useState(0);
  const [isCheckingBiometric, setIsCheckingBiometric] = useState(false);
  const [biometricStatus, setBiometricStatus] = useState<string | null>(null);
  const [capability, setCapability] = useState<BiometricCapabilityStatus | null>(null);
  const [isForgotPinOpen, setIsForgotPinOpen] = useState(false);
  const autoPromptFiredRef = useRef(false);

  const hasEnrolledBiometrics =
    settings.biometricEnabled && settings.biometricCredentials.length > 0;
  const displayStoreName = storeProfile.storeName?.trim() || 'SQ ENTERPRISES';
  const storeInitials =
    displayStoreName
      .split(/\s+/)
      .slice(0, 2)
      .map(w => w[0]?.toUpperCase() || '')
      .join('') || 'SQ';

  useEffect(() => {
    void checkBiometricCapability().then(setCapability);
  }, []);

  useEffect(() => {
    if (cooldownRemaining <= 0) return;
    const timer = window.setInterval(() => {
      setCooldownRemaining(prev => {
        if (prev <= 1) {
          setFailedAttempts(0);
          setErrorMsg(null);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldownRemaining]);

  const handleBiometricUnlock = useCallback(async () => {
    if (!hasEnrolledBiometrics || isCheckingBiometric) return;
    setIsCheckingBiometric(true);
    setErrorMsg(null);
    setBiometricStatus('Waiting for Fingerprint or Face verification...');
    try {
      const res = await authenticateWithBiometric(settings);
      if (res.ok) {
        soundManager.playCheckoutSuccess();
        soundManager.vibrateSaleCompleted();
        onUnlock('biometric', res.credentialId);
      } else {
        soundManager.playAlertSound();
        setBiometricStatus(
          res.error || 'Biometric unlock was not completed. Enter your 4-digit PIN.'
        );
      }
    } finally {
      setIsCheckingBiometric(false);
    }
  }, [hasEnrolledBiometrics, isCheckingBiometric, onUnlock, settings]);

  // Trigger biometric prompt once on launch if enrolled & supported
  useEffect(() => {
    if (
      !autoPromptFiredRef.current &&
      hasEnrolledBiometrics &&
      capability?.canUseBiometric
    ) {
      autoPromptFiredRef.current = true;
      const t = window.setTimeout(() => {
        void handleBiometricUnlock();
      }, 220);
      return () => window.clearTimeout(t);
    }
  }, [hasEnrolledBiometrics, capability?.canUseBiometric, handleBiometricUnlock]);

  const submitPin = useCallback(
    (candidate: string) => {
      if (cooldownRemaining > 0) return;
      if (verifyMasterPin(candidate, settings)) {
        soundManager.playCheckoutSuccess();
        soundManager.vibrateSaleCompleted();
        setErrorMsg(null);
        setPinDigits('');
        onUnlock('pin');
      } else {
        soundManager.playAlertSound();
        const nextAttempts = failedAttempts + 1;
        setFailedAttempts(nextAttempts);
        setPinDigits('');
        if (nextAttempts >= MAX_PIN_ATTEMPTS) {
          setCooldownRemaining(LOCKOUT_SECONDS);
          setErrorMsg(
            `Too many incorrect PIN attempts. PIN keypad paused for ${LOCKOUT_SECONDS}s.`
          );
        } else {
          setErrorMsg(
            `Incorrect 4-digit Master PIN (${MAX_PIN_ATTEMPTS - nextAttempts} attempt${
              MAX_PIN_ATTEMPTS - nextAttempts === 1 ? '' : 's'
            } remaining).`
          );
        }
      }
    },
    [cooldownRemaining, failedAttempts, onUnlock, settings]
  );

  const handleAppendDigit = useCallback(
    (digit: string) => {
      if (cooldownRemaining > 0 || pinDigits.length >= 4) return;
      soundManager.playMechanicalClick();
      soundManager.vibrateTap();
      setErrorMsg(null);
      const next = `${pinDigits}${digit}`;
      setPinDigits(next);
      if (next.length === 4) {
        window.setTimeout(() => submitPin(next), 90);
      }
    },
    [cooldownRemaining, pinDigits, submitPin]
  );

  const handleBackspace = useCallback(() => {
    if (cooldownRemaining > 0 || pinDigits.length === 0) return;
    soundManager.playMechanicalClick();
    setPinDigits(prev => prev.slice(0, -1));
  }, [cooldownRemaining, pinDigits.length]);

  const handleClear = useCallback(() => {
    if (cooldownRemaining > 0) return;
    soundManager.playMechanicalClick();
    setPinDigits('');
    setErrorMsg(null);
  }, [cooldownRemaining]);

  // Physical keyboard digit & backspace support (disabled while Forgot PIN inputs are active)
  useEffect(() => {
    if (isForgotPinOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= '0' && e.key <= '9') {
        e.preventDefault();
        handleAppendDigit(e.key);
      } else if (e.key === 'Backspace') {
        e.preventDefault();
        handleBackspace();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        handleClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isForgotPinOpen, handleAppendDigit, handleBackspace, handleClear]);

  return (
    <div
      className="fixed inset-0 z-[100] bg-slate-950 text-slate-100 flex items-center justify-center p-4 overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-label="POS Terminal Authentication Lock Screen"
    >
      <div className="w-full max-w-md bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl p-5 sm:p-7 space-y-5">
        {/* Store Identity Header (No Sensitive Sales/Stock Metrics Exposed) */}
        <div className="flex flex-col items-center text-center space-y-2.5">
          {storeProfile.logoDataUrl ? (
            <img
              src={storeProfile.logoDataUrl}
              alt={displayStoreName}
              className="w-14 h-14 rounded-2xl object-contain bg-white p-1 border border-slate-700 shadow-md"
            />
          ) : (
            <div className="w-14 h-14 rounded-2xl bg-gradient-to-br from-blue-600 via-indigo-600 to-sky-500 flex items-center justify-center text-white font-black text-lg shadow-lg">
              {storeInitials}
            </div>
          )}

          <div>
            <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-sky-300">
              <Lock className="w-3.5 h-3.5" />
              <span>POS Terminal Locked</span>
              {activeBranch && (
                <>
                  <span aria-hidden="true">·</span>
                  <span className="font-mono">{activeBranch.code}</span>
                </>
              )}
            </div>
            <h1 className="text-lg sm:text-xl font-black text-white mt-0.5">
              {displayStoreName}
            </h1>
            <p className="text-xs text-slate-400 mt-0.5">
              Verify with Fingerprint / Face ID or enter your 4-digit Master PIN to access billing.
            </p>
          </div>
        </div>

        {isForgotPinOpen ? (
          <ForgotPinRecoveryPanel
            settings={settings}
            storeProfile={storeProfile}
            onCancel={() => {
              setIsForgotPinOpen(false);
              setErrorMsg(null);
            }}
            onCompleteReset={(newPin, methodSummary) => {
              setFailedAttempts(0);
              setCooldownRemaining(0);
              setPinDigits('');
              setErrorMsg(null);
              setIsForgotPinOpen(false);
              onResetPin(newPin, methodSummary);
            }}
          />
        ) : (
          <>
            {/* Biometric Unlock Action */}
            {settings.biometricEnabled && (
              <div className="space-y-2">
                {hasEnrolledBiometrics ? (
                  <button
                    type="button"
                    disabled={isCheckingBiometric}
                    onClick={() => void handleBiometricUnlock()}
                    className="w-full min-h-[52px] px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 text-white font-bold text-sm flex items-center justify-center gap-2.5 shadow-lg shadow-emerald-950/50 transition active:scale-[0.98]"
                  >
                    <Fingerprint className="w-5 h-5" />
                    <ScanFace className="w-5 h-5" />
                    <span>
                      {isCheckingBiometric
                        ? 'Verifying Biometrics...'
                        : 'Unlock with Fingerprint / Face ID'}
                    </span>
                  </button>
                ) : (
                  <div className="p-3 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 flex items-center gap-2.5">
                    <Fingerprint className="w-4 h-4 text-slate-500 flex-shrink-0" />
                    <span>
                      Biometric unlock is ready to enroll in{' '}
                      <strong className="text-slate-200">Store Profile → Security</strong> after
                      unlocking with your 4-digit PIN.
                    </span>
                  </div>
                )}

                {biometricStatus && (
                  <div className="text-[11px] text-center text-sky-300 font-medium">
                    {biometricStatus}
                  </div>
                )}
              </div>
            )}

            {/* 4-Digit Master PIN Indicator */}
            <div className="space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400 px-1">
                <span className="flex items-center gap-1.5 font-semibold text-slate-300">
                  <KeyRound className="w-3.5 h-3.5 text-blue-400" />
                  4-Digit Master PIN Fallback
                </span>
                {settings.masterPin === DEFAULT_APP_LOCK_PIN && (
                  <span className="font-mono text-[11px] text-slate-400">
                    Default: <strong className="text-slate-200">1234</strong>
                  </span>
                )}
              </div>

              <div
                className="flex items-center justify-center gap-4 py-2"
                aria-label={`Entered ${pinDigits.length} of 4 PIN digits`}
              >
                {[0, 1, 2, 3].map(idx => {
                  const filled = idx < pinDigits.length;
                  return (
                    <div
                      key={idx}
                      className={`w-12 h-12 rounded-2xl border flex items-center justify-center transition-all ${
                        errorMsg
                          ? 'border-rose-500/60 bg-rose-950/30'
                          : filled
                          ? 'border-blue-500 bg-blue-600/20'
                          : 'border-slate-700 bg-slate-950'
                      }`}
                    >
                      <div
                        className={`w-3.5 h-3.5 rounded-full transition-transform ${
                          filled ? 'bg-white scale-100' : 'bg-slate-700 scale-75'
                        }`}
                      />
                    </div>
                  );
                })}
              </div>

              {errorMsg && (
                <div
                  role="alert"
                  className="p-2.5 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                  <span className="tabular-nums">
                    {errorMsg}
                    {cooldownRemaining > 0 ? ` (${cooldownRemaining}s)` : ''}
                  </span>
                </div>
              )}

              {/* Thumb-Friendly 4-Digit Touch Keypad */}
              <div className="grid grid-cols-3 gap-2.5 pt-1">
                {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(digit => (
                  <button
                    key={digit}
                    type="button"
                    disabled={cooldownRemaining > 0}
                    onClick={() => handleAppendDigit(digit)}
                    className="min-h-[54px] rounded-2xl bg-slate-950 hover:bg-slate-800 active:bg-blue-600/30 border border-slate-800 text-xl font-black text-white tabular-nums transition active:scale-95 disabled:opacity-40"
                  >
                    {digit}
                  </button>
                ))}

                <button
                  type="button"
                  disabled={cooldownRemaining > 0}
                  onClick={handleClear}
                  className="min-h-[54px] rounded-2xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 transition active:scale-95 disabled:opacity-40"
                >
                  Clear
                </button>

                <button
                  type="button"
                  disabled={cooldownRemaining > 0}
                  onClick={() => handleAppendDigit('0')}
                  className="min-h-[54px] rounded-2xl bg-slate-950 hover:bg-slate-800 active:bg-blue-600/30 border border-slate-800 text-xl font-black text-white tabular-nums transition active:scale-95 disabled:opacity-40"
                >
                  0
                </button>

                <button
                  type="button"
                  disabled={cooldownRemaining > 0 || pinDigits.length === 0}
                  onClick={handleBackspace}
                  aria-label="Delete last PIN digit"
                  className="min-h-[54px] rounded-2xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-slate-300 flex items-center justify-center transition active:scale-95 disabled:opacity-40"
                >
                  <Delete className="w-5 h-5" />
                </button>
              </div>

              {/* Forgot PIN Trigger */}
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setErrorMsg(null);
                  setIsForgotPinOpen(true);
                }}
                className="w-full min-h-[44px] px-3 py-2 rounded-xl bg-slate-950/80 hover:bg-slate-800/80 border border-slate-800 text-xs font-bold text-sky-300 hover:text-sky-200 flex items-center justify-center gap-1.5 transition"
              >
                <HelpCircle className="w-4 h-4" />
                <span>Forgot PIN? Reset via Email or Security Questions</span>
              </button>
            </div>
          </>
        )}

        <div className="pt-2 border-t border-slate-800/80 flex items-center justify-center gap-1.5 text-[11px] text-slate-500">
          <ShieldCheck className="w-3.5 h-3.5 text-emerald-500" />
          <span>Protected by Master PIN &amp; WebAuthn Biometric App Lock</span>
        </div>
      </div>
    </div>
  );
};
