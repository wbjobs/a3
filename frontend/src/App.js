import React, { useEffect, useState, useCallback } from 'react';
import './App.css';
import { Server, Wifi, WifiOff } from './components/Icons';
import NodeTopology from './components/NodeTopology';
import ConfigEditor from './components/ConfigEditor';
import ConfigHistory from './components/ConfigHistory';
import { nodeApi } from './services/api';
import { wsService } from './services/websocket';

function App() {
  const [nodeInfo, setNodeInfo] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const [peerCount, setPeerCount] = useState(0);

  const showToast = useCallback(({ type, message }) => {
    setToast({ type, message, id: Date.now() });
    setTimeout(() => {
      setToast(prev => prev && prev.id === Date.now() ? null : prev);
    }, 3000);
  }, []);

  useEffect(() => {
    fetchNodeInfo();
    connectWebSocket();

    return () => {
      wsService.disconnect();
    };
  }, []);

  const fetchNodeInfo = async () => {
    try {
      const response = await nodeApi.getInfo();
      setNodeInfo(response.data);
    } catch (e) {
      console.error('Error fetching node info:', e);
    }
  };

  const connectWebSocket = async () => {
    try {
      await wsService.connect();
      setWsConnected(true);
      
      wsService.on('connected', () => {
        setWsConnected(true);
        wsService.requestTopology();
        wsService.requestConfig();
        wsService.requestHistory(100);
      });
      
      wsService.on('disconnected', () => {
        setWsConnected(false);
      });

      wsService.on('peer-connected', (data) => {
        showToast({
          type: 'info',
          message: `Peer connected: ${data.peerId.slice(0, 12)}...`
        });
        setPeerCount(prev => prev + 1);
      });

      wsService.on('peer-disconnected', (data) => {
        showToast({
          type: 'info',
          message: `Peer disconnected: ${data.peerId.slice(0, 12)}...`
        });
        setPeerCount(prev => Math.max(0, prev - 1));
      });
    } catch (e) {
      console.error('Error connecting WebSocket:', e);
      setWsConnected(false);
    }
  };

  const handleToast = useCallback(({ type, message }) => {
    showToast({ type, message });
  }, [showToast]);

  return (
    <div className="app">
      <header className="app-header">
        <div className="header-left">
          <div className="logo">
            <Server size={24} color="white" />
          </div>
          <div>
            <div className="header-title">P2P Config Sync</div>
            <div className="header-subtitle">
              Decentralized JSON Configuration Synchronization
            </div>
          </div>
        </div>
        <div className="header-right">
          <div className="status-indicator">
            <span className={`status-dot ${wsConnected ? '' : 'error'}`} />
            {wsConnected ? (
              <>
                <Wifi size={16} style={{ color: '#22c55e' }} />
                <span style={{ color: '#22c55e' }}>Live</span>
              </>
            ) : (
              <>
                <WifiOff size={16} style={{ color: '#ef4444' }} />
                <span style={{ color: '#ef4444' }}>Disconnected</span>
              </>
            )}
          </div>
          {nodeInfo && (
            <div className="node-id" title={nodeInfo.nodeId}>
              ID: {nodeInfo.nodeId.slice(0, 16)}...
            </div>
          )}
        </div>
      </header>

      <main className="app-main">
        <NodeTopology />
        <ConfigEditor onToast={handleToast} />
        <ConfigHistory />
      </main>

      {toast && (
        <div className={`toast ${toast.type}`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

export default App;
