# SpinnerMine Cloud — Phase 1 Architecture & Security Guide

SpinnerMine Cloud is a cryptocurrency cloud mining and interactive gaming web application built with **React 19**, **TypeScript**, **Tailwind CSS**, **Node.js/Express**, and **Firebase (Authentication & Cloud Firestore)**.

---

## 1. Phase 1 Security Architecture & Safeguards

### A. Role-Based Access Control (RBAC) & Custom Claims
- **Elimination of Static Email Bypasses**: No hardcoded email checks exist in client or server code.
- **Cryptographic Custom Claims**: Admin privileges strictly require verified Firebase ID Token claims (`token.admin === true` or `token.role === 'admin'`).
- **Client Role Escalation Blocked**: User creation is restricted by `hasOnly()` rules; default role must be `'user'`. Writes to `admins/{uid}` are permanently forbidden (`allow write: if false;`).
- **Route & UI Shielding**: Direct URL/hash navigation to `#admin` or `/admin` enforces role guards, redirecting unauthorized users to the dashboard or displaying a 403 Forbidden screen.
- **Listener Leak Prevention**: Real-time snapshot listeners are scoped with explicit cleanup references (`profileUnsubRef`) to prevent cross-account data leaks upon sign-out.

### B. Financial Integrity & Atomic Ledger
- **Zero Client Mutations**: Client applications (including browser admin sessions) cannot write directly to `miningRevenue`, `userEarnings`, `walletLedger`, `withdrawals`, or `auditLogs`. All client writes are denied (`allow write: if false;`).
- **Atomic Precision (Piconero)**: All balance and transaction math is modeled in atomic integer units:
  $$\text{1 XMR} = 10^{12} \text{ piconero}$$
  Eliminates IEEE-754 floating-point drift and rounding exploits.
- **Idempotency Keys**: All financial operations require unique `idempotencyKey` values preventing duplicate transaction replays.
- **Phase 1 Withdrawal Lock**: Real cryptocurrency withdrawals are locked in Phase 1 with Monero standard address validation and a clear security audit notice. No mock transactions or fake block hashes are generated.

### C. Server-Authoritative Game API & Cryptographic Signatures
- **Server Verification (`/api/games/verify` & `/api/games/spin-wheel`)**:
  - Outgoing game requests pass the Firebase ID Token in the `Authorization: Bearer <token>` header.
  - Server extracts the trusted `uid` strictly from the decoded token (never trusts client body `userId`).
  - Rate limiting enforces a 2-second cooldown and max 15 requests/minute per player.
  - Replay protection rejects duplicate nonces with HTTP 409 Conflict.
  - Clock skew protection rejects client timestamps deviating by more than 5 minutes.
  - Outcomes are cryptographically signed with server HMAC-SHA256 signatures.
  - Zero fallback points: Failed server connection prevents points distribution.
  - Zero cryptocurrency vouchers are distributed from client games.

---

## 2. Administrator Setup via CLI (`scripts/set-admin.ts`)

To grant administrative privileges, run the secure CLI script from a trusted server environment with Google Cloud Application Default Credentials (ADC) or service account credentials:

```bash
# Grant admin claim using target user email or UID
npm run set-admin -- user@spinnermine.cloud

# Or set via environment variables:
TARGET_ADMIN_UID="USER_FIREBASE_UID" npm run set-admin
```

The script:
1. Validates operator environment without hardcoding secrets in the codebase.
2. Calls `adminAuth.setCustomUserClaims(uid, { admin: true, role: 'admin' })`.
3. Records the event in the `admins` collection and appends to `auditLogs`.
4. Instructs the user to re-authenticate or click "Refresh Session" to receive their elevated token.

---

## 3. Tech Stack

- **Frontend**: React 19, TypeScript, Lucide Icons, Canvas API, Web Audio API, Tailwind CSS
- **Backend**: Node.js, Express (`server.ts`), Vite middleware integration
- **Storage & Auth**: Firebase Auth (Email/Password, Google OAuth), Cloud Firestore (Enterprise)
- **Internationalization**: English (LTR) & Arabic (RTL) with dynamic font switching (Cairo / Inter)
- **PWA**: Offline service worker cache, Web App Manifest, mobile navigation

---

## 4. Running the Application & Test Suite

### Development Server
```bash
npm run dev
```
Starts the full-stack Express server on `http://localhost:3000`, mounting Vite dev middleware and `/api/*` proxy routes.

### Running Unit Tests (Vitest)
```bash
npm test
```
Executes all 27 unit tests across 5 suites:
1. `tests/auth-rbac.test.ts`: Authentication lifecycle, token parsing, RBAC guards, listener cleanup, and 401 unauth rejection.
2. `tests/firestore-rules.test.ts`: `hasOnly()` field boundaries, update protection, financial lockdown, and game session schema validation.
3. `tests/game-verification.test.ts`: HMAC-SHA256 signatures, token UID extraction, replay protection, clock skew, rate limiting, and zero crypto guarantee.
4. `tests/financial-integrity.test.ts`: Atomic piconero math, idempotency keys, and 20% miner / 80% platform split invariant.
5. `tests/i18n-pwa.test.ts`: Mining consent gating (v1.0), bilingual parity, RTL/LTR mapping, and PWA manifest standards.

### Compiling for Production
```bash
npm run build
```
Generates a verified, type-checked production bundle in `dist/`.

---

## 5. Security Rules Architecture (`firestore.rules`)

The deployed Firestore security rules enforce Least Privilege access control:

| Collection | Read Rule | Write Rule | Protection Mechanism |
| :--- | :--- | :--- | :--- |
| `users/{userId}` | Authenticated Owner or Admin | Owner (`hasOnly()`) | Role locked to `'user'`, financial fields blocked |
| `miningSessions` | Authenticated Owner or Admin | Authenticated Owner | Blocked from client financial properties (`revenue`, `payout`) |
| `miningWorkers` | Authenticated Owner or Admin | Authenticated Owner | Heartbeat & threads configuration only |
| `acceptedShares` | Authenticated Owner or Admin | **DENIED (`false`)** | Attributable shares confirmed strictly by backend pool daemon |
| `miningRevenue` | Authenticated Users (aggregate) | **DENIED (`false`)** | Server daemon mutations only |
| `userEarnings` | Authenticated Owner or Admin | **DENIED (`false`)** | Server daemon mutations only |
| `walletLedger` | Authenticated Owner or Admin | **DENIED (`false`)** | Server daemon mutations only |
| `withdrawals` | Authenticated Owner or Admin | **DENIED (`false`)** | Phase 1 lock; backend worker processing |
| `spinnerSessions` | Authenticated Owner | Authenticated Owner | Casual recreational points only; crypto fields blocked |
| `wheelSpins` | Authenticated Owner | Authenticated Owner | Casual recreational records only; crypto vouchers blocked |
| `rewards` | Authenticated Users | **DENIED (`false`)** | Admin catalog managed server-side |
| `referrals` | Authenticated Owner | Authenticated Owner | Referral invite association |
| `systemSettings` | Public / Authenticated | **DENIED (`false`)** | Managed via server |
| `admins/{adminId}` | Authenticated Read | **DENIED (`false`)** | Controlled via Firebase Admin SDK CLI |
| `auditLogs` | Admin Token Only | **DENIED (`false`)** | Append-only server logging |

---

## 6. Phase 2C Architecture — Safe Mining Engine Controller

Phase 2C delivers an authoritative, high-integrity mining engine control system utilizing an isolated Mock Mining Engine without launching real mining processes:

### State Machine Specification
```
                ┌─────────────── START ───────────────┐
                ▼                                     │
          [ STARTING ] ──> [ RUNNING ] ── PAUSE ──> [ PAUSED ]
                │                 │                   │
                │                 ├─── STOP ───┐     RESUME
                ▼                 ▼            ▼      │
            [ ERROR ] <── (Thermal/Fail)  [ STOPPING ]│
                │                              │      │
           RESET_ERROR                         ▼      │
                │                         [ STOPPED ] ◄
                └──────────────────────────────┘
```

- **Supported States**: `STOPPED`, `STARTING`, `RUNNING`, `PAUSED`, `STOPPING`, `ERROR`.
- **Command Set**: `START`, `STOP`, `PAUSE`, `RESUME`, `RESET_ERROR`.
- **Concurrency Mutex Lock**: Blocks rapid duplicate clicks while commands are transitioning.
- **Worker Ownership Gate**: Validates caller `userId` matches authenticated owner UID.
- **Windows Process Lifecycle**: Clean exit (`handleAppExit`), crash recovery without auto-start, safe pause on network offline (`handleNetworkOffline`), and immediate termination upon Firebase logout (`handleUserLogout`).
- **Financial & Process Isolation**:
  - `acceptedShares: 0` permanently enforced on Mock Engine.
  - Telemetry strictly tagged with `isSimulation: true` and `[SIMULATION ONLY]`.
  - Zero `child_process` spawn calls for `xmrig.exe`.
  - Zero Stratum network pool socket traffic.
  - Zero mutations to user balances or financial ledgers.
- **Independent Live Monitoring**:
  - Device Connection: Online / Offline (evaluated via 3-minute heartbeat threshold).
  - Engine Status: Running / Stopped / Paused / Error.
  - Engine Type: Mock.
  - CPU Threads: User selected / detected logical cores.
  - Last Heartbeat: Formatted relative time.
  - Engine Uptime: Real-time duration timer.
  - Command Audit Log: In-memory ring-buffer with timestamp, command, transition, duration, and status.

### Test Verification
Full test suite passing 100%:
- 18 Test Suites (211 Tests Passed).
- Dedicated Acceptance Suite: `tests/mining-engine-controller-phase2c.test.ts` (20 Tests Passed).
- Windows Lifecycle Gate: `npm run test:windows-lifecycle` (Passed).
- Electron Build & Validation: `npm run build:electron-all` (Passed).

