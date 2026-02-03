/**
 * Debounce utility for optimization
 * Ensures functions are not called too frequently
 */

export class Debouncer {
  private timers: Map<string, NodeJS.Timeout> = new Map();

  /**
   * Debounce a function call
   * @param key - Unique key for this debounce operation
   * @param fn - Function to debounce
   * @param delay - Delay in milliseconds
   */
  debounce(key: string, fn: () => void | Promise<void>, delay: number): void {
    const existing = this.timers.get(key);
    if (existing) {
      clearTimeout(existing);
    }

    const timer = setTimeout(() => {
      fn();
      this.timers.delete(key);
    }, delay);

    this.timers.set(key, timer);
  }

  /**
   * Cancel a pending debounce
   */
  cancel(key: string): void {
    const timer = this.timers.get(key);
    if (timer) {
      clearTimeout(timer);
      this.timers.delete(key);
    }
  }

  /**
   * Clear all pending debounces
   */
  clear(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }

  /**
   * Get number of pending debounces
   */
  getPendingCount(): number {
    return this.timers.size;
  }
}

export class ThrottledFunction {
  private lastCall = 0;
  private pending = false;
  private pendingArgs: any[] = [];

  constructor(
    private fn: (...args: any[]) => void | Promise<void>,
    private delay: number
  ) {}

  /**
   * Call the function with throttling
   */
  async call(...args: any[]): Promise<void> {
    const now = Date.now();
    this.pendingArgs = args;

    if (now - this.lastCall >= this.delay) {
      this.lastCall = now;
      this.pending = false;
      await this.fn(...args);
    } else if (!this.pending) {
      this.pending = true;
      setTimeout(async () => {
        this.lastCall = Date.now();
        this.pending = false;
        await this.fn(...this.pendingArgs);
      }, this.delay - (now - this.lastCall));
    }
  }
}
