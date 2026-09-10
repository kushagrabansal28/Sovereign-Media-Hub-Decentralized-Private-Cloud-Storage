import React, { useState } from 'react';
import { formatFileSize } from '../services/compress';

export default function MediaViewer({ event, onClose, onDelete, pubkey }) {
  const [deleting, setDeleting] = useState(false);
  
  if (!event) return null;

  const tags = event.tags || [];
  const getTag = (name) => {
    const t = tags.find(tag => tag[0] === name);
    return t ? t[1] : null;
  };

  const url = getTag('url');
  const hash = getTag('x');
  const mimeType = getTag('m');
  const size = getTag('size');
  const dim = getTag('dim');
  const alt = getTag('alt');

  const isVideo = mimeType && mimeType.startsWith('video/');
  const isOwner = pubkey && event.pubkey === pubkey;

  const handleDelete = async () => {
    if (!window.confirm("Are you sure you want to delete this media? This will remove the file from the blossom server.")) return;
    
    setDeleting(true);
    try {
      await onDelete(hash, event.id);
      onClose();
    } catch (err) {
      alert("Delete failed: " + err.message);
      setDeleting(false);
    }
  };

  return (
    <div className="modal-overlay" style={{ background: 'rgba(0,0,0,0.9)', zIndex: 1000 }} onClick={onClose}>
      
      {/* Close Button */}
      <button 
        onClick={onClose}
        style={{
          position: 'absolute',
          top: 'var(--space-lg)',
          right: 'var(--space-lg)',
          color: 'white',
          fontSize: '2rem',
          zIndex: 1010
        }}
      >
        ×
      </button>

      {/* Main Content Area */}
      <div 
        style={{ maxWidth: '90%', maxHeight: '90vh', position: 'relative' }} 
        onClick={e => e.stopPropagation()} // prevent closing when clicking image
      >
        {isVideo ? (
          <video 
            src={url} 
            controls 
            autoPlay 
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 'var(--radius-sm)' }}
          />
        ) : (
          <img 
            src={url} 
            alt={alt || "Media viewer full screen"} 
            style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 'var(--radius-sm)', objectFit: 'contain' }}
          />
        )}
      </div>

      {/* Info / Metadata bottom bar */}
      <div 
        onClick={e => e.stopPropagation()}
        style={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          padding: 'var(--space-lg)',
          background: 'linear-gradient(to top, rgba(0,0,0,0.8) 0%, transparent 100%)',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-end',
          color: 'var(--text-secondary)'
        }}
      >
        <div style={{ fontSize: '0.875rem' }}>
          {alt && <div style={{ color: 'white', fontWeight: 600, marginBottom: '4px' }}>{alt}</div>}
          <div>
            {mimeType} {size && `• ${formatFileSize(size)}`} {dim && `• ${dim}`}
          </div>
          <div style={{ fontSize: '0.75rem', opacity: 0.7, marginTop: '4px' }}>
            Event ID: {event.id.slice(0, 16)}... • SHA256: {hash && `${hash.slice(0, 16)}...`}
          </div>
        </div>

        {isOwner && (
          <button 
            className="btn btn-danger" 
            onClick={handleDelete}
            disabled={deleting}
          >
            {deleting ? 'Deleting...' : 'Delete'}
          </button>
        )}
      </div>
    </div>
  );
}
