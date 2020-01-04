export interface RetryPolicyOptions {
  enabled?: boolean;
  retries?: number;
  delay?: number;
  maxDelay?: number;
  factor?: number;
}

export class RetryPolicy {
  enabled = true;
  retries = 5;
  delay = 200;
  maxDelay = 3200;
  factor = 2;

  private _retryTimer: any;
  private _retries = 0;

  constructor(options?: RetryPolicyOptions) {
    if (options) {
      this.enabled = options.enabled !== false;

      if (options.retries) {
        this.retries = options.retries;
      }
      if (options.delay) {
        this.delay = options.delay;
      }
      if (options.maxDelay) {
        this.maxDelay = options.maxDelay;
      }
      if (options.factor) {
        this.factor = options.factor;
      }
    }
  }

  get canRetry() {
    return this.enabled && this._retries < this.retries;
  }

  retry(callback: () => void, delay?: number) {
    if (this._retryTimer) {
      return;
    }
    this._retryTimer = setTimeout(() => {
      this._retryTimer = undefined;
      callback();
    }, delay || this.currentDelay);
    this._retries++;
  }

  reset() {
    clearTimeout(this._retryTimer);
    this._retries = 0;
    this._retryTimer = undefined;
  }

  get currentDelay() {
    let delay = this.delay;
    for (let i = 0; i < this._retries; i++) {
      delay = delay * this.factor;
    }
    return Math.min(delay, this.maxDelay);
  }
}
