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
  string, // ObjectStoreName
  'create' | 'delete', // Method
  (db: IDBDatabase) => unknown,
];

type UpgIReq = [
  string, // IndexName
  'create' | 'delete', // Method
  (objectStore: IDBObjectStore) => unknown,
];

type Req = [
  string, // ObjectStoreName
  IDBTransactionMode, // Mode
  (tx: IDBTransaction) => unknown,
];

export type IndexParameters = {
  name: string;
  keyPath: string | Iterable<string>;
  options?: IDBIndexParameters;
};

function queryWrapper<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => {
      resolve(req.result);
    };
    req.onerror = () => {
      reject(
        req.error ?? req.transaction?.error ?? new Error('Request failed.'),
      );
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

  private upgReqs: UpgReq[] = [];
  private upgIReqs = Object.create(null) as Record<string, UpgIReq[]>;
  private reqs: Req[] = [];
  private isCommitRequested = false;

  constructor(name: string) {
    this.name = name;
  }

  private async open<T>(
    callback: (db: IDBDatabase) => T | Promise<T>,
    dbVersion?: number,
    onupgradeneeded?: (db: IDBDatabase, tx: IDBTransaction | null) => void,
  ): Promise<T> {
    const req = indexedDB.open(this.name, dbVersion);
    if (onupgradeneeded) {
      req.onupgradeneeded = () => {
        onupgradeneeded(req.result, req.transaction);
      };
    }
    try {
      return await callback(await queryWrapper(req));
    } finally {
      req.result.close();
    }
  }

  private transaction<T>(
    db: IDBDatabase,
    objectStoreNames: string[],
    mode: IDBTransactionMode,
    callback: (tx: IDBTransaction) => T,
  ): Promise<T> {
    let result: T;
    return new Promise((resolve, reject) => {
      const tx = db.transaction(objectStoreNames, mode);
      tx.oncomplete = () => {
        resolve(result);
      };
      tx.onerror = () => {
        reject(tx.error ?? new Error('Transaction failed.'));
      };
      try {
        result = callback(tx);
      } catch (error) {
        tx.abort();
        throw error;
      }
    });
  }

  private addUpgIRec(objectStoreName: string, upgIRec: UpgIReq) {
    if (!this.upgIReqs[objectStoreName]) {
      this.upgIReqs[objectStoreName] = [];
    }
    this.upgIReqs[objectStoreName].push(upgIRec);
  }

  version(): Promise<number> {
    return this.open((db) => db.version);
  }

  objectStoreNames(): Promise<DOMStringList> {
    return this.open((db) => db.objectStoreNames);
  }

  objectStore(
    name: string,
    options?: IDBObjectStoreParameters | null,
    indices?: IndexParameters[],
  ): IdbStore {
    this.upgReqs.push([
      name,
      'create',
      (db) => {
        if (!db.objectStoreNames.contains(name)) {
          if (options) {
            db.createObjectStore(name, options);
          } else {
            db.createObjectStore(name);
          }
        }
      },
    ]);
    if (indices) {
      for (const index of indices) {
        this.addUpgIRec(name, [
          index.name,
          'create',
          (objectStore) => {
            if (!objectStore.indexNames.contains(index.name)) {
              objectStore.createIndex(index.name, index.keyPath, index.options);
            }
          },
        ]);
      }
    }
    return new IdbStore(this, name, name);
  }

  deleteObjectStore(name: string): Promise<void> {
    this.upgReqs.push([
      name,
      'delete',
      (db) => {
        if (db.objectStoreNames.contains(name)) {
          db.deleteObjectStore(name);
        }
      },
    ]);
    return this.commit();
  }

  deleteIndex(objectStoreName: string, indexName: string): Promise<void> {
    this.addUpgIRec(objectStoreName, [
      indexName,
      'delete',
      (objectStore) => {
        if (objectStore.indexNames.contains(indexName)) {
          objectStore.deleteIndex(indexName);
        }
      },
    ]);
    return this.commit();
  }

  private isNeedToUpg(db: IDBDatabase): boolean {
    for (const [name, method] of this.upgReqs) {
      const contains = db.objectStoreNames.contains(name);

      if (method === 'create' && !contains) {
        return true;
      } else if (method === 'delete' && contains) {
        return true;
      }
    }
    return false;
  }

  private async isNeedToIUpg(db: IDBDatabase): Promise<boolean> {
    const targetObjectStoreNames = Object.keys(this.upgIReqs);
    if (!targetObjectStoreNames.length) return false;

    return this.transaction(db, targetObjectStoreNames, 'readonly', (tx) => {
      for (const objectStoreName of targetObjectStoreNames) {
        const objectStore = tx.objectStore(objectStoreName);

        for (const [indexName, method] of this.upgIReqs[
          objectStoreName
        ] as UpgIReq[]) {
          const contains = objectStore.indexNames.contains(indexName);

          if (method === 'create' && !contains) {
            return true;
          } else if (method === 'delete' && contains) {
            return true;
          }
        }
      }
      return false;
    });
  }

  async requestToCommit(req?: Req): Promise<void> {
    if (req) {
      this.reqs.push(req);
    }
    if (this.isCommitRequested) return;
    this.isCommitRequested = true;
    await Promise.resolve();
    this.isCommitRequested = false;
    await this.commit();
  }

  private async commit(): Promise<void> {
    let dbVersion = 0;
    if (this.upgReqs.length) {
      dbVersion = await this.open(async (db) => {
        if (this.isNeedToUpg(db) || (await this.isNeedToIUpg(db))) {
          return db.version + 1;
        }
        this.upgReqs = [];
        this.upgIReqs = Object.create(null) as Record<string, UpgIReq[]>;
        await this.processReqs(db);
        return 0;
      });
    }
    if (this.reqs.length || this.upgReqs.length) {
      if (this.upgReqs.length) {
        await this.open(
          (db) => this.processReqs(db),
          dbVersion,
          (db, tx) => {
            if (tx) this.processUpgReqs(db, tx);
          },
        );
      } else {
        await this.open((db) => this.processReqs(db));
      }
    }
  }

  private processUpgReqs(db: IDBDatabase, tx: IDBTransaction): void {
    for (const [, , fn] of this.upgReqs) {
      fn(db);
    }
    this.upgReqs = [];

    for (const [storeName, reqs] of Object.entries(this.upgIReqs)) {
      const objectStore = tx.objectStore(storeName);
      for (const [, , fn] of reqs) {
        fn(objectStore);
      }
    }
    this.upgIReqs = Object.create(null) as Record<string, UpgIReq[]>;
  }

  private async processReqs(db: IDBDatabase): Promise<void> {
    if (!this.reqs.length) return;

    const objectStoreNames = [...new Set(this.reqs.map(([name]) => name))];
    const mode = this.reqs.every(([, mode]) => mode === 'readonly')
      ? 'readonly'
      : 'readwrite';

    await this.transaction(db, objectStoreNames, mode, (tx) => {
      for (const [, , fn] of this.reqs) {
        fn(tx);
      }
      this.reqs = [];
    });
  }

  deleteDatabase(): Promise<IDBDatabase> {
    return queryWrapper(indexedDB.deleteDatabase(this.name));
  }
}

abstract class IdbStoreBase<U extends IDBObjectStore | IDBIndex> {
  protected db: Idb;
  protected osName: string;
  readonly name: string;

  constructor(db: Idb, osName: string, name: string) {
    this.db = db;
    this.osName = osName;
    this.name = name;
  }

  protected abstract getTarget(tx: IDBTransaction): U;

  protected register<T>(
    mode: IDBTransactionMode,
    callback: (os: U) => T | Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      this.db
        .requestToCommit([
          this.osName,
          mode,
          (tx) => {
            try {
              resolve(callback(this.getTarget(tx)));
            } catch (error) {
              reject(error as Error);
            }
          },
        ])
        .catch((error: unknown) => {
          reject(error as Error);
        });
    });
  }

  protected registerQuery<T>(
    mode: IDBTransactionMode,
    callback: (os: U) => IDBRequest<T>,
  ): Promise<T> {
    return this.register(mode, (os) => queryWrapper(callback(os)));
  }

  protected async *registerCursor<T>(
    mode: IDBTransactionMode,
    callback: (os: U) => IDBRequest<T | null>,
  ): AsyncGenerator<T, void, unknown> {
    yield* await this.register(mode, (os) => cursorWrapper(callback(os)));
  }

  keyPath(): Promise<string | string[]> {
    return this.register('readonly', (os) => os.keyPath);
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

export class IdbStore extends IdbStoreBase<IDBObjectStore> {
  protected getTarget(tx: IDBTransaction): IDBObjectStore {
    return tx.objectStore(this.name);
  }

  autoIncrement(): Promise<boolean> {
    return this.register('readonly', (os) => os.autoIncrement);
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

  deleteIndex(indexName: string): Promise<void> {
    return this.db.deleteIndex(this.name, indexName);
  }

  indexNames(): Promise<DOMStringList> {
    return this.register('readonly', (os) => os.indexNames);
  }

  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.registerQuery('readwrite', (os) => os.put(value, key));
  }
}

export class IdbIndex extends IdbStoreBase<IDBIndex> {
  protected getTarget(tx: IDBTransaction): IDBIndex {
    return tx.objectStore(this.osName).index(this.name);
  }

  multiEntry(): Promise<boolean> {
    return this.register('readonly', (os) => os.multiEntry);
  }

  unique(): Promise<boolean> {
    return this.register('readonly', (os) => os.unique);
  }
}

export function open(dbname: string) {
  return new Idb(dbname);
}

export default {
  open,
};
