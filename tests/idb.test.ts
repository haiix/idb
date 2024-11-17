// As of version 5, fake-indexeddb no longer includes a structuredClone polyfill.
// See: https://github.com/dumbmatter/fakeIndexedDB
import 'core-js/stable/structured-clone';
import 'fake-indexeddb/auto';
import * as idb from '../src/idb';

/* eslint max-lines-per-function: off */

describe('Basic test', () => {
  test('The default object has the open function.', () => {
    expect(idb.default.open).toBe(idb.open);
  });

  test('Should be getVersion', async () => {
    const db = idb.open('testdb');
    const version = await db.getVersion();
    expect(version).toBe(1);
  });

  test('Should be able to open a database and add data to the store.', async () => {
    const db = idb.open('testdb');
    expect(db).toBeInstanceOf(idb.Idb);
    const store1 = db.objectStore('store1');
    const store2 = db.objectStore('store2');
    expect(store1).toBeInstanceOf(idb.IdbStore);
    expect(store2).toBeInstanceOf(idb.IdbStore);
    const [result11, result12, result21, result22] = await Promise.all([
      store1.add('value11', 'key11'),
      store1.add('value12', 'key12'),
      store2.add('value21', 'key21'),
      store2.add('value22', 'key22'),
    ]);
    expect(result11).toBe('key11');
    expect(result12).toBe('key12');
    expect(result21).toBe('key21');
    expect(result22).toBe('key22');
    await db.deleteDatabase();
  });
});

describe('Store test', () => {
  beforeEach(async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const store2 = db.objectStore('store2');
    await Promise.all([
      store1.add('value11', 'key11'),
      store1.add('value12', 'key12'),
      store2.add('value21', 'key21'),
      store2.add('value22', 'key22'),
    ]);
  });

  afterEach(async () => {
    const db = idb.open('testdb');
    await db.deleteDatabase();
  });

  test('Existing keys should not be able to be added.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    try {
      await store1.add('value13', 'key11');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  test('Existing keys should be able to be put.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    await store1.put('value13', 'key11');
  });

  test('Should be possible to retrieve a value from a key that exists.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const value11 = await store1.get('key11');
    expect(value11).toBe('value11');
  });

  test('Should be delete.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    await store1.delete('key11');
    const value11 = await store1.get('key11');
    expect(value11).toBeUndefined();
  });

  test('Should be count.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const num = await store1.count();
    expect(num).toBe(2);
  });

  test('Should be getAll.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = await store1.getAll();
    expect(result).toStrictEqual(['value11', 'value12']);
  });

  test('Should be getAllKeys.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = await store1.getAllKeys();
    expect(result).toStrictEqual(['key11', 'key12']);
  });

  test('Should be getKey.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const range = IDBKeyRange.upperBound('key12');
    const result = await store1.getKey(range);
    expect(result).toBe('key11');
  });

  test('Should be openCursor.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = [];
    for await (const cursor of store1.openCursor()) {
      result.push(cursor.value);
      cursor.continue();
    }
    expect(result).toStrictEqual(['value11', 'value12']);
  });

  test('Should be openKeyCursor.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = [];
    for await (const cursor of store1.openKeyCursor()) {
      result.push(cursor.key);
      cursor.continue();
    }
    expect(result).toStrictEqual(['key11', 'key12']);
  });

  test('Should be clear.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    await store1.clear();
    const [result1, result2] = await Promise.all([
      store1.get('key11'),
      store1.get('key12'),
    ]);
    expect(result1).toBeUndefined();
    expect(result2).toBeUndefined();
  });

  test('Should be deleteObjectStore.', async () => {
    const db = idb.open('testdb');
    await db.deleteObjectStore('store1');
  });
});

describe('Index test', () => {
  beforeEach(async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1', { keyPath: 'testkey' }, [
      { name: 'testindex', keyPath: 'test.index' },
    ]);
    await Promise.all([
      store1.add({ testkey: 1, test: { index: 'a' } }),
      store1.add({ testkey: 2, test: { index: 'b' } }),
    ]);
  });

  afterEach(async () => {
    const db = idb.open('testdb');
    await db.deleteDatabase();
  });

  test('Should be get.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const index = store1.index('testindex');
    const [value1, value2] = await Promise.all([
      index.get('a'),
      index.get('b'),
    ]);
    expect(value1).toStrictEqual({ testkey: 1, test: { index: 'a' } });
    expect(value2).toStrictEqual({ testkey: 2, test: { index: 'b' } });
  });
});
