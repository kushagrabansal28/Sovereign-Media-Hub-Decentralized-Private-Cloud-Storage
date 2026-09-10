import React, { useState, useEffect } from 'react';
import { useNostr } from '../hooks/useNostr';
import { useRelays } from '../hooks/useRelays';
import { getServerURL, setServerURL, getServerInfo } from '../services/api';
import LoginPrompt from '../components/LoginPrompt';

export default function Settings() {
  const { pubkey } = useNostr();
  const { relays, saveRelays } = useRelays();
  
  const [serverUrlInput, setServerUrlInput] = useState(getServerURL());
  const [relaysInput, setRelaysInput] = useState(relays.join('\n'));
  
  const [serverStatus, setServerStatus] = useState('checking'); // checking, online, offline
  const [serverInfo, setServerInfo] = useState(null);
  
  const [saveMsg, setSaveMsg] = useState('');

  useEffect(() => {
    checkServer();
  }, [serverUrlInput]); // Re-check when URL changes

  const checkServer = async () => {
    setServerStatus('checking');
    try {
      // Temporarily save to test
      const original = getServerURL();
      setServerURL(serverUrlInput);
      
      const info = await getServerInfo();
      setServerInfo(info);
      setServerStatus('online');
      
    } catch (err) {
      setServerStatus('offline');
      setServerInfo(null);
    }
  };

  const handleSave = () => {
    // Save Server URL
    setServerURL(serverUrlInput);
    
    // Save Relays
    const newRelays = relaysInput
      .split('\n')
      .map(r => r.trim())
      .filter(r => r.startsWith('ws://') || r.startsWith('wss://'));
    
    if (newRelays.length > 0) {
      saveRelays(newRelays);
    }
    
    setSaveMsg('Settings saved successfully');
    setTimeout(() => setSaveMsg(''), 3000);
  };

  if (!pubkey) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoginPrompt />
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in" style={{ maxWidth: '800px' }}>
      <div className="page-header">
        <h2 className="page-title">Settings</h2>
        <p className="page-subtitle">Configure your Blossom server and preferred Nostr relays</p>
      </div>

      {saveMsg && (
        <div className="toast toast-success" style={{ position: 'relative', marginBottom: 'var(--space-lg)' }}>
          {saveMsg}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2xl)' }}>
        
        {/* Blossom Server Configuration */}
        <section className="glass-card" style={{ padding: 'var(--space-xl)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Blossom Server (Storage)</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--space-lg)' }}>
            The HTTP endpoint where your binary blobs (images/videos) will be uploaded and stored.
          </p>
          
          <div style={{ display: 'flex', gap: 'var(--space-sm)', marginBottom: 'var(--space-sm)' }}>
            <input 
              type="url" 
              className="input" 
              value={serverUrlInput}
              onChange={e => setServerUrlInput(e.target.value)}
              placeholder="http://localhost:8080"
              style={{ flex: 1 }}
            />
            <button className="btn btn-secondary" onClick={checkServer}>Check</button>
          </div>

          <div style={{ fontSize: '0.875rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            Status: 
            {serverStatus === 'checking' && <span style={{ color: 'var(--text-secondary)' }}>Checking...</span>}
            {serverStatus === 'offline' && <span style={{ color: 'var(--error)' }}>Offline / Unreachable</span>}
            {serverStatus === 'online' && <span style={{ color: 'var(--success)' }}>Online</span>}
          </div>

          {serverInfo && (
            <div style={{ 
              marginTop: 'var(--space-md)', 
              padding: 'var(--space-md)', 
              background: 'var(--bg-elevated)',
              borderRadius: 'var(--radius-sm)',
              fontSize: '0.875rem',
              color: 'var(--text-secondary)'
            }}>
              <strong>{serverInfo.name}</strong> v{serverInfo.version} <br/>
              {serverInfo.description}
            </div>
          )}
        </section>

        {/* Nostr Relays Configuration */}
        <section className="glass-card" style={{ padding: 'var(--space-xl)' }}>
          <h3 style={{ marginBottom: 'var(--space-md)' }}>Nostr Relays (Metadata)</h3>
          <p style={{ color: 'var(--text-secondary)', fontSize: '0.875rem', marginBottom: 'var(--space-lg)' }}>
            The WebSocket endpoints where your NIP-94 file metadata events will be published and queried. 
            One relay per line.
          </p>
          
          <textarea 
            className="input" 
            rows={5}
            value={relaysInput}
            onChange={e => setRelaysInput(e.target.value)}
            style={{ width: '100%', resize: 'vertical', fontFamily: 'var(--font-mono)' }}
          />
        </section>

        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button className="btn btn-primary" onClick={handleSave} style={{ minWidth: '150px' }}>
            Save All Settings
          </button>
        </div>

      </div>
    </div>
  );
}
