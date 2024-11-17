export declare const version = "0.0.1";
type UpgReq = [
    string,
    // StoreName
    'create' | 'delete',
    (db: IDBDatabase) => unknown
];
type Req = [
    string,
    IDBTransactionMode,
    (tx: IDBTransaction) => unknown
];
export type IndexParameters = {
    name: string;
    keyPath: string | Iterable<string>;
    options?: IDBIndexParameters;
};
export declare class Idb {
    readonly name: string;
    version?: number;
    readonly upgReqs: UpgReq[];
    readonly reqs: Req[];
    private commitRequested;
    latestError: unknown;
    constructor(name: string);
    private open;
    private transaction;
    getVersion(): Promise<number>;
    objectStoreNames(): Promise<DOMStringList>;
    objectStore(name: string, options?: IDBObjectStoreParameters, indices?: IndexParameters[]): IdbStore;
    deleteObjectStore(name: string): Promise<void>;
    requestToCommit(): void;
    commit(): Promise<void>;
    deleteDatabase(): Promise<IDBDatabase>;
}
declare abstract class IdbStoreBase {
    protected abstract register<T>(mode: IDBTransactionMode, fn: (os: IDBObjectStore | IDBIndex) => T): Promise<T>;
    count(query?: IDBValidKey | IDBKeyRange): Promise<number>;
    get(query: IDBValidKey | IDBKeyRange): Promise<unknown>;
    getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<unknown[]>;
    getAllKeys(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<IDBValidKey[]>;
    getKey(query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey | undefined>;
    openCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): AsyncGenerator<IDBCursorWithValue, void>;
    openKeyCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): AsyncGenerator<IDBCursor, void>;
}
export declare class IdbIndex extends IdbStoreBase {
    readonly db: Idb;
    readonly storeName: string;
    readonly name: string;
    constructor(db: Idb, storeName: string, name: string);
    protected register<T>(mode: IDBTransactionMode, fn: (os: IDBIndex) => T): Promise<T>;
}
export declare class IdbStore extends IdbStoreBase {
    readonly db: Idb;
    readonly name: string;
    constructor(db: Idb, name: string, options?: IDBObjectStoreParameters, indices?: IndexParameters[]);
    protected register<T>(mode: IDBTransactionMode, fn: (os: IDBObjectStore) => T): Promise<T>;
    add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
    clear(): Promise<void>;
    delete(query: IDBValidKey | IDBKeyRange): Promise<void>;
    index(name: string): IdbIndex;
    put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
}
export declare function open(dbname: string): Idb;
declare const _default: {
    open: typeof open;
};
export default _default;
