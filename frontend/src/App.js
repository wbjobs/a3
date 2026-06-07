import React, { useEffect, useState, useCallback } from 'react';
import './App.css';
import { Server, Wifi, WifiOff, AlertTriangle, Camera, Rss, GitBranch } from './components/Icons';
import NodeTopology from './components/NodeTopology';
import ConfigEditor from './components/ConfigEditor';
import ConfigHistory from './components/ConfigHistory';
import SnapshotManager from './components/SnapshotManager';
import SubscriptionManager from './components/SubscriptionManager';
import ConflictResolver from './components/ConflictResolver';
import { nodeApi } from './services/api';
import { wsService } from './services/websocket';

const TABS = [
  { id: 'editor', label: 'Editor', icon: GitBranch },
  { id: 'snapshots', label: 'Snapshots', icon: Camera },
  { id: 'subscriptions', label: 'Subscriptions', icon: Rss },
  { id: 'conflicts', label: 'Conflicts', icon: AlertTriangle },
  { id: 'history', label: 'History', icon: GitBranch },
  { id: 'topology', label: 'Topology', icon: Server },
];

function App() {
  const [nodeInfo, setNodeInfo] = useState(null);
  const [wsConnected, setWsConnected] = useState(false);
  const [toast, setToast] = useState(null);
  const [peerCount, setPeerCount] = useState(0);
  const [activeTab, setActiveTab] = useState('editor');
  const [conflictCount, setConflictCount] = useState(0);

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
        wsService.requestSnapshots();
        wsService.requestSubscriptions();
        wsService.requestConflicts();
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

      wsService.on('conflict-detected', (data) => {
        showToast({
          type: 'warning',
          message: `New conflict detected: ${data.conflict?.key}`
        });
        setConflictCount(prev => prev + 1);
      });

      wsService.on('conflict-resolved', (data) => {
        showToast({
          type: 'success',
          message: `Conflict resolved: ${data.conflict?.key}`
        });
        setConflictCount(prev => Math.max(0, prev - 1));
      });

      wsService.on('snapshot-created', (data) => {
        showToast({
          type: 'success',
          message: `Snapshot created: ${data.snapshot?.name}`
        });
      });

      wsService.on('snapshot-rolled-back', (data) => {
        showToast({
          type: 'info',
          message: `Rolled back to: ${data.snapshotName}`
        });
      });

      wsService.on('subscription-created', (data) => {
        showToast({
          type: 'success',
          message: `Subscribed to ${data.peerId?.slice(0, 12)}...`
        });
      });
    } catch (e) {
      console.error('Error connecting WebSocket:', e);
      setWsConnected(false);
    }
  };

  const handleToast = useCallback(({ type, message }) => {
    showToast({ type, message });
  }, [showToast]);

  const handleConflictCountChange = useCallback((count) => {
    setConflictCount(count);
  }, []);

  const renderTabContent = () => {
    switch (activeTab) {
      case 'editor':
        return <ConfigEditor onToast={handleToast} />;
      case 'snapshots':
        return <SnapshotManager onToast={handleToast} />;
      case 'subscriptions':
        return <SubscriptionManager onToast={handleToast} />;
      case 'conflicts':
        return (
          <ConflictResolver 
            onToast={handleToast} 
            onConflictCountChange={handleConflictCountChange}
          />
        );
      case 'history':
        return <ConfigHistory />;
      case 'topology':
        return <NodeTopology />;
      default:
        return <ConfigEditor onToast={handleToast} />;
    }
  };

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
          {conflictCount > 0 && (
            <div className="conflict-badge" title={`${conflictCount} unresolved conflicts`}>
              <AlertTriangle size={16} style={{ color: '#f59e0b' }} />
              <span>{conflictCount}</span>
            </div>
          )}
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

      <nav className="app-tabs">
        {TABS.map(tab => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          const showBadge = tab.id === 'conflicts' && conflictCount > 0;
          
          return (
            <button
              key={tab.id}
              className={`tab-btn ${isActive ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={16} />
              <span>{tab.label}</span>
              {showBadge && (
                <span className="tab-badge">{conflictCount}</span>
              )}
            </button>
          );
        })}
      </nav>

      <main className="app-main">
        {renderTabContent()}
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
