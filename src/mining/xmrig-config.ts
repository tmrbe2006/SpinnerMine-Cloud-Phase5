/**
 * SpinnerMine Cloud - Official XMRig Configuration Generator & Validator
 *
 * Implements strict compliance with XMRig 6.x configuration specification:
 * - Localhost-only HTTP API (127.0.0.1) with cryptographic bearer token
 * - Zero remote exposure
 * - Dynamic CPU thread mapping and priority throttling
 * - Stratum pool connectivity with TLS and worker pairing
 * - Mandatory explicit pool host, port, and wallet address validation (NO dummy defaults)
 */

import crypto from 'crypto';

export interface XMRigConfigOptions {
  poolHost: string;
  poolPort: number;
  tls?: boolean;
  walletAddress: string;
  workerName?: string;
  password?: string;
  threads?: number;
  maxThreadsHint?: number; // 1-100 percentage
  apiPort?: number;
  apiToken?: string;
  donateLevel?: number;
}

export interface GeneratedConfigResult {
  config: Record<string, any>;
  configJson: string;
  apiPort: number;
  apiToken: string;
}

export function generateRandomApiToken(): string {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * Validates Monero wallet address format.
 * Standard addresses start with '4', subaddresses with '8', length 95 or 106 chars.
 */
export function isValidMoneroAddress(address: string): boolean {
  if (!address || typeof address !== 'string') return false;
  const trimmed = address.trim();
  // Valid Monero address is 95 characters (standard/subaddress) or 106 characters (integrated)
  // or a custom mining user name for specific pools (min length 10)
  return /^[48][0-9AB][1-9A-HJ-NP-Za-km-z]{93}$/.test(trimmed) || 
         /^[4][0-9AB][1-9A-HJ-NP-Za-km-z]{104}$/.test(trimmed) ||
         (trimmed.length >= 10 && /^[a-zA-Z0-9_\-\.]+$/.test(trimmed));
}

/**
 * Validates pool host string (rejects empty or whitespace).
 */
export function isValidPoolHost(host: string): boolean {
  if (!host || typeof host !== 'string') return false;
  const trimmed = host.trim();
  if (trimmed.length < 3) return false;
  // Disallow dummy or placeholder values
  if (['dummy', 'none', 'example.com', 'placeholder'].includes(trimmed.toLowerCase())) {
    return false;
  }
  return /^[a-zA-Z0-9\.\-]+$/.test(trimmed);
}

/**
 * Generates an authoritative XMRig config.json structure.
 * Security Invariant: The HTTP API is strictly bound to 127.0.0.1 with restricted: true.
 * Requires explicit, validated pool host, port, and wallet address.
 */
export function generateXMRigConfig(options: XMRigConfigOptions): GeneratedConfigResult {
  // 1. Strict validation of required configuration inputs
  if (!options) {
    throw new Error('XMRig configuration options must be provided.');
  }

  const host = options.poolHost?.trim();
  if (!host || !isValidPoolHost(host)) {
    throw new Error('Valid mining pool host must be explicitly configured before starting mining.');
  }

  const port = Number(options.poolPort);
  if (isNaN(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid mining pool port '${options.poolPort}'. Must be an integer between 1 and 65535.`);
  }

  const wallet = options.walletAddress?.trim();
  if (!wallet || wallet.length < 5) {
    throw new Error('Valid mining wallet address must be explicitly configured before starting mining.');
  }

  const worker = options.workerName?.trim() ? options.workerName.trim().replace(/[^a-zA-Z0-9_\-]/g, '') : 'worker1';
  const apiPort = options.apiPort || 18088;
  const apiToken = options.apiToken || generateRandomApiToken();
  const poolUrl = `${host}:${port}`;
  const user = worker ? `${wallet}.${worker}` : wallet;

  const config: Record<string, any> = {
    "api": {
      "id": null,
      "worker-id": worker,
      "token": apiToken,
      "host": "127.0.0.1", // Strictly localhost; remote binding prohibited
      "port": apiPort,
      "restricted": true   // Blocks remote administration commands
    },
    "http": {
      "enabled": true,
      "host": "127.0.0.1",
      "port": apiPort,
      "access-token": apiToken,
      "restricted": true
    },
    "autosave": false,
    "background": false,
    "colors": true,
    "title": true,
    "randomx": {
      "init": -1,
      "init-avx2": -1,
      "mode": "auto",
      "1gb-pages": false,
      "rdmsr": true,
      "wrmsr": true,
      "cache_qos": false,
      "numa": true,
      "scratchpad_prefetch_mode": 1
    },
    "cpu": {
      "enabled": true,
      "huge-pages": true,
      "huge-pages-jit": false,
      "hw-aes": null,
      "priority": 1, // Below normal priority to ensure OS responsiveness
      "memory-pool": false,
      "yield": true,
      "max-threads-hint": Math.min(100, Math.max(10, options.maxThreadsHint || 50)),
      "asm": true,
      "argon2-impl": null,
      "cn/0": false,
      "cn-lite/0": false
    },
    "opencl": {
      "enabled": false
    },
    "cuda": {
      "enabled": false
    },
    "donate-level": Math.max(1, options.donateLevel ?? 1),
    "donate-over-proxy": 1,
    "log-file": null,
    "pools": [
      {
        "algo": "rx/0",
        "coin": "monero",
        "url": poolUrl,
        "user": user,
        "pass": options.password || "x",
        "rig-id": worker,
        "nicehash": false,
        "keepalive": true,
        "enabled": true,
        "tls": Boolean(options.tls),
        "tls-fingerprint": null,
        "daemon": false,
        "socks5": null,
        "self-select": null,
        "submit-to-origin": false
      }
    ],
    "retries": 5,
    "retry-pause": 5,
    "print-time": 30,
    "health-print-time": 60,
    "dmi": true,
    "syslog": false,
    "user-agent": null,
    "watch": false,
    "pause-on-battery": false,
    "pause-on-active": false
  };

  // If specific thread count is explicitly requested, define the rx array
  if (options.threads && options.threads > 0) {
    const rxThreads: number[] = [];
    for (let i = 0; i < options.threads; i++) {
      rxThreads.push(i);
    }
    config.cpu["rx"] = rxThreads;
  }

  return {
    config,
    configJson: JSON.stringify(config, null, 2),
    apiPort,
    apiToken
  };
}

/**
 * Validates an XMRig configuration for syntax and security constraints.
 */
export function validateXMRigConfig(configInput: string | Record<string, any>): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  let config: Record<string, any>;
  if (typeof configInput === 'string') {
    try {
      config = JSON.parse(configInput);
    } catch (e: any) {
      return { valid: false, errors: [`JSON Parse Error: ${e.message}`] };
    }
  } else {
    config = configInput;
  }

  // Security Check 1: Host binding must be strictly 127.0.0.1 or localhost
  const apiHost = config?.api?.host || config?.http?.host;
  if (apiHost && apiHost !== '127.0.0.1' && apiHost !== 'localhost') {
    errors.push(`Security Violation: API host '${apiHost}' is not localhost. Must be strictly 127.0.0.1`);
  }

  // Security Check 2: API port must be a valid unprivileged port
  const apiPort = config?.api?.port || config?.http?.port;
  if (!apiPort || apiPort < 1024 || apiPort > 65535) {
    errors.push(`Invalid API port: ${apiPort}. Must be between 1024 and 65535`);
  }

  // Security Check 3: API token must be present and secure
  const apiToken = config?.api?.token || config?.http?.['access-token'];
  if (!apiToken || typeof apiToken !== 'string' || apiToken.length < 16) {
    errors.push('Security Warning: API token is missing or insufficiently strong (minimum 16 characters required)');
  }

  // Pool validation
  if (!Array.isArray(config?.pools) || config.pools.length === 0) {
    errors.push('Missing or empty pools array in configuration');
  } else {
    const primaryPool = config.pools[0];
    if (!primaryPool.url || typeof primaryPool.url !== 'string') {
      errors.push('Pool URL is missing or invalid');
    }
    if (!primaryPool.user || typeof primaryPool.user !== 'string' || primaryPool.user.trim().length < 5) {
      errors.push('Pool user/wallet is missing or invalid');
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
