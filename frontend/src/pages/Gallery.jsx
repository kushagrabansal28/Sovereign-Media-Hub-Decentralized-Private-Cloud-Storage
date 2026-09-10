import React, { useState, useEffect } from 'react';
import { useNostr } from '../hooks/useNostr';
import { useRelays } from '../hooks/useRelays';
import { deleteBlob } from '../services/api';
import MediaGrid from '../components/MediaGrid';
import MediaViewer from '../components/MediaViewer';
import LoginPrompt from '../components/LoginPrompt';

export default function Gallery() {
  const { pubkey, getBlossomNIP98Token } = useNostr();
  const { fetchMediaEvents, isConnected } = useRelays();
  
  const [events, setEvents] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedEvent, setSelectedEvent] = useState(null);

  useEffect(() => {
    const loadEvents = async () => {
      if (!pubkey || !isConnected) return;
      setLoading(true);
      try {
        const fetched = await fetchMediaEvents(pubkey);
        setEvents(fetched);
      } catch (err) {
        console.error("Failed to load events", err);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [pubkey, isConnected, fetchMediaEvents]);

  const handleDelete = async (hash, eventId) => {
     // 1. Delete from Blossom Server (requires NIP-98)
     try {
         const token = await getBlossomNIP98Token(`/${hash}`, 'DELETE');
         await deleteBlob(hash, token);
     } catch (err) {
         console.warn("Blossom delete failed, might already be gone:", err);
         // Continue to remove from UI even if blossom delete fails (e.g. server reset)
     }

     // 2. Ideally, publish a Kind 5 (Delete Event) to relays here to remove the Kind 1063 event.
     // For this v1 scope, we just remove it from local state. Real apps should publish Kind 5.
     setEvents(prev => prev.filter(e => e.id !== eventId));
  };

  if (!pubkey) {
    return (
      <div className="page-container" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <LoginPrompt />
      </div>
    );
  }

  return (
    <div className="page-container animate-fade-in">
      <div className="page-header">
        <h2 className="page-title">Your Gallery</h2>
        <p className="page-subtitle">Media synced from decentralized relays</p>
      </div>

      {loading ? (
        <div className="media-grid">
           {[...Array(8)].map((_, i) => (
             <div key={i} className="skeleton" style={{ aspectRatio: '3/4', borderRadius: 'var(--radius-lg)' }}></div>
           ))}
        </div>
      ) : (
        <MediaGrid events={events} onMediaClick={setSelectedEvent} />
      )}

      {selectedEvent && (
        <MediaViewer 
          event={selectedEvent} 
          pubkey={pubkey}
          onClose={() => setSelectedEvent(null)} 
          onDelete={handleDelete}
        />
      )}
    </div>
  );
}
