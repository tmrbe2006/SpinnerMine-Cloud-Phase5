import React, { useRef, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { PhaseBadge } from '../components/common/PhaseBadge';
import { verifySpinnerWithServer } from '../services/gameApi';
import { Zap, Volume2, VolumeX, Sparkles, ShieldCheck, CheckCircle2, AlertCircle, Award } from 'lucide-react';

export const SpinnerGamePage: React.FC = () => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Game physics state
  const angleRef = useRef<number>(0);
  const velocityRef = useRef<number>(0); // radians per frame
  const isDraggingRef = useRef<boolean>(false);
  const lastPointerAngleRef = useRef<number>(0);
  const totalSpinsRef = useRef<number>(0);
  const topRpmRef = useRef<number>(0);
  const sessionStartTimeRef = useRef<number>(Date.now());

  const [currentRpm, setCurrentRpm] = useState<number>(0);
  const [displayTotalSpins, setDisplayTotalSpins] = useState<number>(0);
  const [displayTopRpm, setDisplayTopRpm] = useState<number>(0);
  const [soundEnabled, setSoundEnabled] = useState<boolean>(true);
  
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifiedPoints, setVerifiedPoints] = useState<number | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Audio synthesis using Web Audio API
  const audioCtxRef = useRef<AudioContext | null>(null);
  const oscRef = useRef<OscillatorNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);

  const initAudio = () => {
    if (!audioCtxRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();

        osc.type = 'triangle';
        osc.frequency.setValueAtTime(60, ctx.currentTime);
        gain.gain.setValueAtTime(0, ctx.currentTime);

        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();

        audioCtxRef.current = ctx;
        oscRef.current = osc;
        gainRef.current = gain;
      }
    }
  };

  // Main Canvas & Physics Loop
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;

    const render = () => {
      // Apply friction
      if (!isDraggingRef.current) {
        velocityRef.current *= 0.991; // high grade ceramic bearing friction
        if (Math.abs(velocityRef.current) < 0.0005) {
          velocityRef.current = 0;
        }
      }

      // Update angle
      const oldAngle = angleRef.current;
      angleRef.current += velocityRef.current;
      
      // Calculate revolutions
      const diff = Math.abs(angleRef.current - oldAngle);
      totalSpinsRef.current += diff / (2 * Math.PI);
      setDisplayTotalSpins(Math.floor(totalSpinsRef.current));

      // Calculate RPM
      const rpm = Math.round(Math.abs(velocityRef.current) * 60 * 60 / (2 * Math.PI));
      setCurrentRpm(rpm);

      if (rpm > topRpmRef.current) {
        topRpmRef.current = rpm;
        setDisplayTopRpm(rpm);
      }

      // Update audio frequency
      if (audioCtxRef.current && gainRef.current && oscRef.current) {
        if (soundEnabled && rpm > 10) {
          const freq = Math.min(600, 80 + rpm * 0.4);
          const vol = Math.min(0.12, (rpm / 800) * 0.12);
          oscRef.current.frequency.setTargetAtTime(freq, audioCtxRef.current.currentTime, 0.05);
          gainRef.current.gain.setTargetAtTime(vol, audioCtxRef.current.currentTime, 0.05);
        } else {
          gainRef.current.gain.setTargetAtTime(0, audioCtxRef.current.currentTime, 0.05);
        }
      }

      // Clear Canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      const centerX = canvas.width / 2;
      const centerY = canvas.height / 2;
      const currentAngle = angleRef.current;

      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(currentAngle);

      // Draw Tri-Blade Spinner Body
      const bladeRadius = 85;
      const bearingRadius = 26;

      for (let i = 0; i < 3; i++) {
        const bladeAngle = (i * 2 * Math.PI) / 3;
        ctx.save();
        ctx.rotate(bladeAngle);

        // Arm stem
        ctx.beginPath();
        ctx.moveTo(-18, 0);
        ctx.lineTo(-24, bladeRadius);
        ctx.arc(0, bladeRadius, 26, Math.PI, 0, false);
        ctx.lineTo(18, 0);
        ctx.closePath();
        ctx.fillStyle = '#0f172a';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#0284c7';
        ctx.stroke();

        // Arm Weight Ring
        ctx.beginPath();
        ctx.arc(0, bladeRadius, 18, 0, 2 * Math.PI);
        ctx.fillStyle = '#1e293b';
        ctx.fill();
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#38bdf8';
        ctx.stroke();

        // Inner Brass Weight
        ctx.beginPath();
        ctx.arc(0, bladeRadius, 8, 0, 2 * Math.PI);
        ctx.fillStyle = '#f59e0b';
        ctx.fill();

        ctx.restore();
      }

      // Center Hub Ring
      ctx.beginPath();
      ctx.arc(0, 0, bearingRadius + 4, 0, 2 * Math.PI);
      ctx.fillStyle = '#0284c7';
      ctx.fill();

      // Center Cap
      ctx.beginPath();
      ctx.arc(0, 0, bearingRadius, 0, 2 * Math.PI);
      ctx.fillStyle = '#020617';
      ctx.fill();
      ctx.lineWidth = 2.5;
      ctx.strokeStyle = '#38bdf8';
      ctx.stroke();

      // Logo/Glyph in Hub
      ctx.fillStyle = '#38bdf8';
      ctx.font = 'bold 11px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('XMR', 0, 0);

      ctx.restore();

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animId);
      if (audioCtxRef.current) {
        audioCtxRef.current.close().catch(() => {});
      }
    };
  }, [soundEnabled]);

  // Pointer Interaction Handlers
  const handlePointerDown = (e: React.PointerEvent) => {
    initAudio();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - canvas.width / 2;
    const y = e.clientY - rect.top - canvas.height / 2;

    isDraggingRef.current = true;
    lastPointerAngleRef.current = Math.atan2(y, x);
    velocityRef.current = 0;
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left - canvas.width / 2;
    const y = e.clientY - rect.top - canvas.height / 2;

    const currentAngle = Math.atan2(y, x);
    let delta = currentAngle - lastPointerAngleRef.current;

    if (delta > Math.PI) delta -= 2 * Math.PI;
    if (delta < -Math.PI) delta += 2 * Math.PI;

    angleRef.current += delta;
    velocityRef.current = delta;
    lastPointerAngleRef.current = currentAngle;
  };

  const handlePointerUp = () => {
    isDraggingRef.current = false;
  };

  const handleBoost = () => {
    initAudio();
    const boostDir = velocityRef.current >= 0 ? 1 : -1;
    velocityRef.current = boostDir * 0.42; // Fast kick
  };

  // Authoritative server-verified session claim
  const handleClaimPoints = async () => {
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!currentUser) {
      setErrorMessage('Please sign in to verify session and claim arcade points.');
      return;
    }

    const durationSec = Math.max(3, Math.round((Date.now() - sessionStartTimeRef.current) / 1000));
    const finalRpm = Math.max(100, displayTopRpm);

    setVerifying(true);

    try {
      // 1. Submit session telemetry to server for HMAC-SHA256 outcome verification
      const outcome = await verifySpinnerWithServer({
        duration: durationSec,
        rpm: currentRpm || finalRpm,
        maxRpm: displayTopRpm
      });

      // Session is recorded and verified server-side via Firebase Admin SDK with zero client write authority

      setVerifiedPoints(outcome.awardedEntertainmentPoints);
      setSuccessMessage(`Successfully claimed +${outcome.awardedEntertainmentPoints} verified arcade points!`);
      // Reset session timer
      sessionStartTimeRef.current = Date.now();
    } catch (err: any) {
      setErrorMessage(err.message || 'Server verification failed. No points awarded.');
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.spinner.title}</h1>
            <PhaseBadge phase={1} text="Server-Verified Arcade" />
          </div>
          <p className="text-xs sm:text-sm text-slate-400">{t.spinner.subtitle}</p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className="p-2.5 rounded-xl border border-slate-800 bg-slate-950 text-slate-400 hover:text-white transition cursor-pointer"
            title={soundEnabled ? 'Mute Sound' : 'Enable Sound'}
          >
            {soundEnabled ? <Volume2 className="w-4 h-4 text-sky-400" /> : <VolumeX className="w-4 h-4" />}
          </button>
          
          <button
            onClick={handleBoost}
            className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-amber-500 to-amber-600 hover:from-amber-400 hover:to-amber-500 text-slate-950 font-extrabold text-xs shadow-lg shadow-amber-500/20 flex items-center gap-2 transition cursor-pointer"
          >
            <Zap className="w-4 h-4" />
            <span>{t.spinner.boostBtn}</span>
          </button>
        </div>
      </div>

      {/* Status Alerts */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {successMessage && (
        <div className="p-4 rounded-2xl bg-emerald-950/40 border border-emerald-500/40 text-emerald-300 text-xs flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 shrink-0 text-emerald-400" />
          <span>{successMessage}</span>
        </div>
      )}

      {/* Main Canvas Stage */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 items-center">
        
        {/* Left Stats */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400 font-semibold uppercase">{t.spinner.rpm}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-black text-sky-400 font-mono-numbers">{currentRpm}</span>
              <span className="text-xs text-slate-500">RPM</span>
            </div>
            {/* RPM gauge bar */}
            <div className="w-full bg-slate-800 h-2 rounded-full mt-3 overflow-hidden">
              <div 
                className="bg-gradient-to-r from-sky-400 to-amber-400 h-full transition-all duration-100"
                style={{ width: `${Math.min(100, (currentRpm / 1500) * 100)}%` }}
              />
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400 font-semibold uppercase">{t.spinner.topSpeed}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-amber-400 font-mono-numbers">{displayTopRpm}</span>
              <span className="text-xs text-slate-500">MAX RPM</span>
            </div>
          </div>
        </div>

        {/* Center Spinner Viewport */}
        <div className="flex flex-col items-center justify-center p-6 rounded-3xl bg-slate-900/40 border border-slate-800/80 shadow-2xl relative">
          <canvas
            ref={canvasRef}
            width={340}
            height={340}
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerUp}
            className="cursor-grab active:cursor-grabbing touch-none select-none max-w-full"
          />
          <p className="text-xs text-slate-400 mt-4 text-center font-medium">
            {t.spinner.swipeInstruction}
          </p>

          <button
            onClick={handleClaimPoints}
            disabled={verifying}
            className="mt-4 px-6 py-2.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-white font-bold text-xs shadow-lg shadow-sky-500/20 flex items-center gap-2 cursor-pointer transition disabled:opacity-50"
          >
            <Award className="w-4 h-4" />
            <span>{verifying ? 'Verifying with Server...' : 'Claim Verified Points'}</span>
          </button>
        </div>

        {/* Right Stats & Rewards */}
        <div className="space-y-4">
          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400 font-semibold uppercase">{t.spinner.totalSpins}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-3xl font-black text-white font-mono-numbers">{displayTotalSpins}</span>
              <span className="text-xs text-slate-500">Revolutions</span>
            </div>
          </div>

          <div className="p-5 rounded-2xl bg-slate-900/60 border border-slate-800">
            <span className="text-xs text-slate-400 font-semibold uppercase">{t.spinner.pointsEarned}</span>
            <div className="flex items-baseline gap-2 mt-1">
              <span className="text-2xl font-black text-emerald-400 font-mono-numbers">
                {verifiedPoints !== null ? `+${verifiedPoints}` : '0'}
              </span>
              <span className="text-xs text-slate-500">Verified Points</span>
            </div>
          </div>
        </div>

      </div>

      {/* Disclaimers & Integrity */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
        <span>
          Spinner sessions submit rotation telemetry to the server API for cryptographic HMAC verification. Arcade points are recreational and completely decoupled from cryptocurrency balances.
        </span>
      </div>

    </div>
  );
};
