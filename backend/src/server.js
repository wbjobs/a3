if (typeof Promise.withResolvers !== 'function') {
  Promise.withResolvers = function() {
    let resolve, reject;
    const promise = new Promise((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  };
}

import express from 'express';
import cors from 'cors';
import http from 'http';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';

import { createP2PNode } from './p2p/node.js';
import { ConfigSyncManager } from './sync/ConfigSyncManager.js';
import { WebSocketManager } from './api/WebSocketManager.js';
import { createRoutes } from './api/routes.js';

const argv = yargs(hideBin(process.argv))
  .option('port', {
    type: 'number',
    default: 3001,
    description: 'HTTP server port'
  })
  .option('p2p-port', {
    type: 'number',
    default: 4001,
    description: 'P2P port'
  })
  .option('bootstrap', {
    type: 'array',
    default: [],
    description: 'Bootstrap peer multiaddrs'
  })
  .option('peer', {
    type: 'boolean',
    default: false,
    description: 'Connect to local bootstrap peer'
  })
  .parse();

async function main() {
  const httpPort = argv.port;
  const p2pPort = argv['p2p-port'];
  
  let bootstrapPeers = argv.bootstrap;
  
  if (argv.peer && bootstrapPeers.length === 0) {
    bootstrapPeers = ['/ip4/127.0.0.1/tcp/4001/p2p/QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa'];
  }

  if (bootstrapPeers.length > 0 && bootstrapPeers[0].includes('QmQCU2EcMqAqQPR2i9bChDtGNJchTbq5TbXJJ16u19uLTa')) {
    console.log('[WARN] Using placeholder bootstrap peer ID. For real network connectivity, specify valid bootstrap peers with --bootstrap flag.');
    console.log('[INFO] When --peer flag is used without --bootstrap, it attempts to connect to a local node on port 4001.');
    console.log('[INFO] For public DHT connectivity, run without --peer flag to use default bootstrap nodes.');
  }

  console.log('='.repeat(60));
  console.log('P2P Config Sync Backend');
  console.log('='.repeat(60));
  console.log(`HTTP Port: ${httpPort}`);
  console.log(`P2P Port: ${p2pPort}`);
  console.log(`Bootstrap Peers: ${bootstrapPeers.length > 0 ? bootstrapPeers.join(', ') : 'none'}`);
  console.log('='.repeat(60));

  console.log('\n[1/4] Creating libp2p node...');
  const p2pNode = await createP2PNode({
    p2pPort,
    bootstrapPeers,
    enableMdns: true,
    enableDHT: true
  });

  console.log(`Node ID: ${p2pNode.getNodeId()}`);
  console.log('Listening on:');
  p2pNode.getMultiaddrs().forEach(addr => console.log(`  ${addr}`));

  console.log('\n[2/4] Creating config sync manager...');
  const syncManager = new ConfigSyncManager(p2pNode, p2pNode.getNodeId());

  console.log('\n[3/4] Starting Express server...');
  const app = express();
  const server = http.createServer(app);

  app.use(cors());
  app.use(express.json({ limit: '10mb' }));

  console.log('\n[4/4] Setting up WebSocket server...');
  const wsManager = new WebSocketManager(server);

  const apiRoutes = createRoutes(p2pNode, syncManager, wsManager);
  app.use('/api', apiRoutes);

  app.get('/', (req, res) => {
    res.json({
      name: 'P2P Config Sync Backend',
      version: '1.0.0',
      endpoints: {
        nodeInfo: 'GET /api/node/info',
        peers: 'GET /api/node/peers',
        topology: 'GET /api/node/topology',
        config: 'GET /api/config',
        updateConfig: 'PUT /api/config',
        history: 'GET /api/config/history',
        sync: 'POST /api/sync/all',
        health: 'GET /api/health'
      },
      websocket: 'ws://localhost:' + httpPort
    });
  });

  syncManager.onChange((change) => {
    wsManager.broadcast({
      type: 'config-change',
      payload: {
        change,
        config: syncManager.getConfig()
      }
    });
  });

  p2pNode.on('peerConnected', (peerId) => {
    wsManager.broadcast({
      type: 'peer-connected',
      payload: { peerId }
    });
  });

  p2pNode.on('peerDisconnected', (peerId) => {
    wsManager.broadcast({
      type: 'peer-disconnected',
      payload: { peerId }
    });
  });

  wsManager.on('request-topology', async (clientId) => {
    const peers = await p2pNode.getPeers();
    const localNodeId = p2pNode.getNodeId();
    
    const nodes = [
      {
        id: localNodeId,
        label: `Local Node\n${localNodeId.slice(0, 8)}...`,
        isLocal: true,
        color: '#4CAF50'
      },
      ...peers.map(peer => ({
        id: peer.id,
        label: `Peer\n${peer.id.slice(0, 8)}...`,
        isLocal: false,
        connectedAt: peer.connectedAt,
        color: '#2196F3'
      }))
    ];

    const edges = peers.map(peer => ({
      from: localNodeId,
      to: peer.id,
      color: '#90CAF9'
    }));

    wsManager.sendToClient(clientId, {
      type: 'topology-update',
      payload: { nodes, edges }
    });
  });

  wsManager.on('request-config', (clientId) => {
    wsManager.sendToClient(clientId, {
      type: 'config-update',
      payload: {
        config: syncManager.getConfig()
      }
    });
  });

  wsManager.on('request-history', (clientId, payload) => {
    const limit = payload?.limit || 100;
    wsManager.sendToClient(clientId, {
      type: 'history-update',
      payload: {
        history: syncManager.getHistory(limit)
      }
    });
  });

  server.listen(httpPort, () => {
    console.log('\n' + '='.repeat(60));
    console.log(`Server running on http://localhost:${httpPort}`);
    console.log(`WebSocket: ws://localhost:${httpPort}`);
    console.log('='.repeat(60));
    console.log('\nTo start another node for testing:');
    console.log(`  npm run node2`);
    console.log('\nOr manually:');
    console.log(`  node src/server.js --peer --port 3002 --p2p-port 4002`);
    console.log('='.repeat(60));
  });

  async function shutdown() {
    console.log('\n\nShutting down...');
    try {
      await p2pNode.node.stop();
      wsManager.close();
      server.close();
      console.log('Shutdown complete');
      process.exit(0);
    } catch (e) {
      console.error('Error during shutdown:', e);
      process.exit(1);
    }
  }

  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
