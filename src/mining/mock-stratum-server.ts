/**
 * SpinnerMine Cloud - Local Stratum Protocol Mock Server (Phase 2D Enhanced)
 *
 * For development, QA, and automated Vitest/CI testing:
 * Simulates a standard Stratum mining pool endpoint on 127.0.0.1.
 * Supports:
 * - DNS resolution & TCP handshake
 * - Stratum Login negotiation & authentication
 * - Job issuance (RandomX blob, seed_hash, target, height)
 * - Share submission with explicit accepted / rejected responses
 * - Connection timeouts & simulated disconnection/reconnection
 */

import net from 'net';

export interface MockStratumServerOptions {
  port?: number;
  rejectLogin?: boolean;
  rejectShares?: boolean;
  onClientConnect?: (address: string) => void;
  onLogin?: (params: any) => void;
  onSubmit?: (params: any) => void;
}

export class MockStratumServer {
  private server: net.Server | null = null;
  private port: number;
  private isRunning = false;
  private options: MockStratumServerOptions;
  private activeSockets: Set<net.Socket> = new Set();

  public connectionsCount = 0;
  public loginsCount = 0;
  public submittedSharesCount = 0;
  public acceptedSharesCount = 0;
  public rejectedSharesCount = 0;

  constructor(options: MockStratumServerOptions = {}) {
    this.options = options;
    this.port = options.port || 13333;
  }

  public async start(): Promise<number> {
    return new Promise((resolve, reject) => {
      this.server = net.createServer((socket) => {
        this.connectionsCount++;
        this.activeSockets.add(socket);
        const clientAddr = `${socket.remoteAddress}:${socket.remotePort}`;
        if (this.options.onClientConnect) {
          this.options.onClientConnect(clientAddr);
        }

        let buffer = '';
        socket.on('data', (data) => {
          buffer += data.toString();
          const lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const message = JSON.parse(line.trim());
              this.handleStratumMessage(socket, message);
            } catch {}
          }
        });

        socket.on('close', () => {
          this.activeSockets.delete(socket);
        });

        socket.on('error', () => {
          this.activeSockets.delete(socket);
        });
      });

      this.server.on('error', (err) => {
        reject(err);
      });

      this.server.listen(this.port, '127.0.0.1', () => {
        this.isRunning = true;
        const addr = this.server?.address() as net.AddressInfo;
        this.port = addr.port;
        resolve(this.port);
      });
    });
  }

  public async stop(): Promise<void> {
    return new Promise((resolve) => {
      for (const socket of this.activeSockets) {
        try {
          socket.destroy();
        } catch {}
      }
      this.activeSockets.clear();

      if (this.server && this.isRunning) {
        this.server.close(() => {
          this.isRunning = false;
          resolve();
        });
      } else {
        this.isRunning = false;
        resolve();
      }
    });
  }

  public getPort(): number {
    return this.port;
  }

  public getIsRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Broadcasts a new job to all connected sockets
   */
  public broadcastJob(jobId: string = 'job_next_102'): void {
    const jobPayload = {
      jsonrpc: '2.0',
      method: 'job',
      params: {
        blob: '0c0c00000000000000000000000000000000000000000000000000000000000000000001',
        job_id: jobId,
        target: 'ffffffff',
        seed_hash: '1111111111111111111111111111111111111111111111111111111111111111',
        height: 3100001
      }
    };
    const msg = JSON.stringify(jobPayload) + '\n';
    for (const socket of this.activeSockets) {
      try {
        socket.write(msg);
      } catch {}
    }
  }

  private handleStratumMessage(socket: net.Socket, msg: any) {
    const id = msg.id ?? 1;
    const method = msg.method;

    if (method === 'login') {
      this.loginsCount++;
      if (this.options.onLogin) {
        this.options.onLogin(msg.params);
      }

      const login = String(msg.params?.login || '');
      const shouldReject = this.options.rejectLogin || login.includes('invalid') || login === 'reject';

      if (shouldReject) {
        const errResponse = {
          id,
          jsonrpc: '2.0',
          error: {
            code: -1,
            message: 'Unauthenticated / Invalid wallet address'
          }
        };
        socket.write(JSON.stringify(errResponse) + '\n');
        return;
      }

      // Stratum login response with initial job
      const response = {
        id,
        jsonrpc: '2.0',
        result: {
          id: `mock_session_${Date.now()}`,
          job: {
            blob: '0c0c00000000000000000000000000000000000000000000000000000000000000000000',
            job_id: 'job_101',
            target: 'ffffffff',
            seed_hash: '0000000000000000000000000000000000000000000000000000000000000000',
            height: 3100000
          },
          status: 'OK'
        },
        error: null
      };
      socket.write(JSON.stringify(response) + '\n');
    } else if (method === 'submit') {
      this.submittedSharesCount++;
      if (this.options.onSubmit) {
        this.options.onSubmit(msg.params);
      }

      const nonce = String(msg.params?.nonce || '');
      const shouldReject = this.options.rejectShares || nonce.includes('reject') || nonce === 'invalid';

      if (shouldReject) {
        this.rejectedSharesCount++;
        const response = {
          id,
          jsonrpc: '2.0',
          error: {
            code: -1,
            message: 'Low difficulty share / stale share rejected'
          }
        };
        socket.write(JSON.stringify(response) + '\n');
      } else {
        this.acceptedSharesCount++;
        const response = {
          id,
          jsonrpc: '2.0',
          result: { status: 'OK' },
          error: null
        };
        socket.write(JSON.stringify(response) + '\n');
      }
    } else {
      const response = {
        id,
        jsonrpc: '2.0',
        result: { status: 'OK' },
        error: null
      };
      socket.write(JSON.stringify(response) + '\n');
    }
  }
}
