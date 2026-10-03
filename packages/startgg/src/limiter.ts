export type Clock = () => number;
export type Sleep = (ms: number) => Promise<void>;

export interface TokenBucketOptions {
  ratePerMinute: number;
  /** Burst size. Keep at 1 so no 60 s window can hold more than ratePerMinute requests. */
  capacity?: number;
  clock: Clock;
  sleep: Sleep;
}

/** Token bucket: one token per request, refilled continuously. */
export class TokenBucket {
  private tokens: number;
  private last: number;
  private readonly capacity: number;
  private readonly perMs: number;

  constructor(private readonly options: TokenBucketOptions) {
    this.capacity = options.capacity ?? 1;
    this.perMs = options.ratePerMinute / 60_000;
    this.tokens = this.capacity;
    this.last = options.clock();
  }

  async acquire(): Promise<void> {
    for (;;) {
      const now = this.options.clock();
      this.tokens = Math.min(this.capacity, this.tokens + (now - this.last) * this.perMs);
      this.last = now;
      if (this.tokens >= 1 - 1e-9) {
        this.tokens -= 1;
        return;
      }
      await this.options.sleep(Math.max(1, Math.ceil((1 - this.tokens) / this.perMs)));
    }
  }
}
