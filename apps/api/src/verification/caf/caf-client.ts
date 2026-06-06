import { CafConfig } from '../../config';
import { CafTransaction, isTransactionComplete } from './caf-mappers';

type FetchFn = (url: string, init?: any) => Promise<{ ok: boolean; status: number; json: () => Promise<any> }>;

export class CafClient {
  private token: { value: string; expiresAtMs: number } | null = null;

  constructor(
    private readonly cfg: CafConfig,
    private readonly fetchFn: FetchFn = fetch as any,
    private readonly nowMs: () => number = () => Date.now(),
  ) {}

  private async authHeader(): Promise<string> {
    if (this.token && this.nowMs() < this.token.expiresAtMs) return `Bearer ${this.token.value}`;
    const res = await this.fetchFn(`${this.cfg.baseUrl}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ client_id: this.cfg.clientId, client_secret: this.cfg.clientSecret }),
    });
    if (!res.ok) throw new Error(`CAF token request failed: ${res.status}`);
    const body = await res.json();
    // Refresh 60s before expiry to avoid edge races.
    this.token = { value: body.access_token, expiresAtMs: this.nowMs() + (Number(body.expires_in) - 60) * 1000 };
    return `Bearer ${this.token.value}`;
  }

  async createTransaction(payload: unknown): Promise<{ id: string }> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transactions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: await this.authHeader() },
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`CAF createTransaction failed: ${res.status}`);
    const body = await res.json();
    return { id: body.id };
  }

  async getTransaction(id: string): Promise<CafTransaction> {
    const res = await this.fetchFn(`${this.cfg.baseUrl}/transactions/${id}`, {
      method: 'GET',
      headers: { Authorization: await this.authHeader() },
    });
    if (!res.ok) throw new Error(`CAF getTransaction failed: ${res.status}`);
    return res.json();
  }

  async awaitTransaction(id: string): Promise<CafTransaction> {
    for (let attempt = 0; attempt < this.cfg.pollMaxAttempts; attempt++) {
      const tx = await this.getTransaction(id);
      if (isTransactionComplete(tx)) return tx;
      if (this.cfg.pollIntervalMs > 0) await new Promise((r) => setTimeout(r, this.cfg.pollIntervalMs));
    }
    throw new Error(`CAF transaction ${id} timed out after ${this.cfg.pollMaxAttempts} attempts`);
  }
}
