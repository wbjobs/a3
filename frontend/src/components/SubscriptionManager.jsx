import React, { useEffect, useState, useMemo } from 'react';
import { Rss, RssOff, RefreshCw, Plus, X, Check, Tag, User } from './Icons';
import { nodeApi, subscriptionApi, configApi } from '../services/api';
import { wsService } from '../services/websocket';

const DEFAULT_NAMESPACE_SUGGESTIONS = [
  '*',
  'editor.*',
  'editor.fontSize',
  'editor.theme',
  'editor.tabSize',
  'workbench.*',
  'workbench.colorTheme',
  'files.*',
  'files.autoSave',
  'terminal.*',
  'terminal.integrated.fontSize',
  'extensions.*'
];

const NAMESPACE_PATTERN = /^(\*\*?|[\w-]+(\.[\w-]+)*(\.\*)?)$/;

function matchNamespace(key, pattern) {
  if (pattern === '*') {
    return true;
  }
  
  const regexPattern = pattern
    .split('.')
    .map(part => part === '*' ? '[^.]+' : part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
    .join('\\.');
  
  const regex = new RegExp(`^${regexPattern}$`);
  return regex.test(key);
}

function validateNamespace(namespace) {
  if (!namespace || namespace.trim() === '') {
    return 'Namespace cannot be empty';
  }
  if (!NAMESPACE_PATTERN.test(namespace)) {
    return 'Invalid format. Use letters, numbers, hyphens, dots, and wildcards (*)';
  }
  return null;
}

function getConfigKeys(obj, prefix = '') {
  const keys = [];
  for (const [key, value] of Object.entries(obj)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      keys.push(`${fullKey}.*`);
      keys.push(...getConfigKeys(value, fullKey));
    } else {
      keys.push(fullKey);
    }
  }
  return keys;
}

export default function SubscriptionManager({ onToast }) {
  const [peers, setPeers] = useState([]);
  const [subscriptions, setSubscriptions] = useState([]);
  const [config, setConfig] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subscribing, setSubscribing] = useState(false);
  const [unsubscribingPeerId, setUnsubscribingPeerId] = useState(null);
  const [showModal, setShowModal] = useState(false);
  const [selectedPeer, setSelectedPeer] = useState(null);
  const [namespaceInput, setNamespaceInput] = useState('');
  const [namespaces, setNamespaces] = useState([]);
  const [namespaceError, setNamespaceError] = useState(null);
  const [showSuggestions, setShowSuggestions] = useState(false);

  useEffect(() => {
    fetchData();

    const unsubscribe1 = wsService.on('peer-connected', () => {
      fetchPeers();
    });

    const unsubscribe2 = wsService.on('peer-disconnected', () => {
      fetchPeers();
    });

    const unsubscribe3 = wsService.on('subscription-created', (data) => {
      if (data && data.subscription) {
        setSubscriptions(prev => {
          const filtered = prev.filter(s => s.peerId !== data.subscription.peerId);
          return [...filtered, data.subscription];
        });
      }
    });

    const unsubscribe4 = wsService.on('subscriptions-update', (data) => {
      if (data && data.subscriptions) {
        setSubscriptions(data.subscriptions);
      }
    });

    const interval = setInterval(() => {
      if (wsService.isConnected()) {
        fetchSubscriptions();
        fetchPeers();
      }
    }, 15000);

    return () => {
      unsubscribe1();
      unsubscribe2();
      unsubscribe3();
      unsubscribe4();
      clearInterval(interval);
    };
  }, []);

  const namespaceSuggestions = useMemo(() => {
    const configKeys = config ? getConfigKeys(config) : [];
    const allSuggestions = [...new Set([...DEFAULT_NAMESPACE_SUGGESTIONS, ...configKeys])];
    
    if (!namespaceInput.trim()) {
      return allSuggestions;
    }
    
    const input = namespaceInput.toLowerCase();
    return allSuggestions.filter(s => 
      s.toLowerCase().includes(input) && !namespaces.includes(s)
    ).slice(0, 15);
  }, [config, namespaceInput, namespaces]);

  const peersWithSubscriptionStatus = useMemo(() => {
    const subscriptionMap = new Map(subscriptions.map(s => [s.peerId, s]));
    return peers.map(peer => ({
      ...peer,
      subscription: subscriptionMap.get(peer.id) || null
    }));
  }, [peers, subscriptions]);

  const subscribedPeersCount = useMemo(() => {
    return peersWithSubscriptionStatus.filter(p => p.subscription).length;
  }, [peersWithSubscriptionStatus]);

  async function fetchData() {
    setLoading(true);
    try {
      await Promise.all([
        fetchPeers(),
        fetchSubscriptions(),
        fetchConfig()
      ]);
    } catch (e) {
      console.error('Error fetching data:', e);
    } finally {
      setLoading(false);
    }
  }

  async function fetchPeers() {
    try {
      const response = await nodeApi.getPeers();
      setPeers(response.data.connectedPeers || []);
    } catch (e) {
      console.error('Error fetching peers:', e);
    }
  }

  async function fetchSubscriptions() {
    try {
      const response = await subscriptionApi.getSubscriptions();
      setSubscriptions(response.data.subscriptions || []);
    } catch (e) {
      console.error('Error fetching subscriptions:', e);
    }
  }

  async function fetchConfig() {
    try {
      const response = await configApi.getConfig();
      setConfig(response.data);
    } catch (e) {
      console.error('Error fetching config:', e);
    }
  }

  function handleRefresh() {
    if (wsService.isConnected()) {
      fetchPeers();
      fetchSubscriptions();
    } else {
      fetchData();
    }
  }

  function openSubscribeModal(peer) {
    setSelectedPeer(peer);
    setNamespaces(peer.subscription ? [...peer.subscription.namespaces] : []);
    setNamespaceInput('');
    setNamespaceError(null);
    setShowSuggestions(false);
    setShowModal(true);
  }

  function closeModal() {
    setShowModal(false);
    setSelectedPeer(null);
    setNamespaces([]);
    setNamespaceInput('');
    setNamespaceError(null);
    setShowSuggestions(false);
  }

  function handleAddNamespace() {
    const trimmed = namespaceInput.trim();
    const error = validateNamespace(trimmed);
    
    if (error) {
      setNamespaceError(error);
      return;
    }
    
    if (namespaces.includes(trimmed)) {
      setNamespaceError('This namespace is already added');
      return;
    }
    
    setNamespaces([...namespaces, trimmed]);
    setNamespaceInput('');
    setNamespaceError(null);
    setShowSuggestions(false);
  }

  function handleSelectSuggestion(suggestion) {
    if (!namespaces.includes(suggestion)) {
      setNamespaces([...namespaces, suggestion]);
    }
    setNamespaceInput('');
    setNamespaceError(null);
    setShowSuggestions(false);
  }

  function handleRemoveNamespace(index) {
    setNamespaces(namespaces.filter((_, i) => i !== index));
  }

  function handleNamespaceKeyDown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAddNamespace();
    } else if (e.key === 'Backspace' && namespaceInput === '' && namespaces.length > 0) {
      handleRemoveNamespace(namespaces.length - 1);
    }
  }

  async function handleSubscribe() {
    if (!selectedPeer) return;
    
    if (namespaces.length === 0) {
      setNamespaceError('At least one namespace is required');
      return;
    }
    
    setSubscribing(true);
    try {
      const response = await subscriptionApi.subscribeToPeer(selectedPeer.id, namespaces);
      
      setSubscriptions(prev => {
        const filtered = prev.filter(s => s.peerId !== selectedPeer.id);
        return [...filtered, response.data.subscription];
      });
      
      if (onToast) {
        onToast({
          type: 'success',
          message: `Subscribed to ${selectedPeer.id.slice(0, 12)}... with ${namespaces.length} namespace(s)`
        });
      }
      
      closeModal();
    } catch (e) {
      console.error('Error subscribing:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: e.response?.data?.error || 'Failed to subscribe'
        });
      }
    } finally {
      setSubscribing(false);
    }
  }

  async function handleUnsubscribe(peerId) {
    if (!window.confirm('Are you sure you want to unsubscribe from this peer?')) {
      return;
    }
    
    setUnsubscribingPeerId(peerId);
    try {
      await subscriptionApi.unsubscribeFromPeer(peerId);
      
      setSubscriptions(prev => prev.filter(s => s.peerId !== peerId));
      
      if (onToast) {
        onToast({
          type: 'success',
          message: `Unsubscribed from ${peerId.slice(0, 12)}...`
        });
      }
    } catch (e) {
      console.error('Error unsubscribing:', e);
      if (onToast) {
        onToast({
          type: 'error',
          message: e.response?.data?.error || 'Failed to unsubscribe'
        });
      }
    } finally {
      setUnsubscribingPeerId(null);
    }
  }

  function formatDate(timestamp) {
    if (!timestamp) return 'N/A';
    return new Date(timestamp).toLocaleString();
  }

  function shortPeerId(peerId) {
    if (!peerId) return '';
    return peerId.slice(0, 12) + '...';
  }

  return (
    <div className="card subscription-section">
      <div className="card-header">
        <div className="card-title">
          <Rss size={20} />
          <span>Subscription Manager</span>
          <span className="sync-status">
            {subscribedPeersCount}/{peers.length} peer{subscribedPeersCount !== 1 ? 's' : ''} subscribed
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
        {loading && peers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">🔄</div>
            <div>Loading subscriptions...</div>
          </div>
        ) : peers.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📡</div>
            <div>No peers connected</div>
            <div style={{ fontSize: '0.875rem', color: '#94a3b8', marginTop: '0.5rem' }}>
              Wait for peers to connect to manage subscriptions
            </div>
          </div>
        ) : (
          <div className="peer-list">
            {peersWithSubscriptionStatus.map(peer => (
              <div key={peer.id} className={`peer-item ${peer.subscription ? 'subscribed' : 'not-subscribed'}`}>
                <div className="peer-item-header">
                  <div className="peer-info">
                    <span className={`status-dot ${peer.subscription ? 'subscribed' : 'not-subscribed'}`} />
                    <span className="peer-id">
                      <User size={14} style={{ display: 'inline', marginRight: '0.5rem' }} />
                      {shortPeerId(peer.id)}
                    </span>
                    {peer.subscription && (
                      <span className="subscription-badge">
                        <Check size={12} style={{ display: 'inline', marginRight: '4px' }} />
                        Subscribed
                      </span>
                    )}
                  </div>
                  <div className="peer-actions">
                    {peer.subscription ? (
                      <>
                        <button 
                          className="btn btn-secondary btn-sm"
                          onClick={() => openSubscribeModal(peer)}
                          disabled={subscribing}
                        >
                          <Tag size={14} />
                          Edit
                        </button>
                        <button 
                          className="btn btn-danger btn-sm"
                          onClick={() => handleUnsubscribe(peer.id)}
                          disabled={unsubscribingPeerId === peer.id}
                        >
                          <RssOff size={14} className={unsubscribingPeerId === peer.id ? 'spinner' : ''} />
                          Unsubscribe
                        </button>
                      </>
                    ) : (
                      <button 
                        className="btn btn-primary btn-sm"
                        onClick={() => openSubscribeModal(peer)}
                        disabled={subscribing}
                      >
                        <Plus size={14} />
                        Subscribe
                      </button>
                    )}
                  </div>
                </div>
                
                {peer.subscription && (
                  <div className="peer-subscription-info">
                    <div className="subscription-meta">
                      <span className="meta-label">Subscribed at:</span>
                      <span className="meta-value">{formatDate(peer.subscription.subscribedAt)}</span>
                    </div>
                    <div className="subscription-namespaces">
                      <span className="meta-label">Namespaces:</span>
                      <div className="namespace-tags">
                        {peer.subscription.namespaces.map((ns, index) => (
                          <span key={index} className="namespace-tag">
                            <Tag size={12} style={{ display: 'inline', marginRight: '4px' }} />
                            {ns}
                          </span>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
                
                {!peer.subscription && (
                  <div className="peer-subscription-info not-subscribed">
                    <span style={{ color: '#94a3b8', fontSize: '0.875rem' }}>
                      Not subscribed - click Subscribe to receive updates from this peer
                    </span>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      {showModal && selectedPeer && (
        <div className="modal-overlay" onClick={closeModal}>
          <div className="modal-content" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h3>
                {selectedPeer.subscription ? 'Edit Subscription' : 'Subscribe to Peer'}
              </h3>
              <button className="modal-close" onClick={closeModal}>
                <X size={20} />
              </button>
            </div>
            
            <div className="modal-body">
              <div className="modal-peer-info">
                <User size={16} style={{ display: 'inline', marginRight: '0.5rem' }} />
                <span>Peer: {shortPeerId(selectedPeer.id)}</span>
              </div>
              
              <div className="form-group">
                <label className="form-label">
                  Namespaces <span style={{ color: '#f87171' }}>*</span>
                </label>
                <div className="namespace-input-container">
                  <div className="namespace-input-wrapper">
                    {namespaces.map((ns, index) => (
                      <span key={index} className="namespace-tag removable">
                        <Tag size={12} style={{ display: 'inline', marginRight: '4px' }} />
                        {ns}
                        <button 
                          className="tag-remove" 
                          onClick={() => handleRemoveNamespace(index)}
                        >
                          <X size={12} />
                        </button>
                      </span>
                    ))}
                    <input
                      type="text"
                      className="namespace-input"
                      placeholder={namespaces.length === 0 ? "Enter namespace (e.g., 'editor.*')" : "Add more..."}
                      value={namespaceInput}
                      onChange={e => {
                        setNamespaceInput(e.target.value);
                        setNamespaceError(null);
                        setShowSuggestions(true);
                      }}
                      onKeyDown={handleNamespaceKeyDown}
                      onFocus={() => setShowSuggestions(true)}
                    />
                  </div>
                  <button 
                    className="btn btn-secondary btn-sm namespace-add-btn"
                    onClick={handleAddNamespace}
                    disabled={!namespaceInput.trim()}
                  >
                    <Plus size={14} />
                    Add
                  </button>
                </div>
                
                {namespaceError && (
                  <div className="form-error">
                    ⚠️ {namespaceError}
                  </div>
                )}
                
                {showSuggestions && namespaceSuggestions.length > 0 && (
                  <div className="suggestions-dropdown">
                    <div className="suggestions-header">
                      <Tag size={12} style={{ display: 'inline', marginRight: '4px' }} />
                      Available namespaces
                    </div>
                    {namespaceSuggestions.map((suggestion, index) => (
                      <div 
                        key={index}
                        className="suggestion-item"
                        onClick={() => handleSelectSuggestion(suggestion)}
                      >
                        <Tag size={12} style={{ display: 'inline', marginRight: '6px', opacity: 0.6 }} />
                        {suggestion}
                      </div>
                    ))}
                  </div>
                )}
                
                <div className="form-hint">
                  <p>
                    <strong>Wildcard patterns:</strong>
                  </p>
                  <ul>
                    <li><code>*</code> - Match all keys</li>
                    <li><code>editor.*</code> - Match all keys under editor (e.g., editor.fontSize, editor.theme)</li>
                    <li><code>editor.fontSize</code> - Match only the exact key</li>
                  </ul>
                </div>
              </div>
            </div>
            
            <div className="modal-footer">
              <button 
                className="btn btn-secondary" 
                onClick={closeModal}
                disabled={subscribing}
              >
                Cancel
              </button>
              <button 
                className="btn btn-primary"
                onClick={handleSubscribe}
                disabled={subscribing || namespaces.length === 0}
              >
                <Rss size={16} className={subscribing ? 'spinner' : ''} />
                {selectedPeer.subscription ? 'Update Subscription' : 'Subscribe'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
