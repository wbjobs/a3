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

export default api;
