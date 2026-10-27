export interface Env {
  FIREBASE_PROJECT_ID?: string;
  FIRESTORE_DATABASE_ID?: string;
  ENVIRONMENT?: string;
  ALLOW_LOCALHOST_ORIGIN?: string;
  GAME_SERVER_SECRET?: string;
  FIREBASE_SERVICE_ACCOUNT_EMAIL?: string;
  FIREBASE_SERVICE_ACCOUNT_PRIVATE_KEY?: string;
  MINING_POOL_HOST?: string;
  MINING_POOL_PORT?: string;
  MINING_POOL_TLS?: string;
  MINING_WALLET_ADDRESS?: string;
  BACKEND_VERSION?: string;
}

export interface DecodedUser {
  uid: string;
  email?: string;
  admin?: boolean;
  role?: string;
  name?: string;
}

export interface WheelSegment {
  id: number;
  type: string;
  value: number;
  label: string;
  color: string;
}

export const WHEEL_SEGMENTS: WheelSegment[] = [
  { id: 0, type: 'points', value: 100, label: '+100 Arcade Points', color: '#1e3a8a' },
  { id: 1, type: 'points', value: 250, label: '+250 Arcade Points', color: '#047857' },
  { id: 2, type: 'try_again', value: 0, label: 'Spin Again', color: '#334155' },
  { id: 3, type: 'points', value: 50, label: '+50 Arcade Points', color: '#b45309' },
  { id: 4, type: 'points', value: 500, label: '+500 Arcade Points', color: '#6d28d9' },
  { id: 5, type: 'points', value: 150, label: '+150 Arcade Points', color: '#0369a1' },
  { id: 6, type: 'try_again', value: 0, label: 'No Luck', color: '#475569' },
  { id: 7, type: 'points', value: 300, label: '+300 Arcade Points', color: '#be185d' },
];
