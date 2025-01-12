export declare const version = "0.1.0";
declare const READONLY = 0;
declare const READWRITE = 1;
type TransactionMode = typeof READONLY | typeof READWRITE;
type Req = [
    string,
    TransactionMode,
    (tx: IDBTransaction) => unknown
];
export type IndexParameters = {
    name: string;
    keyPath: string | Iterable<string>;
    options?: IDBIndexParameters;
};
export declare class Idb {
    readonly name: string;
    private upgReqs;
    private upgIReqs;
    private reqs;
    private isRequested;
    constructor(name: string);
    private open;
    private tx;
    private addUpgIRec;
    version(): Promise<number>;
    objectStoreNames(): Promise<DOMStringList>;
    objectStore(name: string, options?: IDBObjectStoreParameters | null, indices?: IndexParameters[]): IdbStore;
    deleteObjectStore(name: string): Promise<void>;
    deleteIndex(objectStoreName: string, indexName: string): Promise<void>;
    private isNeedToUpg;
    private isNeedToIUpg;
    requestToCommit(req?: Req): Promise<void>;
    private commit;
    private procUpgReqs;
    private procReqs;
    deleteDatabase(): Promise<IDBDatabase>;
}
declare abstract class IdbStoreBase<U extends IDBObjectStore | IDBIndex> {
    protected db: Idb;
    protected osName: string;
    readonly name: string;
    constructor(db: Idb, osName: string, name: string);
    protected abstract getTarget(tx: IDBTransaction): U;
    protected reg<T>(mode: TransactionMode, callback: (os: U) => T | Promise<T>): Promise<T>;
    protected regq<T>(mode: TransactionMode, callback: (os: U) => IDBRequest<T>): Promise<T>;
    protected regc<T>(mode: TransactionMode, callback: (os: U) => IDBRequest<T | null>): AsyncGenerator<T, void, unknown>;
    count(query?: IDBValidKey | IDBKeyRange): Promise<number>;
    get(query: IDBValidKey | IDBKeyRange): Promise<unknown>;
    getAll(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<unknown[]>;
    getAllKeys(query?: IDBValidKey | IDBKeyRange | null, count?: number): Promise<IDBValidKey[]>;
    getKey(query: IDBValidKey | IDBKeyRange): Promise<IDBValidKey | undefined>;
    keyPath(): Promise<string | string[]>;
    openCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): AsyncGenerator<IDBCursorWithValue, void, unknown>;
    openKeyCursor(query?: IDBValidKey | IDBKeyRange | null, direction?: IDBCursorDirection): AsyncGenerator<IDBCursor, void, unknown>;
}
export declare class IdbStore extends IdbStoreBase<IDBObjectStore> {
    protected getTarget(tx: IDBTransaction): IDBObjectStore;
    add(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
    autoIncrement(): Promise<boolean>;
    clear(): Promise<void>;
    delete(query: IDBValidKey | IDBKeyRange): Promise<void>;
    deleteIndex(indexName: string): Promise<void>;
    index(name: string): IdbIndex;
    indexNames(): Promise<DOMStringList>;
    put(value: unknown, key?: IDBValidKey): Promise<IDBValidKey>;
}
export declare class IdbIndex extends IdbStoreBase<IDBIndex> {
    protected getTarget(tx: IDBTransaction): IDBIndex;
    multiEntry(): Promise<boolean>;
    unique(): Promise<boolean>;
}
export declare function open(dbname: string): Idb;
declare const _default: {
    open: typeof open;
};
export default _default;
