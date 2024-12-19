// As of version 5, fake-indexeddb no longer includes a structuredClone polyfill.
// See: https://github.com/dumbmatter/fakeIndexedDB
import 'core-js/stable/structured-clone';
import 'fake-indexeddb/auto';
import * as idb from '../src/idb';

/* eslint max-lines-per-function: off */

describe('Basic test', () => {
  test('The default module has the open function.', () => {
    expect(idb.default.open).toBe(idb.open);
  });

  test('To get version', async () => {
    const db = idb.open('testdb');
    const version = await db.version();
    expect(version).toBe(1);
  });

  test('To open the database and add data to the object store.', async () => {
    const db = idb.open('testdb');
    expect(db).toBeInstanceOf(idb.Idb);

    const store1 = db.objectStore('store1');
    const store2 = db.objectStore('store2', {
      keyPath: 'id',
      autoIncrement: true,
    });
    expect(store1).toBeInstanceOf(idb.IdbStore);
    expect(store2).toBeInstanceOf(idb.IdbStore);

    const [result11, result12, result21, result22] = await Promise.all([
      store1.add('value11', 'key11'),
      store1.add('value12', 'key12'),
      store2.add({ value: 'value21' }),
      store2.add({ value: 'value22' }),
    ]);
    expect(result11).toBe('key11');
    expect(result12).toBe('key12');
    expect(result21).toBe(1);
    expect(result22).toBe(2);

    await db.deleteDatabase();
  });
});

describe('Store test', () => {
  beforeEach(async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const store2 = db.objectStore('store2', {
      keyPath: 'id',
      autoIncrement: true,
    });
    await Promise.all([
      store1.add('value11', 'key11'),
      store1.add('value12', 'key12'),
      store2.add({ value: 'value21' }),
      store2.add({ value: 'value22' }),
    ]);
  });

  afterEach(async () => {
    const db = idb.open('testdb');
    await db.deleteDatabase();
  });

  test('Not to add existing keys.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    try {
      await store1.add('value13', 'key11');
    } catch (error: unknown) {
      expect(error).toBeInstanceOf(Error);
    }
  });

  test('To put existing keys.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    await store1.put('value13', 'key11');
  });

  test('To retrieve values from keys that exist.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const value11 = await store1.get('key11');
    expect(value11).toBe('value11');
  });

  test('To get objectStoreNames.', async () => {
    const db = idb.open('testdb');
    const objectStoreNames = await db.objectStoreNames();
    expect(objectStoreNames).toStrictEqual(['store1', 'store2']);
  });

  test('To get autoIncrement.', async () => {
    const db = idb.open('testdb');
    const store2 = db.objectStore('store2');
    const autoIncrement = await store2.autoIncrement();
    expect(autoIncrement).toBe(true);
  });

  test('To get keyPath.', async () => {
    const db = idb.open('testdb');
    const store2 = db.objectStore('store2');
    const keyPath = await store2.keyPath();
    expect(keyPath).toBe('id');
  });

  test('To delete.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    await store1.delete('key11');
    const value11 = await store1.get('key11');
    expect(value11).toBeUndefined();
  });

  test('To count.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const num = await store1.count();
    expect(num).toBe(2);
  });

  test('To getAll.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = await store1.getAll();
    expect(result).toStrictEqual(['value11', 'value12']);
  });

  test('To getAllKeys.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = await store1.getAllKeys();
    expect(result).toStrictEqual(['key11', 'key12']);
  });

  test('To getKey.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const range = IDBKeyRange.upperBound('key12');
    const result = await store1.getKey(range);
    expect(result).toBe('key11');
  });

  test('To openCursor.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = [];
    for await (const cursor of store1.openCursor()) {
      result.push(cursor.value);
      cursor.continue();
    }
    expect(result).toStrictEqual(['value11', 'value12']);
  });

  test('To continue processing without calling cursor.continue().', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = [];
    for await (const cursor of store1.openCursor()) {
      result.push(cursor.value);
      if (result.length) {
        break;
      }
    }
    expect(result).toStrictEqual(['value11']);
  });

  test('To openKeyCursor.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const result = [];
    for await (const cursor of store1.openKeyCursor()) {
      result.push(cursor.key);
      cursor.continue();
    }
    expect(result).toStrictEqual(['key11', 'key12']);
  });

  test('To clear.', async () => {
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

  test('To deleteObjectStore.', async () => {
    const db = idb.open('testdb');
    await db.deleteObjectStore('store1');
    const objectStoreNames = await db.objectStoreNames();
    expect(objectStoreNames).toStrictEqual(['store2']);
  });

  test('DB should not be upgraded when the object store already exist.', async () => {
    const db = idb.open('testdb');
    expect(await db.version()).toBe(2);

    const store1 = db.objectStore('store1');
    const value11 = await store1.get('key11');

    expect(value11).toBe('value11');
    expect(await db.version()).toBe(2);
  });
});

describe('Index test', () => {
  beforeEach(async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1', { keyPath: 'testkey' }, [
      { name: 'index1', keyPath: 'test.index' },
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

  test('To get indexNames.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const indexNames = await store1.indexNames();
    expect(indexNames).toStrictEqual(['index1']);
  });

  test('To get multiEntry.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const index1 = store1.index('index1');
    const multiEntry = await index1.multiEntry();
    expect(multiEntry).toBe(false);
  });

  test('To get unique.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const index1 = store1.index('index1');
    const unique = await index1.unique();
    expect(unique).toBe(false);
  });

  test('To get.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    const index1 = store1.index('index1');
    const [value1, value2] = await Promise.all([
      index1.get('a'),
      index1.get('b'),
    ]);
    expect(value1).toStrictEqual({ testkey: 1, test: { index: 'a' } });
    expect(value2).toStrictEqual({ testkey: 2, test: { index: 'b' } });
  });

  test('To add indexes later.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1', null, [
      { name: 'index2', keyPath: 'test.index2' },
    ]);

    const indexNames = await store1.indexNames();
    expect(indexNames).toStrictEqual(['index1', 'index2']);

    const index2 = store1.index('index2');
    const result = await index2.getAll();
    expect(result).toStrictEqual([]);
  });

  test('To deleteIndex.', async () => {
    const db = idb.open('testdb');
    const store1 = db.objectStore('store1');
    await store1.deleteIndex('index1');
    const indexNames = await store1.indexNames();
    expect(indexNames).toStrictEqual([]);
  });

  test('DB should not be upgraded when the index already exist.', async () => {
    const db = idb.open('testdb');
    expect(await db.version()).toBe(2);

    const store1 = db.objectStore('store1', null, [
      { name: 'index1', keyPath: 'test.index' },
    ]);

    const indexNames = await store1.indexNames();
    expect(indexNames).toStrictEqual(['index1']);

    expect(await db.version()).toBe(2);
  });
});
