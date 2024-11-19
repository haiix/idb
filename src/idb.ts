/*
 * idb.ts
 *
 * Copyright (c) 2024 haiix
 *
 * This software is released under the MIT license.
 * See: https://opensource.org/licenses/MIT
 */

export const version = '0.0.1';

type UpgReq = [
  string, // StoreName
  'create' | 'delete', // Method
  (db: IDBDatabase) => unknown,
];

type Req = [
  string, // StoreName
  IDBTransactionMode, // Mode
  (tx: IDBTransaction) => unknown,
];

export type IndexParameters = {
  name: string;
  keyPath: string | Iterable<string>;
  options?: IDBIndexParameters;
};

function reqError(req: IDBRequest): Error {
  return req.error ?? req.transaction?.error ?? new Error('Request failed.');
}

function queryWrapper<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(reqError(req));
    };
  });
}

async function* cursorWrapper<T>(
  req: IDBRequest<T | null>,
): AsyncGenerator<T, void> {
  // eslint-disable-next-line no-await-in-loop
  for (let cursor; (cursor = await queryWrapper(req)); ) {
    yield cursor;
  }
}

export class Idb {
  readonly name: string;
  version?: number;
  latestError: unknown;

  private upgReqs: UpgReq[] = [];
  private reqs: Req[] = [];
  private commitRequested = false;

  constructor(name: string) {
    this.name = name;
  }

  private open<T>(
    onsuccess: (db: IDBDatabase) => T,
    onupgradeneeded?: ((db: IDBDatabase) => void) | null,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onsuccess = () => {
        try {
          resolve(onsuccess(req.result));
        } catch (error) {
          reject(error as Error);
        } finally {
          req.result.close();
        }
      };
      req.onerror = () => {
        reject(reqError(req));
      };
      if (onupgradeneeded) {
        req.onupgradeneeded = () => {
          onupgradeneeded(req.result);
        };
      }
    });
  }

  private async transaction(
    db: IDBDatabase,
    storeNames: string[],
    mode: IDBTransactionMode,
    callback: (tx: IDBTransaction) => void,
  ): Promise<void> {
    if (!storeNames.length) {
      return Promise.resolve();
    }
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      tx.oncomplete = () => {
        resolve();
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Transaction failed.'));
      };
      try {
        callback(tx);
      } catch (error) {
        tx.abort();
        throw error;
      }
    });
  }

  getVersion(): Promise<number> {
    return this.open((db) => db.version);
  }

  async objectStoreNames(): Promise<DOMStringList> {
    return this.open((db) => db.objectStoreNames);
  }

  objectStore(
    name: string,
    options?: IDBObjectStoreParameters,
    indices?: IndexParameters[],
  ): IdbStore {
    this.upgReqs.push([
      name,
      'create',
      (idb) => {
        if (!idb.objectStoreNames.contains(name)) {
          const store = idb.createObjectStore(name, options);
          if (indices) {
            for (const params of indices) {
              store.createIndex(params.name, params.keyPath, params.options);
            }
          }
        }
      },
    ]);
    return new IdbStore(this, name, name);
  }

  deleteObjectStore(name: string): Promise<void> {
    this.upgReqs.push([
      name,
      'delete',
      (db) => {
        db.deleteObjectStore(name);
      },
    ]);
    return this.commit();
  }

  requestToCommit(req?: Req): void {
    (async () => {
      if (req) {
        this.reqs.push(req);
      }
      if (this.commitRequested) return;
      this.commitRequested = true;
      await Promise.resolve();
      this.commitRequested = false;
      await this.commit();
    })().catch((error: unknown) => {
      this.latestError = error;
    });
  }

  async commit(): Promise<void> {
    if (this.upgReqs.length) {
      await this.open(async (db) => {
        let reqUpgrade = false;
        const currentObjectStores = db.objectStoreNames;
        for (const [storeName, method] of this.upgReqs) {
          if (method === 'create' && !currentObjectStores.contains(storeName)) {
            reqUpgrade = true;
          } else if (
            method === 'delete' &&
            currentObjectStores.contains(storeName)
          ) {
            reqUpgrade = true;
          }
        }
        if (reqUpgrade) {
          this.version = db.version + 1;
          return;
        }
        this.upgReqs.length = 0;
        await this.execReqs(db);
      });
    }
    if (this.reqs.length) {
      await this.open(
        (db) => this.execReqs(db),
        this.upgReqs.length
          ? (db) => {
              for (const [, , fn] of this.upgReqs) {
                fn(db);
              }
              this.upgReqs.length = 0;
            }
          : null,
      );
    }
  }

  private execReqs(db: IDBDatabase): Promise<void> {
    const storeNames = [
      ...this.reqs.reduce(
        (set, [storeName]) => set.add(storeName),
        new Set<string>(),
      ),
    ];
    const mode = this.reqs.every(([, mode]) => mode === 'readonly')
      ? 'readonly'
      : 'readwrite';
    return this.transaction(db, storeNames, mode, (tx) => {
      for (const [, , fn] of this.reqs) {
        fn(tx);
      }
      this.reqs.length = 0;
    });
  }

  deleteDatabase(): Promise<IDBDatabase> {
    return queryWrapper(indexedDB.deleteDatabase(this.name));
  }
}

abstract class IdbStoreBase<U extends IDBObjectStore | IDBIndex> {
  readonly db: Idb;
  readonly storeName: string;
  readonly name: string;

  constructor(db: Idb, storeName: string, name: string) {
    this.db = db;
    this.storeName = storeName;
    this.name = name;
  }

  protected abstract getTarget(tx: IDBTransaction): U;

  protected register<T>(
    mode: IDBTransactionMode,
    fn: (os: U) => T | Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.db.requestToCommit([
        this.storeName,
        mode,
        (tx) => {
          try {
            resolve(fn(this.getTarget(tx)));
          } catch (error) {
            reject(error as Error);
          }
        },
      ]);
    });
  }

  protected registerQuery<T>(
    mode: IDBTransactionMode,
    fn: (os: U) => IDBRequest<T>,
  ): Promise<T> {
    return this.register(mode, (os) => queryWrapper(fn(os)));
  }

  protected async *registerCursor<T>(
    mode: IDBTransactionMode,
    fn: (os: U) => IDBRequest<T | null>,
  ): AsyncGenerator<T, void, unknown> {
    yield* await this.register(mode, (os) => cursorWrapper(fn(os)));
  }

  count(query?: IDBValidKey | IDBKeyRange): Promise<number> {
    return this.registerQuery('readonly', (os) => os.count(query));
  }

  get(query: IDBValidKey | IDBKeyRange): Promise<unknown> {
    return this.registerQuery('readonly', (os) => os.get(query));
  }

  getAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<unknown[]> {
    return this.registerQuery('readonly', (os) => os.getAll(query, count));
  }

  getAllKeys(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<IDBValidKey[]> {
    return this.registerQuery('readonly', (os) => os.getAllKeys(query, count));
  }

  getKey(query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey | undefined> {
    return this.registerQuery('readonly', (os) => os.getKey(query));
  }

  openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): AsyncGenerator<IDBCursorWithValue, void, unknown> {
    return this.registerCursor('readwrite', (os) =>
      os.openCursor(query, direction),
    );
  }

  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): AsyncGenerator<IDBCursor, void, unknown> {
    return this.registerCursor('readwrite', (os) =>
      os.openKeyCursor(query, direction),
    );
  }
}

export class IdbIndex extends IdbStoreBase<IDBIndex> {
  protected getTarget(tx: IDBTransaction): IDBIndex {
    return tx.objectStore(this.storeName).index(this.name);
  }
}

export class IdbStore extends IdbStoreBase<IDBObjectStore> {
  protected getTarget(tx: IDBTransaction): IDBObjectStore {
    return tx.objectStore(this.storeName);
  }

  add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.registerQuery('readwrite', (os) => os.add(value, key));
  }

  clear(): Promise<void> {
    return this.registerQuery('readwrite', (os) => os.clear());
  }

  delete(query: IDBValidKey | IDBKeyRange): Promise<void> {
    return this.registerQuery('readwrite', (os) => os.delete(query));
  }

  index(name: string): IdbIndex {
    return new IdbIndex(this.db, this.name, name);
  }

  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.registerQuery('readwrite', (os) => os.put(value, key));
  }
}

export function open(dbname: string) {
  return new Idb(dbname);
}

export default {
  open,
};
