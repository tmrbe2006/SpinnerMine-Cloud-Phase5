/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useEffect } from 'react';
import { AuthProvider, useAuth } from './context/AuthContext';
import { LanguageProvider } from './context/LanguageContext';
import { AppPage } from './types';
import { Navbar } from './components/layout/Navbar';
import { Sidebar } from './components/layout/Sidebar';
import { Footer } from './components/layout/Footer';
import { OfflineIndicator } from './components/common/OfflineIndicator';
import { MiningConsentModal } from './components/common/MiningConsentModal';
import { TestRunnerModal } from './components/common/TestRunnerModal';

// Pages
import { LandingPage } from './pages/LandingPage';
import { LoginPage } from './pages/LoginPage';
import { RegisterPage } from './pages/RegisterPage';
import { ForgotPasswordPage } from './pages/ForgotPasswordPage';
import { UserDashboardPage } from './pages/UserDashboardPage';
import { MiningDashboardPage } from './pages/MiningDashboardPage';
import { SpinnerGamePage } from './pages/SpinnerGamePage';
import { WheelOfFortunePage } from './pages/WheelOfFortunePage';
import { WalletPage } from './pages/WalletPage';
import { WithdrawalsPage } from './pages/WithdrawalsPage';
import { ReferralsPage } from './pages/ReferralsPage';
import { AccountSettingsPage } from './pages/AccountSettingsPage';
import { AdminDashboardPage } from './pages/AdminDashboardPage';
import { ShieldAlert, ArrowLeft } from 'lucide-react';

const AppContent: React.FC = () => {
  const { currentUser, isAdmin, loading } = useAuth();

  const isElectronEnv = typeof window !== 'undefined' && Boolean(window.electronAPI || window.electronMiningAPI);

  // Navigation state initialized safely
  const [currentPage, setCurrentPage] = useState<AppPage>(() => {
    const hash = window.location.hash.replace('#', '') as AppPage;
    const validPages: AppPage[] = [
      'landing', 'login', 'register', 'forgot-password', 
      'dashboard', 'mining', 'spinner', 'wheel', 
      'wallet', 'withdrawals', 'referrals', 'settings', 'admin'
    ];
    if (validPages.includes(hash)) return hash;
    // Desktop Electron client defaults directly to the mining dashboard
    if (isElectronEnv) return 'mining';
    return 'landing';
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(false);
  const [isConsentModalOpen, setIsConsentModalOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);

  // Sync hash with current page
  useEffect(() => {
    window.location.hash = currentPage;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }, [currentPage]);

  // Handle browser back/forward buttons & URL hash changes with strict guards
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash.replace('#', '') as AppPage;
      if (hash && hash !== currentPage) {
        if (hash === 'admin' && !isAdmin) {
          // Block hash tampering for unauthorized admin access
          setCurrentPage('dashboard');
          window.location.hash = 'dashboard';
        } else {
          setCurrentPage(hash);
        }
      }
    };
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, [currentPage, isAdmin]);

  // Protected route definitions (In desktop Electron client, mining is directly accessible)
  const protectedPages: AppPage[] = isElectronEnv
    ? ['dashboard', 'spinner', 'wheel', 'wallet', 'withdrawals', 'referrals', 'settings', 'admin']
    : ['dashboard', 'mining', 'spinner', 'wheel', 'wallet', 'withdrawals', 'referrals', 'settings', 'admin'];

  // Route security gate
  const navigateToPage = (page: AppPage) => {
    if (!currentUser && protectedPages.includes(page)) {
      setCurrentPage('login');
      return;
    }
    if (page === 'admin' && !isAdmin) {
      // Strictly prevent non-admins from opening admin dashboard
      setCurrentPage('dashboard');
      return;
    }
    setCurrentPage(page);
  };

  // If user is on 'admin' route but NOT admin, immediately redirect
  useEffect(() => {
    if (!loading && currentPage === 'admin' && !isAdmin) {
      setCurrentPage('dashboard');
      window.location.hash = 'dashboard';
    }
  }, [currentPage, isAdmin, loading]);

  // Mark application ready for Electron runtime smoke verification
  useEffect(() => {
    if (!loading) {
      document.getElementById('root')?.setAttribute('data-app-ready', 'true');
      document.body.setAttribute('data-app-ready', 'true');
    }
  }, [loading]);

  const isDashboardLayout = Boolean(currentUser && protectedPages.includes(currentPage));

  if (loading) {
    return (
      <div data-app-ready="loading" className="min-h-screen bg-[#050a14] flex flex-col items-center justify-center space-y-4">
        <div className="w-12 h-12 rounded-2xl bg-gradient-to-tr from-sky-500 to-blue-600 p-[1.5px] animate-pulse">
          <div className="w-full h-full bg-slate-950 rounded-[14px] flex items-center justify-center">
            <img src="./icon.svg" alt="Loading" className="w-8 h-8 object-contain animate-spin" />
          </div>
        </div>
        <p className="text-xs font-mono text-sky-400">CONNECTING SPINNERMINE CLUSTER...</p>
      </div>
    );
  }

  return (
    <div data-app-ready="true" className="min-h-screen bg-[#050a14] text-slate-100 flex flex-col selection:bg-sky-500/30 selection:text-sky-200">
      
      {/* Top Navigation */}
      <Navbar
        currentPage={currentPage}
        setCurrentPage={navigateToPage}
        onOpenTests={() => setIsTestModalOpen(true)}
        onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}
        isSidebarOpen={isSidebarOpen}
      />

      {/* Main Body */}
      <div className="flex-1 flex">
        {/* Sidebar for authenticated dashboard pages */}
        {isDashboardLayout && (
          <Sidebar
            currentPage={currentPage}
            setCurrentPage={navigateToPage}
            isOpen={isSidebarOpen}
            onClose={() => setIsSidebarOpen(false)}
          />
        )}

        {/* Page Content Container */}
        <main className={`flex-1 w-full transition-all ${isDashboardLayout ? 'lg:ms-64' : ''}`}>
          {currentPage === 'landing' && (
            <LandingPage
              setCurrentPage={navigateToPage}
              onOpenConsentModal={() => setIsConsentModalOpen(true)}
            />
          )}

          {currentPage === 'login' && (
            <LoginPage setCurrentPage={navigateToPage} />
          )}

          {currentPage === 'register' && (
            <RegisterPage setCurrentPage={navigateToPage} />
          )}

          {currentPage === 'forgot-password' && (
            <ForgotPasswordPage setCurrentPage={navigateToPage} />
          )}

          {currentPage === 'dashboard' && (
            <UserDashboardPage
              setCurrentPage={navigateToPage}
              onOpenConsentModal={() => setIsConsentModalOpen(true)}
            />
          )}

          {currentPage === 'mining' && (
            <MiningDashboardPage
              onOpenConsentModal={() => setIsConsentModalOpen(true)}
              onNavigateLogin={() => navigateToPage('login')}
            />
          )}

          {currentPage === 'spinner' && (
            <SpinnerGamePage />
          )}

          {currentPage === 'wheel' && (
            <WheelOfFortunePage />
          )}

          {currentPage === 'wallet' && (
            <WalletPage
              onNavigateWithdrawals={() => navigateToPage('withdrawals')}
            />
          )}

          {currentPage === 'withdrawals' && (
            <WithdrawalsPage />
          )}

          {currentPage === 'referrals' && (
            <ReferralsPage />
          )}

          {currentPage === 'settings' && (
            <AccountSettingsPage
              onOpenConsentModal={() => setIsConsentModalOpen(true)}
            />
          )}

          {currentPage === 'admin' && (
            isAdmin ? (
              <AdminDashboardPage />
            ) : (
              <div className="min-h-[70vh] flex items-center justify-center px-4">
                <div className="max-w-md w-full p-8 rounded-3xl bg-slate-900 border border-slate-800 text-center space-y-4">
                  <div className="w-12 h-12 mx-auto rounded-2xl bg-rose-500/10 border border-rose-500/30 text-rose-400 flex items-center justify-center">
                    <ShieldAlert className="w-6 h-6" />
                  </div>
                  <h3 className="text-lg font-bold text-white">403 — Unauthorized Route</h3>
                  <p className="text-xs text-slate-400">
                    Administrator authorization token (Custom Claim) required. Access denied.
                  </p>
                  <button
                    onClick={() => navigateToPage('dashboard')}
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-semibold text-white transition cursor-pointer"
                  >
                    <ArrowLeft className="w-4 h-4 rtl:rotate-180" />
                    <span>Return to User Dashboard</span>
                  </button>
                </div>
              </div>
            )
          )}
        </main>
      </div>

      {/* Footer */}
      <Footer />

      {/* Offline Banner */}
      <OfflineIndicator />

      {/* Mining Consent Policy Modal */}
      <MiningConsentModal
        isOpen={isConsentModalOpen}
        onClose={() => setIsConsentModalOpen(false)}
      />

      {/* Phase 1 Verification Test Runner */}
      <TestRunnerModal
        isOpen={isTestModalOpen}
        onClose={() => setIsTestModalOpen(false)}
      />

    </div>
  );
};

export default function App() {
  return (
    <LanguageProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </LanguageProvider>
  );
}
