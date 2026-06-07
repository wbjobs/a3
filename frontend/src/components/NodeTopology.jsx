import React, { useEffect, useRef, useState } from 'react';
import { Network } from 'vis-network/standalone/esm/vis-network';
import { RefreshCw, Network as NetworkIcon } from './Icons';
import { nodeApi } from '../services/api';
import { wsService } from '../services/websocket';

export default function NodeTopology() {
  const containerRef = useRef(null);
  const networkRef = useRef(null);
  const [loading, setLoading] = useState(true);
  const [topology, setTopology] = useState({ nodes: [], edges: [] });
  const [peerCount, setPeerCount] = useState(0);

  useEffect(() => {
    fetchTopology();
    
    const unsubscribe1 = wsService.on('topology-update', (data) => {
      if (data && data.nodes) {
        setTopology(data);
        setPeerCount(data.nodes.length - 1);
        setLoading(false);
      }
    });

    const unsubscribe2 = wsService.on('peer-connected', () => {
      wsService.requestTopology();
    });

    const unsubscribe3 = wsService.on('peer-disconnected', () => {
      wsService.requestTopology();
    });

    const interval = setInterval(() => {
      if (wsService.isConnected()) {
        wsService.requestTopology();
      }
    }, 10000);

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
      clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (containerRef.current && topology.nodes.length > 0) {
      const nodes = topology.nodes.map(node => ({
        id: node.id,
        label: node.label,
        color: {
          background: node.color,
          border: node.isLocal ? '#22c55e' : '#3b82f6',
          highlight: {
            background: node.color,
            border: node.isLocal ? '#4ade80' : '#60a5fa'
          }
        },
        font: {
          color: '#f1f5f9',
          size: 12,
          face: 'Courier New'
        },
        shape: 'dot',
        size: node.isLocal ? 30 : 25,
        borderWidth: node.isLocal ? 3 : 2,
        shadow: {
          enabled: true,
          color: node.isLocal ? 'rgba(34, 197, 94, 0.3)' : 'rgba(59, 130, 246, 0.3)',
          size: 15
        },
        title: node.isLocal ? 'Local Node' : `Peer: ${node.id}`
      }));

      const edges = topology.edges.map(edge => ({
        from: edge.from,
        to: edge.to,
        color: {
          color: edge.color || '#475569',
          highlight: '#60a5fa'
        },
        width: 2,
        smooth: {
          enabled: true,
          type: 'dynamic'
        },
        shadow: {
          enabled: true,
          color: 'rgba(144, 202, 249, 0.2)'
        }
      }));

      const data = { nodes, edges };
      const options = {
        nodes: {
          shape: 'dot'
        },
        edges: {
          arrows: {
            to: { enabled: false }
          }
        },
        physics: {
          enabled: true,
          barnesHut: {
            gravitationalConstant: -3000,
            centralGravity: 0.3,
            springLength: 150,
            springConstant: 0.04,
            damping: 0.09
          },
          stabilization: {
            enabled: true,
            iterations: 1000
          }
        },
        interaction: {
          hover: true,
          tooltipDelay: 200,
          hideEdgesOnDrag: false,
          hideNodesOnDrag: false
        },
        layout: {
          improvedLayout: true
        }
      };

      if (networkRef.current) {
        networkRef.current.setData(data);
      } else {
        networkRef.current = new Network(containerRef.current, data, options);
        
        networkRef.current.on('stabilizationIterationsDone', () => {
          setLoading(false);
        });
      }
    }
  }, [topology]);

  const fetchTopology = async () => {
    setLoading(true);
    try {
      const response = await nodeApi.getTopology();
      setTopology(response.data);
      setPeerCount(response.data.nodes.length - 1);
    } catch (e) {
      console.error('Error fetching topology:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (wsService.isConnected()) {
      wsService.requestTopology();
    } else {
      fetchTopology();
    }
  };

  return (
    <div className="card topology-section">
      <div className="card-header">
        <div className="card-title">
          <NetworkIcon size={20} />
          <span>P2P Network Topology</span>
          <span className="sync-status">
            {peerCount} peer{peerCount !== 1 ? 's' : ''} connected
          </span>
        </div>
        <div className="card-actions">
          <button className="btn btn-secondary" onClick={handleRefresh}>
            <RefreshCw size={16} className={loading ? 'spinner' : ''} />
            Refresh
          </button>
        </div>
      </div>
      <div className="card-content">
        <div className="topology-container">
          <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
          {loading && topology.nodes.length === 0 && (
            <div className="topology-loading">
              <div className="empty-state">
                <div className="empty-icon">🔄</div>
                <div>Loading network topology...</div>
              </div>
            </div>
          )}
        </div>
        <div className="peer-info" style={{ marginTop: '1rem' }}>
          <div className="peer-badge">
            <span className="peer-dot" style={{ background: '#22c55e' }} />
            Local Node
          </div>
          {topology.nodes.filter(n => !n.isLocal).map(node => (
            <div className="peer-badge" key={node.id}>
              <span className="peer-dot" />
              {node.id.slice(0, 12)}...
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
