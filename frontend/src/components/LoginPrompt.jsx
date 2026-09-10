import React, { useState } from 'react';
import { useNostr } from '../hooks/useNostr';

export default function LoginPrompt() {
  const { hasExtension, loginWithExtension, generateNewAccount, loginWithPrivkey } = useNostr();
  const [showManual, setShowManual] = useState(false);
  const [privkeyInput, setPrivkeyInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleExtLogin = async () => {
    try {
      setLoading(true);
      setError('');
      await loginWithExtension();
    } catch (err) {
      setError(err.message || "Failed to login with extension");
      setLoading(false);
    }
  };

  const handleManualLogin = (e) => {
    e.preventDefault();
    if (!privkeyInput) return;
    try {
      loginWithPrivkey(privkeyInput);
    } catch (err) {
      setError(err.message);
    }
  };

  const handleGenerate = () => {
    try {
      generateNewAccount();
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="empty-state">
      <div className="empty-state-icon">🔐</div>
      <h2 className="empty-state-title">Welcome to Sovereign Media Hub</h2>
      <p className="empty-state-text">
        Authenticate using your Nostr identity. Your keys give you ownership of your files.
      </p>

      {error && (
        <div className="toast toast-error" style={{ position: 'relative', margin: '0 auto var(--space-md) auto', width: 'fit-content' }}>
          {error}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-md)', maxWidth: '320px', margin: '0 auto' }}>
        {hasExtension ? (
          <button 
            className="btn btn-primary" 
            onClick={handleExtLogin}
            disabled={loading}
          >
            {loading ? <div className="spinner"></div> : "Login with Browser Extension"}
          </button>
        ) : (
          <div className="glass-card" style={{ padding: 'var(--space-md)' }}>
            <p style={{ fontSize: '0.875rem', marginBottom: 'var(--space-md)', color: 'var(--warning)' }}>
              ⚠️ No Nostr browser extension detected (like Alby or nos2x). 
              For security, we highly recommend using an extension.
            </p>
            <a href="https://getalby.com/" target="_blank" rel="noreferrer" className="btn btn-secondary" style={{ width: '100%' }}>
              Get Alby Extension
            </a>
          </div>
        )}

        {!showManual ? (
          <button className="btn btn-secondary" onClick={() => setShowManual(true)}>
            Use Private Key (Dev / Test)
          </button>
        ) : (
          <div className="glass-card animate-fade-in" style={{ padding: 'var(--space-md)', textAlign: 'left' }}>
            <form onSubmit={handleManualLogin}>
              <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: 'var(--space-xs)', color: 'var(--text-secondary)' }}>
                Hex Private Key (nsec not supported yet):
              </label>
              <input 
                type="password" 
                className="input" 
                value={privkeyInput}
                onChange={e => setPrivkeyInput(e.target.value)}
                placeholder="e.g. 7f3a..."
                style={{ marginBottom: 'var(--space-md)' }}
              />
              <button type="submit" className="btn btn-primary" style={{ width: '100%', marginBottom: 'var(--space-md)' }}>
                Login
              </button>
            </form>
            
            <div style={{ textAlign: 'center' }}>
              <span style={{ fontSize: '0.875rem', color: 'var(--text-tertiary)' }}>or </span>
              <button onClick={handleGenerate} style={{ fontSize: '0.875rem', color: 'var(--accent-secondary)', textDecoration: 'underline' }}>
                generate a new temporary account
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
