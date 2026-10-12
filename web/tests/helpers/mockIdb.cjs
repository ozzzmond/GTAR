/**
 * In-memory Mock IDBFactory implementation for Node.js test runner.
 * Implements open, object stores, indexes, key ranges, transactions, and quota error simulation.
 */

class MockIDBKeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) {
    this.lower = lower
    this.upper = upper
    this.lowerOpen = lowerOpen
    this.upperOpen = upperOpen
  }

  static only(value) {
    return new MockIDBKeyRange(value, value, false, false)
  }

  includes(key) {
    if (this.lower !== undefined) {
      if (this.lowerOpen && key <= this.lower) return false
      if (!this.lowerOpen && key < this.lower) return false
    }
    if (this.upper !== undefined) {
      if (this.upperOpen && key >= this.upper) return false
      if (!this.upperOpen && key > this.upper) return false
    }
    return true
  }
}

class MockIDBRequest {
  constructor() {
    this.result = undefined
    this.error = null
    this.onsuccess = null
    this.onerror = null
  }
}

class MockIDBIndex {
  constructor(store, name, keyPath, options = {}) {
    this.store = store
    this.name = name
    this.keyPath = keyPath
    this.unique = options.unique || false
  }

  _extractKeyValue(record) {
    if (Array.isArray(this.keyPath)) {
      return this.keyPath.map(k => record[k])
    }
    return record[this.keyPath]
  }

  getAll(range) {
    const req = new MockIDBRequest()
    queueMicrotask(() => {
      const records = Array.from(this.store.records.values())
      const matched = records.filter(r => {
        const val = this._extractKeyValue(r)
        if (range instanceof MockIDBKeyRange) {
          if (Array.isArray(this.keyPath) && Array.isArray(range.lower)) {
            return JSON.stringify(val) === JSON.stringify(range.lower)
          }
          return range.includes(val)
        }
        return true
      })
      req.result = matched
      if (req.onsuccess) req.onsuccess({ target: req })
    })
    return req
  }

  getAllKeys(range) {
    const req = new MockIDBRequest()
    queueMicrotask(() => {
      const entries = Array.from(this.store.records.entries())
      const matchedKeys = entries
        .filter(([, r]) => {
          const val = this._extractKeyValue(r)
          if (range instanceof MockIDBKeyRange) {
            return range.includes(val)
          }
          return true
        })
        .map(([k]) => k)
      req.result = matchedKeys
      if (req.onsuccess) req.onsuccess({ target: req })
    })
    return req
  }
}

class MockIDBObjectStore {
  constructor(name, keyPath, db) {
    this.name = name
    this.keyPath = keyPath
    this.db = db
    this.records = new Map() // key -> record
    this.indexes = new Map() // indexName -> MockIDBIndex
  }

  createIndex(name, keyPath, options) {
    const idx = new MockIDBIndex(this, name, keyPath, options)
    this.indexes.set(name, idx)
    return idx
  }

  index(name) {
    const idx = this.indexes.get(name)
    if (!idx) throw new Error(`Index ${name} not found`)
    return idx
  }

  put(record) {
    if (this.db._simulateQuotaError) {
      const err = new Error('QuotaExceededError')
      err.name = 'QuotaExceededError'
      throw err
    }
    const key = record[this.keyPath]
    this.records.set(key, JSON.parse(JSON.stringify(record)))
  }

  get(key) {
    const req = new MockIDBRequest()
    queueMicrotask(() => {
      req.result = this.records.get(key) ? JSON.parse(JSON.stringify(this.records.get(key))) : undefined
      if (req.onsuccess) req.onsuccess({ target: req })
    })
    return req
  }

  delete(key) {
    this.records.delete(key)
  }
}

class MockIDBTransaction {
  constructor(db, storeNames, mode) {
    this.db = db
    this.storeNames = Array.isArray(storeNames) ? storeNames : [storeNames]
    this.mode = mode
    this.oncomplete = null
    this.onerror = null
    this.onabort = null
    this.error = null

    queueMicrotask(() => {
      if (this.oncomplete) this.oncomplete()
    })
  }

  objectStore(name) {
    return this.db.stores.get(name)
  }
}

class MockIDBDatabase {
  constructor(name, version) {
    this.name = name
    this.version = version
    this.stores = new Map()
    this.objectStoreNames = {
      contains: (n) => this.stores.has(n),
    }
    this._simulateQuotaError = false
  }

  createObjectStore(name, { keyPath }) {
    const store = new MockIDBObjectStore(name, keyPath, this)
    this.stores.set(name, store)
    return store
  }

  transaction(storeNames, mode = 'readonly') {
    return new MockIDBTransaction(this, storeNames, mode)
  }

  close() {}
}

class MockIDBFactory {
  constructor() {
    this.databases = new Map() // dbName -> MockIDBDatabase
    this._simulateUnavailable = false
  }

  open(name, version = 1) {
    if (this._simulateUnavailable) {
      throw new Error('IndexedDB service is unavailable')
    }

    const req = new MockIDBRequest()
    queueMicrotask(() => {
      let db = this.databases.get(name)
      if (!db) {
        db = new MockIDBDatabase(name, version)
        this.databases.set(name, db)
        req.result = db
        if (req.onupgradeneeded) {
          req.onupgradeneeded({ target: req })
        }
      } else {
        req.result = db
      }
      if (req.onsuccess) {
        req.onsuccess({ target: req })
      }
    })
    return req
  }
}

module.exports = {
  MockIDBKeyRange,
  MockIDBFactory,
  MockIDBDatabase,
}
