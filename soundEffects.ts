/**
 * Web Audio API synthesizer for zero-latency POS sound effects
 * Guaranteed to work offline with zero external audio assets.
 */

class SoundController {
  private ctx: AudioContext | null = null;
  private soundEnabled: boolean = true;
  private soundMode: 'beep' | 'click' = 'beep';
  private hapticsEnabled: boolean = true;
  private lastHapticAt: number = 0;
  private hapticsListeners: Set<(enabled: boolean) => void> = new Set();

  constructor() {
    if (typeof window !== 'undefined') {
      const savedEnabled = localStorage.getItem('sq_sound_enabled');
      if (savedEnabled !== null) {
        this.soundEnabled = savedEnabled === 'true';
      }
      const savedMode = localStorage.getItem('sq_sound_mode');
      if (savedMode === 'beep' || savedMode === 'click') {
        this.soundMode = savedMode;
      }
      const savedHaptics = localStorage.getItem('sq_haptics_enabled');
      if (savedHaptics !== null) {
        this.hapticsEnabled = savedHaptics === 'true';
      }
    }
  }

  private initCtx() {
    if (!this.ctx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (AudioCtx) {
        this.ctx = new AudioCtx();
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }
    return this.ctx;
  }

  public setSoundEnabled(enabled: boolean) {
    this.soundEnabled = enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sq_sound_enabled', String(enabled));
    }
  }

  public isSoundEnabled(): boolean {
    return this.soundEnabled;
  }

  public setSoundMode(mode: 'beep' | 'click') {
    this.soundMode = mode;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sq_sound_mode', mode);
    }
  }

  public getSoundMode(): 'beep' | 'click' {
    return this.soundMode;
  }

  public isHapticsSupported(): boolean {
    return typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
  }

  public setHapticsEnabled(enabled: boolean) {
    this.hapticsEnabled = enabled;
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('sq_haptics_enabled', String(enabled));
    }
    this.hapticsListeners.forEach(listener => {
      try {
        listener(enabled);
      } catch {
        // ignore listener errors
      }
    });
  }

  public isHapticsEnabled(): boolean {
    return this.hapticsEnabled;
  }

  public subscribeHapticsChange(listener: (enabled: boolean) => void): () => void {
    this.hapticsListeners.add(listener);
    return () => {
      this.hapticsListeners.delete(listener);
    };
  }

  private triggerHaptic(pattern: VibratePattern = 30, minIntervalMs: number = 45): boolean {
    if (!this.hapticsEnabled || !this.isHapticsSupported()) {
      return false;
    }

    const now = Date.now();
    if (minIntervalMs > 0 && now - this.lastHapticAt < minIntervalMs) {
      return false;
    }
    this.lastHapticAt = now;

    try {
      return navigator.vibrate(pattern);
    } catch {
      return false;
    }
  }

  /**
   * Short crisp vibration when adding or incrementing an item in the POS cart
   */
  public vibrateItemAdded(): boolean {
    return this.triggerHaptic(30, 50);
  }

  /**
   * Distinct double-pulse vibration confirmation when completing a sale
   */
  public vibrateSaleCompleted(): boolean {
    return this.triggerHaptic([45, 55, 85], 80);
  }

  /**
   * Subtle tactile pulse for quick UI confirmations (e.g. toggling haptics on)
   */
  public vibrateTap(): boolean {
    return this.triggerHaptic(20, 40);
  }

  /**
   * Distinct POS item added sound (Beep or Click based on preference)
   */
  public playItemAdded() {
    this.vibrateItemAdded();
    if (!this.soundEnabled) return;

    if (this.soundMode === 'click') {
      this.playMechanicalClick();
    } else {
      this.playScannerBeep();
    }
  }

  /**
   * Crisp 1850Hz POS barcode scanner beep
   */
  public playScannerBeep() {
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sine';
      osc.frequency.setValueAtTime(1850, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1900, ctx.currentTime + 0.08);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.35, ctx.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.09);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.095);
    } catch {
      // AudioContext fallback
    }
  }

  /**
   * Tactile mechanical switch click
   */
  public playMechanicalClick() {
    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(850, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(120, ctx.currentTime + 0.04);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 0.005);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.045);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.05);
    } catch {
      // AudioContext fallback
    }
  }

  /**
   * Checkout / Bill Generated success chime
   */
  public playCheckoutSuccess() {
    this.vibrateSaleCompleted();
    if (!this.soundEnabled) return;

    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const notes = [1046.5, 1318.5, 1567.98]; // C6, E6, G6
      notes.forEach((freq, idx) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        const startTime = ctx.currentTime + idx * 0.08;
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, startTime);

        gain.gain.setValueAtTime(0.001, startTime);
        gain.gain.linearRampToValueAtTime(0.3, startTime + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, startTime + 0.22);

        osc.connect(gain);
        gain.connect(ctx.destination);

        osc.start(startTime);
        osc.stop(startTime + 0.24);
      });
    } catch {
      // AudioContext fallback
    }
  }

  /**
   * Warning / Low Stock alert sound
   */
  public playAlertSound() {
    this.triggerHaptic([80, 50, 80], 60);
    if (!this.soundEnabled) return;

    const ctx = this.initCtx();
    if (!ctx) return;

    try {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(320, ctx.currentTime);
      osc.frequency.setValueAtTime(260, ctx.currentTime + 0.1);

      gain.gain.setValueAtTime(0.001, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(0.25, ctx.currentTime + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.22);

      osc.connect(gain);
      gain.connect(ctx.destination);

      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.23);
    } catch {
      // AudioContext fallback
    }
  }
}

export const soundManager = new SoundController();
