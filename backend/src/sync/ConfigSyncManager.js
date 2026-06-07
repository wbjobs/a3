import { LWWJSONConfig } from '../crdt/LWWMap.js';
import { v4 as uuidv4 } from 'uuid';

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

export class ConfigSyncManager {
  constructor(p2pNode, nodeId) {
    this.p2pNode = p2pNode;
    this.nodeId = nodeId;
    this.config = new LWWJSONConfig(nodeId);
    this.pendingSyncRequests = new Map();
    this.messageHandlers = new Map();
    
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

    console.log(`[Sync] Received operation from ${from}: ${operation.type} ${operation.key}`);
    
    const applied = this.config.applyOperation(operation);
    
    if (applied) {
      console.log(`[Sync] Applied operation: ${operation.key} = ${operation.value}`);
    } else {
      console.log(`[Sync] Operation rejected (outdated): ${operation.key}`);
    }
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
      if (op.author !== this.nodeId) {
        this.config.applyOperation(op);
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

  updateKey(path, value) {
    const timestamp = Date.now();
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
}
