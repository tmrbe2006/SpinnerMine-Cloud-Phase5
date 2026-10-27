/**
 * SpinnerMine Cloud - CLI Verification Script for Real Mining Proof (Phase 2D.3)
 *
 * Can be run via:
 *   npx tsx scripts/verify-real-mining.ts
 */

import { RealMiningVerifier } from '../src/mining/real-mining-verifier';

async function main() {
  console.log('='.repeat(80));
  console.log('SPINNERMINE CLOUD — PHASE 2D.3 REAL XMRIG MINING VERIFICATION SUITE');
  console.log('='.repeat(80));

  const verifier = new RealMiningVerifier();

  const proof = await verifier.verifyRealMining({
    poolHost: process.env.MINING_POOL_HOST || 'pool.supportxmr.com',
    poolPort: Number(process.env.MINING_POOL_PORT || 3333),
    tls: process.env.MINING_POOL_TLS === 'true',
    walletAddress: process.env.MINING_WALLET_ADDRESS || '44AFFq5kSiGBoZ4NMDwYtN18obc8AemS33DBLWs3H7otXMV33WD9279tQiTcTDALCQSmRJq3PJ1nKAqZsK64cX97DpWstPm',
    workerName: 'tm-main',
    workerId: 'w_qBPFqVEe_tm',
    queryPoolApi: true
  });

  if (proof.diagnosticReport) {
    console.log('\n' + proof.diagnosticReport);
  } else {
    console.log(`\nVerification ID:          ${proof.verificationId}`);
    console.log(`Status:                   [${proof.status}]`);
    console.log(`Share Verification Type:  [${proof.shareVerificationType}]`);
  }

  console.log('\n' + '='.repeat(80));
  console.log(`AUDIT FINISHED — STATUS: [${proof.status}], FINANCIAL IMPACT: 0 XMR`);
  console.log('='.repeat(80));
}

main().catch(err => {
  console.error('Fatal verification error:', err);
  process.exit(1);
});
