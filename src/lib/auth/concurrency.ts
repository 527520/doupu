export interface ConcurrencyGate {
  run<T>(job: () => Promise<T>): Promise<T>;
}

/** FIFO 并发闸门；job 抛错也一定释放 permit，避免队列永久阻塞。 */
export function createConcurrencyGate(limit: number): ConcurrencyGate {
  if (!Number.isInteger(limit) || limit < 1) throw new RangeError('concurrency limit must be a positive integer');
  let active = 0;
  const waiters: Array<() => void> = [];

  async function acquire(): Promise<void> {
    if (active < limit) {
      active += 1;
      return;
    }
    // release() 直接把当前 permit 交给队首；此处无需再递增 active。
    await new Promise<void>((resolve) => waiters.push(resolve));
  }

  function release(): void {
    const next = waiters.shift();
    if (next) next();
    else active -= 1;
  }

  return {
    async run<T>(job: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await job();
      } finally {
        release();
      }
    },
  };
}
