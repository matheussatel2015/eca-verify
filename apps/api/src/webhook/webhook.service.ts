import { Injectable } from '@nestjs/common';
import { WebhookPayload } from '@eca/sdk-types';
import { signPayload } from './signature.util';

type FetchFn = (url: string, init: any) => Promise<{ ok: boolean; status: number }>;
interface RetryOpts { retries: number; delayMs: number; }

@Injectable()
export class WebhookService {
  constructor(
    private readonly fetchFn: FetchFn = fetch as any,
    private readonly opts: RetryOpts = { retries: 3, delayMs: 500 },
  ) {}

  async dispatch(url: string, secret: string, payload: WebhookPayload): Promise<void> {
    const body = JSON.stringify(payload);
    const signature = signPayload(body, secret);
    let lastErr: unknown;
    for (let attempt = 0; attempt <= this.opts.retries; attempt++) {
      try {
        const res = await this.fetchFn(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Signature': signature },
          body,
        });
        if (res.ok) return;
        lastErr = new Error(`webhook returned ${res.status}`);
      } catch (e) {
        lastErr = e;
      }
      if (attempt < this.opts.retries && this.opts.delayMs > 0) {
        await new Promise((r) => setTimeout(r, this.opts.delayMs));
      }
    }
    throw lastErr ?? new Error('webhook failed');
  }
}
