import {
  AppLockRecoveryConfig,
  AppLockSettings,
  BiometricCredentialInfo,
  SecurityQuestionItem,
  StoreProfile,
} from '../types';

export interface BiometricCapabilityStatus {
  webAuthnSupported: boolean;
  platformAuthenticatorAvailable: boolean;
  secureContext: boolean;
  canUseBiometric: boolean;
  reason?: string;
}

function bufferToBase64Url(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToUint8Array(base64Url: string): Uint8Array {
  const padded = base64Url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  const base64 = padded + '='.repeat(padLen);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function getRandomChallenge(byteLength = 32): Uint8Array {
  const buf = new Uint8Array(byteLength);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(buf);
  } else {
    for (let i = 0; i < byteLength; i++) {
      buf[i] = Math.floor(Math.random() * 256);
    }
  }
  return buf;
}

export async function checkBiometricCapability(): Promise<BiometricCapabilityStatus> {
  if (typeof window === 'undefined') {
    return {
      webAuthnSupported: false,
      platformAuthenticatorAvailable: false,
      secureContext: false,
      canUseBiometric: false,
      reason: 'Browser window is unavailable.',
    };
  }

  const secureContext = Boolean(window.isSecureContext);
  const webAuthnSupported =
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials);

  if (!webAuthnSupported) {
    return {
      webAuthnSupported: false,
      platformAuthenticatorAvailable: false,
      secureContext,
      canUseBiometric: false,
      reason: 'This browser does not support WebAuthn Biometric Unlock. Use your 4-digit Master PIN.',
    };
  }

  if (!secureContext) {
    return {
      webAuthnSupported: true,
      platformAuthenticatorAvailable: false,
      secureContext: false,
      canUseBiometric: false,
      reason: 'Biometric authentication requires HTTPS or localhost. Use your 4-digit Master PIN.',
    };
  }

  let platformAvailable = false;
  try {
    if (typeof PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function') {
      platformAvailable = await Promise.race<boolean>([
        PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable(),
        new Promise<boolean>(resolve => setTimeout(() => resolve(false), 1500)),
      ]);
    }
  } catch {
    platformAvailable = false;
  }

  return {
    webAuthnSupported: true,
    platformAuthenticatorAvailable: platformAvailable,
    secureContext: true,
    canUseBiometric: platformAvailable,
    reason: platformAvailable
      ? undefined
      : 'No built-in fingerprint or face sensor was detected on this device/frame. You can still use your 4-digit Master PIN.',
  };
}

export function detectDeviceBiometricLabel(): string {
  if (typeof navigator === 'undefined') return 'Fingerprint / Face Unlock';
  const ua = navigator.userAgent || '';
  if (/iPhone|iPad|iPod/i.test(ua)) return 'Face ID / Touch ID';
  if (/Macintosh/i.test(ua)) return 'Mac Touch ID';
  if (/Android/i.test(ua)) return 'Android Fingerprint / Face Unlock';
  if (/Windows/i.test(ua)) return 'Windows Hello (Fingerprint / Face)';
  return 'Fingerprint / Face Unlock';
}

export async function enrollBiometricCredential(
  customLabel?: string
): Promise<{
  ok: boolean;
  credential?: BiometricCredentialInfo;
  error?: string;
}> {
  const capability = await checkBiometricCapability();
  if (!capability.webAuthnSupported || !capability.secureContext) {
    return {
      ok: false,
      error:
        capability.reason ||
        'WebAuthn biometric enrollment is unavailable in this browser context.',
    };
  }

  try {
    const challenge = getRandomChallenge(32);
    const userId = getRandomChallenge(16);
    const rpId = window.location.hostname || undefined;

    const credential = (await navigator.credentials.create({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        rp: {
          name: 'SQ ENTERPRISES POS',
          ...(rpId ? { id: rpId } : {}),
        },
        user: {
          id: userId.buffer as ArrayBuffer,
          name: `pos-master-${Date.now()}`,
          displayName: 'POS Master Admin',
        },
        pubKeyCredParams: [
          { type: 'public-key', alg: -7 }, // ES256
          { type: 'public-key', alg: -257 }, // RS256
        ],
        authenticatorSelection: {
          authenticatorAttachment: 'platform',
          userVerification: 'required',
          residentKey: 'preferred',
        },
        timeout: 60000,
        attestation: 'none',
      },
    })) as PublicKeyCredential | null;

    if (!credential || !credential.rawId) {
      return {
        ok: false,
        error: 'Biometric enrollment returned no credential.',
      };
    }

    const credentialId = bufferToBase64Url(credential.rawId);
    const label = customLabel?.trim() || detectDeviceBiometricLabel();

    return {
      ok: true,
      credential: {
        credentialId,
        label,
        enrolledAt: new Date().toISOString(),
      },
    };
  } catch (err: any) {
    const name = String(err?.name || '');
    if (name === 'NotAllowedError') {
      return {
        ok: false,
        error:
          'Biometric prompt was cancelled or blocked by browser/iframe permissions. You can always use your 4-digit Master PIN.',
      };
    }
    if (name === 'SecurityError') {
      return {
        ok: false,
        error:
          'Biometric registration is restricted in this embedded frame domain. Open directly over HTTPS/localhost or use your 4-digit PIN.',
      };
    }
    return {
      ok: false,
      error:
        err?.message ||
        'Biometric sensor unavailable on this device. Your 4-digit Master PIN remains active.',
    };
  }
}

export async function authenticateWithBiometric(
  settings: AppLockSettings
): Promise<{
  ok: boolean;
  credentialId?: string;
  cancelled?: boolean;
  error?: string;
}> {
  if (!settings.biometricEnabled || settings.biometricCredentials.length === 0) {
    return {
      ok: false,
      error: 'No biometric credential enrolled yet. Enter your 4-digit Master PIN.',
    };
  }

  const capability = await checkBiometricCapability();
  if (!capability.webAuthnSupported || !capability.secureContext) {
    return {
      ok: false,
      error:
        capability.reason ||
        'Biometric unlock is unavailable here. Use your 4-digit Master PIN.',
    };
  }

  try {
    const challenge = getRandomChallenge(32);
    const rpId = window.location.hostname || undefined;
    const allowCredentials: PublicKeyCredentialDescriptor[] =
      settings.biometricCredentials.map(c => ({
        type: 'public-key',
        id: base64UrlToUint8Array(c.credentialId).buffer as ArrayBuffer,
        transports: ['internal'],
      }));

    const assertion = (await navigator.credentials.get({
      publicKey: {
        challenge: challenge.buffer as ArrayBuffer,
        ...(rpId ? { rpId } : {}),
        allowCredentials,
        userVerification: 'required',
        timeout: 60000,
      },
    })) as PublicKeyCredential | null;

    if (!assertion || !assertion.rawId) {
      return {
        ok: false,
        error: 'Biometric verification did not return an assertion.',
      };
    }

    return {
      ok: true,
      credentialId: bufferToBase64Url(assertion.rawId),
    };
  } catch (err: any) {
    const name = String(err?.name || '');
    if (name === 'NotAllowedError') {
      return {
        ok: false,
        cancelled: true,
        error: 'Biometric verification was cancelled or timed out. Enter your 4-digit PIN below.',
      };
    }
    return {
      ok: false,
      error:
        err?.message ||
        'Biometric verification failed. Please enter your 4-digit Master PIN.',
    };
  }
}

export function isValidFourDigitPin(pin: string): boolean {
  return /^\d{4}$/.test(pin.trim());
}

export function verifyMasterPin(pinInput: string, settings: AppLockSettings): boolean {
  const cleanInput = pinInput.trim();
  const storedPin = (settings.masterPin || '1234').trim();
  return /^\d{4}$/.test(cleanInput) && cleanInput === storedPin;
}

// =========================================================================
// FORGOT PIN RECOVERY: SECURITY QUESTIONS (SHA-256) & EMAIL VERIFICATION
// =========================================================================

const SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function rotr(value: number, bits: number): number {
  return (value >>> bits) | (value << (32 - bits));
}

export function sha256Hex(message: string): string {
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const totalLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(totalLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;

  const view = new DataView(padded.buffer);
  view.setUint32(totalLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(totalLen - 4, bitLen >>> 0, false);

  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const W = new Uint32Array(64);

  for (let offset = 0; offset < totalLen; offset += 64) {
    for (let i = 0; i < 16; i++) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(W[i - 15], 7) ^ rotr(W[i - 15], 18) ^ (W[i - 15] >>> 3);
      const s1 = rotr(W[i - 2], 17) ^ rotr(W[i - 2], 19) ^ (W[i - 2] >>> 10);
      W[i] = (W[i - 16] + s0 + W[i - 7] + s1) >>> 0;
    }

    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + SHA256_K[i] + W[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  return H.map(n => n.toString(16).padStart(8, '0')).join('');
}

export const PRESET_SECURITY_QUESTIONS = [
  'What is your registered store name?',
  'What city or market is your shop located in?',
  'What are the last 4 digits of your registered shop phone?',
  'What is the name of your primary wholesale distributor?',
  'What is your favorite childhood school name?',
  'What was the make or model of your first vehicle?',
];

export function normalizeSecurityAnswer(rawAnswer: string): string {
  return String(rawAnswer || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export function hashSecurityAnswer(rawAnswer: string): string {
  return sha256Hex(`sq-pos-pin-recovery::${normalizeSecurityAnswer(rawAnswer)}`);
}

export function createDefaultRecoveryConfig(storeEmail = ''): AppLockRecoveryConfig {
  return {
    recoveryEmail: storeEmail.trim(),
    emailRecoveryEnabled: true,
    securityQuestionsEnabled: true,
    requireBothMethods: false,
    securityQuestions: [
      {
        id: 'sq_default_store',
        question: PRESET_SECURITY_QUESTIONS[0],
        answerHash: hashSecurityAnswer('SQ ENTERPRISES'),
      },
      {
        id: 'sq_default_city',
        question: PRESET_SECURITY_QUESTIONS[1],
        answerHash: hashSecurityAnswer('New Delhi'),
      },
    ],
  };
}

export function isUsingDefaultSecurityQuestions(questions: SecurityQuestionItem[]): boolean {
  if (questions.length !== 2) return false;
  return (
    questions[0]?.id === 'sq_default_store' &&
    questions[0]?.answerHash === hashSecurityAnswer('SQ ENTERPRISES') &&
    questions[1]?.id === 'sq_default_city' &&
    questions[1]?.answerHash === hashSecurityAnswer('New Delhi')
  );
}

export function resolveRecoveryConfig(
  settings: AppLockSettings,
  storeProfile?: Pick<StoreProfile, 'email' | 'storeName'>
): AppLockRecoveryConfig {
  const defaults = createDefaultRecoveryConfig(storeProfile?.email || '');
  const raw = settings.recovery;
  const resolvedEmail =
    (raw?.recoveryEmail || '').trim() || (storeProfile?.email || '').trim() || 'billing@sqenterprises.in';
  const validQuestions =
    Array.isArray(raw?.securityQuestions) && raw.securityQuestions.length > 0
      ? raw.securityQuestions.filter(q => q && q.question?.trim() && q.answerHash?.trim())
      : defaults.securityQuestions;

  return {
    recoveryEmail: resolvedEmail,
    emailRecoveryEnabled: raw?.emailRecoveryEnabled ?? defaults.emailRecoveryEnabled,
    securityQuestionsEnabled: raw?.securityQuestionsEnabled ?? defaults.securityQuestionsEnabled,
    requireBothMethods: Boolean(raw?.requireBothMethods),
    securityQuestions: validQuestions.length > 0 ? validQuestions : defaults.securityQuestions,
    updatedAt: raw?.updatedAt,
  };
}

export function isValidEmailAddress(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());
}

export function maskEmailAddress(email: string): string {
  const clean = email.trim();
  const [local, domain] = clean.split('@');
  if (!local || !domain) return clean;
  if (local.length <= 2) return `${local[0] || '*'}*@${domain}`;
  return `${local.slice(0, 2)}${'*'.repeat(Math.min(5, Math.max(2, local.length - 2)))}${local.slice(-1)}@${domain}`;
}

export function verifySecurityQuestionAnswers(
  submittedAnswers: Record<string, string>,
  questions: SecurityQuestionItem[]
): { ok: boolean; failedQuestionIds: string[] } {
  if (!questions || questions.length === 0) {
    return { ok: false, failedQuestionIds: [] };
  }
  const failedQuestionIds: string[] = [];
  for (const q of questions) {
    const raw = submittedAnswers[q.id] || '';
    if (!normalizeSecurityAnswer(raw) || hashSecurityAnswer(raw) !== q.answerHash) {
      failedQuestionIds.push(q.id);
    }
  }
  return {
    ok: failedQuestionIds.length === 0,
    failedQuestionIds,
  };
}

export interface EmailVerificationDispatchResult {
  ok: boolean;
  recoverySessionId?: string;
  maskedEmail?: string;
  expiresInMinutes?: number;
  deliveryChannel?: 'resend_email' | 'webhook_email' | 'sandbox_preview';
  previewCode?: string;
  error?: string;
}

export async function requestPinRecoveryEmailCode(params: {
  email: string;
  storeName?: string;
}): Promise<EmailVerificationDispatchResult> {
  try {
    const res = await fetch('/api/auth/recovery/send-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      return {
        ok: false,
        error: data?.error || 'Could not dispatch email verification code. Try Security Questions.',
      };
    }
    return {
      ok: true,
      recoverySessionId: data.recoverySessionId,
      maskedEmail: data.maskedEmail,
      expiresInMinutes: data.expiresInMinutes || 10,
      deliveryChannel: data.deliveryChannel,
      previewCode: data.previewCode,
    };
  } catch {
    return {
      ok: false,
      error:
        'Unable to reach the server to send email OTP. Check your connection or use Security Questions.',
    };
  }
}

export async function verifyPinRecoveryEmailCode(params: {
  recoverySessionId: string;
  email: string;
  code: string;
}): Promise<{ ok: boolean; resetToken?: string; attemptsLeft?: number; error?: string }> {
  try {
    const res = await fetch('/api/auth/recovery/verify-code', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success || !data?.verified) {
      return {
        ok: false,
        attemptsLeft: typeof data?.attemptsLeft === 'number' ? data.attemptsLeft : undefined,
        error: data?.error || 'Invalid or expired verification code.',
      };
    }
    return {
      ok: true,
      resetToken: data.resetToken,
    };
  } catch {
    return {
      ok: false,
      error: 'Network error while verifying email code. Check connection or use Security Questions.',
    };
  }
}
