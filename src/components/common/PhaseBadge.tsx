import React from 'react';

interface PhaseBadgeProps {
  phase?: 1 | 2;
  text?: string;
  className?: string;
}

export const PhaseBadge: React.FC<PhaseBadgeProps> = ({ phase = 1, text, className = '' }) => {
  if (phase === 1) {
    return (
      <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-sky-950/70 text-sky-400 border border-sky-500/30 shadow-sm ${className}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-sky-400 animate-pulse" />
        {text || 'Phase 1 Active'}
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-950/60 text-amber-400 border border-amber-500/30 ${className}`}>
      <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
      {text || 'Phase 2 Engine'}
    </span>
  );
};
