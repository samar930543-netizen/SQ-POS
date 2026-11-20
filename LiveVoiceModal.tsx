import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Bill, Customer, Product, StoreProfile } from '../types';
import {
  buildLiveStoreContext,
  computeRmsLevel,
  decodeBase64Pcm24kToFloat32,
  float32ToInt16PcmBase64,
  LIVE_VOICE_OPTIONS,
  LiveVoiceName,
} from '../utils/liveVoiceAudio';
import { formatAudioDuration } from '../utils/audioTranscribe';
import { soundManager } from '../utils/soundEffects';
import {
  AlertCircle,
  AudioWaveform,
  Check,
  Copy,
  Loader2,
  Mic,
  MicOff,
  Phone,
  PhoneOff,
  Send,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';

interface LiveVoiceModalProps {
  isOpen: boolean;
  onClose: () => void;
  storeProfile: StoreProfile;
  products: Product[];
  customers: Customer[];
  bills: Bill[];
}

interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  timestamp: string;
  isStreaming?: boolean;
}

type SessionPhase = 'idle' | 'connecting' | 'live' | 'error';

const QUICK_PROMPTS = [
  'Which products are running low on stock?',
  'What are today’s total sales and bill count?',
  'Summarize top pending customer udhar balances',
  'Tell me the bundle price for Gold Flake',
];

const VISUALIZER_BARS = 24;

export const LiveVoiceModal: React.FC<LiveVoiceModalProps> = ({
  isOpen,
  onClose,
  storeProfile,
  products,
  customers,
  bills,
}) => {
  const [phase, setPhase] = useState<SessionPhase>('idle');
  const [selectedVoice, setSelectedVoice] = useState<LiveVoiceName>('Zephyr');
  const [isMuted, setIsMuted] = useState(false);
  const [isSpeakerMuted, setIsSpeakerMuted] = useState(false);
  const [isModelSpeaking, setIsModelSpeaking] = useState(false);
  const [callSeconds, setCallSeconds] = useState(0);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState('');
  const [copiedTranscript, setCopiedTranscript] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [visualizerBars, setVisualizerBars] = useState<number[]>(() =>
    Array.from({ length: VISUALIZER_BARS }, () => 0.14)
  );

  // Refs for audio callbacks & WebSocket to avoid stale closures
  const wsRef = useRef<WebSocket | null>(null);
  const inputCtxRef = useRef<AudioContext | null>(null);
  const outputCtxRef = useRef<AudioContext | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const nextStartTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());
  const isMutedRef = useRef<boolean>(false);
  const isSpeakerMutedRef = useRef<boolean>(false);
  const isLiveRef = useRef<boolean>(false);
  const callTimerRef = useRef<number | null>(null);
  const speakingHoldTimerRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const micSupported =
    typeof navigator !== 'undefined' &&
    Boolean(navigator.mediaDevices?.getUserMedia) &&
    typeof window !== 'undefined' &&
    typeof window.AudioContext !== 'undefined';

  useEffect(() => {
    isMutedRef.current = isMuted;
  }, [isMuted]);

  useEffect(() => {
    isSpeakerMutedRef.current = isSpeakerMuted;
    if (isSpeakerMuted) {
      stopAllOutputAudio();
    }
  }, [isSpeakerMuted]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const stopAllOutputAudio = () => {
    activeSourcesRef.current.forEach(src => {
      try {
        src.stop();
      } catch {
        // Ignore already stopped sources
      }
    });
    activeSourcesRef.current.clear();
    if (outputCtxRef.current) {
      nextStartTimeRef.current = outputCtxRef.current.currentTime;
    } else {
      nextStartTimeRef.current = 0;
    }
    setIsModelSpeaking(false);
  };

  const cleanupSession = (nextPhase: SessionPhase = 'idle') => {
    isLiveRef.current = false;

    if (callTimerRef.current !== null) {
      window.clearInterval(callTimerRef.current);
      callTimerRef.current = null;
    }
    if (speakingHoldTimerRef.current !== null) {
      window.clearTimeout(speakingHoldTimerRef.current);
      speakingHoldTimerRef.current = null;
    }

    stopAllOutputAudio();

    if (processorRef.current) {
      try {
        processorRef.current.onaudioprocess = null;
        processorRef.current.disconnect();
      } catch {
        // Ignore disconnect errors
      }
      processorRef.current = null;
    }

    if (sourceNodeRef.current) {
      try {
        sourceNodeRef.current.disconnect();
      } catch {
        // Ignore
      }
      sourceNodeRef.current = null;
    }

    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach(track => track.stop());
      mediaStreamRef.current = null;
    }

    if (inputCtxRef.current) {
      inputCtxRef.current.close().catch(() => {});
      inputCtxRef.current = null;
    }

    if (outputCtxRef.current) {
      outputCtxRef.current.close().catch(() => {});
      outputCtxRef.current = null;
    }

    if (wsRef.current) {
      const ws = wsRef.current;
      wsRef.current = null;
      try {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'stop' }));
        }
        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();
      } catch {
        // Ignore
      }
    }

    setIsModelSpeaking(false);
    setVisualizerBars(Array.from({ length: VISUALIZER_BARS }, () => 0.14));
    setPhase(nextPhase);
  };

  // Cleanup when modal closes or component unmounts
  useEffect(() => {
    if (!isOpen) {
      cleanupSession('idle');
    }
    return () => {
      cleanupSession('idle');
    };
  }, [isOpen]);

  const updateBarsFromLevel = (level: number, source: 'user' | 'model') => {
    const safeLevel = Math.max(0.12, Math.min(1, level));
    setVisualizerBars(prev =>
      prev.map((_, idx) => {
        const centerWeight = 1 - Math.abs(idx - VISUALIZER_BARS / 2) / (VISUALIZER_BARS / 2);
        const ripple = source === 'model' ? ((idx % 3) + 1) * 0.18 : ((idx % 2) + 1) * 0.15;
        return Math.max(0.14, Math.min(1, safeLevel * (0.45 + centerWeight * 0.55) + ripple * safeLevel));
      })
    );
  };

  const appendStreamingTranscript = (role: 'user' | 'assistant', chunkText: string) => {
    const cleaned = chunkText;
    if (!cleaned) return;

    setMessages(prev => {
      const last = prev[prev.length - 1];
      if (last && last.role === role && last.isStreaming) {
        const needsSpace =
          last.text.length > 0 &&
          !last.text.endsWith(' ') &&
          !cleaned.startsWith(' ') &&
          !/^[.,!?;:']/.test(cleaned);
        const mergedText = `${last.text}${needsSpace ? ' ' : ''}${cleaned}`;
        return [...prev.slice(0, -1), { ...last, text: mergedText }];
      }

      return [
        ...prev,
        {
          id: `live_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
          role,
          text: cleaned.trimStart(),
          timestamp: new Date().toLocaleTimeString('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          }),
          isStreaming: true,
        },
      ];
    });
  };

  const finalizeStreamingTurns = () => {
    setMessages(prev =>
      prev.map(m => (m.isStreaming ? { ...m, isStreaming: false } : m))
    );
  };

  const playPcm24kChunk = (base64Pcm: string) => {
    const outputCtx = outputCtxRef.current;
    if (!outputCtx || isSpeakerMutedRef.current) return;

    try {
      if (outputCtx.state === 'suspended') {
        void outputCtx.resume();
      }
      const samples = decodeBase64Pcm24kToFloat32(base64Pcm);
      if (samples.length === 0) return;

      const audioBuffer = outputCtx.createBuffer(1, samples.length, 24000);
      audioBuffer.getChannelData(0).set(samples);

      const source = outputCtx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(outputCtx.destination);

      const startTime = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
      source.start(startTime);
      nextStartTimeRef.current = startTime + audioBuffer.duration;

      activeSourcesRef.current.add(source);
      source.onended = () => {
        activeSourcesRef.current.delete(source);
        if (activeSourcesRef.current.size === 0) {
          setIsModelSpeaking(false);
        }
      };

      setIsModelSpeaking(true);
      updateBarsFromLevel(computeRmsLevel(samples), 'model');
      if (speakingHoldTimerRef.current !== null) {
        window.clearTimeout(speakingHoldTimerRef.current);
      }
      speakingHoldTimerRef.current = window.setTimeout(() => {
        if (activeSourcesRef.current.size === 0) {
          setIsModelSpeaking(false);
        }
      }, Math.max(250, Math.round(audioBuffer.duration * 1000) + 120));
    } catch {
      // Ignore malformed chunk
    }
  };

  const startVoiceConversation = async () => {
    if (phase === 'connecting' || phase === 'live') return;
    setErrorMsg(null);

    if (!micSupported) {
      setErrorMsg(
        'Microphone capture or Web Audio API is unavailable in this browser.'
      );
      setPhase('error');
      return;
    }

    setPhase('connecting');
    setCallSeconds(0);
    setIsMuted(false);
    isMutedRef.current = false;

    try {
      // 1. Initialize 16kHz input and 24kHz output AudioContexts inside user gesture
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;

      let inputCtx: AudioContext;
      try {
        inputCtx = new AudioCtx({ sampleRate: 16000 });
      } catch {
        inputCtx = new AudioCtx();
      }
      inputCtxRef.current = inputCtx;

      let outputCtx: AudioContext;
      try {
        outputCtx = new AudioCtx({ sampleRate: 24000 });
      } catch {
        outputCtx = new AudioCtx();
      }
      outputCtxRef.current = outputCtx;
      nextStartTimeRef.current = outputCtx.currentTime;

      if (inputCtx.state === 'suspended') await inputCtx.resume();
      if (outputCtx.state === 'suspended') await outputCtx.resume();

      // 2. Request microphone permission
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      mediaStreamRef.current = stream;

      // 3. Connect WebSocket bridge to server
      const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const ws = new WebSocket(`${wsProtocol}//${window.location.host}/api/live-voice`);
      wsRef.current = ws;

      const storeContext = buildLiveStoreContext({
        storeProfile,
        products,
        customers,
        bills,
      });

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            type: 'start',
            voiceName: selectedVoice,
            storeContext,
          })
        );
      };

      ws.onmessage = (event) => {
        let payload: any;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (payload.type) {
          case 'ready': {
            isLiveRef.current = true;
            setPhase('live');
            soundManager.playScannerBeep();

            if (callTimerRef.current === null) {
              callTimerRef.current = window.setInterval(() => {
                setCallSeconds(prev => prev + 1);
              }, 1000);
            }

            // Start streaming 16kHz PCM mic frames
            if (!processorRef.current && mediaStreamRef.current && inputCtxRef.current) {
              const ctx = inputCtxRef.current;
              const src = ctx.createMediaStreamSource(mediaStreamRef.current);
              const processor = ctx.createScriptProcessor(4096, 1, 1);
              sourceNodeRef.current = src;
              processorRef.current = processor;

              // Route through zero-gain sink to avoid mic self-echo
              const silentGain = ctx.createGain();
              silentGain.gain.value = 0;

              processor.onaudioprocess = (audioEvent) => {
                if (!isLiveRef.current || isMutedRef.current) return;
                const activeWs = wsRef.current;
                if (!activeWs || activeWs.readyState !== WebSocket.OPEN) return;

                const channelData = audioEvent.inputBuffer.getChannelData(0);
                const rms = computeRmsLevel(channelData);
                if (rms > 0.05 && activeSourcesRef.current.size === 0) {
                  updateBarsFromLevel(rms, 'user');
                }
                const pcmBase64 = float32ToInt16PcmBase64(channelData, ctx.sampleRate);
                activeWs.send(JSON.stringify({ type: 'audio', data: pcmBase64 }));
              };

              src.connect(processor);
              processor.connect(silentGain);
              silentGain.connect(ctx.destination);
            }
            break;
          }

          case 'audio':
            if (typeof payload.data === 'string') {
              playPcm24kChunk(payload.data);
            }
            break;

          case 'input_transcript':
            if (typeof payload.text === 'string') {
              appendStreamingTranscript('user', payload.text);
            }
            break;

          case 'output_transcript':
            if (typeof payload.text === 'string') {
              appendStreamingTranscript('assistant', payload.text);
            }
            break;

          case 'interrupted':
            stopAllOutputAudio();
            finalizeStreamingTurns();
            break;

          case 'turn_complete':
            finalizeStreamingTurns();
            break;

          case 'error':
            soundManager.playAlertSound();
            setErrorMsg(payload.error || 'Gemini Live connection encountered an error.');
            cleanupSession('error');
            break;

          case 'closed':
            finalizeStreamingTurns();
            if (isLiveRef.current) {
              cleanupSession('idle');
            }
            break;
        }
      };

      ws.onerror = () => {
        soundManager.playAlertSound();
        setErrorMsg('WebSocket connection to Live Voice server failed. Please try again.');
        cleanupSession('error');
      };

      ws.onclose = () => {
        if (isLiveRef.current) {
          finalizeStreamingTurns();
          cleanupSession('idle');
        }
      };
    } catch (err: any) {
      soundManager.playAlertSound();
      const name = err?.name || '';
      if (name === 'NotAllowedError' || name === 'PermissionDeniedError') {
        setErrorMsg(
          'Microphone permission was denied. Allow microphone access in your browser settings to start a live voice conversation.'
        );
      } else if (name === 'NotFoundError') {
        setErrorMsg('No microphone hardware was found on this device.');
      } else {
        setErrorMsg(err?.message || 'Unable to start real-time voice session.');
      }
      cleanupSession('error');
    }
  };

  const handleEndConversation = () => {
    soundManager.playMechanicalClick();
    finalizeStreamingTurns();
    cleanupSession('idle');
  };

  const handleSendTextPrompt = (textToSend?: string) => {
    const clean = (textToSend ?? textDraft).trim();
    if (!clean) return;
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN || phase !== 'live') return;

    soundManager.playMechanicalClick();
    finalizeStreamingTurns();
    setMessages(prev => [
      ...prev,
      {
        id: `live_msg_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
        role: 'user',
        text: clean,
        timestamp: new Date().toLocaleTimeString('en-IN', {
          hour: '2-digit',
          minute: '2-digit',
        }),
        isStreaming: false,
      },
    ]);

    ws.send(JSON.stringify({ type: 'text', text: clean }));
    if (!textToSend) {
      setTextDraft('');
    }
  };

  const handleCopyConversation = async () => {
    if (messages.length === 0) return;
    const formatted = messages
      .map(m => `${m.role === 'user' ? 'You' : 'Assistant'}: ${m.text}`)
      .join('\n\n');
    try {
      await navigator.clipboard.writeText(formatted);
      soundManager.playMechanicalClick();
      setCopiedTranscript(true);
      setTimeout(() => setCopiedTranscript(false), 1800);
    } catch {
      setErrorMsg('Clipboard access blocked by browser.');
    }
  };

  const storeContextSummary = useMemo(
    () =>
      buildLiveStoreContext({
        storeProfile,
        products,
        customers,
        bills,
      }),
    [storeProfile, products, customers, bills]
  );

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/85 backdrop-blur-sm flex items-end sm:items-center justify-center p-0 sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="live-voice-modal-title"
    >
      <div className="bg-slate-900 border border-slate-800 w-full max-w-4xl h-[92vh] sm:h-[86vh] rounded-t-3xl sm:rounded-2xl shadow-2xl flex flex-col overflow-hidden">
        {/* Top Header */}
        <div className="px-4 sm:px-5 py-3.5 bg-slate-950 border-b border-slate-800 flex items-center justify-between gap-3 flex-shrink-0">
          <div className="min-w-0">
            <h2
              id="live-voice-modal-title"
              className="text-base font-bold text-white flex items-center gap-2"
            >
              <AudioWaveform className="w-4 h-4 text-emerald-400 flex-shrink-0" />
              <span className="truncate">Real-Time Voice Assistant</span>
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 truncate">
              Full-duplex voice conversation via Gemini 3.8 Live · Aware of your store catalog &amp; sales
            </p>
          </div>

          <div className="flex items-center gap-2 flex-shrink-0">
            {phase === 'live' && (
              <span className="px-2.5 py-1 rounded-lg bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 font-mono text-xs font-bold tabular-nums">
                LIVE · {formatAudioDuration(callSeconds)}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                soundManager.playMechanicalClick();
                cleanupSession('idle');
                onClose();
              }}
              className="min-h-[40px] min-w-[40px] flex items-center justify-center rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white border border-slate-700 transition"
              aria-label="Close Live Voice Assistant"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Workspace Grid */}
        <div className="flex-1 overflow-y-auto lg:overflow-hidden grid grid-cols-1 lg:grid-cols-12 divide-y lg:divide-y-0 lg:divide-x divide-slate-800">
          {/* LEFT: Call Controls, Voice Picker & Live Waveform */}
          <div className="lg:col-span-5 p-4 sm:p-5 bg-slate-900/70 flex flex-col justify-between gap-4 lg:overflow-y-auto">
            <div className="space-y-4">
              {/* Voice Waveform Visualizer Surface */}
              <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 space-y-3">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-white">
                    {phase === 'live'
                      ? isModelSpeaking
                        ? 'Assistant Speaking'
                        : isMuted
                        ? 'Microphone Muted'
                        : 'Listening (Speak anytime)'
                      : phase === 'connecting'
                      ? 'Connecting Live Session...'
                      : 'Ready for Voice Conversation'}
                  </span>
                  <span className="text-[11px] text-slate-400">
                    Voice: {selectedVoice}
                  </span>
                </div>

                {/* Audio Level Equalizer */}
                <div
                  className="h-20 px-3 rounded-xl bg-slate-900 border border-slate-800/80 flex items-center justify-between gap-1"
                  aria-hidden="true"
                >
                  {visualizerBars.map((bar, idx) => (
                    <div
                      key={`live_viz_bar_${idx}`}
                      className={`flex-1 rounded-full transition-all duration-75 ${
                        phase !== 'live'
                          ? 'bg-slate-700'
                          : isModelSpeaking
                          ? 'bg-emerald-400'
                          : isMuted
                          ? 'bg-amber-500/40'
                          : 'bg-sky-400'
                      }`}
                      style={{ height: `${Math.round(bar * 100)}%` }}
                    />
                  ))}
                </div>

                {/* Call Controls */}
                <div className="flex flex-wrap items-center gap-2">
                  {phase !== 'live' && phase !== 'connecting' ? (
                    <button
                      type="button"
                      onClick={() => void startVoiceConversation()}
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold flex items-center justify-center gap-2 shadow-lg shadow-emerald-950/50 transition active:scale-[0.98]"
                    >
                      <Phone className="w-4 h-4" />
                      <span>Start Live Voice Call</span>
                    </button>
                  ) : phase === 'connecting' ? (
                    <button
                      type="button"
                      onClick={handleEndConversation}
                      className="w-full min-h-[48px] px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-bold flex items-center justify-center gap-2 transition"
                    >
                      <Loader2 className="w-4 h-4 animate-spin text-emerald-400" />
                      <span>Connecting... (Tap to Cancel)</span>
                    </button>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setIsMuted(prev => !prev);
                        }}
                        className={`flex-1 min-h-[46px] px-3 py-2 rounded-xl text-xs font-bold border flex items-center justify-center gap-1.5 transition ${
                          isMuted
                            ? 'bg-amber-600/20 border-amber-500/50 text-amber-200'
                            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                        }`}
                        aria-pressed={isMuted}
                      >
                        {isMuted ? (
                          <>
                            <MicOff className="w-4 h-4 text-amber-400" />
                            <span>Muted</span>
                          </>
                        ) : (
                          <>
                            <Mic className="w-4 h-4 text-sky-400" />
                            <span>Mute Mic</span>
                          </>
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setIsSpeakerMuted(prev => !prev);
                        }}
                        className={`min-h-[46px] px-3 py-2 rounded-xl text-xs font-semibold border flex items-center justify-center gap-1.5 transition ${
                          isSpeakerMuted
                            ? 'bg-slate-800 border-rose-500/50 text-rose-300'
                            : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-200'
                        }`}
                        title={isSpeakerMuted ? 'Unmute assistant audio' : 'Mute assistant audio'}
                        aria-label={isSpeakerMuted ? 'Unmute assistant audio' : 'Mute assistant audio'}
                      >
                        {isSpeakerMuted ? (
                          <VolumeX className="w-4 h-4 text-rose-400" />
                        ) : (
                          <Volume2 className="w-4 h-4 text-emerald-400" />
                        )}
                      </button>

                      <button
                        type="button"
                        onClick={handleEndConversation}
                        className="flex-1 min-h-[46px] px-3.5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md transition active:scale-[0.98]"
                      >
                        <PhoneOff className="w-4 h-4" />
                        <span>End Call</span>
                      </button>
                    </>
                  )}
                </div>

                {phase === 'live' && isModelSpeaking && (
                  <button
                    type="button"
                    onClick={() => {
                      soundManager.playMechanicalClick();
                      stopAllOutputAudio();
                    }}
                    className="w-full py-2 rounded-xl bg-slate-900 hover:bg-slate-800 border border-slate-700 text-xs font-semibold text-slate-300 transition"
                  >
                    Stop Assistant Playback
                  </button>
                )}
              </div>

              {errorMsg && (
                <div className="p-3 rounded-xl bg-rose-950/50 border border-rose-700/60 text-rose-200 text-xs flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-rose-400 flex-shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {/* Voice Persona Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-semibold text-slate-300">Assistant Voice</span>
                  {phase === 'live' && (
                    <span className="text-[11px] text-slate-500">End call to switch voice</span>
                  )}
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-2 gap-1.5">
                  {LIVE_VOICE_OPTIONS.map(voice => {
                    const active = selectedVoice === voice.id;
                    return (
                      <button
                        key={voice.id}
                        type="button"
                        disabled={phase === 'live' || phase === 'connecting'}
                        onClick={() => {
                          soundManager.playMechanicalClick();
                          setSelectedVoice(voice.id);
                        }}
                        className={`px-3 py-2 rounded-xl border text-left transition disabled:opacity-60 ${
                          active
                            ? 'bg-emerald-600/20 border-emerald-500/60 text-white'
                            : 'bg-slate-950 border-slate-800 text-slate-300 hover:border-slate-700'
                        }`}
                      >
                        <div className="text-xs font-bold">{voice.label}</div>
                        <div className="text-[10px] text-slate-400 truncate">{voice.tone}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>

            {/* Live Store Awareness Context Summary */}
            <div className="p-3 rounded-xl bg-slate-950/80 border border-slate-800 text-[11px] text-slate-400 space-y-1">
              <div className="font-semibold text-slate-300">Connected Store Context</div>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 tabular-nums">
                <span>{storeContextSummary.totalProducts} SKUs</span>
                <span aria-hidden="true">·</span>
                <span>{storeContextSummary.lowStockCount} Low Stock</span>
                <span aria-hidden="true">·</span>
                <span>{storeContextSummary.totalCustomers} Customers</span>
              </div>
            </div>
          </div>

          {/* RIGHT: Live Conversation Feed & Optional Text Follow-up */}
          <div className="lg:col-span-7 flex flex-col lg:overflow-hidden bg-slate-950/60">
            {/* Transcript Toolbar */}
            <div className="px-4 py-3 border-b border-slate-800 bg-slate-900/50 flex items-center justify-between gap-2 flex-shrink-0">
              <span className="text-xs font-semibold text-white">
                Live Conversation Transcript
              </span>
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={handleCopyConversation}
                  disabled={messages.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-200 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 transition"
                >
                  {copiedTranscript ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-400" />
                      <span>Copied</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5" />
                      <span>Copy</span>
                    </>
                  )}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    soundManager.playMechanicalClick();
                    setMessages([]);
                  }}
                  disabled={messages.length === 0}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:opacity-40 text-slate-300 hover:text-rose-300 border border-slate-700 text-[11px] font-semibold flex items-center gap-1 transition"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  <span>Clear</span>
                </button>
              </div>
            </div>

            {/* Conversation Stream */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {messages.length === 0 ? (
                <div className="h-full min-h-[220px] flex flex-col items-center justify-center text-center bg-slate-900/40 border border-slate-800/80 rounded-2xl p-6 space-y-3">
                  <AudioWaveform className="w-10 h-10 text-emerald-400/70 stroke-[1.5]" />
                  <div>
                    <p className="text-sm font-semibold text-white">
                      {phase === 'live'
                        ? 'Listening — go ahead and say hello!'
                        : 'Tap "Start Live Voice Call" to begin'}
                    </p>
                    <p className="text-xs text-slate-400 mt-1 max-w-md leading-relaxed">
                      Ask about product rates, low-stock items, customer udhar dues, or today&apos;s billing totals in English, Hindi, or Hinglish. You can interrupt naturally mid-sentence anytime.
                    </p>
                  </div>

                  {phase === 'live' && (
                    <div className="flex flex-wrap justify-center gap-1.5 pt-2 max-w-lg">
                      {QUICK_PROMPTS.map(prompt => (
                        <button
                          key={prompt}
                          type="button"
                          onClick={() => handleSendTextPrompt(prompt)}
                          className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-[11px] font-medium transition"
                        >
                          {prompt}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {messages.map(msg => (
                    <div
                      key={msg.id}
                      className={`flex flex-col ${
                        msg.role === 'user' ? 'items-end' : 'items-start'
                      }`}
                    >
                      <div className="flex items-center gap-1.5 text-[10px] text-slate-400 mb-1 px-1 tabular-nums">
                        <span className="font-semibold">
                          {msg.role === 'user' ? 'You' : `Gemini Live (${selectedVoice})`}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span>{msg.timestamp}</span>
                      </div>
                      <div
                        className={`max-w-[85%] px-3.5 py-2.5 rounded-2xl text-xs leading-relaxed ${
                          msg.role === 'user'
                            ? 'bg-sky-600 text-white rounded-br-sm'
                            : 'bg-slate-900 border border-slate-800 text-slate-100 rounded-bl-sm'
                        }`}
                      >
                        {msg.text}
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} />
                </>
              )}
            </div>

            {/* Optional Text Message Input During Live Session */}
            <form
              onSubmit={e => {
                e.preventDefault();
                handleSendTextPrompt();
              }}
              className="p-3.5 bg-slate-950 border-t border-slate-800 flex items-center gap-2 flex-shrink-0"
            >
              <input
                type="text"
                value={textDraft}
                onChange={e => setTextDraft(e.target.value)}
                disabled={phase !== 'live'}
                placeholder={
                  phase === 'live'
                    ? 'Speak into mic, or type a message to Gemini Live...'
                    : 'Start the voice call to talk or send messages...'
                }
                className="flex-1 px-3.5 py-2.5 rounded-xl bg-slate-900 border border-slate-800 text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={phase !== 'live' || !textDraft.trim()}
                className="min-h-[42px] px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1.5 transition"
                aria-label="Send message to live conversation"
              >
                <Send className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Send</span>
              </button>
            </form>
          </div>
        </div>
      </div>
    </div>
  );
};
