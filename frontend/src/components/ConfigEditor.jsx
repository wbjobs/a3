import React, { useEffect, useState, useRef } from 'react';
import { FileJson, Save, RefreshCw, Sync, RotateCcw } from './Icons';
import Editor from '@monaco-editor/react';
import { configApi, syncApi } from '../services/api';
import { wsService } from '../services/websocket';

export default function ConfigEditor({ onToast }) {
  const [config, setConfig] = useState(null);
  const [editorValue, setEditorValue] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);
  const [parseError, setParseError] = useState(null);
  const originalConfigRef = useRef(null);

  useEffect(() => {
    fetchConfig();

    const unsubscribe1 = wsService.on('config-update', (data) => {
      if (data && data.config) {
        setConfig(data.config);
        const jsonStr = JSON.stringify(data.config, null, 2);
        setEditorValue(jsonStr);
        originalConfigRef.current = jsonStr;
        setHasChanges(false);
        setParseError(null);
        setLoading(false);
      }
    });

    const unsubscribe2 = wsService.on('config-change', (data) => {
      if (data && data.config) {
        setConfig(data.config);
        const jsonStr = JSON.stringify(data.config, null, 2);
        if (!hasChanges) {
          setEditorValue(jsonStr);
          originalConfigRef.current = jsonStr;
        }
        if (onToast) {
          onToast({
            type: 'info',
            message: `Config updated: ${data.change.type} ${data.change.key}`
          });
        }
      }
    });

    const interval = setInterval(() => {
      if (wsService.isConnected() && !hasChanges) {
        wsService.requestConfig();
      }
    }, 30000);

    return () => {
      unsubscribe1();
      unsubscribe2();
      clearInterval(interval);
    };
  }, [hasChanges, onToast]);

  const fetchConfig = async () => {
    setLoading(true);
    try {
      const response = await configApi.getConfig();
      setConfig(response.data);
      const jsonStr = JSON.stringify(response.data, null, 2);
      setEditorValue(jsonStr);
      originalConfigRef.current = jsonStr;
      setHasChanges(false);
      setParseError(null);
    } catch (e) {
      console.error('Error fetching config:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to load config'
        });
      }
    } finally {
      setLoading(false);
    }
  };

  const handleEditorChange = (value) => {
    setEditorValue(value);
    
    try {
      JSON.parse(value);
      setParseError(null);
    } catch (e) {
      setParseError(e.message);
    }
    
    setHasChanges(value !== originalConfigRef.current);
  };

  const handleSave = async () => {
    if (parseError) {
      if (onToast) {
        onToast({
          type: 'error',
          message: `Invalid JSON: ${parseError}`
        });
      }
      return;
    }

    setSaving(true);
    try {
      const newConfig = JSON.parse(editorValue);
      const response = await configApi.updateConfig(newConfig);
      
      setConfig(response.data.config);
      const jsonStr = JSON.stringify(response.data.config, null, 2);
      setEditorValue(jsonStr);
      originalConfigRef.current = jsonStr;
      setHasChanges(false);
      
      if (onToast) {
        onToast({
          type: 'success',
          message: `Config saved! ${response.data.changes.length} changes synced`
        });
      }
    } catch (e) {
      console.error('Error saving config:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to save config'
        });
      }
    } finally {
      setSaving(false);
    }
  };

  const handleReset = () => {
    if (originalConfigRef.current) {
      setEditorValue(originalConfigRef.current);
      setHasChanges(false);
      setParseError(null);
    }
  };

  const handleRefresh = () => {
    if (wsService.isConnected()) {
      wsService.requestConfig();
    } else {
      fetchConfig();
    }
  };

  const handleSyncAll = async () => {
    setSyncing(true);
    try {
      const response = await syncApi.syncAll();
      setConfig(response.data.config);
      const jsonStr = JSON.stringify(response.data.config, null, 2);
      setEditorValue(jsonStr);
      originalConfigRef.current = jsonStr;
      setHasChanges(false);
      
      const successCount = response.data.results.filter(r => r.success).length;
      
      if (onToast) {
        onToast({
          type: 'success',
          message: `Synced with ${successCount}/${response.data.results.length} peers`
        });
      }
    } catch (e) {
      console.error('Error syncing:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: 'Failed to sync with peers'
        });
      }
    } finally {
      setSyncing(false);
    }
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
    readOnly: loading,
    formatOnPaste: true,
    formatOnType: true
  };

  return (
    <div className="card config-section">
      <div className="card-header">
        <div className="card-title">
          <FileJson size={20} />
          <span>Config Editor</span>
          {hasChanges && (
            <span className="sync-status" style={{ color: '#f59e0b' }}>
              ● Unsaved changes
            </span>
          )}
        </div>
        <div className="card-actions">
          <button 
            className="btn btn-secondary" 
            onClick={handleRefresh}
            disabled={loading}
          >
            <RefreshCw size={16} className={loading ? 'spinner' : ''} />
            Refresh
          </button>
          <button 
            className="btn btn-secondary" 
            onClick={handleReset}
            disabled={!hasChanges || saving || loading}
          >
            <RotateCcw size={16} />
            Reset
          </button>
          <button 
            className="btn btn-primary" 
            onClick={handleSyncAll}
            disabled={syncing || loading}
          >
            <Sync size={16} className={syncing ? 'spinner' : ''} />
            Sync All
          </button>
          <button 
            className="btn btn-success" 
            onClick={handleSave}
            disabled={!hasChanges || parseError || saving || loading}
          >
            <Save size={16} className={saving ? 'spinner' : ''} />
            Save
          </button>
        </div>
      </div>
      <div className="card-content">
        {loading ? (
          <div className="empty-state">
            <div className="empty-icon">⚙️</div>
            <div>Loading configuration...</div>
          </div>
        ) : (
          <div className="editor-container">
            {parseError && (
              <div style={{ 
                padding: '0.75rem', 
                background: 'rgba(239, 68, 68, 0.1)', 
                border: '1px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '6px',
                color: '#fca5a5',
                fontSize: '0.875rem'
              }}>
                ⚠️ JSON Parse Error: {parseError}
              </div>
            )}
            <div className="monaco-editor">
              <Editor
                height="100%"
                language="json"
                value={editorValue}
                onChange={handleEditorChange}
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
            <div className="sync-status">
              <span>settings.json</span>
              {config && (
                <span style={{ marginLeft: '1rem' }}>
                  {Object.keys(config).length} root keys
                </span>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
