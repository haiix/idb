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
  readonly upgReqs: UpgReq[] = [];
  readonly reqs: Req[] = [];
  private commitRequested = false;
  latestError: unknown;

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
    return new IdbStore(this, name, options, indices);
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

  requestToCommit(): void {
    (async () => {
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

abstract class IdbStoreBase {
  protected abstract register<T>(
    mode: IDBTransactionMode,
    fn: (os: IDBObjectStore | IDBIndex) => T,
  ): Promise<T>;

  async count(query?: IDBValidKey | IDBKeyRange): Promise<number> {
    return await this.register('readonly', (os) =>
      queryWrapper(os.count(query)),
    );
  }

  async get(query: IDBValidKey | IDBKeyRange): Promise<unknown> {
    return await this.register('readonly', (os) => queryWrapper(os.get(query)));
  }

  async getAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<unknown[]> {
    return await this.register('readonly', (os) =>
      queryWrapper<unknown[]>(os.getAll(query, count)),
    );
  }

  async getAllKeys(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<IDBValidKey[]> {
    return await this.register('readonly', (os) =>
      queryWrapper(os.getAllKeys(query, count)),
    );
  }

  async getKey(
    query: IDBValidKey | IDBKeyRange,
  ): Promise<IDBValidKey | undefined> {
    return await this.register('readonly', (os) =>
      queryWrapper(os.getKey(query)),
    );
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

export class IdbIndex extends IdbStoreBase {
  readonly db: Idb;
  readonly storeName: string;
  readonly name: string;

  constructor(db: Idb, storeName: string, name: string) {
    super();
    this.db = db;
    this.storeName = storeName;
    this.name = name;
  }

  protected register<T>(
    mode: IDBTransactionMode,
    fn: (os: IDBIndex) => T,
  ): Promise<T> {
    const result = new Promise((resolve, reject) => {
      this.db.reqs.push([
        this.storeName,
        mode,
        (tx) => {
          try {
            resolve(fn(tx.objectStore(this.storeName).index(this.name)));
          } catch (error) {
            reject(error as Error);
          }
        },
      ]);
    });
    this.db.requestToCommit();
    return result as Promise<T>;
  }
}

export class IdbStore extends IdbStoreBase {
  readonly db: Idb;
  readonly name: string;

  constructor(
    db: Idb,
    name: string,
    options?: IDBObjectStoreParameters,
    indices?: IndexParameters[],
  ) {
    super();
    this.db = db;
    this.name = name;
    this.db.upgReqs.push([
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
    this.db.requestToCommit();
  }

  protected register<T>(
    mode: IDBTransactionMode,
    fn: (os: IDBObjectStore) => T,
  ): Promise<T> {
    const result = new Promise((resolve, reject) => {
      this.db.reqs.push([
        this.name,
        mode,
        (tx) => {
          try {
            resolve(fn(tx.objectStore(this.name)));
          } catch (error) {
            reject(error as Error);
          }
        },
      ]);
    });
    this.db.requestToCommit();
    return result as Promise<T>;
  }

  async add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return await this.register('readwrite', (os) =>
      queryWrapper(os.add(value, key)),
    );
  }

  async clear(): Promise<void> {
    await this.register('readwrite', (os) => queryWrapper(os.clear()));
  }

  async delete(query: IDBValidKey | IDBKeyRange): Promise<void> {
    await this.register('readwrite', (os) => queryWrapper(os.delete(query)));
  }

  index(name: string) {
    return new IdbIndex(this.db, this.name, name);
  }

  async put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return await this.register('readwrite', (os) =>
      queryWrapper(os.put(value, key)),
    );
  }
}

export function open(dbname: string) {
  return new Idb(dbname);
}

export default {
  open,
};
