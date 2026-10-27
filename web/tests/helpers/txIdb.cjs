/**
 * #252: stricter in-memory IndexedDB for the B2 storage tests.
 *
 * Unlike mockIdb.cjs, a readwrite transaction is atomic: writes go to an overlay and reach the
 * database only when the transaction commits; abort() or a failure discards them all. A
 * transaction commits after the task in which its last request settled, so code that awaits
 * anything other than an IndexedDB request inside a transaction gets TransactionInactiveError,
 * as in browsers. Values are structured clones. Fault hooks let tests fail opens, writes and commits.
 */
'use strict'

const clone = value => structuredClone(value)
const macrotask = fn => setImmediate(fn)

class DOMErrorLike extends Error {
  constructor(name, message) { super(message || name); this.name = name }
}

class Request {
  constructor(source) { this.source = source; this.result = undefined; this.error = null; this.readyState = 'pending'; this.onsuccess = null; this.onerror = null }
}

class KeyRange {
  constructor(lower, upper, lowerOpen = false, upperOpen = false) { Object.assign(this, { lower, upper, lowerOpen, upperOpen }) }
  static only(value) { return new KeyRange(value, value) }
  static bound(lower, upper, lowerOpen, upperOpen) { return new KeyRange(lower, upper, lowerOpen, upperOpen) }
  static lowerBound(lower, open) { return new KeyRange(lower, undefined, open) }
  static upperBound(upper, open) { return new KeyRange(undefined, upper, false, open) }
  includes(key) {
    if (this.lower !== undefined && (this.lowerOpen ? key <= this.lower : key < this.lower)) return false
    if (this.upper !== undefined && (this.upperOpen ? key >= this.upper : key > this.upper)) return false
    return true
  }
}

const compareKeys = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

class StoreData {
  constructor(name, keyPath) { this.name = name; this.keyPath = keyPath; this.records = new Map(); this.indexes = new Map() }
}

class Index {
  constructor(store, name) { this.store = store; this.name = name }
  getAll(range) {
    return this.store._tx._request(this, () => {
      const keyPath = this.store._data.indexes.get(this.name).keyPath
      return [...this.store._view().values()]
        .filter(record => record[keyPath] !== undefined && (!range || range.includes(record[keyPath])))
        .sort((a, b) => compareKeys(a[keyPath], b[keyPath]))
        .map(clone)
    })
  }
  count(range) { return this.store._tx._request(this, () => this.getAllSync(range).length) }
  getAllSync(range) {
    const keyPath = this.store._data.indexes.get(this.name).keyPath
    return [...this.store._view().values()].filter(record => record[keyPath] !== undefined && (!range || range.includes(record[keyPath])))
  }
}

class ObjectStore {
  constructor(tx, data) { this._tx = tx; this._data = data; this.name = data.name; this.keyPath = data.keyPath }
  get indexNames() { return { contains: name => this._data.indexes.has(name), length: this._data.indexes.size } }
  createIndex(name, keyPath, options = {}) {
    if (this._tx.mode !== 'versionchange') throw new DOMErrorLike('InvalidStateError', 'createIndex outside an upgrade')
    this._data.indexes.set(name, { keyPath, unique: !!options.unique })
    return new Index(this, name)
  }
  index(name) {
    if (!this._data.indexes.has(name)) throw new DOMErrorLike('NotFoundError', `Index ${name} not found`)
    return new Index(this, name)
  }
  /** Records as this transaction sees them (committed data + its own overlay). */
  _view() {
    const view = new Map(this._data.records)
    const overlay = this._tx._overlay.get(this.name)
    if (overlay) for (const [key, value] of overlay) { if (value === DELETED) view.delete(key); else view.set(key, value) }
    return view
  }
  _write(key, value) {
    if (this._tx.mode === 'readonly') throw new DOMErrorLike('ReadOnlyError', 'readonly transaction')
    if (!this._tx._overlay.has(this.name)) this._tx._overlay.set(this.name, new Map())
    this._tx._overlay.get(this.name).set(key, value)
  }
  get(key) { return this._tx._request(this, () => { const value = this._view().get(key); return value === undefined ? undefined : clone(value) }) }
  getAll() { return this._tx._request(this, () => [...this._view().entries()].sort(([a], [b]) => compareKeys(a, b)).map(([, value]) => clone(value))) }
  getAllKeys() { return this._tx._request(this, () => [...this._view().keys()].sort(compareKeys)) }
  count() { return this._tx._request(this, () => this._view().size) }
  put(value) {
    this._tx._assertActive()
    const key = value[this.keyPath]
    if (key === undefined) throw new DOMErrorLike('DataError', 'Missing key')
    const fault = this._tx._db._factory.faults.put?.(this._tx._db.name, this.name, value)
    if (fault) { this._tx._fail(fault); throw fault }
    const stored = clone(value)
    this._tx._bytes += JSON.stringify(stored).length
    return this._tx._request(this, () => { this._write(key, stored); return key })
  }
  delete(key) { this._tx._assertActive(); return this._tx._request(this, () => { this._write(key, DELETED); return undefined }) }
  clear() {
    this._tx._assertActive()
    return this._tx._request(this, () => { for (const key of this._view().keys()) this._write(key, DELETED); return undefined })
  }
}

const DELETED = Symbol('deleted')

class Transaction {
  constructor(db, names, mode) {
    this._db = db; this.mode = mode; this._names = names
    this._overlay = new Map(); this._pending = 0; this._state = 'active'; this._bytes = 0
    this.oncomplete = null; this.onerror = null; this.onabort = null; this.error = null
    this.objectStoreNames = { contains: name => names.includes(name), length: names.length }
    db._factory.stats.transactions++
    if (mode !== 'readonly') db._factory.stats.writeTransactions++
    macrotask(() => this._maybeCommit())
  }
  objectStore(name) {
    if (!this._names.includes(name)) throw new DOMErrorLike('NotFoundError', `Store ${name} not in transaction`)
    return new ObjectStore(this, this._db._stores.get(name))
  }
  _assertActive() {
    if (this._state !== 'active') throw new DOMErrorLike('TransactionInactiveError', 'The transaction has finished.')
  }
  _request(source, run) {
    this._assertActive()
    const request = new Request(source)
    this._pending++
    queueMicrotask(() => {
      if (this._state !== 'active') return
      try { request.result = run(); request.readyState = 'done'; request.onsuccess?.({ target: request }) }
      catch (error) { request.error = error; request.readyState = 'done'; request.onerror?.({ target: request }); this._fail(error) }
      this._pending--
      macrotask(() => this._maybeCommit())
    })
    return request
  }
  _maybeCommit() {
    if (this._state !== 'active' || this._pending > 0) return
    const factory = this._db._factory
    const quota = factory.faults.quotaBytes
    if (this.mode !== 'readonly' && quota !== undefined && factory.usedBytes() + this._bytes > quota) {
      const error = new DOMErrorLike('QuotaExceededError', 'The quota has been exceeded.')
      return this._fail(error)
    }
    const fault = this.mode !== 'readonly' && factory.faults.commit?.(this._db.name, [...this._overlay.keys()])
    if (fault) return this._fail(fault)
    this._state = 'committed'
    for (const [name, overlay] of this._overlay) {
      const records = this._db._stores.get(name).records
      for (const [key, value] of overlay) { if (value === DELETED) records.delete(key); else records.set(key, value) }
    }
    if (this.mode !== 'readonly' && this._overlay.size) factory.stats.commits++
    this.oncomplete?.({ target: this })
  }
  _fail(error) {
    if (this._state !== 'active') return
    this._state = 'aborted'; this.error = error; this._overlay.clear()
    this._db._factory.stats.aborts++
    macrotask(() => { this.onerror?.({ target: this }); this.onabort?.({ target: this }) })
  }
  abort() {
    if (this._state !== 'active') throw new DOMErrorLike('InvalidStateError', 'Transaction already finished')
    this._fail(new DOMErrorLike('AbortError', 'The transaction was aborted.'))
  }
}

class Database {
  constructor(factory, name) { this._factory = factory; this.name = name; this.version = 0; this._stores = new Map(); this._closed = false; this.onversionchange = null }
  get objectStoreNames() { const names = [...this._stores.keys()]; return { contains: name => this._stores.has(name), length: names.length, item: i => names[i] } }
  createObjectStore(name, options = {}) {
    if (this._stores.has(name)) throw new DOMErrorLike('ConstraintError', `Store ${name} exists`)
    const data = new StoreData(name, options.keyPath)
    this._stores.set(name, data)
    return new ObjectStore(this._upgradeTx, data)
  }
  transaction(names, mode = 'readonly') {
    if (this._closed) throw new DOMErrorLike('InvalidStateError', 'The database connection is closing.')
    const list = Array.isArray(names) ? names : [names]
    for (const name of list) if (!this._stores.has(name)) throw new DOMErrorLike('NotFoundError', `Store ${name} not found`)
    return new Transaction(this, list, mode)
  }
  close() { this._closed = true }
}

class Factory {
  constructor() {
    this._dbs = new Map()
    this.faults = {}
    this.stats = { opens: 0, transactions: 0, writeTransactions: 0, commits: 0, aborts: 0 }
  }
  usedBytes() {
    let bytes = 0
    for (const db of this._dbs.values()) for (const store of db.stores.values()) for (const value of store.records.values()) bytes += JSON.stringify(value).length
    return bytes
  }
  databaseNames() { return [...this._dbs.keys()] }
  /** Committed records of one store, for assertions. */
  dump(dbName, storeName) {
    const db = this._dbs.get(dbName)
    return db ? [...(db.stores.get(storeName)?.records.values() ?? [])].map(clone) : []
  }
  open(name, version = 1) {
    const request = new Request(null)
    this.stats.opens++
    macrotask(() => {
      const fault = this.faults.open?.(name)
      if (fault) { request.error = fault; request.onerror?.({ target: request }); return }
      let shared = this._dbs.get(name)
      if (!shared) { shared = { version: 0, stores: new Map() }; this._dbs.set(name, shared) }
      const db = new Database(this, name)
      db._stores = shared.stores
      db.version = shared.version
      if (version < shared.version) { request.error = new DOMErrorLike('VersionError', 'Requested version is lower'); request.onerror?.({ target: request }); return }
      if (version > shared.version) {
        const tx = new Transaction(db, [], 'versionchange')
        tx._state = 'upgrading'
        db._upgradeTx = tx
        tx.objectStore = storeName => {
          const data = shared.stores.get(storeName)
          if (!data) throw new DOMErrorLike('NotFoundError', `Store ${storeName} not found`)
          return new ObjectStore(tx, data)
        }
        request.result = db
        request.transaction = tx
        try { request.onupgradeneeded?.({ target: request, oldVersion: shared.version, newVersion: version }) }
        catch (error) { request.error = error; request.onerror?.({ target: request }); return }
        shared.version = version
        db.version = version
        db._upgradeTx = null
      }
      request.result = db
      request.onsuccess?.({ target: request })
    })
    return request
  }
  deleteDatabase(name) {
    const request = new Request(null)
    macrotask(() => { this._dbs.delete(name); request.onsuccess?.({ target: request }) })
    return request
  }
}

module.exports = { Factory, KeyRange }
