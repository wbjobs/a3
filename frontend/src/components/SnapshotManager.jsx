import React, { useEffect, useState } from 'react';
import Editor from '@monaco-editor/react';
import { Camera, RotateCcw, Trash2, Eye, Plus, X, RefreshCw } from './Icons';
import { snapshotApi } from '../services/api';
import { wsService } from '../services/websocket';

export default function SnapshotManager({ onToast }) {
  const [snapshots, setSnapshots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [rollingBack, setRollingBack] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showPreviewModal, setShowPreviewModal] = useState(false);
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [previewSnapshot, setPreviewSnapshot] = useState(null);
  const [confirmAction, setConfirmAction] = useState(null);
  const [confirmSnapshot, setConfirmSnapshot] = useState(null);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');

  useEffect(() => {
    fetchSnapshots();

    const unsubscribe1 = wsService.on('snapshot-created', () => {
      fetchSnapshots();
      if (onToast) {
        onToast({
          type: 'success',
          message: 'New snapshot created'
        });
      }
    });

    const unsubscribe2 = wsService.on('snapshot-rolled-back', (data) => {
      fetchSnapshots();
      if (onToast) {
        onToast({
          type: 'success',
          message: `Rolled back to snapshot: ${data?.snapshot?.name || 'Unknown'}`
        });
      }
    });

    const unsubscribe3 = wsService.on('snapshot-deleted', () => {
      fetchSnapshots();
      if (onToast) {
        onToast({
          type: 'info',
          message: 'Snapshot deleted'
        });
      }
    });

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
    };
  }, [onToast]);

  const fetchSnapshots = async () => {
    try {
      const response = await snapshotApi.getSnapshots();
      const sorted = response.data.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
      setSnapshots(sorted);
    } catch (e) {
      console.error('Error fetching snapshots:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to load snapshots'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const getKeyCount = (config) => {
    if (!config) return 0;
    return Object.keys(config).length;
  };

  const formatDate = (dateString) => {
    const date = new Date(dateString);
    return date.toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  const handleCreateClick = () => {
    setNewName('');
    setNewDescription('');
    setShowCreateModal(true);
  };

  const handleCreate = async () => {
    if (!newName.trim()) {
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Please enter a snapshot name'
        });
      }
      return;
    }

    setCreating(true);
    try {
      await snapshotApi.createSnapshot(newName.trim(), newDescription.trim());
      setShowCreateModal(false);
      if (onToast) {
        onToast({
          type: 'success',
          message: 'Snapshot created successfully'
        });
      }
    } catch (e) {
      console.error('Error creating snapshot:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to create snapshot'
        });
      }
    } finally {
      setCreating(false);
    }
  };

  const handlePreview = async (snapshot) => {
    try {
      const response = await snapshotApi.getSnapshot(snapshot.id);
      setPreviewSnapshot(response.data);
      setShowPreviewModal(true);
    } catch (e) {
      console.error('Error fetching snapshot details:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to load snapshot details'
        });
      }
    }
  };

  const handleRollbackClick = (snapshot, e) => {
    e.stopPropagation();
    setConfirmAction('rollback');
    setConfirmSnapshot(snapshot);
    setShowConfirmModal(true);
  };

  const handleDeleteClick = (snapshot, e) => {
    e.stopPropagation();
    setConfirmAction('delete');
    setConfirmSnapshot(snapshot);
    setShowConfirmModal(true);
  };

  const handleConfirm = async () => {
    if (!confirmAction || !confirmSnapshot) return;

    if (confirmAction === 'rollback') {
      setRollingBack(confirmSnapshot.id);
      try {
        await snapshotApi.rollbackToSnapshot(confirmSnapshot.id);
        setShowConfirmModal(false);
        if (onToast) {
          onToast({
            type: 'success',
            message: `Rolled back to: ${confirmSnapshot.name}`
          });
        }
      } catch (e) {
        console.error('Error rolling back:', e);
        if (onToast) {
          onToast({
            type: 'error',
            message: 'Failed to rollback snapshot'
          });
        }
      } finally {
        setRollingBack(null);
      }
    } else if (confirmAction === 'delete') {
      setDeleting(confirmSnapshot.id);
      try {
        await snapshotApi.deleteSnapshot(confirmSnapshot.id);
        setShowConfirmModal(false);
        if (onToast) {
          onToast({
            type: 'success',
            message: 'Snapshot deleted'
          });
        }
      } catch (e) {
        console.error('Error deleting snapshot:', e);
        if (onToast) {
          onToast({
            type: 'error',
            message: 'Failed to delete snapshot'
          });
        }
      } finally {
        setDeleting(null);
      }
    }
  };

  const closeModals = () => {
    setShowCreateModal(false);
    setShowPreviewModal(false);
    setShowConfirmModal(false);
    setConfirmAction(null);
    setConfirmSnapshot(null);
    setPreviewSnapshot(null);
  };

  const editorOptions = {
    minimap: { enabled: false },
    fontSize: 13,
    fontFamily: 'Consolas, "Courier New", monospace',
    lineNumbers: 'on',
    scrollBeyondLastLine: false,
    automaticLayout: true,
    tabSize: 2,
    wordWrap: 'on',
    theme: 'vs-dark',
    readOnly: true,
    formatOnPaste: true,
    formatOnType: true
  };

  const getPreviewContent = () => {
    if (!previewSnapshot) return '';
    return JSON.stringify(previewSnapshot.config, null, 2);
  };

  return (
    <div className="card snapshot-section">
      <div className="card-header">
        <div className="card-title">
          <Camera size={20} />
          <span>Snapshot Manager</span>
          {snapshots.length > 0 && (
            <span className="key-count-badge">{snapshots.length} snapshots</span>
          )}
        </div>
        <div className="card-actions">
          <button
            className="btn btn-secondary"
            onClick={fetchSnapshots}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinner' : ''} />
            Refresh
          </button>
          <button
            className="btn btn-primary"
            onClick={handleCreateClick}
            disabled={creating}
          >
            <Plus size={16} className={creating ? 'spinner' : ''} />
            Create Snapshot
          </button>
        </div>
      </div>
      <div className="card-content">
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">📸</div>
            <div>Loading snapshots...</div>
          </div>
        ) : snapshots.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📸</div>
            <div>No snapshots yet</div>
            <div style={{ fontSize: '0.875rem', color: '#64748b' }}>
              Click "Create Snapshot" to save the current configuration
            </div>
          </div>
        ) : (
          <div className="snapshot-list">
            {snapshots.map((snapshot) => (
              <div
                key={snapshot.id}
                className="snapshot-card"
                onClick={() => handlePreview(snapshot)}
              >
                <div className="snapshot-card-header">
                  <h3 className="snapshot-name">{snapshot.name}</h3>
                  <span className="key-count-badge">
                    {getKeyCount(snapshot.config)} keys
                  </span>
                </div>
                <p className="snapshot-description">
                  {snapshot.description || 'No description'}
                </p>
                <div className="snapshot-meta">
                  <div>{formatDate(snapshot.createdAt)}</div>
                  <div className="snapshot-node-id" title={snapshot.nodeId}>
                    {snapshot.nodeId?.slice(0, 12)}...
                  </div>
                </div>
                <div className="snapshot-actions">
                  <button
                    className="btn btn-secondary btn-icon"
                    onClick={(e) => handlePreview(snapshot, e)}
                    title="Preview"
                  >
                    <Eye size={14} />
                    View
                  </button>
                  <button
                    className="btn btn-warning btn-icon"
                    onClick={(e) => handleRollbackClick(snapshot, e)}
                    disabled={rollingBack === snapshot.id}
                    title="Rollback"
                  >
                    <RotateCcw size={14} className={rollingBack === snapshot.id ? 'spinner' : ''} />
                    Rollback
                  </button>
                  <button
                    className="btn btn-danger btn-icon"
                    onClick={(e) => handleDeleteClick(snapshot, e)}
                    disabled={deleting === snapshot.id}
                    title="Delete"
                  >
                    <Trash2 size={14} className={deleting === snapshot.id ? 'spinner' : ''} />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreateModal && (
        <div className="modal-overlay" onClick={closeModals}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Camera size={20} />
                Create Snapshot
              </h3>
              <button className="modal-close" onClick={closeModals}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <div className="form-group">
                <label className="form-label">Name *</label>
                <input
                  type="text"
                  className="form-input"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Enter snapshot name"
                  autoFocus
                />
              </div>
              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  className="form-textarea"
                  value={newDescription}
                  onChange={(e) => setNewDescription(e.target.value)}
                  placeholder="Enter description (optional)"
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={closeModals}
                disabled={creating}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreate}
                disabled={creating || !newName.trim()}
              >
                <Camera size={16} className={creating ? 'spinner' : ''} />
                {creating ? 'Creating...' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}

      {showPreviewModal && previewSnapshot && (
        <div className="modal-overlay" onClick={closeModals}>
          <div className="modal large" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                <Eye size={20} />
                Snapshot: {previewSnapshot.name}
              </h3>
              <button className="modal-close" onClick={closeModals}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              {previewSnapshot.description && (
                <p style={{ color: '#94a3b8', marginTop: 0, marginBottom: '1rem' }}>
                  {previewSnapshot.description}
                </p>
              )}
              <div className="snapshot-meta" style={{ marginBottom: '1rem' }}>
                <div>Created: {formatDate(previewSnapshot.createdAt)}</div>
                <div className="key-count-badge">
                  {getKeyCount(previewSnapshot.config)} configuration keys
                </div>
              </div>
              <div className="preview-editor">
                <Editor
                  height="100%"
                  language="json"
                  value={getPreviewContent()}
                  options={editorOptions}
                  loading={
                    <div style={{ 
                      display: 'flex', 
                      alignItems: 'center', 
                      justifyContent: 'center', 
                      height: '100%',
                      background: '#1e1e1e',
                      color: '#666'
                    }}>
                      Loading editor...
                    </div>
                  }
                />
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={closeModals}
              >
                Close
              </button>
              <button
                className="btn btn-warning"
                onClick={() => {
                  closeModals();
                  setTimeout(() => {
                    setConfirmAction('rollback');
                    setConfirmSnapshot(previewSnapshot);
                    setShowConfirmModal(true);
                  }, 100);
                }}
                disabled={rollingBack === previewSnapshot.id}
              >
                <RotateCcw size={16} />
                Rollback to This
              </button>
            </div>
          </div>
        </div>
      )}

      {showConfirmModal && confirmSnapshot && (
        <div className="modal-overlay" onClick={closeModals}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">
                {confirmAction === 'rollback' ? 'Confirm Rollback' : 'Confirm Delete'}
              </h3>
              <button className="modal-close" onClick={closeModals}>
                <X size={20} />
              </button>
            </div>
            <div className="modal-content">
              <div className="confirm-dialog">
                <div className={`confirm-icon ${confirmAction === 'rollback' ? 'warning' : 'danger'}`}>
                  {confirmAction === 'rollback' ? '⚠️' : '🗑️'}
                </div>
                <div className="confirm-message">
                  {confirmAction === 'rollback'
                    ? `Are you sure you want to rollback to "${confirmSnapshot.name}"?`
                    : `Are you sure you want to delete "${confirmSnapshot.name}"?`
                  }
                </div>
                <div className="confirm-details">
                  {confirmAction === 'rollback'
                    ? 'This will replace the current configuration with the snapshot version.'
                    : 'This action cannot be undone.'
                  }
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                className="btn btn-secondary"
                onClick={closeModals}
                disabled={rollingBack === confirmSnapshot.id || deleting === confirmSnapshot.id}
              >
                Cancel
              </button>
              <button
                className={`btn ${confirmAction === 'rollback' ? 'btn-warning' : 'btn-danger'}`}
                onClick={handleConfirm}
                disabled={rollingBack === confirmSnapshot.id || deleting === confirmSnapshot.id}
              >
                {confirmAction === 'rollback' ? (
                  <>
                    <RotateCcw size={16} className={rollingBack === confirmSnapshot.id ? 'spinner' : ''} />
                    {rollingBack === confirmSnapshot.id ? 'Rolling Back...' : 'Rollback'}
                  </>
                ) : (
                  <>
                    <Trash2 size={16} className={deleting === confirmSnapshot.id ? 'spinner' : ''} />
                    {deleting === confirmSnapshot.id ? 'Deleting...' : 'Delete'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
