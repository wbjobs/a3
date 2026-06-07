import React, { useEffect, useState, useCallback } from 'react';
import { AlertTriangle, RefreshCw, Clock, User, ChevronDown, ChevronUp, Check, X, Edit3, AlertCircle } from './Icons';
import { formatDistanceToNow } from 'date-fns';
import { conflictApi } from '../services/api';
import { wsService } from '../services/websocket';

function formatValue(value) {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'object') return JSON.stringify(value, null, 2);
  return String(value);
}

function diffLines(localStr, remoteStr) {
  const localLines = localStr.split('\n');
  const remoteLines = remoteStr.split('\n');
  const maxLen = Math.max(localLines.length, remoteLines.length);
  const diff = [];

  for (let i = 0; i < maxLen; i++) {
    const localLine = localLines[i];
    const remoteLine = remoteLines[i];
    const localExists = i < localLines.length;
    const remoteExists = i < remoteLines.length;

    if (!localExists && remoteExists) {
      diff.push({ type: 'add', local: '', remote: remoteLine });
    } else if (localExists && !remoteExists) {
      diff.push({ type: 'remove', local: localLine, remote: '' });
    } else if (localLine !== remoteLine) {
        diff.push({ type: 'modify', local: localLine, remote: remoteLine });
      } else {
        diff.push({ type: 'equal', local: localLine, remote: remoteLine });
      }
    }

  return diff;
}

function DiffView({ localValue, remoteValue }) {
  const localStr = formatValue(localValue);
  const remoteStr = formatValue(remoteValue);
  const diff = diffLines(localStr, remoteStr);

  return (
    <div className="diff-container">
      <div className="diff-column">
        <div className="diff-header local">
          <span className="diff-label">Local</span>
        </div>
        <div className="diff-content">
          {diff.map((line, idx) => (
            <div
              key={idx} className={`diff-line ${line.type}`}>
              <span className="line-number">{idx + 1}</span>
              <span
                className="line-content"
                dangerouslySetInnerHTML={{
                  __html: line.local
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                }}
              />
            </div>
          ))}
        </div>
      </div>
      <div className="diff-column">
        <div className="diff-header remote">
          <span className="diff-label">Remote</span>
        </div>
        <div className="diff-content">
          {diff.map((line, idx) => (
            <div key={idx} className={`diff-line ${line.type}`}>
              <span className="line-number">{idx + 1}</span>
              <span
                className="line-content"
                dangerouslySetInnerHTML={{
                  __html: line.remote
                    .replace(/&/g, '&amp;')
                    .replace(/</g, '&lt;')
                    .replace(/>/g, '&gt;')
                }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function ConflictItem({ conflict, onResolve, onToast }) {
  const [expanded, setExpanded] = useState(false);
  const [resolving, setResolving] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [showCustom, setShowCustom] = useState(false);

  const handleResolve = async (choice, customValue) => {
    setResolving(true);
    try {
      await onResolve(conflict.key, choice, customValue);
    } catch (e) {
      if (onToast) {
        onToast({
          type: 'error',
          message: `Failed to resolve conflict: ${e.message || 'Unknown error'}`
        });
      }
    } finally {
      setResolving(false);
    }
  };

  const handleCustomSubmit = () => {
    let parsedValue;
    try {
      parsedValue = JSON.parse(customInput);
    } catch (e) {
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Invalid JSON for custom value'
        });
      }
      return;
    }
    handleResolve('custom', parsedValue);
    setShowCustom(false);
    setCustomInput('');
  };

  const shortLocalAuthor = conflict.localAuthor ? conflict.localAuthor.slice(0, 12) + '...' : 'unknown';
  const shortRemoteAuthor = conflict.remoteAuthor ? conflict.remoteAuthor.slice(0, 12) + '...' : 'unknown';

  return (
    <div className="conflict-item">
      <div className="conflict-header">
        <div className="conflict-header-left">
          <AlertTriangle size={18} style={{ color: '#ef4444' }} />
          <div className="conflict-key">{conflict.key}</div>
          <span className="conflict-badge">
            <AlertCircle size={12} />
            Conflict
          </span>
        </div>
        <div className="conflict-header-right">
          <button
            className="btn btn-secondary btn-sm"
            onClick={() => setExpanded(!expanded)}
            disabled={resolving}
          >
            {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
          </button>
        </div>
      </div>

      <div className="conflict-meta">
        <div className="conflict-authors">
          <span className="author-badge local">
            <User size={12} />
            Local: {shortLocalAuthor}
          </span>
          <span className="author-badge remote">
            <User size={12} />
            Remote: {shortRemoteAuthor}
          </span>
        </div>
        <div className="conflict-time">
          <Clock size={12} />
          {formatDistanceToNow(conflict.detectedAt, { addSuffix: true })}
        </div>
      </div>

      {expanded && (
        <div className="conflict-details">
          <DiffView localValue={conflict.localValue} remoteValue={conflict.remoteValue} />
          
          <div className="conflict-actions">
            <button
              className="btn btn-primary"
              onClick={() => handleResolve('local')}
              disabled={resolving}
            >
              <Check size={16} />
              保留本地
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => handleResolve('remote')}
              disabled={resolving}
            >
              <Check size={16} />
              保留远程
            </button>
            <button
              className="btn btn-secondary"
              onClick={() => {
                setShowCustom(!showCustom);
                if (!showCustom) {
                  setCustomInput(formatValue(conflict.localValue));
                }
              }}
              disabled={resolving}
            >
              <Edit3 size={16} />
              自定义
            </button>
          </div>

          {showCustom && (
            <div className="custom-input-container">
              <textarea
                className="custom-textarea"
                value={customInput}
                onChange={(e) => setCustomInput(e.target.value)}
                placeholder="Enter custom JSON value..."
              />
              <div className="custom-actions">
                <button
                  className="btn btn-success"
                  onClick={handleCustomSubmit}
                  disabled={resolving}
                >
                  <Check size={16} />
                  应用自定义值
                </button>
                <button
                  className="btn btn-secondary"
                  onClick={() => setShowCustom(false)}
                  disabled={resolving}
                >
                  <X size={16} />
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function ConflictResolver({ onToast, onConflictCountChange }) {
  const [conflicts, setConflicts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [resolvingAll, setResolvingAll] = useState(false);

  const fetchConflicts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await conflictApi.getConflicts();
      const unresolved = response.data.conflicts.filter(c => !c.resolved);
      setConflicts(unresolved);
      if (onConflictCountChange) {
        onConflictCountChange(unresolved.length);
      }
    } catch (e) {
      console.error('Error fetching conflicts:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to load conflicts'
        });
      }
    } finally {
      setLoading(false);
    }
  }, [onToast, onConflictCountChange]);

  useEffect(() => {
    fetchConflicts();

    const unsubscribe1 = wsService.on('conflict-detected', (data) => {
      if (data && data.conflict) {
        setConflicts(prev => {
          const exists = prev.find(c => c.id === data.conflict.id);
          if (!exists && !data.conflict.resolved) {
            const updated = [...prev, data.conflict];
            if (onConflictCountChange) {
              onConflictCountChange(updated.length);
            }
            return updated;
          }
          return prev;
        });
        if (onToast) {
          onToast({
            type: 'warning',
            message: `New conflict detected: ${data.conflict.key}`
          });
        }
      }
    });

    const unsubscribe2 = wsService.on('conflict-resolved', (data) => {
      if (data && data.conflict) {
        setConflicts(prev => {
          const updated = prev.filter(c => c.id !== data.conflict.id);
          if (onConflictCountChange) {
            onConflictCountChange(updated.length);
          }
          return updated;
        });
        if (onToast) {
          onToast({
            type: 'success',
            message: `Conflict resolved: ${data.conflict.key}`
          });
        }
      }
    });

    const interval = setInterval(() => {
      if (wsService.isConnected()) {
        wsService.requestConflicts();
      }
    }, 30000);

    return () => {
      unsubscribe1();
      unsubscribe2();
      clearInterval(interval);
    };
  }, [fetchConflicts, onToast, onConflictCountChange]);

  const handleResolve = async (key, choice, customValue) => {
    await conflictApi.resolveConflict(key, choice, customValue);
  };

  const handleResolveAll = async (choice) => {
    setResolvingAll(true);
    try {
      await conflictApi.resolveAllConflicts(choice);
      setConflicts([]);
      if (onConflictCountChange) {
        onConflictCountChange(0);
      }
      if (onToast) {
        onToast({
          type: 'success',
          message: `All conflicts resolved with choice: ${choice}`
        });
      }
    } catch (e) {
      console.error('Error resolving all conflicts:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to resolve all conflicts'
        });
      }
    } finally {
      setResolvingAll(false);
    }
  };

  const handleRefresh = () => {
    if (wsService.isConnected()) {
      wsService.requestConflicts();
    } else {
      fetchConflicts();
    }
  };

  return (
    <div className="card conflict-section">
      <div className="card-header">
        <div className="card-title">
          <AlertTriangle size={20} style={{ color: '#ef4444' }} />
          <span>Conflict Resolver</span>
          <span className="sync-status">
            {conflicts.length} conflict{conflicts.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="card-actions">
          {conflicts.length > 0 && (
            <>
              <button
                className="btn btn-secondary"
                onClick={() => handleResolveAll('local')}
                disabled={resolvingAll || loading}
              >
                <Check size={16} className={resolvingAll ? 'spinner' : ''} />
                全部保留本地
              </button>
              <button
                className="btn btn-secondary"
                onClick={() => handleResolveAll('remote')}
                disabled={resolvingAll || loading}
              >
                <Check size={16} />
                全部保留远程
              </button>
            </>
          )}
          <button className="btn btn-secondary" onClick={handleRefresh} disabled={loading}>
            <RefreshCw size={16} className={loading ? 'spinner' : ''} />
            Refresh
          </button>
        </div>
      </div>
      <div className="card-content">
        {loading && conflicts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">⚖️</div>
            <div>Loading conflicts...</div>
          </div>
        ) : conflicts.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">✅</div>
            <div>No conflicts</div>
          </div>
        ) : (
          <div className="conflicts-list">
            {conflicts.map((conflict) => (
              <ConflictItem
                key={conflict.id}
                conflict={conflict}
                onResolve={handleResolve}
                onToast={onToast}
              />
            ))}
          </div>
        )}
      </div>

      <style>{`
        .conflict-section {
          grid-column: 1 / -1;
        }

        .conflicts-list {
          display: flex;
          flex-direction: column;
          gap: 1rem;
        }

        .conflict-item {
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 8px;
          overflow: hidden;
        }

        .conflict-header {
          padding: 1rem 1.25rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          border-bottom: 1px solid #334155;
        }

        .conflict-header-left {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }

        .conflict-header-right {
          display: flex;
          gap: 0.5rem;
        }

        .conflict-key {
          font-family: 'Courier New', monospace;
          font-size: 0.9rem;
          color: #f1f5f9;
          font-weight: 500;
        }

        .conflict-badge {
          display: flex;
          align-items: center;
          gap: 0.25rem;
          font-size: 0.7rem;
          padding: 0.2rem 0.5rem;
          background: rgba(239, 68, 68, 0.2);
          color: #ef4444;
          border-radius: 4px;
          font-weight: 600;
        }

        .conflict-meta {
          padding: 0.75rem 1.25rem;
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-wrap: wrap;
          gap: 0.75rem;
          border-bottom: 1px solid #334155;
          font-size: 0.8rem;
        }

        .conflict-authors {
          display: flex;
          gap: 0.75rem;
          flex-wrap: wrap;
        }

        .author-badge {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          padding: 0.25rem 0.5rem;
          border-radius: 4px;
          font-family: 'Courier New', monospace;
          font-size: 0.75rem;
        }

        .author-badge.local {
          background: rgba(34, 197, 94, 0.15);
          color: #22c55e;
        }

        .author-badge.remote {
          background: rgba(96, 165, 250, 0.15);
          color: #60a5fa;
        }

        .conflict-time {
          display: flex;
          align-items: center;
          gap: 0.3rem;
          color: #64748b;
        }

        .conflict-details {
          padding: 1.25rem;
        }

        .diff-container {
          display: flex;
          gap: 1rem;
          margin-bottom: 1rem;
          border: 1px solid #334155;
          border-radius: 6px;
          overflow: hidden;
        }

        .diff-column {
          flex: 1;
          display: flex;
          flex-direction: column;
        }

        .diff-header {
          padding: 0.5rem 0.75rem;
          font-size: 0.75rem;
          font-weight: 600;
          border-bottom: 1px solid #334155;
        }

        .diff-header.local {
          background: rgba(239, 68, 68, 0.1);
          border-right: 1px solid #334155;
        }

        .diff-header.remote {
          background: rgba(34, 197, 94, 0.1);
        }

        .diff-label {
          font-family: 'Courier New', monospace;
        }

        .diff-header.local .diff-label {
          color: #ef4444;
        }

        .diff-header.remote .diff-label {
          color: #22c55e;
        }

        .diff-content {
          font-family: 'Courier New', monospace;
          font-size: 0.8rem;
          background: #020617;
          max-height: 300px;
          overflow-y: auto;
        }

        .diff-column:first-child .diff-content {
          border-right: 1px solid #334155;
        }

        .diff-line {
          display: flex;
          padding: 0 0.5rem;
          min-height: 1.25rem;
          line-height: 1.25rem;
        }

        .diff-line .line-number {
          width: 2.5rem;
          color: #475569;
          text-align: right;
          padding-right: 0.75rem;
          user-select: none;
          flex-shrink: 0;
        }

        .diff-line .line-content {
          flex: 1;
          white-space: pre;
        }

        .diff-line.remove {
          background: rgba(239, 68, 68, 0.15);
        }

        .diff-line.remove .line-content {
          color: #fca5a5;
        }

        .diff-line.add {
          background: rgba(34, 197, 94, 0.15);
        }

        .diff-line.add .line-content {
          color: #86efac;
        }

        .diff-line.modify {
          background: rgba(245, 158, 11, 0.15);
        }

        .diff-line.modify .line-content {
          color: #fcd34d;
        }

        .conflict-actions {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .btn-sm {
          padding: 0.35rem 0.7rem;
          font-size: 0.8rem;
        }

        .custom-input-container {
          margin-top: 1rem;
          display: flex;
          flex-direction: column;
          gap: 0.75rem;
        }

        .custom-textarea {
          width: 100%;
          min-height: 120px;
          background: #0f172a;
          border: 1px solid #334155;
          border-radius: 6px;
          padding: 0.75rem;
          color: #f1f5f9;
          font-family: 'Courier New', monospace;
          font-size: 0.875rem;
          resize: vertical;
        }

        .custom-textarea:focus {
          outline: none;
          border-color: #3b82f6;
        }

        .custom-actions {
          display: flex;
          gap: 0.5rem;
        }

        .btn-success {
          background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
          color: white;
        }

        .btn-success:hover {
          background: linear-gradient(135deg, #16a34a 0%, #15803d 100%);
        }

        @media (max-width: 768px) {
          .diff-container {
            flex-direction: column;
          }

          .diff-column:first-child .diff-content {
            border-right: none;
            border-bottom: 1px solid #334155;
          }

          .diff-header.local {
            border-right: none;
            border-bottom: 1px solid #334155;
          }
        }
      `}</style>
    </div>
  );
}
