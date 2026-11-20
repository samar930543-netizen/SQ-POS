import React, { useEffect, useState } from 'react';
import { AppLockSettings, StoreProfile } from '../types';
import {
  isUsingDefaultSecurityQuestions,
  isValidEmailAddress,
  isValidFourDigitPin,
  maskEmailAddress,
  requestPinRecoveryEmailCode,
  resolveRecoveryConfig,
  verifyPinRecoveryEmailCode,
  verifySecurityQuestionAnswers,
} from '../utils/appLock';
import { soundManager } from '../utils/soundEffects';
import {
  AlertTriangle,
  ArrowLeft,
  Check,
  CheckCircle2,
  Eye,
  EyeOff,
  HelpCircle,
  KeyRound,
  Mail,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

interface ForgotPinRecoveryPanelProps {
  settings: AppLockSettings;
  storeProfile: StoreProfile;
  onCancel: () => void;
  onCompleteReset: (newPin: string, methodSummary: string) => void;
}

type RecoveryMethodTab = 'email' | 'questions';

export const ForgotPinRecoveryPanel: React.FC<ForgotPinRecoveryPanelProps> = ({
  settings,
  storeProfile,
  onCancel,
  onCompleteReset,
}) => {
  const recovery = resolveRecoveryConfig(settings, storeProfile);
  const emailAvailable = recovery.emailRecoveryEnabled && isValidEmailAddress(recovery.recoveryEmail);
  const questionsAvailable =
    recovery.securityQuestionsEnabled && recovery.securityQuestions.length > 0;
  const requireBoth = Boolean(recovery.requireBothMethods && emailAvailable && questionsAvailable);

  const [activeTab, setActiveTab] = useState<RecoveryMethodTab>(() =>
    emailAvailable ? 'email' : 'questions'
  );

  // Email verification state
  const [emailInput, setEmailInput] = useState('');
  const [recoverySessionId, setRecoverySessionId] = useState<string | null>(null);
  const [otpInput, setOtpInput] = useState('');
  const [sendingOtp, setSendingOtp] = useState(false);
  const [verifyingOtp, setVerifyingOtp] = useState(false);
  const [resendCooldown, setResendCooldown] = useState(0);
  const [deliveryChannel, setDeliveryChannel] = useState<string | null>(null);
  const [sandboxPreviewCode, setSandboxPreviewCode] = useState<string | null>(null);
  const [emailVerified, setEmailVerified] = useState(false);

  // Security questions state
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [showAnswers, setShowAnswers] = useState(false);
  const [failedQuestionIds, setFailedQuestionIds] = useState<string[]>([]);
  const [questionsVerified, setQuestionsVerified] = useState(false);

  // Step 2: New 4-digit PIN state
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [showNewPin, setShowNewPin] = useState(false);

  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const isIdentityVerified = requireBoth
    ? emailVerified && questionsVerified
    : emailVerified || questionsVerified;

  useEffect(() => {
    if (resendCooldown <= 0) return;
    const t = window.setInterval(() => {
      setResendCooldown(prev => (prev <= 1 ? 0 : prev - 1));
    }, 1000);
    return () => window.clearInterval(t);
  }, [resendCooldown]);

  const handleSendEmailCode = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const typed = emailInput.trim().toLowerCase();
    const expected = recovery.recoveryEmail.trim().toLowerCase();

    if (!isValidEmailAddress(typed)) {
      soundManager.playAlertSound();
      setErrorMsg('Please enter a valid email address.');
      return;
    }

    if (typed !== expected) {
      soundManager.playAlertSound();
      setErrorMsg(
        `Email does not match the registered recovery email (${maskEmailAddress(
          recovery.recoveryEmail
        )}).`
      );
      return;
    }

    setSendingOtp(true);
    try {
      const res = await requestPinRecoveryEmailCode({
        email: typed,
        storeName: storeProfile.storeName,
      });
      if (!res.ok || !res.recoverySessionId) {
        soundManager.playAlertSound();
        setErrorMsg(res.error || 'Failed to send verification code.');
        return;
      }

      soundManager.playMechanicalClick();
      setRecoverySessionId(res.recoverySessionId);
      setOtpInput('');
      setResendCooldown(30);
      setDeliveryChannel(res.deliveryChannel || null);
      setSandboxPreviewCode(res.previewCode || null);
      setInfoMsg(
        `6-digit verification code dispatched to ${
          res.maskedEmail || maskEmailAddress(typed)
        }. Valid for ${res.expiresInMinutes || 10} minutes.`
      );
    } finally {
      setSendingOtp(false);
    }
  };

  const handleVerifyEmailOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!recoverySessionId) {
      setErrorMsg('Please send a verification code first.');
      return;
    }
    const cleanCode = otpInput.replace(/\D/g, '').slice(0, 6);
    if (cleanCode.length !== 6) {
      soundManager.playAlertSound();
      setErrorMsg('Enter the complete 6-digit verification code.');
      return;
    }

    setVerifyingOtp(true);
    try {
      const res = await verifyPinRecoveryEmailCode({
        recoverySessionId,
        email: emailInput.trim().toLowerCase(),
        code: cleanCode,
      });
      if (!res.ok) {
        soundManager.playAlertSound();
        setErrorMsg(res.error || 'Verification code did not match.');
        return;
      }

      soundManager.playCheckoutSuccess();
      setEmailVerified(true);
      setInfoMsg(
        requireBoth && !questionsVerified
          ? 'Email verified! Next, answer your Security Questions to finish identity verification.'
          : 'Email verified successfully. Set your new 4-digit Master PIN below.'
      );
      if (requireBoth && !questionsVerified) {
        setActiveTab('questions');
      }
    } finally {
      setVerifyingOtp(false);
    }
  };

  const handleVerifyQuestions = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setInfoMsg(null);

    const res = verifySecurityQuestionAnswers(answers, recovery.securityQuestions);
    if (!res.ok) {
      soundManager.playAlertSound();
      setFailedQuestionIds(res.failedQuestionIds);
      setErrorMsg(
        `${res.failedQuestionIds.length} security answer${
          res.failedQuestionIds.length === 1 ? '' : 's'
        } did not match. Answers are case-insensitive.`
      );
      return;
    }

    soundManager.playCheckoutSuccess();
    setFailedQuestionIds([]);
    setQuestionsVerified(true);
    setInfoMsg(
      requireBoth && !emailVerified
        ? 'Security Questions verified! Next, complete Email Verification.'
        : 'Security Questions verified. Set your new 4-digit Master PIN below.'
    );
    if (requireBoth && !emailVerified) {
      setActiveTab('email');
    }
  };

  const handleResetPinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);

    const cleanNew = newPin.replace(/\D/g, '');
    const cleanConfirm = confirmPin.replace(/\D/g, '');

    if (!isValidFourDigitPin(cleanNew)) {
      soundManager.playAlertSound();
      setErrorMsg('New Master PIN must be exactly 4 digits (0–9).');
      return;
    }
    if (cleanNew !== cleanConfirm) {
      soundManager.playAlertSound();
      setErrorMsg('New 4-digit PIN and Confirm PIN do not match.');
      return;
    }

    soundManager.playCheckoutSuccess();
    soundManager.vibrateSaleCompleted();
    const via =
      emailVerified && questionsVerified
        ? 'Email Verification & Security Questions'
        : emailVerified
        ? 'Email Verification'
        : 'Security Questions';
    onCompleteReset(cleanNew, via);
  };

  const usingDefaultQs = isUsingDefaultSecurityQuestions(recovery.securityQuestions);

  return (
    <div className="space-y-4">
      {/* Header Row */}
      <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-800">
        <button
          type="button"
          onClick={() => {
            soundManager.playMechanicalClick();
            onCancel();
          }}
          className="min-h-[40px] px-3 py-1.5 rounded-xl bg-slate-950 hover:bg-slate-800 border border-slate-800 text-xs font-bold text-slate-300 flex items-center gap-1.5 transition"
        >
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to PIN
        </button>

        <span className="text-xs font-bold text-sky-300 whitespace-nowrap">
          {isIdentityVerified ? 'Step 2 of 2 · New PIN' : 'Step 1 of 2 · Verify Identity'}
        </span>
      </div>

      {/* Title & Policy Context */}
      <div>
        <h2 className="text-base font-black text-white flex items-center gap-2">
          <KeyRound className="w-4 h-4 text-amber-400 flex-shrink-0" />
          Forgot Master PIN Recovery
        </h2>
        <p className="text-xs text-slate-400 mt-1 leading-snug">
          {isIdentityVerified
            ? 'Identity verified. Choose a new 4-digit Master PIN to regain access to your POS terminal.'
            : requireBoth
            ? 'Dual recovery is enabled: verify both your registered Email and Security Questions.'
            : 'Verify your identity using Email Verification or Security Questions to reset your 4-digit Master PIN.'}
        </p>
      </div>

      {/* Dual-Verification Checklist when requireBothMethods is ON */}
      {requireBoth && !isIdentityVerified && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div
            className={`px-3 py-2 rounded-xl border flex items-center gap-2 font-semibold ${
              emailVerified
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span>1. Email {emailVerified ? 'Verified' : 'Pending'}</span>
          </div>
          <div
            className={`px-3 py-2 rounded-xl border flex items-center gap-2 font-semibold ${
              questionsVerified
                ? 'bg-emerald-950/50 border-emerald-500/40 text-emerald-300'
                : 'bg-slate-950 border-slate-800 text-slate-400'
            }`}
          >
            <CheckCircle2 className="w-3.5 h-3.5 flex-shrink-0" />
            <span>2. Questions {questionsVerified ? 'Verified' : 'Pending'}</span>
          </div>
        </div>
      )}

      {/* Alerts */}
      {errorMsg && (
        <div
          role="alert"
          className="p-3 rounded-xl bg-rose-950/60 border border-rose-500/40 text-rose-200 text-xs font-semibold flex items-start gap-2"
        >
          <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {infoMsg && (
        <div className="p-3 rounded-xl bg-sky-950/50 border border-sky-500/35 text-sky-200 text-xs font-medium flex items-start gap-2">
          <CheckCircle2 className="w-4 h-4 text-sky-400 flex-shrink-0 mt-0.5" />
          <span>{infoMsg}</span>
        </div>
      )}

      {!isIdentityVerified ? (
        <>
          {!emailAvailable && !questionsAvailable ? (
            <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 text-xs text-slate-300 space-y-2">
              <div className="font-bold text-amber-300">No Recovery Method Enabled</div>
              <p className="text-slate-400 leading-snug">
                Both Email Verification and Security Questions were disabled in Security Settings. Unlock using Fingerprint / Face ID or ask an administrator with PIN access.
              </p>
            </div>
          ) : (
            <>
              {/* Method Switcher */}
              {emailAvailable && questionsAvailable && (
                <div
                  role="tablist"
                  aria-label="Recovery verification method"
                  className="grid grid-cols-2 gap-1.5 p-1 rounded-xl bg-slate-950 border border-slate-800"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'email'}
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setErrorMsg(null);
                      setActiveTab('email');
                    }}
                    className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                      activeTab === 'email'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <Mail className="w-3.5 h-3.5" />
                    <span>Email Code</span>
                    {emailVerified && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                  </button>

                  <button
                    type="button"
                    role="tab"
                    aria-selected={activeTab === 'questions'}
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      setErrorMsg(null);
                      setActiveTab('questions');
                    }}
                    className={`min-h-[42px] px-3 py-2 rounded-lg text-xs font-bold flex items-center justify-center gap-1.5 transition whitespace-nowrap ${
                      activeTab === 'questions'
                        ? 'bg-blue-600 text-white shadow'
                        : 'text-slate-400 hover:text-white'
                    }`}
                  >
                    <HelpCircle className="w-3.5 h-3.5" />
                    <span>Security Questions</span>
                    {questionsVerified && <Check className="w-3.5 h-3.5 text-emerald-300" />}
                  </button>
                </div>
              )}

              {/* Method A: Email Verification */}
              {activeTab === 'email' && emailAvailable && (
                <div className="space-y-3.5">
                  <form onSubmit={e => void handleSendEmailCode(e)} className="space-y-2.5">
                    <div className="flex items-center justify-between text-[11px] text-slate-400">
                      <label htmlFor="forgot-pin-email" className="font-bold text-slate-300">
                        Registered Recovery Email
                      </label>
                      <span className="font-mono text-slate-400">
                        Hint: {maskEmailAddress(recovery.recoveryEmail)}
                      </span>
                    </div>

                    <div className="flex gap-2">
                      <input
                        id="forgot-pin-email"
                        type="email"
                        autoFocus
                        value={emailInput}
                        disabled={emailVerified}
                        onChange={e => setEmailInput(e.target.value)}
                        placeholder="Enter registered email address"
                        className="flex-1 min-w-0 px-3.5 py-2.5 rounded-xl bg-slate-950 border border-slate-700 text-xs text-white focus:outline-none focus:border-blue-500 disabled:opacity-60"
                      />
                      <button
                        type="submit"
                        disabled={sendingOtp || resendCooldown > 0 || emailVerified}
                        className="min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:bg-slate-800 disabled:text-slate-400 text-white text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${sendingOtp ? 'animate-spin' : ''}`} />
                        {resendCooldown > 0
                          ? `Wait ${resendCooldown}s`
                          : recoverySessionId
                          ? 'Resend'
                          : 'Send Code'}
                      </button>
                    </div>
                  </form>

                  {/* Sandbox preview banner ONLY when external SMTP/Resend isn't configured */}
                  {deliveryChannel === 'sandbox_preview' && sandboxPreviewCode && !emailVerified && (
                    <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/35 text-xs space-y-1.5">
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-amber-200">
                          Local Sandbox Dispatch Code
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            soundManager.playMechanicalClick();
                            setOtpInput(sandboxPreviewCode);
                          }}
                          className="px-2.5 py-1 rounded-lg bg-amber-500/20 hover:bg-amber-500/30 border border-amber-400/40 text-amber-200 text-[11px] font-bold transition"
                        >
                          Fill Code
                        </button>
                      </div>
                      <div className="flex items-center justify-between text-[11px] text-amber-300/90">
                        <span>No external email provider key detected; generated OTP:</span>
                        <strong className="font-mono text-sm tracking-widest text-white tabular-nums">
                          {sandboxPreviewCode}
                        </strong>
                      </div>
                    </div>
                  )}

                  {recoverySessionId && !emailVerified && (
                    <form onSubmit={e => void handleVerifyEmailOtp(e)} className="space-y-2.5 pt-1">
                      <label htmlFor="forgot-pin-otp" className="block text-[11px] font-bold text-slate-300">
                        6-Digit Email Verification Code
                      </label>
                      <input
                        id="forgot-pin-otp"
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otpInput}
                        onChange={e => setOtpInput(e.target.value.replace(/\D/g, '').slice(0, 6))}
                        placeholder="000000"
                        className="w-full px-4 py-3 rounded-xl bg-slate-950 border border-slate-700 text-lg font-mono font-black tracking-[0.45em] text-center text-white tabular-nums focus:outline-none focus:border-emerald-500"
                      />
                      <button
                        type="submit"
                        disabled={verifyingOtp || otpInput.replace(/\D/g, '').length !== 6}
                        className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition"
                      >
                        <ShieldCheck className="w-4 h-4" />
                        {verifyingOtp ? 'Verifying Code...' : 'Verify Email Code'}
                      </button>
                    </form>
                  )}
                </div>
              )}

              {/* Method B: Security Questions */}
              {activeTab === 'questions' && questionsAvailable && (
                <form onSubmit={handleVerifyQuestions} className="space-y-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-slate-400">
                      Answer {recovery.securityQuestions.length} configured security question
                      {recovery.securityQuestions.length === 1 ? '' : 's'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setShowAnswers(v => !v)}
                      className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-300 flex items-center gap-1"
                    >
                      {showAnswers ? (
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

                  {usingDefaultQs && (
                    <div className="p-2.5 rounded-xl bg-slate-950 border border-slate-800 text-[11px] text-slate-400 leading-snug">
                      Using initial store setup questions (customize anytime inside{' '}
                      <strong className="text-slate-200">Store Profile → Security</strong>).
                    </div>
                  )}

                  <div className="space-y-2.5 max-h-56 overflow-y-auto pr-0.5">
                    {recovery.securityQuestions.map((q, idx) => {
                      const hasFailed = failedQuestionIds.includes(q.id);
                      return (
                        <div key={q.id} className="space-y-1">
                          <label
                            htmlFor={`sq-answer-${q.id}`}
                            className="block text-xs font-bold text-slate-200 leading-snug"
                          >
                            Q{idx + 1}. {q.question}
                          </label>
                          <input
                            id={`sq-answer-${q.id}`}
                            type={showAnswers ? 'text' : 'password'}
                            value={answers[q.id] || ''}
                            disabled={questionsVerified}
                            onChange={e => {
                              setFailedQuestionIds(prev => prev.filter(id => id !== q.id));
                              setAnswers(prev => ({ ...prev, [q.id]: e.target.value }));
                            }}
                            placeholder="Enter your answer (case-insensitive)"
                            className={`w-full px-3.5 py-2.5 rounded-xl bg-slate-950 border text-xs text-white focus:outline-none ${
                              hasFailed
                                ? 'border-rose-500/70 focus:border-rose-400'
                                : 'border-slate-700 focus:border-blue-500'
                            }`}
                          />
                        </div>
                      );
                    })}
                  </div>

                  <button
                    type="submit"
                    disabled={questionsVerified}
                    className="w-full min-h-[46px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-800 disabled:text-slate-500 text-white text-xs font-bold flex items-center justify-center gap-2 transition"
                  >
                    <ShieldCheck className="w-4 h-4" />
                    {questionsVerified ? 'Security Questions Verified' : 'Verify Security Answers'}
                  </button>
                </form>
              )}
            </>
          )}
        </>
      ) : (
        /* Step 2: Set New 4-Digit Master PIN */
        <form onSubmit={handleResetPinSubmit} className="space-y-3.5">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-emerald-300 flex items-center gap-1.5">
              <CheckCircle2 className="w-4 h-4" />
              Identity Verified · Set New 4-Digit PIN
            </span>
            <button
              type="button"
              onClick={() => setShowNewPin(v => !v)}
              className="px-2 py-1 rounded-lg bg-slate-950 hover:bg-slate-800 border border-slate-800 text-[11px] font-semibold text-slate-300 flex items-center gap-1"
            >
              {showNewPin ? (
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

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <label htmlFor="reset-new-pin" className="block text-[11px] font-bold text-slate-300">
                New 4-Digit PIN
              </label>
              <input
                id="reset-new-pin"
                type={showNewPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                autoFocus
                value={newPin}
                onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="4 digits"
                className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-700 text-base font-mono font-black tracking-widest text-white text-center tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label htmlFor="reset-confirm-pin" className="block text-[11px] font-bold text-slate-300">
                Confirm 4-Digit PIN
              </label>
              <input
                id="reset-confirm-pin"
                type={showNewPin ? 'text' : 'password'}
                inputMode="numeric"
                maxLength={4}
                value={confirmPin}
                onChange={e => setConfirmPin(e.target.value.replace(/\D/g, '').slice(0, 4))}
                placeholder="Repeat PIN"
                className="w-full px-3 py-3 rounded-xl bg-slate-950 border border-slate-700 text-base font-mono font-black tracking-widest text-white text-center tabular-nums focus:outline-none focus:border-emerald-500"
              />
            </div>
          </div>

          <button
            type="submit"
            className="w-full min-h-[48px] px-4 py-3 rounded-2xl bg-emerald-600 hover:bg-emerald-500 text-white text-sm font-black flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition active:scale-[0.99]"
          >
            <Check className="w-4 h-4" />
            Save New PIN &amp; Unlock Terminal
          </button>
        </form>
      )}
    </div>
  );
};
