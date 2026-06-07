import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { mplex } from '@libp2p/mplex';
import { kadDHT } from '@libp2p/kad-dht';
import { mdns } from '@libp2p/mdns';
import { gossipsub } from '@chainsafe/libp2p-gossipsub';
import { bootstrap } from '@libp2p/bootstrap';
import { fromString as uint8ArrayFromString } from 'uint8arrays/from-string';
import { toString as uint8ArrayToString } from 'uint8arrays/to-string';

const CONFIG_SYNC_PROTOCOL = '/p2p-config-sync/1.0.0';
const CONFIG_TOPIC = 'p2p-config-sync';

export async function createP2PNode(options = {}) {
  const {
    p2pPort = 4001,
    bootstrapPeers = [],
    enableMdns = true,
    enableDHT = true
  } = options;

  const peerDiscovery = [];

  if (bootstrapPeers.length > 0) {
    peerDiscovery.push(bootstrap({ list: bootstrapPeers }));
  }

  if (enableMdns) {
    peerDiscovery.push(mdns({
      interval: 2000
    }));
  }

  const dhtConfig = enableDHT ? {
    dht: kadDHT({
      clientMode: false,
      kBucketSize: 20,
      enabled: true
    })
  } : {};

  const node = await createLibp2p({
    addresses: {
      listen: [
        `/ip4/0.0.0.0/tcp/${p2pPort}`,
        `/ip4/0.0.0.0/tcp/${parseInt(p2pPort) + 1}/ws`
      ]
    },
    transports: [
      tcp(),
      webSockets()
    ],
    connectionEncryption: [
      noise()
    ],
    streamMuxers: [
      mplex()
    ],
    peerDiscovery,
    services: {
      pubsub: gossipsub({
        allowPublishToZeroPeers: true,
        emitSelf: true
      }),
      ...dhtConfig
    },
    connectionManager: {
      minConnections: 1,
      maxConnections: 50
    }
  });

  const peers = new Map();
  const listeners = {
    peerConnected: [],
    peerDisconnected: [],
    messageReceived: []
  };

  node.addEventListener('peer:discovery', (evt) => {
    const peerId = evt.detail.id.toString();
    console.log(`[P2P] Discovered peer: ${peerId}`);
  });

  node.addEventListener('peer:connect', (evt) => {
    const peerId = evt.detail.remotePeer.toString();
    console.log(`[P2P] Connected to peer: ${peerId}`);
    peers.set(peerId, { connectedAt: Date.now() });
    listeners.peerConnected.forEach(cb => cb(peerId));
  });

  node.addEventListener('peer:disconnect', (evt) => {
    const peerId = evt.detail.remotePeer.toString();
    console.log(`[P2P] Disconnected from peer: ${peerId}`);
    peers.delete(peerId);
    listeners.peerDisconnected.forEach(cb => cb(peerId));
  });

  node.services.pubsub.addEventListener('message', (evt) => {
    const message = evt.detail;
    if (message.topic === CONFIG_TOPIC) {
      try {
        const data = JSON.parse(uint8ArrayToString(message.data));
        const from = message.from.toString();
        console.log(`[P2P] Received message on ${CONFIG_TOPIC} from ${from}`);
        listeners.messageReceived.forEach(cb => cb(data, from));
      } catch (e) {
        console.error('[P2P] Error parsing message:', e);
      }
    }
  });

  async function sendMessage(data) {
    const message = uint8ArrayFromString(JSON.stringify(data));
    await node.services.pubsub.publish(CONFIG_TOPIC, message);
  }

  async function subscribe(topic = CONFIG_TOPIC) {
    await node.services.pubsub.subscribe(topic);
    console.log(`[P2P] Subscribed to topic: ${topic}`);
  }

  async function getPeers() {
    const peersList = [];
    const connectedPeers = node.getPeers();
    
    for (const peerId of connectedPeers) {
      const peerStr = peerId.toString();
      const addr = peers.get(peerStr);
      peersList.push({
        id: peerStr,
        connectedAt: addr?.connectedAt,
        isConnected: true
      });
    }
    
    return peersList;
  }

  async function getDHTPeers() {
    if (!node.services.dht) return [];
    
    const peers = [];
    for await (const peer of node.services.dht.getClosestPeers(uint8ArrayFromString('p2p-config-sync'))) {
      peers.push(peer.id.toString());
    }
    return peers;
  }

  function on(event, callback) {
    if (listeners[event]) {
      listeners[event].push(callback);
    }
  }

  function off(event, callback) {
    if (listeners[event]) {
      const idx = listeners[event].indexOf(callback);
      if (idx > -1) {
        listeners[event].splice(idx, 1);
      }
    }
  }

  async function requestFullSync(peerId) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Sync request timed out')), 10000);
      
      const handler = async ({ stream }) => {
        try {
          const buffer = [];
          for await (const chunk of stream.source) {
            buffer.push(chunk);
          }
          const data = uint8ArrayToString(Buffer.concat(buffer));
          clearTimeout(timeout);
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      };

      node.handle(`${CONFIG_SYNC_PROTOCOL}/sync-request`, handler, { maxInboundStreams: 10 });
      
      node.dialProtocol(peerId, `${CONFIG_SYNC_PROTOCOL}/sync-request`).catch(reject);
    });
  }

  async function provideConfig(contentId) {
    if (!node.services.dht) return;
    try {
      const cid = uint8ArrayFromString(contentId);
      await node.services.dht.provide(cid);
      console.log(`[P2P] Provided content: ${contentId}`);
    } catch (e) {
      console.error('[P2P] Error providing content:', e);
    }
  }

  async function findProviders(contentId) {
    if (!node.services.dht) return [];
    
    const providers = [];
    try {
      const cid = uint8ArrayFromString(contentId);
      for await (const provider of node.services.dht.findProviders(cid)) {
        providers.push(provider.id.toString());
      }
    } catch (e) {
      console.error('[P2P] Error finding providers:', e);
    }
    return providers;
  }

  function getNodeId() {
    return node.peerId.toString();
  }

  function getMultiaddrs() {
    return node.getMultiaddrs().map(ma => ma.toString());
  }

  await subscribe();

  node.handle(`${CONFIG_SYNC_PROTOCOL}/full-config`, async ({ stream, connection }) => {
    const peerId = connection.remotePeer.toString();
    console.log(`[P2P] Received full config request from ${peerId}`);
    const requestHandler = listeners.messageReceived;
    requestHandler.forEach(cb => cb({ type: 'full-config-request' }, peerId));
  });

  return {
    node,
    sendMessage,
    subscribe,
    getPeers,
    getDHTPeers,
    on,
    off,
    requestFullSync,
    provideConfig,
    findProviders,
    getNodeId,
    getMultiaddrs,
    protocol: CONFIG_SYNC_PROTOCOL,
    topic: CONFIG_TOPIC
  };
}
