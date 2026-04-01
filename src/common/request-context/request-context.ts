import { AsyncLocalStorage } from 'node:async_hooks';
import type { RequestContextStore } from './request-context.types';

const als = new AsyncLocalStorage<RequestContextStore>();

export const RequestContext = {
  run<T>(store: RequestContextStore, fn: () => T): T {
    return als.run(store, fn);
  },

  get(): RequestContextStore {
    return als.getStore() ?? {};
  },

  merge(patch: Partial<RequestContextStore>): void {
    const store = als.getStore();
    if (store) {
      Object.assign(store, patch);
    }
  },
};