import React, { useState } from 'react';
import { useAuth } from '../../context/AuthContext';
import { useLanguage } from '../../context/LanguageContext';
import { AppPage } from '../../types';
import { PWAInstallButton } from '../common/PWAInstallButton';
import { PhaseBadge } from '../common/PhaseBadge';
import { 
  Languages, 
  ShieldCheck, 
  LogOut, 
  User, 
  Menu, 
  X, 
  Cpu, 
  Sparkles,
  ChevronDown,
  LayoutDashboard
} from 'lucide-react';

interface NavbarProps {
  currentPage: AppPage;
  setCurrentPage: (page: AppPage) => void;
  onOpenTests: () => void;
  onToggleSidebar?: () => void;
  isSidebarOpen?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({ 
  currentPage, 
  setCurrentPage, 
  onOpenTests,
  onToggleSidebar,
  isSidebarOpen 
}) => {
  const { currentUser, userProfile, isAdmin, logout } = useAuth();
  const { language, setLanguage, isRTL, t } = useLanguage();
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);

  const toggleLanguage = () => {
    const nextLang = language === 'en' ? 'ar' : 'en';
    setLanguage(nextLang);
  };

  return (
    <header className="sticky top-0 z-40 w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl transition-colors">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Left: Mobile Menu Toggle & Brand Logo */}
          <div className="flex items-center gap-3">
            {currentUser && onToggleSidebar && (
              <button
                onClick={onToggleSidebar}
                className="lg:hidden p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-900 border border-slate-800 transition cursor-pointer"
                aria-label="Toggle sidebar"
              >
                {isSidebarOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
              </button>
            )}

            <button
              onClick={() => setCurrentPage('landing')}
              className="flex items-center gap-2.5 text-start cursor-pointer group"
            >
              <div className="relative w-9 h-9 rounded-xl bg-gradient-to-tr from-sky-500 via-blue-600 to-amber-400 p-[1.5px] shadow-lg shadow-sky-500/20 group-hover:shadow-sky-500/40 transition">
                <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center overflow-hidden">
                  <img src="./icon.svg" alt="SpinnerMine Logo" className="w-6 h-6 object-contain group-hover:rotate-180 transition-transform duration-700" />
                </div>
              </div>

              <div>
                <div className="flex items-center gap-1.5">
                  <span className="font-extrabold text-base tracking-tight bg-gradient-to-r from-white via-slate-100 to-sky-400 bg-clip-text text-transparent">
                    {t.brand}
                  </span>
                  <PhaseBadge phase={1} text="Phase 1" className="hidden sm:inline-flex scale-90" />
                </div>
                <p className="text-[10px] text-slate-400 font-mono -mt-0.5 tracking-wider hidden sm:block">
                  MONERO POOL CLUSTER
                </p>
              </div>
            </button>
          </div>

          {/* Center Navigation for Guest */}
          {!currentUser && (
            <nav className="hidden md:flex items-center gap-6 text-xs font-semibold text-slate-300">
              <button
                onClick={() => setCurrentPage('landing')}
                className={`hover:text-sky-400 transition cursor-pointer ${currentPage === 'landing' ? 'text-sky-400 font-bold' : ''}`}
              >
                {t.nav.home}
              </button>
              <button
                onClick={() => setCurrentPage('login')}
                className="hover:text-sky-400 transition cursor-pointer"
              >
                {t.landing.viewMining}
              </button>
              <button
                onClick={() => setCurrentPage('register')}
                className="hover:text-sky-400 transition cursor-pointer flex items-center gap-1"
              >
                <Sparkles className="w-3.5 h-3.5 text-amber-400" />
                <span>20% Miner Split</span>
              </button>
            </nav>
          )}

          {/* Right Action Tools */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            
            {/* Run Self Tests Verification */}
            <button
              onClick={onOpenTests}
              className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-sky-500/30 bg-sky-950/30 text-sky-300 hover:bg-sky-900/40 text-xs font-semibold transition cursor-pointer"
              title="Execute Phase 1 Section J Automated Verification Suite"
            >
              <ShieldCheck className="w-4 h-4 text-sky-400" />
              <span>{t.nav.tests}</span>
            </button>

            {/* PWA Install Button */}
            <PWAInstallButton />

            {/* Language Switcher Button */}
            <button
              onClick={toggleLanguage}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-800 bg-slate-900/80 hover:bg-slate-800 text-slate-200 text-xs font-bold transition cursor-pointer"
              title="Toggle English / العربية (RTL)"
            >
              <Languages className="w-3.5 h-3.5 text-sky-400" />
              <span>{language === 'en' ? 'العربية' : 'EN'}</span>
            </button>

            {/* Auth Buttons */}
            {currentUser ? (
              <div className="relative">
                <button
                  onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                  className="flex items-center gap-2 p-1.5 sm:pe-3 rounded-xl border border-slate-800 bg-slate-900/80 hover:bg-slate-800 transition cursor-pointer"
                >
                  <div className="w-7 h-7 rounded-lg bg-gradient-to-tr from-sky-500 to-blue-600 flex items-center justify-center text-white text-xs font-bold uppercase shadow-sm">
                    {userProfile?.displayName?.charAt(0) || currentUser.email?.charAt(0) || 'M'}
                  </div>
                  <span className="hidden sm:block text-xs font-semibold text-slate-200 max-w-[100px] truncate">
                    {userProfile?.displayName || currentUser.email?.split('@')[0]}
                  </span>
                  <ChevronDown className="w-3.5 h-3.5 text-slate-400" />
                </button>

                {/* Profile Dropdown */}
                {profileDropdownOpen && (
                  <div 
                    className="absolute end-0 mt-2 w-56 rounded-2xl bg-slate-900 border border-slate-700/80 p-2 shadow-2xl z-50 text-slate-200"
                    onClick={() => setProfileDropdownOpen(false)}
                  >
                    <div className="px-3 py-2 border-b border-slate-800">
                      <p className="text-xs font-bold text-white truncate">{userProfile?.displayName}</p>
                      <p className="text-[11px] text-slate-400 truncate">{currentUser.email}</p>
                      {isAdmin && (
                        <span className="mt-1.5 inline-block text-[10px] font-extrabold uppercase px-2 py-0.5 rounded bg-amber-500/20 text-amber-400 border border-amber-500/30">
                          Platform Admin
                        </span>
                      )}
                    </div>

                    <div className="py-1">
                      <button
                        onClick={() => setCurrentPage('dashboard')}
                        className="w-full text-start flex items-center gap-2 px-3 py-2 rounded-xl text-xs hover:bg-slate-800 transition cursor-pointer"
                      >
                        <LayoutDashboard className="w-4 h-4 text-sky-400" />
                        <span>{t.nav.dashboard}</span>
                      </button>
                      <button
                        onClick={() => setCurrentPage('settings')}
                        className="w-full text-start flex items-center gap-2 px-3 py-2 rounded-xl text-xs hover:bg-slate-800 transition cursor-pointer"
                      >
                        <User className="w-4 h-4 text-slate-400" />
                        <span>{t.nav.settings}</span>
                      </button>
                    </div>

                    <div className="pt-1 border-t border-slate-800">
                      <button
                        onClick={async () => {
                          await logout();
                          setCurrentPage('landing');
                        }}
                        className="w-full text-start flex items-center gap-2 px-3 py-2 rounded-xl text-xs text-rose-400 hover:bg-rose-500/10 transition cursor-pointer"
                      >
                        <LogOut className="w-4 h-4" />
                        <span>{t.nav.logout}</span>
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage('login')}
                  className="px-3.5 py-1.5 rounded-xl border border-slate-800 hover:border-slate-700 text-xs font-semibold text-slate-200 transition cursor-pointer"
                >
                  {t.nav.login}
                </button>
                <button
                  onClick={() => setCurrentPage('register')}
                  className="px-4 py-1.5 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-400 hover:to-blue-500 text-xs font-bold text-white shadow-lg shadow-sky-500/20 transition cursor-pointer"
                >
                  {t.nav.register}
                </button>
              </div>
            )}

          </div>

        </div>
      </div>
    </header>
  );
};
