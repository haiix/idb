/*
 * idb.ts
 *
 * Copyright (c) 2024 haiix
 *
 * This software is released under the MIT license.
 * See: https://opensource.org/licenses/MIT
 */

export const version = '0.0.1';

const READONLY = 0;
const READWRITE = 1;
const CREATE = 0;
const DELETE = 1;

type TransactionMode = typeof READONLY | typeof READWRITE;
type UpgMethod = typeof CREATE | typeof DELETE;

type UpgReq = [
  string, // ObjectStoreName
  UpgMethod, // Method
  (db: IDBDatabase) => unknown,
];

type UpgIReq = [
  string, // IndexName
  UpgMethod, // Method
  (objectStore: IDBObjectStore) => unknown,
];

type Req = [
  string, // ObjectStoreName
  TransactionMode, // Mode
  (tx: IDBTransaction) => unknown,
];

export type IndexParameters = {
  name: string;
  keyPath: string | Iterable<string>;
  options?: IDBIndexParameters;
};

function createDictionary<T>(): Record<string, T> {
  return Object.create(null) as Record<string, T>;
}

function reqToAsync<T>(req: IDBRequest<T>): Promise<T> {
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

async function* reqToAsyncGen<T>(
  req: IDBRequest<T | null>,
): AsyncGenerator<T, void> {
  // eslint-disable-next-line no-await-in-loop
  for (let cursor; (cursor = await reqToAsync(req)); ) {
    yield cursor;
  }
}

export class Idb {
  readonly name: string;

  private upgReqs: UpgReq[] = [];
  private upgIReqs = createDictionary<UpgIReq[]>();
  private reqs: Req[] = [];
  private isRequested = false;

  constructor(name: string) {
    this.name = name;
  }

  private async open<T>(
    callback: (db: IDBDatabase) => T | Promise<T>,
    dbVersion?: number,
    onupgradeneeded?: (db: IDBDatabase, tx: IDBTransaction) => void,
  ): Promise<T> {
    const req = indexedDB.open(this.name, dbVersion);
    if (onupgradeneeded) {
      req.onupgradeneeded = () => {
        onupgradeneeded(req.result, req.transaction as IDBTransaction);
      };
    }
    try {
      return await callback(await reqToAsync(req));
    } finally {
      req.result.close();
    }
  }

  private tx<T>(
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
      CREATE,
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
          CREATE,
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
      DELETE,
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
      DELETE,
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

      if (method === CREATE && !contains) {
        return true;
      } else if (method === DELETE && contains) {
        return true;
      }
    }
    return false;
  }

  private async isNeedToIUpg(db: IDBDatabase): Promise<boolean> {
    const targetObjectStoreNames = Object.keys(this.upgIReqs);
    if (!targetObjectStoreNames.length) return false;

    return this.tx(db, targetObjectStoreNames, 'readonly', (tx) => {
      for (const objectStoreName of targetObjectStoreNames) {
        const objectStore = tx.objectStore(objectStoreName);

        for (const [indexName, method] of this.upgIReqs[
          objectStoreName
        ] as UpgIReq[]) {
          const contains = objectStore.indexNames.contains(indexName);

          if (method === CREATE && !contains) {
            return true;
          } else if (method === DELETE && contains) {
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
    if (this.isRequested) return;
    this.isRequested = true;
    await Promise.resolve();
    this.isRequested = false;
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
        this.upgIReqs = createDictionary<UpgIReq[]>();
        await this.procReqs(db);
        return 0;
      });
    }
    if (this.reqs.length || this.upgReqs.length) {
      if (this.upgReqs.length) {
        await this.open(
          (db) => this.procReqs(db),
          dbVersion,
          (db, tx) => {
            this.procUpgReqs(db, tx);
          },
        );
      } else {
        await this.open((db) => this.procReqs(db));
      }
    }
  }

  private procUpgReqs(db: IDBDatabase, tx: IDBTransaction): void {
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
    this.upgIReqs = createDictionary<UpgIReq[]>();
  }

  private async procReqs(db: IDBDatabase): Promise<void> {
    if (!this.reqs.length) return;

    const objectStoreNames = [...new Set(this.reqs.map(([name]) => name))];
    const mode = this.reqs.every(([, mode]) => mode === READONLY)
      ? 'readonly'
      : 'readwrite';

    await this.tx(db, objectStoreNames, mode, (tx) => {
      for (const [, , fn] of this.reqs) {
        fn(tx);
      }
      this.reqs = [];
    });
  }

  deleteDatabase(): Promise<IDBDatabase> {
    return reqToAsync(indexedDB.deleteDatabase(this.name));
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

  protected reg<T>(
    mode: TransactionMode,
    callback: (os: U) => T | Promise<T>,
  ): Promise<T> {
    return new Promise((resolve, reject: (reason: unknown) => void) => {
      this.db
        .requestToCommit([
          this.osName,
          mode,
          (tx) => {
            try {
              resolve(callback(this.getTarget(tx)));
            } catch (error) {
              reject(error);
            }
          },
        ])
        .catch(reject);
    });
  }

  protected regq<T>(
    mode: TransactionMode,
    callback: (os: U) => IDBRequest<T>,
  ): Promise<T> {
    return this.reg(mode, (os) => reqToAsync(callback(os)));
  }

  protected async *regc<T>(
    mode: TransactionMode,
    callback: (os: U) => IDBRequest<T | null>,
  ): AsyncGenerator<T, void, unknown> {
    yield* await this.reg(mode, (os) => reqToAsyncGen(callback(os)));
  }

  count(query?: IDBValidKey | IDBKeyRange): Promise<number> {
    return this.regq(READONLY, (os) => os.count(query));
  }

  get(query: IDBValidKey | IDBKeyRange): Promise<unknown> {
    return this.regq(READONLY, (os) => os.get(query));
  }

  getAll(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<unknown[]> {
    return this.regq(READONLY, (os) => os.getAll(query, count));
  }

  getAllKeys(
    query?: IDBValidKey | IDBKeyRange | null,
    count?: number,
  ): Promise<IDBValidKey[]> {
    return this.regq(READONLY, (os) => os.getAllKeys(query, count));
  }

  getKey(query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey | undefined> {
    return this.regq(READONLY, (os) => os.getKey(query));
  }

  keyPath(): Promise<string | string[]> {
    return this.reg(READONLY, (os) => os.keyPath);
  }

  openCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): AsyncGenerator<IDBCursorWithValue, void, unknown> {
    return this.regc(READWRITE, (os) => os.openCursor(query, direction));
  }

  openKeyCursor(
    query?: IDBValidKey | IDBKeyRange | null,
    direction?: IDBCursorDirection,
  ): AsyncGenerator<IDBCursor, void, unknown> {
    return this.regc(READWRITE, (os) => os.openKeyCursor(query, direction));
  }
}

export class IdbStore extends IdbStoreBase<IDBObjectStore> {
  protected getTarget(tx: IDBTransaction): IDBObjectStore {
    return tx.objectStore(this.name);
  }

  add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.regq(READWRITE, (os) => os.add(value, key));
  }

  autoIncrement(): Promise<boolean> {
    return this.reg(READONLY, (os) => os.autoIncrement);
  }

  clear(): Promise<void> {
    return this.regq(READWRITE, (os) => os.clear());
  }

  delete(query: IDBValidKey | IDBKeyRange): Promise<void> {
    return this.regq(READWRITE, (os) => os.delete(query));
  }

  deleteIndex(indexName: string): Promise<void> {
    return this.db.deleteIndex(this.name, indexName);
  }

  index(name: string): IdbIndex {
    return new IdbIndex(this.db, this.name, name);
  }

  indexNames(): Promise<DOMStringList> {
    return this.reg(READONLY, (os) => os.indexNames);
  }

  put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey> {
    return this.regq(READWRITE, (os) => os.put(value, key));
  }
}

export class IdbIndex extends IdbStoreBase<IDBIndex> {
  protected getTarget(tx: IDBTransaction): IDBIndex {
    return tx.objectStore(this.osName).index(this.name);
  }

  multiEntry(): Promise<boolean> {
    return this.reg(READONLY, (os) => os.multiEntry);
  }

  unique(): Promise<boolean> {
    return this.reg(READONLY, (os) => os.unique);
  }
}

export function open(dbname: string) {
  return new Idb(dbname);
}

export default {
  open,
};
