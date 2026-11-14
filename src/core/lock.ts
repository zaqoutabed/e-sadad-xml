/**
 * Runs tasks with the same key one after another (tasks with different keys
 * run in parallel).
 *
 * Used so two concurrent retries of the same payment cannot both post it. This
 * only protects one Node.js process: with several instances, also add a unique
 * constraint or a lock in your database.
 */
export class KeyedLock {
  private readonly tails = new Map<string, Promise<unknown>>();

  async run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const current = previous.then(task, task);
    const tail = current.catch(() => undefined);
    this.tails.set(key, tail);
    try {
      return await current;
    } finally {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    }
  }
}
