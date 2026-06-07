import express from 'express';

export function createRoutes(p2pNode, syncManager, wsManager) {
  const router = express.Router();

  router.get('/node/info', (req, res) => {
    res.json({
      nodeId: p2pNode.getNodeId(),
      multiaddrs: p2pNode.getMultiaddrs(),
      protocol: p2pNode.protocol,
      topic: p2pNode.topic
    });
  });

  router.get('/node/peers', async (req, res) => {
    try {
      const peers = await p2pNode.getPeers();
      const dhtPeers = await p2pNode.getDHTPeers();
      
      res.json({
        connectedPeers: peers,
        dhtPeers
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/node/topology', async (req, res) => {
    try {
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

      res.json({
        nodes,
        edges,
        localNodeId
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/config', (req, res) => {
    res.json(syncManager.getConfig());
  });

  router.put('/config', (req, res) => {
    try {
      const newConfig = req.body;
      const changes = syncManager.updateConfig(newConfig);
      
      res.json({
        success: true,
        changes,
        config: syncManager.getConfig()
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/config/key/:path', (req, res) => {
    const value = syncManager.getKey(req.params.path);
    res.json({ path: req.params.path, value });
  });

  router.put('/config/key/:path', (req, res) => {
    try {
      const { path } = req.params;
      const { value } = req.body;
      
      const change = syncManager.updateKey(path, value);
      
      res.json({
        success: true,
        change,
        config: syncManager.getConfig()
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.delete('/config/key/:path', (req, res) => {
    try {
      const { path } = req.params;
      
      const success = syncManager.deleteKey(path);
      
      res.json({
        success,
        config: syncManager.getConfig()
      });
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  });

  router.get('/config/history', (req, res) => {
    const limit = parseInt(req.query.limit) || 100;
    const history = syncManager.getHistory(limit);
    res.json({ history });
  });

  router.get('/config/crdt', (req, res) => {
    res.json(syncManager.getCRDTState());
  });

  router.post('/sync/peer/:peerId', async (req, res) => {
    try {
      const { peerId } = req.params;
      const success = await syncManager.syncWithPeer(peerId);
      
      res.json({
        success,
        peerId,
        config: syncManager.getConfig()
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.post('/sync/all', async (req, res) => {
    try {
      const results = await syncManager.syncWithAllPeers();
      
      res.json({
        success: true,
        results,
        config: syncManager.getConfig()
      });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  router.get('/ws/clients', (req, res) => {
    res.json({
      count: wsManager.getClientCount(),
      clients: wsManager.getConnectedClients()
    });
  });

  router.get('/health', (req, res) => {
    res.json({
      status: 'healthy',
      nodeId: p2pNode.getNodeId(),
      peerCount: p2pNode.node.getPeers().length,
      wsClientCount: wsManager.getClientCount()
    });
  });

  return router;
}
