import React, { useEffect, useState } from 'react';
import { AppLockSettings, SecurityQuestionItem } from '../types';
import {
  BiometricCapabilityStatus,
  PRESET_SECURITY_QUESTIONS,
  authenticateWithBiometric,
  checkBiometricCapability,
  detectDeviceBiometricLabel,
  enrollBiometricCredential,
  hashSecurityAnswer,
  isUsingDefaultSecurityQuestions,
  isValidEmailAddress,
  isValidFourDigitPin,
  resolveRecoveryConfig,
} from '../utils/appLock';
import { DEFAULT_APP_LOCK_PIN } from '../utils/storage';
import { soundManager } from '../utils/soundEffects';
import { useViewportLayout } from '../hooks/useViewportLayout';
import {
  AlertTriangle,
  Check,
  Clock,
  Eye,
  EyeOff,
  Fingerprint,
  HelpCircle,
  KeyRound,
  Lock,
  Mail,
  Plus,
  ScanFace,
  ShieldCheck,
  Trash2,
} from 'lucide-react';

interface AppLockSettingsPanelProps {
  settings: AppLockSettings;
  storeEmail?: string;
  storeName?: string;
  onUpdateSettings: (next: AppLockSettings) => void;
  onLockNow: () => void;
}

interface EditableSecurityQuestionRow {
  id: string;
  question: string;
  existingHash: string;
  newAnswer: string;
}

export const AppLockSettingsPanel: React.FC<AppLockSettingsPanelProps> = ({
  settings,
  storeEmail,
  storeName,
  onUpdateSettings,
  onLockNow,
}) => {
  const { isMobileLayout } = useViewportLayout();
  const [newPin, setNewPin] = useState(settings.masterPin);
  const [confirmPin, setConfirmPin] = useState(settings.masterPin);
  const [showPinDigits, setShowPinDigits] = useState(false);
  const [capability, setCapability] = useState<BiometricCapabilityStatus | null>(null);
  const [enrollingBiometric, setEnrollingBiometric] = useState(false);
  const [testingBiometric, setTestingBiometric] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const resolvedRecovery = resolveRecoveryConfig(settings, {
    email: storeEmail || '',
    storeName: storeName || '',
  });
  const [recoveryEmail, setRecoveryEmail] = useState(resolvedRecovery.recoveryEmail);
  const [emailRecoveryEnabled, setEmailRecoveryEnabled] = useState(
    resolvedRecovery.emailRecoveryEnabled
  );
  const [securityQuestionsEnabled, setSecurityQuestionsEnabled] = useState(
    resolvedRecovery.securityQuestionsEnabled
  );
  const [requireBothMethods, setRequireBothMethods] = useState(
    Boolean(resolvedRecovery.requireBothMethods)
  );
  const [questionRows, setQuestionRows] = useState<EditableSecurityQuestionRow[]>(() =>
    resolvedRecovery.securityQuestions.map(q => ({
      id: q.id,
      question: q.question,
      existingHash: q.answerHash,
      newAnswer: '',
    }))
  );
  const [showRecoveryAnswers, setShowRecoveryAnswers] = useState(false);

  useEffect(() => {
    setNewPin(settings.masterPin);
    setConfirmPin(settings.masterPin);
  }, [settings.masterPin]);

  useEffect(() => {
    void checkBiometricCapability().then(setCapability);
  }, []);

  const handleToggleMasterLock = () => {
    soundManager.playMechanicalClick();
    const nextEnabled = !settings.enabled;
    onUpdateSettings({
      ...settings,
      enabled: nextEnabled,
      updatedAt: new Date().toISOString(),
    });
    setFeedback({
      type: nextEnabled ? 'success' : 'info',
      text: nextEnabled
        ? 'Master App Lock enabled. POS will require Fingerprint / Face ID or your 4-digit PIN on launch.'
        : 'Master App Lock disabled. Terminal opens directly without lock screen authentication.',
    });
  };

  const handleSavePin = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanNew = newPin.replace(/\D/g, '');
    const cleanConfirm = confirmPin.replace(/\D/g, '');

    if (!isValidFourDigitPin(cleanNew)) {
      soundManager.playAlertSound();
      setFeedback({
        type: 'error',
        text: 'Master PIN must be exactly 4 numeric digits (0–9).',
      });
      return;
    }
    if (cleanNew !== cleanConfirm) {
      soundManager.playAlertSound();
      setFeedback({
        type: 'error',
        text: 'New 4-digit PIN and Confirm PIN do not match.',
      });
      return;
    }

    soundManager.playCheckoutSuccess();
    onUpdateSettings({
      ...settings,
      masterPin: cleanNew,
      updatedAt: new Date().toISOString(),
    });
    setFeedback({
      type: 'success',
      text: '4-digit Master PIN updated and saved for App Lock & fallback authentication.',
    });
  };

  const handleEnrollBiometric = async () => {
    soundManager.playMechanicalClick();
    setEnrollingBiometric(true);
    setFeedback(null);
    try {
      const res = await enrollBiometricCredential(detectDeviceBiometricLabel());
      if (res.ok && res.credential) {
        soundManager.playCheckoutSuccess();
        onUpdateSettings({
          ...settings,
          biometricEnabled: true,
          biometricCredentials: [
            res.credential,
            ...settings.biometricCredentials.filter(
              c => c.credentialId !== res.credential!.credentialId
            ),
          ],
          updatedAt: new Date().toISOString(),
        });
        setFeedback({
          type: 'success',
          text: `Enrolled ${res.credential.label} successfully. Fingerprint / Face Unlock is ready on launch.`,
        });
      } else {
        soundManager.playAlertSound();
        setFeedback({
          type: 'error',
          text: res.error || 'Biometric enrollment could not complete.',
        });
      }
    } finally {
      setEnrollingBiometric(false);
    }
  };

  const handleTestBiometric = async () => {
    soundManager.playMechanicalClick();
    setTestingBiometric(true);
    setFeedback(null);
    try {
      const res = await authenticateWithBiometric(settings);
      if (res.ok) {
        soundManager.playCheckoutSuccess();
        onUpdateSettings({
          ...settings,
          biometricCredentials: settings.biometricCredentials.map(c =>
            c.credentialId === res.credentialId
              ? { ...c, lastUsedAt: new Date().toISOString() }
              : c
          ),
          updatedAt: new Date().toISOString(),
        });
        setFeedback({
          type: 'success',
          text: 'Biometric verification succeeded! Fingerprint / Face Unlock verified.',
        });
      } else {
        soundManager.playAlertSound();
        setFeedback({
          type: 'error',
          text: res.error || 'Biometric verification failed.',
        });
      }
    } finally {
      setTestingBiometric(false);
    }
  };

  const handleRemoveCredential = (credentialId: string) => {
    soundManager.playMechanicalClick();
    onUpdateSettings({
      ...settings,
      biometricCredentials: settings.biometricCredentials.filter(
        c => c.credentialId !== credentialId
      ),
      updatedAt: new Date().toISOString(),
    });
    setFeedback({
      type: 'info',
      text: 'Removed enrolled biometric credential. 4-digit PIN remains active.',
    });
  };

  const handleSaveRecoverySettings = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmedEmail = recoveryEmail.trim();

    if (emailRecoveryEnabled && !isValidEmailAddress(trimmedEmail)) {
      soundManager.playAlertSound();
      setFeedback({
        type: 'error',
        text: 'Please enter a valid Recovery Email address or turn off Email Verification.',
      });
      return;
    }

    const builtQuestions: SecurityQuestionItem[] = [];
    if (securityQuestionsEnabled) {
      if (questionRows.length === 0) {
        soundManager.playAlertSound();
        setFeedback({
          type: 'error',
          text: 'Add at least 1 security question or turn off Security Questions recovery.',
        });
        return;
      }
      for (let i = 0; i < questionRows.length; i++) {
        const row = questionRows[i];
        const qText = row.question.trim();
        const ans = row.newAnswer.trim();
        if (!qText) {
          soundManager.playAlertSound();
          setFeedback({
            type: 'error',
            text: `Security Question ${i + 1} prompt cannot be empty.`,
          });
          return;
        }
        const finalHash = ans ? hashSecurityAnswer(ans) : row.existingHash;
        if (!finalHash) {
          soundManager.playAlertSound();
          setFeedback({
            type: 'error',
            text: `Please enter an answer for Security Question ${i + 1}.`,
          });
          return;
        }
        builtQuestions.push({
          id: row.id,
          question: qText,
          answerHash: finalHash,
        });
      }
    } else {
      questionRows.forEach(row => {
        if (row.question.trim() && (row.newAnswer.trim() || row.existingHash)) {
          builtQuestions.push({
            id: row.id,
            question: row.question.trim(),
            answerHash: row.newAnswer.trim()
              ? hashSecurityAnswer(row.newAnswer.trim())
              : row.existingHash,
          });
        }
      });
    }

    if (!emailRecoveryEnabled && !securityQuestionsEnabled) {
      soundManager.playAlertSound();
      setFeedback({
        type: 'error',
        text: 'Enable at least one recovery method (Email Verification or Security Questions) so you do not get locked out.',
      });
      return;
    }

    const nowIso = new Date().toISOString();
    soundManager.playCheckoutSuccess();
    onUpdateSettings({
      ...settings,
      recovery: {
        recoveryEmail: trimmedEmail,
        emailRecoveryEnabled,
        securityQuestionsEnabled,
        requireBothMethods:
          emailRecoveryEnabled && securityQuestionsEnabled ? requireBothMethods : false,
        securityQuestions: builtQuestions,
        updatedAt: nowIso,
      },
      updatedAt: nowIso,
    });
    setQuestionRows(
      builtQuestions.map(q => ({
        id: q.id,
        question: q.question,
        existingHash: q.answerHash,
        newAnswer: '',
      }))
    );
    setFeedback({
      type: 'success',
      text: 'Forgot PIN recovery settings (Email Verification & Security Questions) saved.',
    });
  };

  const usingDefaultQs = isUsingDefaultSecurityQuestions(resolvedRecovery.securityQuestions);

  return (
    <div className="space-y-4">
      {/* Master App Lock On/Off Card */}
      <div
        className={`rounded-2xl border p-4 transition-colors ${
          settings.enabled
            ? 'bg-slate-950 border-emerald-500/35'
            : 'bg-slate-950 border-slate-800'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-3">
            <div
              className={`w-10 h-10 rounded-xl border flex items-center justify-center flex-shrink-0 ${
                settings.enabled
                  ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-400'
                  : 'bg-slate-900 border-slate-700 text-slate-400'
              }`}
            >
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h4 className="text-sm font-black text-white">
                  Master PIN &amp; Biometric App Lock
                </h4>
                <span
                  className={`text-[10px] font-black uppercase px-2 py-0.5 rounded border ${
                    settings.enabled
                      ? 'bg-emerald-950/70 text-emerald-300 border-emerald-500/40'
                      : 'bg-slate-900 text-slate-400 border-slate-700'
                  }`}
                >
                  {settings.enabled ? 'Lock Active' : 'Disabled'}
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-1 leading-snug">
                {settings.enabled
                  ? 'Requires Fingerprint / Face Unlock or your 4-digit Master PIN when opening the POS app.'
                  : 'App Lock is turned off. Turn ON to protect billing, Khata, and inventory on launch.'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 self-end sm:self-center flex-shrink-0">
            {settings.enabled && (
              <button
                type="button"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onLockNow();
                }}
                className="min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white text-xs font-bold flex items-center gap-1.5 transition whitespace-nowrap"
              >
                <Lock className="w-3.5 h-3.5 text-amber-400" />
                Lock App Now
              </button>
            )}

            <div className="flex items-center gap-2 pl-2 border-l border-slate-800">
              <span className="text-xs font-bold text-slate-200 min-w-[26px] text-right">
                {settings.enabled ? 'ON' : 'OFF'}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={settings.enabled}
                aria-label="Enable or disable Master PIN and Biometric App Lock"
                onClick={handleToggleMasterLock}
                className={`relative inline-flex h-7 w-12 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2 focus:ring-offset-slate-950 ${
                  settings.enabled
                    ? 'bg-emerald-600 border-emerald-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform ${
                    settings.enabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
          </div>
        </div>
      </div>

      {feedback && (
        <div
          className={`p-3 rounded-xl border text-xs font-semibold flex items-center gap-2 ${
            feedback.type === 'success'
              ? 'bg-emerald-950/60 border-emerald-500/40 text-emerald-200'
              : feedback.type === 'error'
              ? 'bg-rose-950/60 border-rose-500/40 text-rose-200'
              : 'bg-slate-900 border-slate-700 text-slate-200'
          }`}
        >
          {feedback.type === 'success' ? (
            <Check className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          ) : (
            <AlertTriangle className="w-4 h-4 text-amber-400 flex-shrink-0" />
          )}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Configuration Grid */}
      <div
        className={`grid ${
          isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'
        } gap-4 transition-opacity ${
          settings.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
        }`}
      >
        {/* Left: 4-Digit Master PIN Setup */}
        <form
          onSubmit={handleSavePin}
          className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3.5"
        >
          <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <KeyRound className="w-4 h-4 text-blue-400" />
              4-Digit Master PIN Fallback
            </h5>
            <button
              type="button"
              onClick={() => setShowPinDigits(v => !v)}
              className="px-2 py-1 rounded-lg bg-slate-900 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-300 flex items-center gap-1"
            >
              {showPinDigits ? (
                <>
                  <EyeOff className="w-3.5 h-3.5" /> Hide
                </>
              ) : (
                <>
                  <Eye className="w-3.5 h-3.5" /> Show
                </>
              )}
            </button>
          </div>

          <p className="text-[11px] text-slate-400 leading-snug">
            Used whenever Fingerprint or Face Unlock is unavailable, cancelled, or on a shared counter terminal.{' '}
            {settings.masterPin === DEFAULT_APP_LOCK_PIN && (
              <span className="text-amber-300 font-semibold">
                Currently using default PIN (1234).
              </span>
            )}
          </p>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-300">
                4-Digit Master PIN
              </label>
              <input
                type={showPinDigits ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                value={newPin}
                onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 digits"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono font-bold tracking-widest text-white text-center focus:outline-none focus:border-blue-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-[11px] font-bold text-slate-300">
                Confirm 4-Digit PIN
              </label>
              <input
                type={showPinDigits ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                pattern="\d{4}"
                value={confirmPin}
                onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Repeat PIN"
                className="w-full px-3 py-2.5 rounded-xl bg-slate-900 border border-slate-700 text-sm font-mono font-bold tracking-widest text-white text-center focus:outline-none focus:border-blue-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={!settings.enabled}
            className="w-full min-h-[44px] px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition active:scale-[0.99]"
          >
            <Check className="w-4 h-4" />
            Save 4-Digit Master PIN
          </button>

          {/* Launch & Auto-Lock Timing */}
          <div className="pt-3 border-t border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs font-bold text-white">
                  Require Authentication on Launch
                </div>
                <div className="text-[11px] text-slate-400">
                  Lock immediately every time the app starts or reloads
                </div>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={settings.requireOnLaunch}
                aria-label="Require authentication on app launch"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onUpdateSettings({
                    ...settings,
                    requireOnLaunch: !settings.requireOnLaunch,
                    updatedAt: new Date().toISOString(),
                  });
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                  settings.requireOnLaunch
                    ? 'bg-blue-600 border-blue-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settings.requireOnLaunch ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="text-xs font-bold text-white flex items-center gap-1.5">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Auto-Lock Inactivity Timeout
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { val: 0, label: 'Launch Only' },
                    { val: 1, label: '1 min' },
                    { val: 5, label: '5 min' },
                    { val: 15, label: '15 min' },
                    { val: 30, label: '30 min' },
                  ] as const
                ).map(opt => (
                  <button
                    key={opt.val}
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      onUpdateSettings({
                        ...settings,
                        autoLockMinutes: opt.val,
                        updatedAt: new Date().toISOString(),
                      });
                    }}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-bold border transition ${
                      settings.autoLockMinutes === opt.val
                        ? 'bg-blue-600/25 border-blue-500 text-blue-200'
                        : 'bg-slate-900 border-slate-800 text-slate-400 hover:text-white'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </form>

        {/* Right: Biometric (Fingerprint & Face Unlock) Enrollment */}
        <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3.5 flex flex-col justify-between">
          <div className="space-y-3">
            <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
              <h5 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
                <Fingerprint className="w-4 h-4 text-emerald-400" />
                Fingerprint &amp; Face Unlock
              </h5>

              <button
                type="button"
                role="switch"
                aria-checked={settings.biometricEnabled}
                aria-label="Enable biometric fingerprint and face unlock"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  onUpdateSettings({
                    ...settings,
                    biometricEnabled: !settings.biometricEnabled,
                    updatedAt: new Date().toISOString(),
                  });
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                  settings.biometricEnabled
                    ? 'bg-emerald-600 border-emerald-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    settings.biometricEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="p-3 rounded-xl bg-slate-900 border border-slate-800 text-[11px] space-y-1">
              <div className="font-bold text-slate-200 flex items-center gap-1.5">
                <ScanFace className="w-3.5 h-3.5 text-sky-400" />
                <span>
                  Device Biometric Sensor:{' '}
                  {capability === null
                    ? 'Checking...'
                    : capability.canUseBiometric
                    ? 'Available (Platform Authenticator Ready)'
                    : 'Not exposed in current frame / browser'}
                </span>
              </div>
              <p className="text-slate-400 leading-snug">
                {capability?.canUseBiometric
                  ? 'Uses WebAuthn platform biometrics (Android Fingerprint, Face ID, Touch ID, Windows Hello).'
                  : capability?.reason ||
                    'When platform biometrics are unavailable, the 4-digit Master PIN keypad is automatically used.'}
              </p>
            </div>

            {/* Enrolled Credentials List */}
            {settings.biometricCredentials.length > 0 ? (
              <div className="space-y-2">
                <div className="text-[11px] font-bold text-slate-400">
                  Enrolled Biometric Devices ({settings.biometricCredentials.length})
                </div>
                <div className="space-y-1.5 max-h-32 overflow-y-auto">
                  {settings.biometricCredentials.map(cred => (
                    <div
                      key={cred.credentialId}
                      className="px-3 py-2 rounded-xl bg-slate-900 border border-slate-800 flex items-center justify-between gap-2 text-xs"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-emerald-300 truncate">
                          {cred.label}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          Enrolled{' '}
                          {new Date(cred.enrolledAt).toLocaleDateString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                          })}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleRemoveCredential(cred.credentialId)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-300 hover:bg-rose-950/50 transition"
                        aria-label={`Remove ${cred.label}`}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <div className="text-xs text-slate-400 py-1">
                No biometric device enrolled on this browser yet. Click below to register your Fingerprint or Face Unlock.
              </div>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <button
              type="button"
              disabled={!settings.enabled || !settings.biometricEnabled || enrollingBiometric}
              onClick={() => void handleEnrollBiometric()}
              className="flex-1 min-h-[44px] px-3.5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 transition"
            >
              <Fingerprint className="w-4 h-4" />
              {enrollingBiometric ? 'Enrolling...' : 'Enroll Fingerprint / Face'}
            </button>

            {settings.biometricCredentials.length > 0 && (
              <button
                type="button"
                disabled={!settings.enabled || !settings.biometricEnabled || testingBiometric}
                onClick={() => void handleTestBiometric()}
                className="min-h-[44px] px-3.5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 disabled:opacity-50 border border-slate-700 text-slate-200 text-xs font-bold transition"
              >
                {testingBiometric ? 'Testing...' : 'Test'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Forgot PIN Recovery Configuration (Email Verification & Security Questions) */}
      <form
        onSubmit={handleSaveRecoverySettings}
        className={`p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-4 transition-opacity ${
          settings.enabled ? 'opacity-100' : 'opacity-50 pointer-events-none'
        }`}
      >
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
          <div>
            <h5 className="text-xs font-black uppercase tracking-wider text-slate-200 flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-sky-400" />
              Forgot PIN Recovery · Email &amp; Security Questions
            </h5>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Configure Email OTP verification and hashed Security Questions used to reset a forgotten 4-digit Master PIN from the lock screen.
            </p>
          </div>
          {usingDefaultQs && (
            <span className="text-[11px] font-semibold text-amber-300 whitespace-nowrap">
              Factory default answers active
            </span>
          )}
        </div>

        <div className={`grid ${isMobileLayout ? 'grid-cols-1' : 'grid-cols-2'} gap-4`}>
          {/* Email Verification Recovery */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-blue-400" />
                <span className="text-xs font-bold text-white">Email Verification OTP</span>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={emailRecoveryEnabled}
                aria-label="Enable email verification for Forgot PIN recovery"
                onClick={() => {
                  soundManager.playMechanicalClick();
                  setEmailRecoveryEnabled(v => !v);
                }}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                  emailRecoveryEnabled
                    ? 'bg-blue-600 border-blue-500'
                    : 'bg-slate-800 border-slate-700'
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    emailRecoveryEnabled ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <label className="text-[11px] font-bold text-slate-300">
                  Recovery Email Address
                </label>
                {storeEmail && storeEmail.trim() && recoveryEmail.trim() !== storeEmail.trim() && (
                  <button
                    type="button"
                    onClick={() => setRecoveryEmail(storeEmail.trim())}
                    className="text-[10px] font-bold text-sky-400 hover:text-sky-300 underline"
                  >
                    Use Store Email
                  </button>
                )}
              </div>
              <input
                type="email"
                disabled={!emailRecoveryEnabled}
                value={recoveryEmail}
                onChange={e => setRecoveryEmail(e.target.value)}
                placeholder="owner@yourstore.in"
                className="w-full px-3 py-2 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
              />
              <p className="text-[10px] text-slate-400 leading-snug">
                Sends a 10-minute, 6-digit verification code to reset the Master PIN.
              </p>
            </div>

            {emailRecoveryEnabled && securityQuestionsEnabled && (
              <div className="pt-2.5 border-t border-slate-800 flex items-center justify-between gap-2">
                <div>
                  <div className="text-[11px] font-bold text-slate-200">
                    Require Both Email &amp; Questions
                  </div>
                  <div className="text-[10px] text-slate-400">
                    {requireBothMethods
                      ? 'Two-step verification: must pass both'
                      : 'Flexible: verify via either Email or Questions'}
                  </div>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={requireBothMethods}
                  aria-label="Require both email verification and security questions to reset PIN"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setRequireBothMethods(v => !v);
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                    requireBothMethods
                      ? 'bg-emerald-600 border-emerald-500'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      requireBothMethods ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            )}
          </div>

          {/* Security Questions Setup */}
          <div className="p-3.5 rounded-xl bg-slate-900/70 border border-slate-800 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HelpCircle className="w-4 h-4 text-emerald-400" />
                <span className="text-xs font-bold text-white">Security Questions (Offline Ready)</span>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowRecoveryAnswers(v => !v)}
                  className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[10px] font-semibold text-slate-300 flex items-center gap-1"
                >
                  {showRecoveryAnswers ? <EyeOff className="w-3 h-3" /> : <Eye className="w-3 h-3" />}
                  {showRecoveryAnswers ? 'Hide' : 'Show'}
                </button>

                <button
                  type="button"
                  role="switch"
                  aria-checked={securityQuestionsEnabled}
                  aria-label="Enable security questions for Forgot PIN recovery"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setSecurityQuestionsEnabled(v => !v);
                  }}
                  className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer items-center rounded-full border transition-colors ${
                    securityQuestionsEnabled
                      ? 'bg-emerald-600 border-emerald-500'
                      : 'bg-slate-800 border-slate-700'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      securityQuestionsEnabled ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>

            <div className="space-y-2.5">
              {questionRows.map((row, idx) => (
                <div
                  key={row.id}
                  className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[10px] font-bold text-slate-400">Question {idx + 1}</span>
                    {questionRows.length > 1 && (
                      <button
                        type="button"
                        disabled={!securityQuestionsEnabled}
                        onClick={() =>
                          setQuestionRows(prev => prev.filter(item => item.id !== row.id))
                        }
                        className="text-slate-500 hover:text-rose-300 text-[10px] font-semibold flex items-center gap-1"
                      >
                        <Trash2 className="w-3 h-3" /> Remove
                      </button>
                    )}
                  </div>

                  <select
                    disabled={!securityQuestionsEnabled}
                    value={
                      PRESET_SECURITY_QUESTIONS.includes(row.question) ? row.question : '__CUSTOM__'
                    }
                    onChange={e => {
                      const val = e.target.value;
                      setQuestionRows(prev =>
                        prev.map(item =>
                          item.id === row.id
                            ? {
                                ...item,
                                question: val === '__CUSTOM__' ? '' : val,
                              }
                            : item
                        )
                      );
                    }}
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                  >
                    {PRESET_SECURITY_QUESTIONS.map(qOpt => (
                      <option key={qOpt} value={qOpt}>
                        {qOpt}
                      </option>
                    ))}
                    <option value="__CUSTOM__">Custom Security Question...</option>
                  </select>

                  {!PRESET_SECURITY_QUESTIONS.includes(row.question) && (
                    <input
                      type="text"
                      disabled={!securityQuestionsEnabled}
                      value={row.question}
                      onChange={e =>
                        setQuestionRows(prev =>
                          prev.map(item =>
                            item.id === row.id ? { ...item, question: e.target.value } : item
                          )
                        )
                      }
                      placeholder="Type custom security question"
                      className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-50"
                    />
                  )}

                  <input
                    type={showRecoveryAnswers ? 'text' : 'password'}
                    disabled={!securityQuestionsEnabled}
                    value={row.newAnswer}
                    onChange={e =>
                      setQuestionRows(prev =>
                        prev.map(item =>
                          item.id === row.id ? { ...item, newAnswer: e.target.value } : item
                        )
                      )
                    }
                    placeholder={
                      row.existingHash
                        ? 'Answer saved (leave blank to keep, or type new answer)'
                        : 'Enter secret answer (case-insensitive)'
                    }
                    className="w-full px-2.5 py-2 rounded-lg bg-slate-900 border border-slate-700 text-xs text-white focus:outline-none focus:border-emerald-500 disabled:opacity-50"
                  />
                </div>
              ))}

              {questionRows.length < 3 && (
                <button
                  type="button"
                  disabled={!securityQuestionsEnabled}
                  onClick={() => {
                    const unused =
                      PRESET_SECURITY_QUESTIONS.find(
                        q => !questionRows.some(r => r.question === q)
                      ) || PRESET_SECURITY_QUESTIONS[2];
                    setQuestionRows(prev => [
                      ...prev,
                      {
                        id: `sq_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
                        question: unused,
                        existingHash: '',
                        newAnswer: '',
                      },
                    ]);
                  }}
                  className="w-full py-2 px-3 rounded-xl bg-slate-950 hover:bg-slate-800 border border-dashed border-slate-700 text-[11px] font-bold text-slate-300 flex items-center justify-center gap-1.5 transition disabled:opacity-40"
                >
                  <Plus className="w-3.5 h-3.5" />
                  Add Another Security Question (max 3)
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-1">
          <span className="text-[11px] text-slate-400">
            Security answers are SHA-256 hashed locally and matched case-insensitively during PIN recovery.
          </span>
          <button
            type="submit"
            disabled={!settings.enabled}
            className="min-h-[44px] px-4 py-2.5 rounded-xl bg-sky-600 hover:bg-sky-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 whitespace-nowrap transition"
          >
            <Check className="w-4 h-4" />
            Save Recovery Settings
          </button>
        </div>
      </form>
    </div>
  );
};
