import React, { useEffect, useState } from 'react';
import { History, RefreshCw, Clock, User, GitMerge } from './Icons';
import { formatDistanceToNow } from 'date-fns';
import { configApi } from '../services/api';
import { wsService } from '../services/websocket';

export default function ConfigHistory() {
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchHistory();

    const unsubscribe1 = wsService.on('history-update', (data) => {
      if (data && data.history) {
        setHistory(data.history);
        setLoading(false);
      }
    });

    const unsubscribe2 = wsService.on('config-change', (data) => {
      if (data && data.change) {
        setHistory(prev => [data.change, ...prev].slice(0, 100));
      }
    });

    const interval = setInterval(() => {
      if (wsService.isConnected()) {
        wsService.requestHistory(100);
      }
    }, 30000);

    return () => {
      unsubscribe1();
      unsubscribe2();
      clearInterval(interval);
    };
  }, []);

  const fetchHistory = async () => {
    setLoading(true);
    try {
      const response = await configApi.getHistory(100);
      setHistory(response.data.history);
    } catch (e) {
      console.error('Error fetching history:', e);
    } finally {
      setLoading(false);
    }
  };

  const handleRefresh = () => {
    if (wsService.isConnected()) {
      wsService.requestHistory(100);
    } else {
      fetchHistory();
    }
  };

  const formatValue = (value) => {
    if (value === null || value === undefined) return 'null';
    if (typeof value === 'object') return JSON.stringify(value, null, 2);
    return String(value);
  };

  const getTypeLabel = (type) => {
    switch (type) {
      case 'create': return 'Created';
      case 'update': return 'Updated';
      case 'delete': return 'Deleted';
      default: return type;
    }
  };

  const isLocalAuthor = (author) => {
    return author.startsWith('local') || author === 'local';
  };

  return (
    <div className="card history-section">
      <div className="card-header">
        <div className="card-title">
          <History size={20} />
          <span>Config Change History</span>
          <span className="sync-status">
            {history.length} change{history.length !== 1 ? 's' : ''}
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
        {loading && history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📜</div>
            <div>Loading change history...</div>
          </div>
        ) : history.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <div>No changes yet</div>
          </div>
        ) : (
          history.map((item, index) => (
            <div
              key={item.operationId || index}
              className={`history-item ${item.type} ${item.merged ? 'merged' : ''}`}
            >
              <div className="history-header">
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span className={`history-type ${item.type}`}>
                    {getTypeLabel(item.type)}
                  </span>
                  {item.merged && (
                    <span className="history-type merged">
                      <GitMerge size={12} style={{ display: 'inline', marginRight: '4px' }} />
                      Merged
                    </span>
                  )}
                </div>
                <div className="history-time">
                  <Clock size={12} style={{ display: 'inline', marginRight: '4px' }} />
                  {formatDistanceToNow(item.timestamp, { addSuffix: true })}
                </div>
              </div>
              
              <div className="history-key">
                {item.key}
              </div>
              
              {(item.type === 'update' || item.type === 'delete') && item.previousValue !== undefined && (
                <div className="history-values">
                  <div className="history-value">
                    <div className="history-label">Previous</div>
                    <div className="history-content" style={{ background: '#1e293b' }}>
                      {formatValue(item.previousValue)}
                    </div>
                  </div>
                  {item.type !== 'delete' && (
                    <div className="history-value">
                      <div className="history-label">New</div>
                      <div className="history-content" style={{ background: '#1a2f1a' }}>
                        {formatValue(item.value)}
                      </div>
                    </div>
                  )}
                </div>
              )}
              
              {item.type === 'create' && (
                <div className="history-values">
                  <div className="history-value">
                    <div className="history-label">Value</div>
                    <div className="history-content" style={{ background: '#1a2f1a' }}>
                      {formatValue(item.value)}
                    </div>
                  </div>
                </div>
              )}
              
              <div className="history-author">
                <User size={12} style={{ display: 'inline', marginRight: '4px' }} />
                {isLocalAuthor(item.author) ? (
                  <span style={{ color: '#22c55e' }}>
                    This device ({item.author.slice(0, 12)}...)
                  </span>
                ) : (
                  <span style={{ color: '#60a5fa' }}>
                    Peer: {item.author.slice(0, 12)}...
                  </span>
                )}
                {item.tiebreaker && (
                  <span style={{ marginLeft: '0.5rem', color: '#8b5cf6' }}>
                    (Tiebreaker: {item.tiebreaker})
                  </span>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
