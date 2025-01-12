# @haiix/idb

A lightweight, promise-based wrapper for IndexedDB that simplifies database operations with async/await syntax.

## Features

- 🚀 Full Promise/async-await support
- 🔒 Type-safe with TypeScript
- 💡 Intuitive API design
- 🔄 Automatic transaction management
- 📑 Support for indexes
- ⚡ Efficient cursor operations

## Installation

```bash
npm install @haiix/idb
```

## Basic Usage

```typescript
import idb from '@haiix/idb';

// Open or create a database
const db = idb.open('myDatabase');

// Create an object store
const store = db.objectStore('myStore', {
  keyPath: 'id',
  autoIncrement: true
});

// Add data
await store.add({ name: 'John', age: 30 });

// Retrieve data
const john = await store.get(1);

// Update data
await store.put({ id: 1, name: 'John', age: 31 });

// Delete data
await store.delete(1);
```

## Transaction Optimization

This library automatically optimizes database transactions by batching synchronous operations. When multiple database operations are executed using `Promise.all`, they are automatically combined into a single transaction, improving performance.

### Transaction Batching

#### Sequential Operations (Multiple Transactions)
When operations are executed sequentially with await, each operation creates its own transaction:

```typescript
// Creates TWO separate transactions
await store.add('value1', 'key1');  // Transaction #1
await store.add('value2', 'key2');  // Transaction #2
```

#### Parallel Operations (Single Transaction)
When operations are executed in parallel using Promise.all, they are automatically batched into a single transaction:

```typescript
// Creates ONE transaction for both operations
await Promise.all([
  store.add('value1', 'key1'),
  store.add('value2', 'key2')
]);
```

### Best Practices for Transaction Optimization

To make the most of transaction batching:

1. Group Related Operations:
```typescript
// Good: Single transaction
await Promise.all([
  userStore.add(userData),
  profileStore.add(profileData),
  settingsStore.add(settingsData)
]);

// Less efficient: Multiple transactions
await userStore.add(userData);
await profileStore.add(profileData);
await settingsStore.add(settingsData);
```

2. Use Promise.all for Parallel Operations:
```typescript
// Efficient batch processing
const users = [{id: 1, name: 'John'}, {id: 2, name: 'Jane'}];
await Promise.all(users.map(user => store.add(user)));
```

3. Balance Between Batching and Response Time:
```typescript
// For large datasets, consider batching in chunks
const BATCH_SIZE = 100;
const chunks = [];
for (let i = 0; i < items.length; i += BATCH_SIZE) {
  chunks.push(items.slice(i, i + BATCH_SIZE));
}

for (const chunk of chunks) {
  await Promise.all(chunk.map(item => store.add(item)));
}
```

## API Reference

[API Reference](https://github.com/haiix/idb/wiki/api_reference)

## License

MIT License - see the [LICENSE](LICENSE) file for details.