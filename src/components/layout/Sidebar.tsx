import React from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AppPage } from '../../types';
import { 
  LayoutDashboard, 
  Cpu, 
  CircleDot, 
  Disc, 
  Wallet, 
  History, 
  Users, 
  Settings, 
  ShieldAlert,
  LogOut,
  Sparkles,
  ExternalLink
} from 'lucide-react';

interface SidebarProps {
  currentPage: AppPage;
  setCurrentPage: (page: AppPage) => void;
  isOpen: boolean;
  onClose: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentPage, setCurrentPage, isOpen, onClose }) => {
  const { userProfile, isAdmin, logout } = useAuth();
  const { t, isRTL } = useLanguage();

  const navItems = [
    { id: 'dashboard' as AppPage, label: t.nav.dashboard, icon: LayoutDashboard },
    { id: 'mining' as AppPage, label: t.nav.mining, icon: Cpu, badge: '20% Split' },
    { id: 'spinner' as AppPage, label: t.nav.spinner, icon: CircleDot, badge: 'Game' },
    { id: 'wheel' as AppPage, label: t.nav.wheel, icon: Disc, badge: 'Daily' },
    { id: 'wallet' as AppPage, label: t.nav.wallet, icon: Wallet },
    { id: 'withdrawals' as AppPage, label: t.nav.withdrawals, icon: History },
    { id: 'referrals' as AppPage, label: t.nav.referrals, icon: Users, badge: '+5%' },
    { id: 'settings' as AppPage, label: t.nav.settings, icon: Settings },
  ];

  const handleNav = (page: AppPage) => {
    setCurrentPage(page);
    onClose();
  };

  return (
    <>
      {/* Mobile Backdrop */}
      {isOpen && (
        <div 
          className="fixed inset-0 z-40 bg-black/60 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar Container */}
      <aside
        className={`fixed top-16 bottom-0 z-40 w-64 bg-slate-950/95 border-e border-slate-800/80 p-4 transition-transform duration-300 ease-in-out lg:translate-x-0 overflow-y-auto flex flex-col justify-between ${
          isOpen ? 'translate-x-0' : isRTL ? 'translate-x-full lg:translate-x-0' : '-translate-x-full lg:translate-x-0'
        }`}
      >
        <div className="space-y-6">
          {/* User Mini Profile Badge */}
          <div className="p-3.5 rounded-2xl bg-gradient-to-b from-slate-900 to-slate-900/60 border border-slate-800/80 shadow-md">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white font-bold text-sm shadow-md shadow-sky-500/20">
                {userProfile?.displayName?.charAt(0) || 'M'}
              </div>
              <div className="overflow-hidden">
                <h4 className="text-xs font-bold text-white truncate">{userProfile?.displayName || 'Active Miner'}</h4>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className={`w-2 h-2 rounded-full ${userProfile?.miningConsent ? 'bg-emerald-400' : 'bg-amber-400'} animate-pulse`} />
                  <span className="text-[11px] text-slate-400 truncate">
                    {userProfile?.miningConsent ? t.consent.statusGranted : t.consent.statusMissing}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Navigation Links */}
          <nav className="space-y-1">
            <p className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-slate-500 mb-2">
              Platform Modules
            </p>

            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = currentPage === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleNav(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-semibold transition cursor-pointer group ${
                    isActive
                      ? 'bg-sky-500/10 text-sky-400 border border-sky-500/30 shadow-sm'
                      : 'text-slate-300 hover:text-white hover:bg-slate-900 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <Icon className={`w-4 h-4 transition ${isActive ? 'text-sky-400' : 'text-slate-400 group-hover:text-slate-200'}`} />
                    <span>{item.label}</span>
                  </div>

                  {item.badge && (
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                      isActive 
                        ? 'bg-sky-500/20 text-sky-300' 
                        : 'bg-slate-800 text-slate-400 group-hover:text-slate-300'
                    }`}>
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}

            {/* Admin Section if Admin */}
            {isAdmin && (
              <div className="pt-4 mt-2 border-t border-slate-800">
                <p className="px-3 text-[10px] font-extrabold uppercase tracking-wider text-amber-500 mb-2 flex items-center gap-1.5">
                  <ShieldAlert className="w-3.5 h-3.5" />
                  Privileged
                </p>
                <button
                  onClick={() => handleNav('admin')}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-xs font-bold transition cursor-pointer ${
                    currentPage === 'admin'
                      ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40 shadow-sm'
                      : 'text-amber-300/80 hover:text-amber-300 hover:bg-amber-950/20 border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <ShieldAlert className="w-4 h-4 text-amber-400" />
                    <span>{t.nav.admin}</span>
                  </div>
                  <span className="text-[9px] font-extrabold px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-300">
                    MASTER
                  </span>
                </button>
              </div>
            )}
          </nav>
        </div>

        {/* Bottom Split Card & Logout */}
        <div className="pt-4 border-t border-slate-800/80 space-y-3">
          <div className="p-3 rounded-xl bg-gradient-to-br from-slate-900 to-sky-950/30 border border-sky-500/20 text-[11px]">
            <div className="flex items-center justify-between font-bold text-sky-300 mb-1">
              <span>{t.mining.splitCardTitle}</span>
              <span className="text-amber-400 font-mono">20 / 80</span>
            </div>
            <p className="text-[10px] text-slate-400 leading-relaxed">
              {t.dashboard.userSplitNotice}
            </p>
          </div>

          <button
            onClick={async () => {
              await logout();
              setCurrentPage('landing');
              onClose();
            }}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
          >
            <LogOut className="w-4 h-4" />
            <span>{t.nav.logout}</span>
          </button>
        </div>
      </aside>
    </>
  );
};
