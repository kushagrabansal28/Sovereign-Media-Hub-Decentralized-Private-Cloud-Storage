import React from 'react';
import { NavLink } from 'react-router-dom';
import { useNostr } from '../hooks/useNostr';

export default function Navbar() {
  const { pubkey, logout } = useNostr();

  const truncatePubkey = (pk) => {
    if (!pk) return '';
    // Nostr pubkeys are 64 hex chars, typical npub is longer. We'll just show hex prefix/suffix for now.
    return `${pk.slice(0, 8)}...${pk.slice(-6)}`;
  };

  return (
    <nav className="glass-card" style={{ 
      margin: 'var(--space-lg) var(--space-lg) 0',
      padding: 'var(--space-md) var(--space-lg)',
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      borderRadius: 'var(--radius-xl)'
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-lg)' }}>
        <h1 style={{ fontSize: '1.25rem', fontWeight: 800, background: 'var(--accent-gradient)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
          SovereignHub
        </h1>
        
        {pubkey && (
          <div style={{ display: 'flex', gap: 'var(--space-md)' }}>
            <NavLink 
              to="/" 
              style={({ isActive }) => ({
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400
              })}
            >
              Gallery
            </NavLink>
            <NavLink 
              to="/upload" 
              style={({ isActive }) => ({
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400
              })}
            >
              Upload
            </NavLink>
            <NavLink 
              to="/settings" 
              style={({ isActive }) => ({
                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                fontWeight: isActive ? 600 : 400
              })}
            >
              Settings
            </NavLink>
          </div>
        )}
      </div>

      <div>
        {pubkey ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-md)' }}>
            <div className="badge badge-accent">
              {truncatePubkey(pubkey)}
            </div>
            <button onClick={logout} className="btn btn-secondary" style={{ padding: '6px 12px', fontSize: '0.75rem' }}>
              Logout
            </button>
          </div>
        ) : (
          <div className="badge badge-accent" style={{ background: 'var(--glass-bg)', color: 'var(--text-secondary)' }}>
            Not Logged In
          </div>
        )}
      </div>
    </nav>
  );
}
