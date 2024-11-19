export declare const version = "0.0.1";
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
    latestError: unknown;
    private upgReqs;
    private reqs;
    private commitRequested;
    constructor(name: string);
    private open;
    private transaction;
    getVersion(): Promise<number>;
    objectStoreNames(): Promise<DOMStringList>;
    objectStore(name: string, options?: IDBObjectStoreParameters, indices?: IndexParameters[]): IdbStore;
    deleteObjectStore(name: string): Promise<void>;
    requestToCommit(req?: Req): void;
    commit(): Promise<void>;
    private execReqs;
    deleteDatabase(): Promise<IDBDatabase>;
}
declare abstract class IdbStoreBase<U extends IDBObjectStore | IDBIndex> {
    readonly db: Idb;
    readonly storeName: string;
    readonly name: string;
    constructor(db: Idb, storeName: string, name: string);
    protected abstract getTarget(tx: IDBTransaction): U;
    protected register<T>(mode: IDBTransactionMode, fn: (os: U) => T | Promise<T>): Promise<T>;
    protected registerQuery<T>(mode: IDBTransactionMode, fn: (os: U) => IDBRequest<T>): Promise<T>;
    protected registerCursor<T>(mode: IDBTransactionMode, fn: (os: U) => IDBRequest<T | null>): AsyncGenerator<T, void, unknown>;
    count(query?: IDBValidKey | IDBKeyRange): Promise<number>;
    get(query: IDBValidKey | IDBKeyRange): Promise<unknown>;
    getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<unknown[]>;
    getAllKeys(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<IDBValidKey[]>;
    getKey(query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey | undefined>;
    openCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): AsyncGenerator<IDBCursorWithValue, void, unknown>;
    openKeyCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): AsyncGenerator<IDBCursor, void, unknown>;
}
export declare class IdbIndex extends IdbStoreBase<IDBIndex> {
    protected getTarget(tx: IDBTransaction): IDBIndex;
}
export declare class IdbStore extends IdbStoreBase<IDBObjectStore> {
    protected getTarget(tx: IDBTransaction): IDBObjectStore;
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
