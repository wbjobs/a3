import axios from 'axios';

const API_BASE_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

const api = axios.create({
  baseURL: API_BASE_URL,
  headers: {
    'Content-Type': 'application/json',
  },
});

export const nodeApi = {
  getInfo: () => api.get('/node/info'),
  getPeers: () => api.get('/node/peers'),
  getTopology: () => api.get('/node/topology'),
};

export const configApi = {
  getConfig: () => api.get('/config'),
  updateConfig: (config) => api.put('/config', config),
  getKey: (path) => api.get(`/config/key/${path}`),
  updateKey: (path, value) => api.put(`/config/key/${path}`, { value }),
  deleteKey: (path) => api.delete(`/config/key/${path}`),
  getHistory: (limit = 100) => api.get(`/config/history?limit=${limit}`),
  getCRDT: () => api.get('/config/crdt'),
};

export const syncApi = {
  syncWithPeer: (peerId) => api.post(`/sync/peer/${peerId}`),
  syncAll: () => api.post('/sync/all'),
};

export const healthApi = {
  getHealth: () => api.get('/health'),
};

export const snapshotApi = {
  createSnapshot: (name, description) => api.post('/config/snapshots', { name, description }),
  getSnapshots: () => api.get('/config/snapshots'),
  getSnapshot: (id) => api.get(`/config/snapshots/${id}`),
  rollbackToSnapshot: (id) => api.post(`/config/snapshots/${id}/rollback`),
  deleteSnapshot: (id) => api.delete(`/config/snapshots/${id}`),
};

export const subscriptionApi = {
  subscribeToPeer: (peerId, namespaces) => api.post('/subscriptions', { peerId, namespaces }),
  getSubscriptions: () => api.get('/subscriptions'),
  unsubscribeFromPeer: (peerId) => api.delete(`/subscriptions/${peerId}`),
};

export const conflictApi = {
  getConflicts: () => api.get('/conflicts'),
  resolveConflict: (key, choice, customValue) => api.post(`/conflicts/${key}/resolve`, { choice, customValue }),
  resolveAllConflicts: (choice) => api.post('/conflicts/resolve-all', { choice }),
};

export default api;
