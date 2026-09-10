import React from 'react';
import MediaCard from './MediaCard';

export default function MediaGrid({ events, onMediaClick }) {
  if (!events || events.length === 0) {
    return (
      <div className="empty-state">
        <div className="empty-state-icon">🖼️</div>
        <h3 className="empty-state-title">No media found</h3>
        <p className="empty-state-text">
          Upload some files to get started. They will appear here once published to relays.
        </p>
      </div>
    );
  }

  return (
    <div className="media-grid">
      {events.map((event) => (
        <MediaCard 
          key={event.id || event.tags.find(t=>t[0]==='x')?.[1]} 
          nip94Event={event} 
          onClick={() => onMediaClick(event)}
        />
      ))}
    </div>
  );
}
