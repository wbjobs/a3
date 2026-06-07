import { WebSocketServer } from 'ws';

export class WebSocketManager {
  constructor(server) {
    this.wss = new WebSocketServer({ server });
    this.clients = new Map();
    this.messageHandlers = new Map();
    
    this.setupHandlers();
  }

  setupHandlers() {
    this.wss.on('connection', (ws, req) => {
      const clientId = this.generateClientId();
      
      console.log(`[WS] New client connected: ${clientId}`);
      
      this.clients.set(clientId, {
        ws,
        id: clientId,
        connectedAt: Date.now()
      });

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleMessage(clientId, data);
        } catch (e) {
          console.error('[WS] Error parsing message:', e);
        }
      });

      ws.on('close', () => {
        console.log(`[WS] Client disconnected: ${clientId}`);
        this.clients.delete(clientId);
      });

      ws.on('error', (error) => {
        console.error(`[WS] Client error ${clientId}:`, error);
      });

      this.sendToClient(clientId, {
        type: 'connected',
        clientId
      });
    });
  }

  generateClientId() {
    return `client_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  handleMessage(clientId, data) {
    const { type, payload } = data;
    const handler = this.messageHandlers.get(type);
    
    if (handler) {
      handler(clientId, payload);
    } else {
      console.log(`[WS] No handler for message type: ${type}`);
    }
  }

  on(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  sendToClient(clientId, message) {
    const client = this.clients.get(clientId);
    if (client && client.ws.readyState === 1) {
      client.ws.send(JSON.stringify(message));
    }
  }

  broadcast(message) {
    const messageStr = JSON.stringify(message);
    for (const client of this.clients.values()) {
      if (client.ws.readyState === 1) {
        client.ws.send(messageStr);
      }
    }
  }

  broadcastToOthers(excludeClientId, message) {
    const messageStr = JSON.stringify(message);
    for (const [clientId, client] of this.clients.entries()) {
      if (clientId !== excludeClientId && client.ws.readyState === 1) {
        client.ws.send(messageStr);
      }
    }
  }

  getConnectedClients() {
    return Array.from(this.clients.keys());
  }

  getClientCount() {
    return this.clients.size;
  }

  close() {
    this.wss.close();
  }
}
