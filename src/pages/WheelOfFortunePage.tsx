import React, { useRef, useEffect, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { PhaseBadge } from '../components/common/PhaseBadge';
import confetti from 'canvas-confetti';
import { requestAuthoritativeWheelSpin } from '../services/gameApi';
import { Clock, CheckCircle2, AlertCircle, ShieldCheck } from 'lucide-react';

interface PrizeSegment {
  id: number;
  label: string;
  type: string;
  value: number;
  color: string;
}

export const WheelOfFortunePage: React.FC = () => {
  const { currentUser } = useAuth();
  const { t } = useLanguage();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [spinning, setSpinning] = useState(false);
  const [lastWonPrize, setLastWonPrize] = useState<PrizeSegment | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Authoritative segments aligned with server definitions
  const segments: PrizeSegment[] = [
    { id: 0, label: '+100 Arcade Points', type: 'points', value: 100, color: '#1e3a8a' },
    { id: 1, label: '+250 Arcade Points', type: 'points', value: 250, color: '#047857' },
    { id: 2, label: 'Spin Again', type: 'try_again', value: 0, color: '#334155' },
    { id: 3, label: '+50 Arcade Points', type: 'points', value: 50, color: '#b45309' },
    { id: 4, label: '+500 Arcade Points', type: 'points', value: 500, color: '#6d28d9' },
    { id: 5, label: '+150 Arcade Points', type: 'points', value: 150, color: '#0369a1' },
    { id: 6, label: 'No Luck', type: 'try_again', value: 0, color: '#475569' },
    { id: 7, label: '+300 Arcade Points', type: 'points', value: 300, color: '#be185d' },
  ];

  const currentRotationRef = useRef<number>(0);

  // Audio click synthesizer
  const playClickSound = () => {
    try {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(800, ctx.currentTime);
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.05);
      }
    } catch {}
  };

  const drawWheel = (rotation: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const numSegments = segments.length;
    const arc = (2 * Math.PI) / numSegments;
    const centerX = canvas.width / 2;
    const centerY = canvas.height / 2;
    const radius = canvas.width / 2 - 16;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Draw Outer Rim
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + 8, 0, 2 * Math.PI);
    ctx.fillStyle = '#0f172a';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();

    // Draw Segments
    for (let i = 0; i < numSegments; i++) {
      const startAngle = rotation + i * arc;
      const endAngle = startAngle + arc;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = segments[i].color;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#050a14';
      ctx.stroke();

      // Draw Text
      ctx.save();
      ctx.translate(centerX, centerY);
      ctx.rotate(startAngle + arc / 2);
      ctx.textAlign = 'right';
      ctx.fillStyle = '#ffffff';
      ctx.font = 'bold 12px Inter, sans-serif';
      ctx.fillText(segments[i].label, radius - 20, 4);
      ctx.restore();
    }

    // Center Hub
    ctx.beginPath();
    ctx.arc(centerX, centerY, 36, 0, 2 * Math.PI);
    ctx.fillStyle = '#050a14';
    ctx.fill();
    ctx.lineWidth = 4;
    ctx.strokeStyle = '#f59e0b';
    ctx.stroke();

    ctx.fillStyle = '#fbbf24';
    ctx.font = 'bold 11px Inter, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('SPIN', centerX, centerY);
  };

  useEffect(() => {
    drawWheel(currentRotationRef.current);
  }, []);

  const handleSpin = async () => {
    if (spinning) return;
    setErrorMessage(null);
    setLastWonPrize(null);

    if (!currentUser) {
      setErrorMessage('Please sign in to your account before spinning the wheel.');
      return;
    }

    setSpinning(true);

    let outcome;
    try {
      // 1. Request server-authoritative outcome (Token verified, rate limited, replay-protected)
      outcome = await requestAuthoritativeWheelSpin();
    } catch (err: any) {
      setErrorMessage(err.message || 'Server connection failed. No points awarded.');
      setSpinning(false);
      return;
    }

    // 2. Animate wheel towards server's target index
    const targetIndex = outcome.targetIndex;
    const numSegments = segments.length;
    const arc = (2 * Math.PI) / numSegments;

    const fullSpins = 5 + Math.floor(Math.random() * 2);
    // Pin at top (3*PI/2)
    const targetAngle = (3 * Math.PI) / 2 - (targetIndex * arc + arc / 2);
    const totalRotation = fullSpins * 2 * Math.PI + targetAngle;

    const startTime = performance.now();
    const duration = 4000;
    const startRot = currentRotationRef.current % (2 * Math.PI);
    let lastClickSegment = -1;

    const animate = async (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / duration);

      const ease = 1 - Math.pow(1 - progress, 3);
      const currentRot = startRot + totalRotation * ease;
      currentRotationRef.current = currentRot;

      const currentSector = Math.floor((currentRot / arc) % numSegments);
      if (currentSector !== lastClickSegment) {
        lastClickSegment = currentSector;
        playClickSound();
      }

      drawWheel(currentRot);

      if (progress < 1) {
        requestAnimationFrame(animate);
      } else {
        setSpinning(false);
        const won = segments[targetIndex];
        setLastWonPrize(won);

        if (won.type !== 'try_again') {
          confetti({
            particleCount: 80,
            spread: 70,
            origin: { y: 0.6 }
          });
        }

        // Outcome is persisted server-side via Firebase Admin SDK with zero client write authority
      }
    };

    requestAnimationFrame(animate);
  };

  return (
    <div className="space-y-8 max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
      
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 p-6 sm:p-8 rounded-3xl bg-slate-900/80 border border-slate-800 shadow-xl">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">{t.wheel.title}</h1>
            <PhaseBadge phase={1} text="Server-Authoritative RNG" />
          </div>
          <p className="text-xs sm:text-sm text-slate-400">{t.wheel.subtitle}</p>
        </div>

        <div className="flex items-center gap-2 text-xs font-semibold text-amber-400 bg-amber-950/40 border border-amber-500/30 px-3.5 py-2 rounded-xl">
          <Clock className="w-4 h-4" />
          <span>Server Verified Outcome</span>
        </div>
      </div>

      {/* Error message banner */}
      {errorMessage && (
        <div className="p-4 rounded-2xl bg-rose-950/40 border border-rose-500/40 text-rose-300 text-xs flex items-center gap-3">
          <AlertCircle className="w-5 h-5 shrink-0 text-rose-400" />
          <span>{errorMessage}</span>
        </div>
      )}

      {/* Main Wheel Viewport */}
      <div className="flex flex-col items-center justify-center p-8 rounded-3xl bg-slate-900/40 border border-slate-800/80 shadow-2xl relative">
        
        {/* Top Indicator Arrow */}
        <div className="z-10 -mb-4 flex flex-col items-center">
          <div className="w-0 h-0 border-l-[12px] border-l-transparent border-r-[12px] border-r-transparent border-t-[20px] border-t-amber-400 drop-shadow-md" />
        </div>

        <canvas
          ref={canvasRef}
          width={380}
          height={380}
          className="max-w-full drop-shadow-2xl"
        />

        {/* Spin Action Button */}
        <div className="mt-6 flex flex-col items-center gap-3">
          <button
            onClick={handleSpin}
            disabled={spinning}
            className="px-10 py-3.5 rounded-2xl bg-gradient-to-r from-amber-500 via-amber-400 to-amber-500 hover:from-amber-400 hover:to-amber-300 text-slate-950 font-black text-sm shadow-xl shadow-amber-500/25 transition transform hover:scale-105 active:scale-95 cursor-pointer disabled:opacity-50"
          >
            {spinning ? t.wheel.spinning : t.wheel.spinBtn}
          </button>
        </div>

        {/* Won Prize Alert */}
        {lastWonPrize && (
          <div className="mt-6 p-4 rounded-2xl bg-gradient-to-r from-slate-900 to-sky-950/60 border border-amber-500/40 text-center animate-bounce">
            <p className="text-xs text-slate-400 uppercase tracking-wider font-semibold">{t.wheel.lastPrize}</p>
            <p className="text-lg font-black text-amber-300 mt-0.5">{lastWonPrize.label}</p>
            <p className="text-[11px] text-emerald-400 mt-1 flex items-center justify-center gap-1">
              <CheckCircle2 className="w-3.5 h-3.5" /> {t.wheel.claimSuccess} (HMAC Verified)
            </p>
          </div>
        )}

      </div>

      {/* Disclaimers & Integrity */}
      <div className="p-4 rounded-2xl bg-slate-900/60 border border-slate-800 text-xs text-slate-400 flex items-center gap-3">
        <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" />
        <span>
          Recreational Gaming Policy: Points won on the Wheel of Fortune are exclusively for entertainment and casual rank progression, verified by server cryptographic HMAC and strictly separated from attributable cryptocurrency mining balances.
        </span>
      </div>

    </div>
  );
};
