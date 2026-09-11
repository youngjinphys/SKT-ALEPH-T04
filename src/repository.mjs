import fs from 'node:fs/promises';
import path from 'node:path';
import { emptyState } from './domain.mjs';

const mutexes = new Map();
function serialized(key, fn) {
  const prev = mutexes.get(key) ?? Promise.resolve();
  const next = prev.then(fn, fn).finally(() => { if (mutexes.get(key) === next) mutexes.delete(key); });
  mutexes.set(key, next);
  return next;
}

export class JsonStateRepository {
  constructor(filePath, kind) { this.filePath = filePath; this.kind = kind; }
  async read() {
    try {
      return JSON.parse(await fs.readFile(this.filePath, 'utf8'));
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
      return emptyState(this.kind);
    }
  }
  async write(state) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tmp = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
    await fs.rename(tmp, this.filePath);
    return state;
  }
  async transact(mutator) {
    return serialized(this.filePath, async () => {
      const current = await this.read();
      const next = await mutator(current);
      await this.write(next);
      return next;
    });
  }
  async reset() { return this.write(emptyState(this.kind)); }
}
