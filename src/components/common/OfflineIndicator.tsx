import React from 'react';
import { useOnlineStatus } from '../../hooks/useOnlineStatus';
import { useLanguage } from '../../context/LanguageContext';
import { WifiOff } from 'lucide-react';

export const OfflineIndicator: React.FC = () => {
  const isOnline = useOnlineStatus();
  const { t } = useLanguage();

  if (isOnline) return null;

  return (
    <div className="fixed bottom-4 start-4 z-50 flex items-center gap-2.5 rounded-xl bg-amber-950/90 border border-amber-500/50 px-4 py-2.5 text-xs font-medium text-amber-200 shadow-2xl backdrop-blur-md animate-bounce">
      <WifiOff className="w-4 h-4 text-amber-400 shrink-0" />
      <span>{t.pwa.offlineBanner}</span>
    </div>
  );
};
