/**
 * SpinnerMine Cloud - Browser Compatibility Stubs for Node.js Built-in Modules
 *
 * Used exclusively when bundling client-side browser code via Vite to prevent
 * runtime errors such as: "Cannot access child_process.spawn in client code".
 *
 * In Electron Main (desktop/main.ts) and Node.js testing (Vitest), real native
 * Node.js modules are used directly.
 */

// --- child_process stubs ---
export const spawn = (_cmd?: any, _args?: any, _opts?: any) => {
  return {
    pid: null,
    killed: false,
    stdin: { write: () => {}, end: () => {} },
    stdout: { on: () => {}, destroy: () => {} },
    stderr: { on: () => {}, destroy: () => {} },
    on: () => {},
    once: (_event: string, cb: (...args: any[]) => void) => {
      if (_event === 'error') {
        setTimeout(() => cb(new Error('child_process.spawn is not available in browser')), 10);
      }
    },
    kill: () => true
  };
};

export const exec = (_cmd: string, _optsOrCb?: any, cb?: any) => {
  const callback = typeof _optsOrCb === 'function' ? _optsOrCb : cb;
  if (callback) {
    setTimeout(() => callback(new Error('child_process.exec is not available in browser')), 10);
  }
};

// --- fs stubs ---
export const existsSync = (_path: string) => false;
export const statSync = (_path: string) => ({
  isFile: () => false,
  isDirectory: () => false,
  size: 0
});
export const mkdirSync = (_path: string, _opts?: any) => {};
export const writeFileSync = (_path: string, _data: any, _opts?: any) => {};
export const unlinkSync = (_path: string) => {};
export const readFileSync = (_path: string, _encoding?: any) => '';
export const createReadStream = (_path: string) => ({
  on: (_event: string, cb: (...args: any[]) => void) => {
    if (_event === 'error') cb(new Error('File reading is not supported in browser'));
  }
});

// --- os stubs ---
export const cpus = () => {
  const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency || 4 : 4;
  const list = [];
  for (let i = 0; i < cores; i++) {
    list.push({
      model: 'Browser Virtual Core',
      speed: 2500,
      times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 }
    });
  }
  return list;
};
export const hostname = () => (typeof window !== 'undefined' ? window.location.hostname || 'browser' : 'browser');
export const totalmem = () => 8 * 1024 * 1024 * 1024;
export const freemem = () => 4 * 1024 * 1024 * 1024;
export const release = () => 'browser';
export const platform = () => 'browser';
export const arch = () => 'x64';

// --- net stubs ---
export const createConnection = (_optsOrPort: any, _hostOrCb?: any, cb?: any) => {
  const callback = typeof _hostOrCb === 'function' ? _hostOrCb : cb;
  const socket = {
    destroyed: false,
    write: () => {},
    on: () => socket,
    once: (event: string, handler: (...args: any[]) => void) => {
      if (event === 'error') {
        setTimeout(() => handler(new Error('Direct TCP socket connections require the Windows Desktop application')), 10);
      }
      return socket;
    },
    destroy: () => {}
  };
  if (callback) setTimeout(callback, 50);
  return socket;
};

// --- tls stubs ---
export const connect = (_opts: any, cb?: any) => {
  return createConnection(_opts, cb);
};

// --- dns stubs ---
export const resolve4 = (host: string, cb: (err: Error | null, addresses: string[]) => void) => {
  if (host === '127.0.0.1' || host === 'localhost') {
    cb(null, ['127.0.0.1']);
  } else {
    cb(new Error('DNS resolution is only available in the Windows Desktop application'), []);
  }
};

// --- crypto stubs ---
export const createHash = (_algo: string) => {
  return {
    update: () => {},
    digest: () => '0000000000000000000000000000000000000000000000000000000000000000'
  };
};

export const randomBytes = (size: number) => {
  const bytes = new Uint8Array(size);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  }
  return {
    toString: (encoding?: string) => {
      if (encoding === 'hex') {
        return Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
      }
      return String.fromCharCode(...bytes);
    }
  };
};

// Default export covering all modules when imported via default import
const defaultExport = {
  spawn,
  exec,
  existsSync,
  statSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  readFileSync,
  createReadStream,
  cpus,
  hostname,
  totalmem,
  freemem,
  release,
  platform,
  arch,
  createConnection,
  connect,
  resolve4,
  createHash,
  randomBytes
};

export default defaultExport;
