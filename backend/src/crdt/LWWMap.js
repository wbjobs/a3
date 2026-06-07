import { v4 as uuidv4 } from 'uuid';

export class LWWMap {
  constructor() {
    this.map = new Map();
    this.history = [];
    this.listeners = [];
  }

  set(key, value, timestamp = Date.now(), author = 'local') {
    const existing = this.map.get(key);
    
    if (!existing || timestamp >= existing.timestamp) {
      const entry = {
        key,
        value,
        timestamp,
        author,
        operationId: uuidv4()
      };
      
      this.map.set(key, entry);
      
      const historyEntry = {
        ...entry,
        type: existing ? 'update' : 'create',
        previousValue: existing?.value
      };
      
      this.history.push(historyEntry);
      this.notifyListeners(historyEntry);
      
      return entry;
    }
    
    return null;
  }

  get(key) {
    const entry = this.map.get(key);
    return entry ? entry.value : undefined;
  }

  has(key) {
    return this.map.has(key);
  }

  delete(key, timestamp = Date.now(), author = 'local') {
    const existing = this.map.get(key);
    
    if (existing && timestamp >= existing.timestamp) {
      const entry = {
        key,
        value: null,
        timestamp,
        author,
        operationId: uuidv4()
      };
      
      this.map.set(key, { ...entry, deleted: true });
      
      const historyEntry = {
        ...entry,
        type: 'delete',
        previousValue: existing.value
      };
      
      this.history.push(historyEntry);
      this.notifyListeners(historyEntry);
      
      return true;
    }
    
    return false;
  }

  getAll() {
    const result = {};
    for (const [key, entry] of this.map.entries()) {
      if (!entry.deleted) {
        result[key] = entry.value;
      }
    }
    return result;
  }

  getAllEntries() {
    return Array.from(this.map.entries()).map(([key, entry]) => ({
      key,
      ...entry
    }));
  }

  merge(other) {
    if (!(other instanceof LWWMap)) {
      throw new Error('Can only merge with another LWWMap');
    }

    let changed = false;

    for (const [key, otherEntry] of other.map.entries()) {
      const localEntry = this.map.get(key);
      
      if (!localEntry || otherEntry.timestamp > localEntry.timestamp) {
        this.map.set(key, { ...otherEntry });
        
        const historyEntry = {
          ...otherEntry,
          type: localEntry ? (otherEntry.deleted ? 'delete' : 'update') : (otherEntry.deleted ? 'delete' : 'create'),
          previousValue: localEntry?.value,
          merged: true
        };
        
        this.history.push(historyEntry);
        this.notifyListeners(historyEntry);
        changed = true;
      } else if (otherEntry.timestamp === localEntry.timestamp && 
                 otherEntry.operationId !== localEntry.operationId) {
        if (otherEntry.author > localEntry.author) {
          this.map.set(key, { ...otherEntry });
          
          const historyEntry = {
            ...otherEntry,
            type: 'update',
            previousValue: localEntry.value,
            merged: true,
            tiebreaker: 'author-id'
          };
          
          this.history.push(historyEntry);
          this.notifyListeners(historyEntry);
          changed = true;
        }
      }
    }

    return changed;
  }

  applyOperation(operation) {
    const { key, value, timestamp, author, operationId, type } = operation;
    
    const existing = this.map.get(key);
    
    if (!existing || timestamp >= existing.timestamp) {
      const entry = {
        key,
        value,
        timestamp,
        author,
        operationId: operationId || uuidv4(),
        deleted: type === 'delete'
      };
      
      this.map.set(key, entry);
      
      const historyEntry = {
        ...entry,
        type: type || (existing ? 'update' : 'create'),
        previousValue: existing?.value
      };
      
      this.history.push(historyEntry);
      this.notifyListeners(historyEntry);
      
      return true;
    }
    
    return false;
  }

  getHistory(startIndex = 0, limit = 100) {
    const start = Math.max(0, this.history.length - limit - startIndex);
    const end = this.history.length - startIndex;
    return this.history.slice(start, end).reverse();
  }

  getFullHistory() {
    return [...this.history];
  }

  getHistoryForKey(key) {
    return this.history.filter(h => h.key === key);
  }

  onChange(callback) {
    this.listeners.push(callback);
    return () => {
      const idx = this.listeners.indexOf(callback);
      if (idx > -1) this.listeners.splice(idx, 1);
    };
  }

  notifyListeners(change) {
    this.listeners.forEach(cb => {
      try {
        cb(change);
      } catch (e) {
        console.error('Error in LWWMap change listener:', e);
      }
    });
  }

  toJSON() {
    return {
      entries: Array.from(this.map.entries()),
      history: this.history
    };
  }

  static fromJSON(json) {
    const map = new LWWMap();
    
    if (json.entries) {
      for (const [key, entry] of json.entries) {
        map.map.set(key, entry);
      }
    }
    
    if (json.history) {
      map.history = [...json.history];
    }
    
    return map;
  }

  clear() {
    this.map.clear();
    this.history = [];
  }

  get size() {
    return this.map.size;
  }

  keys() {
    return Array.from(this.map.keys()).filter(k => !this.map.get(k).deleted);
  }
}

export class LWWJSONConfig {
  constructor(nodeId) {
    this.nodeId = nodeId;
    this.crdt = new LWWMap();
    this.configName = 'settings.json';
  }

  setConfig(config, timestamp = Date.now()) {
    const flatConfig = this.flattenObject(config, '');
    const changedEntries = [];

    for (const [key, value] of Object.entries(flatConfig)) {
      const entry = this.crdt.set(key, value, timestamp, this.nodeId);
      if (entry) changedEntries.push(entry);
    }

    return changedEntries;
  }

  getConfig() {
    const all = this.crdt.getAll();
    return this.unflattenObject(all);
  }

  setKey(path, value, timestamp = Date.now()) {
    return this.crdt.set(path, value, timestamp, this.nodeId);
  }

  getKey(path) {
    return this.crdt.get(path);
  }

  deleteKey(path, timestamp = Date.now()) {
    return this.crdt.delete(path, timestamp, this.nodeId);
  }

  merge(otherConfig) {
    if (otherConfig instanceof LWWJSONConfig) {
      return this.crdt.merge(otherConfig.crdt);
    }
    return false;
  }

  applyOperation(operation) {
    return this.crdt.applyOperation(operation);
  }

  getChangeHistory(limit = 100) {
    return this.crdt.getHistory(0, limit);
  }

  getFullHistory() {
    return this.crdt.getFullHistory();
  }

  onChange(callback) {
    return this.crdt.onChange(callback);
  }

  flattenObject(obj, prefix = '') {
    const result = {};
    
    for (const [key, value] of Object.entries(obj)) {
      const fullKey = prefix ? `${prefix}.${key}` : key;
      
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        Object.assign(result, this.flattenObject(value, fullKey));
      } else {
        result[fullKey] = value;
      }
    }
    
    return result;
  }

  unflattenObject(flat) {
    const result = {};
    
    for (const [key, value] of Object.entries(flat)) {
      const keys = key.split('.');
      let current = result;
      
      for (let i = 0; i < keys.length - 1; i++) {
        const k = keys[i];
        if (!current[k]) {
          current[k] = {};
        }
        current = current[k];
      }
      
      current[keys[keys.length - 1]] = value;
    }
    
    return result;
  }

  toJSON() {
    return this.crdt.toJSON();
  }

  static fromJSON(json, nodeId) {
    const config = new LWWJSONConfig(nodeId);
    config.crdt = LWWMap.fromJSON(json);
    return config;
  }

  getOperationsSince(timestamp) {
    return this.crdt.history.filter(h => h.timestamp >= timestamp);
  }
}
