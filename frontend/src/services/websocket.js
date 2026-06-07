const WS_URL = process.env.REACT_APP_WS_URL || 'ws://localhost:3001';

export class WebSocketService {
  constructor() {
    this.ws = null;
    this.listeners = new Map();
    this.reconnectInterval = 3000;
    this.shouldReconnect = true;
    this.clientId = null;
  }

  connect() {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(WS_URL);

        this.ws.onopen = () => {
          console.log('[WS] Connected');
          this.notifyListeners('connected', { clientId: this.clientId });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            
            if (data.type === 'connected') {
              this.clientId = data.clientId;
              console.log(`[WS] Client ID: ${this.clientId}`);
            }
            
            this.notifyListeners(data.type, data.payload);
          } catch (e) {
            console.error('[WS] Error parsing message:', e);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[WS] Error:', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[WS] Disconnected');
          this.notifyListeners('disconnected', null);
          
          if (this.shouldReconnect) {
            console.log(`[WS] Reconnecting in ${this.reconnectInterval}ms...`);
            setTimeout(() => this.connect(), this.reconnectInterval);
          }
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  disconnect() {
    this.shouldReconnect = false;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  send(type, payload = {}) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, payload }));
    }
  }

  requestTopology() {
    this.send('request-topology');
  }

  requestConfig() {
    this.send('request-config');
  }

  requestHistory(limit = 100) {
    this.send('request-history', { limit });
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
    
    return () => this.off(event, callback);
  }

  off(event, callback) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).delete(callback);
    }
  }

  notifyListeners(event, payload) {
    if (this.listeners.has(event)) {
      this.listeners.get(event).forEach(callback => {
        try {
          callback(payload);
        } catch (e) {
          console.error(`[WS] Error in listener for ${event}:`, e);
        }
      });
    }
  }

  isConnected() {
    return this.ws && this.ws.readyState === WebSocket.OPEN;
  }
}

export const wsService = new WebSocketService();
