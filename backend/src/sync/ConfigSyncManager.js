import { LWWJSONConfig } from '../crdt/LWWMap.js';
import { v4 as uuidv4 } from 'uuid';
import { EventEmitter } from 'events';

const DEFAULT_CONFIG = {
  editor: {
    fontSize: 14,
    fontFamily: 'Consolas, "Courier New", monospace',
    tabSize: 2,
    insertSpaces: true,
    wordWrap: 'on',
    minimap: { enabled: true },
    theme: 'dark+'
  },
  workbench: {
    colorTheme: 'Default Dark+',
    iconTheme: 'vs-seti',
    activityBar: { visible: true },
    statusBar: { visible: true }
  },
  terminal: {
    integrated: {
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      cursorBlinking: true,
      copyOnSelection: false
    }
  },
  files: {
    autoSave: 'afterDelay',
    autoSaveDelay: 1000,
    trimTrailingWhitespace: true,
    insertFinalNewline: true
  },
  extensions: {
    autoUpdate: true,
    recommendations: {
      showRecommendationsOnlyOnDemand: false
    }
  }
};

export class ConfigSyncManager extends EventEmitter {
  constructor(p2pNode, nodeId) {
    super();
    this.p2pNode = p2pNode;
    this.nodeId = nodeId;
    this.config = new LWWJSONConfig(nodeId);
    this.pendingSyncRequests = new Map();
    this.messageHandlers = new Map();
    this.snapshots = new Map();
    this.subscriptions = new Map();
    this.conflicts = new Map();
    
    this.config.setConfig(DEFAULT_CONFIG);
    
    this.setupP2PHandlers();
  }

  setupP2PHandlers() {
    this.p2pNode.on('messageReceived', async (data, from) => {
      await this.handleMessage(data, from);
    });

    this.p2pNode.on('peerConnected', async (peerId) => {
      console.log(`[Sync] New peer connected: ${peerId}, requesting full sync`);
      this.sendFullConfigRequest(peerId);
      this.sendFullConfig(peerId);
    });

    this.config.onChange((change) => {
      this.broadcastOperation(change);
    });
  }

  async handleMessage(data, from) {
    const { type, payload, requestId } = data;

    switch (type) {
      case 'operation':
        this.handleOperation(payload, from);
        break;
      case 'full-config-request':
        this.sendFullConfig(from);
        break;
      case 'full-config-response':
        this.handleFullConfigResponse(payload, from, requestId);
        break;
      case 'sync-request':
        this.handleSyncRequest(payload, from, requestId);
        break;
      case 'sync-response':
        this.handleSyncResponse(payload, from, requestId);
        break;
      default:
        console.log(`[Sync] Unknown message type: ${type}`);
    }
  }

  handleOperation(operation, from) {
    if (operation.author === this.nodeId) {
      return;
    }

    if (!this.isOperationAllowed(operation, from)) {
      console.log(`[Sync] Operation filtered by subscription: ${operation.key} from ${from}`);
      return;
    }

    console.log(`[Sync] Received operation from ${from}: ${operation.type} ${operation.key}`);
    
    const { key, value, timestamp, author } = operation;
    
    const conflict = this.detectConflict(key, null, value, author, timestamp);
    
    if (conflict) {
      console.log(`[Sync] Conflict detected for key: ${operation.key}`);
      return;
    }
    
    const applied = this.config.applyOperation(operation);
    
    if (applied) {
      console.log(`[Sync] Applied operation: ${operation.key} = ${operation.value}`);
    } else {
      console.log(`[Sync] Operation rejected (outdated): ${operation.key}`);
    }
  }

  matchNamespace(key, pattern) {
    if (pattern === '*') {
      return true;
    }
    
    const regexPattern = pattern
      .split('.')
      .map(part => part === '*' ? '[^.]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('\\.');
    
    const regex = new RegExp(`^${regexPattern}$`);
    return regex.test(key);
  }

  isOperationAllowed(operation, peerId) {
    const subscription = this.subscriptions.get(peerId);
    if (!subscription) {
      return true;
    }

    const { key } = operation;
    return subscription.namespaces.some(pattern => this.matchNamespace(key, pattern));
  }

  sendFullConfigRequest(peerId) {
    const requestId = uuidv4();
    
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingSyncRequests.delete(requestId);
        reject(new Error('Full config request timed out'));
      }, 10000);

      this.pendingSyncRequests.set(requestId, { resolve, reject, timeout });

      this.p2pNode.sendMessage({
        type: 'full-config-request',
        requestId,
        to: peerId
      });
    });
  }

  async sendFullConfig(peerId) {
    const fullConfigData = this.config.toJSON();
    
    console.log(`[Sync] Sending full config to ${peerId}`);
    
    this.p2pNode.sendMessage({
      type: 'full-config-response',
      payload: fullConfigData,
      to: peerId
    });
  }

  handleFullConfigResponse(payload, from, requestId) {
    console.log(`[Sync] Received full config from ${from}`);
    
    try {
      const otherConfig = LWWJSONConfig.fromJSON(payload, from);
      const changed = this.config.merge(otherConfig);
      
      console.log(`[Sync] Merged full config, changed: ${changed}`);
      
      if (requestId && this.pendingSyncRequests.has(requestId)) {
        const { resolve, timeout } = this.pendingSyncRequests.get(requestId);
        clearTimeout(timeout);
        this.pendingSyncRequests.delete(requestId);
        resolve(changed);
      }
    } catch (e) {
      console.error('[Sync] Error merging full config:', e);
      
      if (requestId && this.pendingSyncRequests.has(requestId)) {
        const { reject, timeout } = this.pendingSyncRequests.get(requestId);
        clearTimeout(timeout);
        this.pendingSyncRequests.delete(requestId);
        reject(e);
      }
    }
  }

  handleSyncRequest(payload, from, requestId) {
    const { since } = payload;
    
    const operations = this.config.getOperationsSince(since);
    
    this.p2pNode.sendMessage({
      type: 'sync-response',
      requestId,
      payload: { operations },
      to: from
    });
  }

  handleSyncResponse(payload, from, requestId) {
    const { operations } = payload;
    
    if (!operations || !Array.isArray(operations)) {
      return;
    }

    console.log(`[Sync] Received ${operations.length} operations from ${from}`);
    
    for (const op of operations) {
      if (op.author !== this.nodeId && this.isOperationAllowed(op, from)) {
        const { key, value, timestamp, author } = op;
        const conflict = this.detectConflict(key, null, value, author, timestamp);
        
        if (!conflict) {
          this.config.applyOperation(op);
        }
      }
    }
  }

  broadcastOperation(operation) {
    this.p2pNode.sendMessage({
      type: 'operation',
      payload: operation
    });
  }

  updateConfig(newConfig) {
    const timestamp = Date.now();
    return this.config.setConfig(newConfig, timestamp);
  }

  getConfig() {
    return this.config.getConfig();
  }

  updateKey(path, value, timestamp = Date.now()) {
    return this.config.setKey(path, value, timestamp);
  }

  deleteKey(path) {
    const timestamp = Date.now();
    return this.config.deleteKey(path, timestamp);
  }

  getKey(path) {
    return this.config.getKey(path);
  }

  getHistory(limit = 100) {
    return this.config.getChangeHistory(limit);
  }

  getFullHistory() {
    return this.config.getFullHistory();
  }

  onChange(callback) {
    return this.config.onChange(callback);
  }

  async syncWithPeer(peerId) {
    try {
      await this.sendFullConfigRequest(peerId);
      return true;
    } catch (e) {
      console.error(`[Sync] Failed to sync with peer ${peerId}:`, e);
      return false;
    }
  }

  async syncWithAllPeers() {
    const peers = await this.p2pNode.getPeers();
    const results = [];
    
    for (const peer of peers) {
      const success = await this.syncWithPeer(peer.id);
      results.push({ peerId: peer.id, success });
    }
    
    return results;
  }

  getCRDTState() {
    return this.config.toJSON();
  }

  getNodeId() {
    return this.nodeId;
  }

  createSnapshot(name, description = '') {
    const snapshot = {
      id: uuidv4(),
      name,
      description,
      config: JSON.parse(JSON.stringify(this.getConfig())),
      crdtState: this.config.toJSON(),
      createdAt: Date.now(),
      nodeId: this.nodeId
    };

    this.snapshots.set(snapshot.id, snapshot);
    this.emit('snapshot-created', snapshot);
    return snapshot;
  }

  getSnapshots() {
    return Array.from(this.snapshots.values()).sort((a, b) => b.createdAt - a.createdAt);
  }

  getSnapshot(id) {
    return this.snapshots.get(id) || null;
  }

  rollbackToSnapshot(id) {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) {
      throw new Error(`Snapshot ${id} not found`);
    }

    const previousConfig = this.getConfig();
    this.config = LWWJSONConfig.fromJSON(snapshot.crdtState, this.nodeId);
    this.config.nodeId = this.nodeId;
    
    this.config.onChange((change) => {
      this.broadcastOperation(change);
    });
    
    const rollbackInfo = {
      snapshotId: id,
      snapshotName: snapshot.name,
      previousConfig,
      newConfig: this.getConfig(),
      rolledBackAt: Date.now()
    };

    this.emit('snapshot-rolled-back', rollbackInfo);
    this.emit('config-change', { type: 'rollback', config: this.getConfig() });
    return rollbackInfo;
  }

  deleteSnapshot(id) {
    const snapshot = this.snapshots.get(id);
    if (!snapshot) {
      throw new Error(`Snapshot ${id} not found`);
    }
    this.snapshots.delete(id);
    return true;
  }

  subscribe(peerId, namespaces = ['*']) {
    if (!peerId) {
      throw new Error('peerId is required');
    }

    if (!Array.isArray(namespaces) || namespaces.length === 0) {
      throw new Error('namespaces must be a non-empty array');
    }

    const subscription = {
      peerId,
      namespaces,
      subscribedAt: Date.now()
    };

    this.subscriptions.set(peerId, subscription);
    this.emit('subscription-created', subscription);
    return subscription;
  }

  unsubscribe(peerId) {
    if (!this.subscriptions.has(peerId)) {
      throw new Error(`Subscription for peer ${peerId} not found`);
    }
    this.subscriptions.delete(peerId);
    return true;
  }

  getSubscriptions() {
    return Array.from(this.subscriptions.values());
  }

  detectConflict(key, localValue, remoteValue, remoteAuthor, remoteTimestamp) {
    const localEntry = this.config.crdt.map.get(key);
    if (!localEntry) return null;

    if (remoteTimestamp === localEntry.timestamp && 
        JSON.stringify(localEntry.value) !== JSON.stringify(remoteValue)) {
      const conflict = {
        id: uuidv4(),
        key,
        localValue: localEntry.value,
        remoteValue,
        localAuthor: localEntry.author,
        remoteAuthor,
        timestamp: remoteTimestamp,
        detectedAt: Date.now(),
        resolved: false
      };

      this.conflicts.set(conflict.id, conflict);
      this.emit('conflict-detected', conflict);
      return conflict;
    }

    return null;
  }

  getConflicts() {
    return Array.from(this.conflicts.values()).filter(c => !c.resolved);
  }

  resolveConflict(key, choice, customValue) {
    const conflict = Array.from(this.conflicts.values())
      .find(c => c.key === key && !c.resolved);
    
    if (!conflict) {
      throw new Error(`No unresolved conflict for key ${key}`);
    }

    let resolvedValue;
    switch (choice) {
      case 'local':
        resolvedValue = conflict.localValue;
        break;
      case 'remote':
        resolvedValue = conflict.remoteValue;
        break;
      case 'custom':
        if (customValue === undefined) {
          throw new Error('customValue is required for custom choice');
        }
        resolvedValue = customValue;
        break;
      default:
        throw new Error(`Invalid choice: ${choice}. Must be local, remote, or custom`);
    }

    this.updateKey(key, resolvedValue);
    
    conflict.resolved = true;
    conflict.resolvedAt = Date.now();
    conflict.resolvedBy = this.nodeId;
    conflict.resolvedChoice = choice;
    conflict.resolvedValue = resolvedValue;

    this.emit('conflict-resolved', conflict);
    return conflict;
  }

  resolveAllConflicts(choice) {
    if (!['local', 'remote'].includes(choice)) {
      throw new Error(`Invalid choice: ${choice}. Must be local or remote`);
    }

    const unresolvedConflicts = this.getConflicts();
    const results = [];

    for (const conflict of unresolvedConflicts) {
      try {
        const resolved = this.resolveConflict(conflict.key, choice);
        results.push({ key: conflict.key, success: true, conflict: resolved });
      } catch (e) {
        results.push({ key: conflict.key, success: false, error: e.message });
      }
    }

    return {
      total: unresolvedConflicts.length,
      resolved: results.filter(r => r.success).length,
      results
    };
  }
}
