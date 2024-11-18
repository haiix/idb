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

  private open(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(this.name, this.version);
      req.onsuccess = () => {
        resolve(req.result);
      };
      req.onerror = () => {
        reject(reqError(req));
      };
      req.onupgradeneeded = () => {
        for (const [, , fn] of this.upgReqs) {
          fn(req.result);
        }
      };
    });
  }

  private async transaction(
    storeNames: string | Iterable<string>,
    mode: IDBTransactionMode,
    fn: (tx: IDBTransaction) => void,
  ): Promise<void> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      if (typeof storeNames !== 'string' && ![...storeNames].length) {
        db.close();
        resolve();
        return;
      }
      const tx = db.transaction(storeNames, mode);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        if (tx.error) reject(tx.error);
      };
      try {
        fn(tx);
      } catch (error) {
        tx.abort();
        db.close();
        throw error;
      }
    });
  }

  async getVersion(): Promise<number> {
    const db = await this.open();
    const dbVersion = db.version;
    db.close();
    return dbVersion;
  }

  async objectStoreNames(): Promise<DOMStringList> {
    const db = await this.open();
    const { objectStoreNames } = db;
    db.close();
    return objectStoreNames;
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
    this.requestToCommit();
    return new IdbStore(this, name);
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
    let reqUpdate = false;
    if (this.upgReqs.length) {
      const currentObjectStores = await this.objectStoreNames();
      for (const [storeName, method] of this.upgReqs) {
        if (method === 'create' && !currentObjectStores.contains(storeName)) {
          reqUpdate = true;
        } else if (
          method === 'delete' &&
          currentObjectStores.contains(storeName)
        ) {
          reqUpdate = true;
        }
      }
      if (reqUpdate) {
        this.version = (await this.getVersion()) + 1;
      }
    }
    if (reqUpdate || this.reqs.length) {
      const storeNames = [
        ...this.reqs.reduce(
          (set, [storeName]) => set.add(storeName),
          new Set<string>(),
        ),
      ];
      const mode = this.reqs.every(([, mode]) => mode === 'readonly')
        ? 'readonly'
        : 'readwrite';
      await this.transaction(storeNames, mode, (tx) => {
        for (const [, , fn] of this.reqs) {
          fn(tx);
        }
        this.reqs.length = 0;
      });
    }
  }

  deleteDatabase(): Promise<IDBDatabase> {
    return queryWrapper(indexedDB.deleteDatabase(this.name));
  }
}

abstract class IdbStoreBase<U extends IDBObjectStore | IDBIndex> {
  abstract db: Idb;
  abstract storeName: string;

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

  count(query?: IDBValidKey | IDBKeyRange): Promise<number> {
    return this.register('readonly', (os) => queryWrapper(os.count(query)));
  }

  get(query: IDBValidKey | IDBKeyRange): Promise<unknown> {
    return this.register('readonly', (os) => queryWrapper(os.get(query)));
  }

  getAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<unknown[]> {
    return this.register('readonly', (os) =>
      queryWrapper(os.getAll(query, count)),
    );
  }

  getAllKeys(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<IDBValidKey[]> {
    return this.register('readonly', (os) =>
      queryWrapper(os.getAllKeys(query, count)),
    );
  }

  getKey(query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey | undefined> {
    return this.register('readonly', (os) => queryWrapper(os.getKey(query)));
  }

  async *openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): AsyncGenerator<IDBCursorWithValue, void> {
    yield* await this.register('readwrite', (os) =>
      cursorWrapper(os.openCursor(query, direction)),
    );
  }

  async *openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): AsyncGenerator<IDBCursor, void> {
    yield* await this.register('readwrite', (os) =>
      cursorWrapper(os.openKeyCursor(query, direction)),
    );
  }
}

export class IdbIndex extends IdbStoreBase<IDBIndex> {
  readonly db: Idb;
  readonly storeName: string;
  readonly name: string;

  constructor(db: Idb, storeName: string, name: string) {
    super();
    this.db = db;
    this.storeName = storeName;
    this.name = name;
  }

  protected getTarget(tx: IDBTransaction): IDBIndex {
    return tx.objectStore(this.storeName).index(this.name);
  }
}

export class IdbStore extends IdbStoreBase<IDBObjectStore> {
  readonly db: Idb;
  readonly storeName: string;
  readonly name: string;

  constructor(db: Idb, name: string) {
    super();
    this.db = db;
    this.storeName = name;
    this.name = name;
  }

  protected getTarget(tx: IDBTransaction): IDBObjectStore {
    return tx.objectStore(this.storeName);
  }

  add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.register('readwrite', (os) => queryWrapper(os.add(value, key)));
  }

  clear(): Promise<void> {
    return this.register('readwrite', (os) => queryWrapper(os.clear()));
  }

  delete(query: IDBValidKey | IDBKeyRange): Promise<void> {
    return this.register('readwrite', (os) => queryWrapper(os.delete(query)));
  }

  index(name: string): IdbIndex {
    return new IdbIndex(this.db, this.name, name);
  }

  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.register('readwrite', (os) => queryWrapper(os.put(value, key)));
  }
}

export function open(dbname: string) {
  return new Idb(dbname);
}

export default {
  open,
};
