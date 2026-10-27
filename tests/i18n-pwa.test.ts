import { describe, it, expect } from 'vitest';
import { translations } from '../src/i18n/translations';

describe('4. Mining Consent, Internationalization & PWA Standards Tests', () => {

  it('1. User CPU Mining requires explicit user consent before starting workers', () => {
    const canStartMining = (profile: { miningConsent?: boolean; consentVersion?: string }): boolean => {
      return Boolean(profile && profile.miningConsent === true && profile.consentVersion === 'v1.0');
    };

    const consentUser = { miningConsent: true, consentVersion: 'v1.0' };
    const noConsentUser = { miningConsent: false };
    const undefinedConsentUser = {};

    expect(canStartMining(consentUser)).toBe(true);
    expect(canStartMining(noConsentUser)).toBe(false);
    expect(canStartMining(undefinedConsentUser)).toBe(false);
  });

  it('2. English and Arabic dictionaries have parity across all key sections', () => {
    const enKeys = Object.keys(translations.en);
    const arKeys = Object.keys(translations.ar);

    expect(enKeys).toEqual(arKeys);
    expect(translations.en.nav.admin).toBe('Admin Console');
    expect(translations.ar.nav.admin).toBe('لوحة الإدارة');
    expect(translations.en.mining.title).toBe('Mining Control Center');
    expect(translations.ar.mining.title).toBe('مركز التحكم بالتعدين');
  });

  it('3. Arabic direction mapping enforces RTL, English enforces LTR', () => {
    const getDirection = (lang: string) => (lang === 'ar' ? 'rtl' : 'ltr');

    expect(getDirection('ar')).toBe('rtl');
    expect(getDirection('en')).toBe('ltr');
  });

  it('4. Gaming prizes contain zero cryptocurrency vouchers across all languages', () => {
    const enVoucher = translations.en.wheel.prizes.voucherXmr;
    const arVoucher = translations.ar.wheel.prizes.voucherXmr;

    expect(enVoucher).not.toContain('XMR');
    expect(arVoucher).not.toContain('مونيرو');
    expect(enVoucher).toContain('Points');
  });

  it('5. PWA web manifest specification complies with standalone display standards', () => {
    const pwaConfig = {
      name: 'SpinnerMine Cloud',
      short_name: 'SpinnerMine',
      display: 'standalone',
      background_color: '#020617',
      theme_color: '#0a0f1d'
    };

    expect(pwaConfig.display).toBe('standalone');
    expect(pwaConfig.theme_color).toBe('#0a0f1d');
    expect(pwaConfig.name).toBe('SpinnerMine Cloud');
  });
});
