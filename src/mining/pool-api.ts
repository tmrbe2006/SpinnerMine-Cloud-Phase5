/**
 * SpinnerMine Cloud - Authoritative Pool API Verifier (Phase 2D.3)
 *
 * Independently queries documented pool REST APIs to distinguish
 * MINER_REPORTED metrics from POOL_CONFIRMED shares.
 *
 * Security:
 * - Read-only public miner stats endpoints.
 * - Never logs private keys or authorization headers.
 * - Strict timeout (3500ms) with AbortController.
 * - Returns explicit MINER_REPORTED when pool API is unavailable or unconfirmed.
 * - Zero fabricated responses.
 */

export interface PoolStatsResult {
  queried: boolean;
  confirmed: boolean;
  status: 'POOL_CONFIRMED' | 'MINER_REPORTED' | 'NOT_AVAILABLE' | 'WALLET_NOT_FOUND' | 'ERROR';
  poolName?: string;
  poolEndpoint?: string;
  totalHashes?: number;
  validShares?: number;
  invalidShares?: number;
  poolHashrate?: number;
  lastSeen?: string;
  notice: string;
  error?: string;
  latencyMs?: number;
}

export class PoolApiVerifier {
  /**
   * Identifies candidate REST API URL based on pool host
   */
  public static getApiEndpointForHost(poolHost: string, walletAddress: string): string | null {
    if (!walletAddress || !poolHost) return null;
    const cleanHost = poolHost.toLowerCase().replace(/:\d+$/, '').trim();

    if (cleanHost.includes('supportxmr.com')) {
      return `https://supportxmr.com/api/miner/${walletAddress.trim()}/stats`;
    }
    if (cleanHost.includes('moneroocean.stream')) {
      return `https://api.moneroocean.stream/miner/${walletAddress.trim()}/stats`;
    }
    if (cleanHost.includes('nanopool.org')) {
      return `https://api.nanopool.org/v1/xmr/user/${walletAddress.trim()}`;
    }
    if (cleanHost.includes('hashvault.pro')) {
      return `https://monero.hashvault.pro/api/cryptonote/stats/${walletAddress.trim()}`;
    }
    if (cleanHost.includes('hero-miners.com') || cleanHost.includes('herominers.com')) {
      return `https://monero.herominers.com/api/stats_address?address=${walletAddress.trim()}`;
    }

    // Default nodejs-pool style API check
    if (!cleanHost.includes('localhost') && !cleanHost.includes('127.0.0.1')) {
      return `https://${cleanHost}/api/miner/${walletAddress.trim()}/stats`;
    }

    return null;
  }

  /**
   * Queries pool API to check if pool has registered confirmed shares for the given wallet.
   */
  public static async queryMinerStats(params: {
    poolHost: string;
    walletAddress: string;
    workerName?: string;
    timeoutMs?: number;
  }): Promise<PoolStatsResult> {
    const start = Date.now();
    const endpoint = PoolApiVerifier.getApiEndpointForHost(params.poolHost, params.walletAddress);

    if (!endpoint) {
      return {
        queried: false,
        confirmed: false,
        status: 'MINER_REPORTED',
        poolEndpoint: params.poolHost,
        notice: 'Pool does not provide a known public REST API for automated independent verification. Metrics remain labeled as MINER_REPORTED.'
      };
    }

    try {
      const response = await fetch(endpoint, {
        method: 'GET',
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'SpinnerMine-Cloud-Verifier/2.0'
        },
        signal: AbortSignal.timeout(params.timeoutMs || 3500)
      });

      const latencyMs = Date.now() - start;

      if (response.status === 404) {
        return {
          queried: true,
          confirmed: false,
          status: 'WALLET_NOT_FOUND',
          poolEndpoint: endpoint,
          latencyMs,
          notice: 'Wallet not found on pool API (no shares submitted or pool stats have not updated yet). Results remain MINER_REPORTED.'
        };
      }

      if (!response.ok) {
        return {
          queried: true,
          confirmed: false,
          status: 'ERROR',
          poolEndpoint: endpoint,
          latencyMs,
          error: `Pool API returned HTTP ${response.status}`,
          notice: `Pool API returned error ${response.status}. Results remain labeled as MINER_REPORTED.`
        };
      }

      const data = await response.json();

      // SupportXMR / nodejs-pool response structure
      const totalHashes = Number(data.totalHashes || data.hashes || data.total_hashes || 0);
      const validShares = Number(data.validShares || data.shares || data.shares_good || 0);
      const invalidShares = Number(data.invalidShares || data.invalid || 0);
      const poolHashrate = Number(data.hashrate || data.hashrate_raw || 0);
      const lastSeen = data.lastHash ? new Date(Number(data.lastHash) * 1000).toISOString() : (data.last_seen || undefined);

      const hasPoolConfirmedShares = validShares > 0 || totalHashes > 0;

      if (hasPoolConfirmedShares) {
        return {
          queried: true,
          confirmed: true,
          status: 'POOL_CONFIRMED',
          poolName: params.poolHost,
          poolEndpoint: endpoint,
          totalHashes,
          validShares,
          invalidShares,
          poolHashrate,
          lastSeen,
          latencyMs,
          notice: `Pool API independently CONFIRMED ${validShares} valid shares (${totalHashes.toLocaleString()} total hashes) on ${params.poolHost}.`
        };
      } else {
        return {
          queried: true,
          confirmed: false,
          status: 'MINER_REPORTED',
          poolName: params.poolHost,
          poolEndpoint: endpoint,
          totalHashes: 0,
          validShares: 0,
          latencyMs,
          notice: 'Pool API responded successfully, but reports 0 confirmed shares for this wallet so far. Labeled as MINER_REPORTED.'
        };
      }
    } catch (err: any) {
      return {
        queried: true,
        confirmed: false,
        status: 'MINER_REPORTED',
        poolEndpoint: endpoint,
        latencyMs: Date.now() - start,
        error: err.name === 'TimeoutError' ? 'Pool API request timed out' : err.message,
        notice: 'Could not reach pool API for independent verification. Local miner results labeled strictly as MINER_REPORTED.'
      };
    }
  }
}
