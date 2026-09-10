import { useState, useEffect, createContext, useContext, useCallback, useRef } from 'react';
import { SimplePool } from 'nostr-tools/pool';

const RelaysContext = createContext(null);

const DEFAULT_RELAYS = [
  'wss://relay.damus.io',
  'wss://nos.lol',
  'wss://relay.nostr.band'
];

export function RelaysProvider({ children }) {
  const [relays, setRelays] = useState(() => {
    const saved = localStorage.getItem('nostr_relays');
    return saved ? JSON.parse(saved) : DEFAULT_RELAYS;
  });
  const [isConnected, setIsConnected] = useState(false);
  
  const poolRef = useRef(null);

  useEffect(() => {
    // Initialize pool
    poolRef.current = new SimplePool();
    setIsConnected(true);

    return () => {
      if (poolRef.current) {
        poolRef.current.close(relays);
      }
    };
  }, []);

  const saveRelays = (newRelays) => {
    setRelays(newRelays);
    localStorage.setItem('nostr_relays', JSON.stringify(newRelays));
  };

  const publishEvent = useCallback(async (event) => {
    if (!poolRef.current) throw new Error("Pool not initialized");
    
    return new Promise((resolve, reject) => {
      let okCount = 0;
      let seenCount = 0;
      
      const sub = poolRef.current.publish(relays, event);
      
      sub.on('ok', (relay) => {
        console.log(`✓ Published to ${relay}`);
        okCount++;
        if (okCount === 1) resolve(true); // Resolve on first success
      });
      
      sub.on('failed', (relay) => {
        console.warn(`✗ Failed to publish to ${relay}`);
        seenCount++;
        if (seenCount === relays.length && okCount === 0) {
          reject(new Error("Failed to publish to all relays"));
        }
      });
    });
  }, [relays]);

  const fetchMediaEvents = useCallback(async (pubkey) => {
    if (!poolRef.current) return [];
    
    const events = await poolRef.current.querySync(relays, {
      authors: [pubkey],
      kinds: [1063] // NIP-94 File Metadata
    });
    
    // Sort by created_at descending
    return events.sort((a, b) => b.created_at - a.created_at);
  }, [relays]);

  const value = {
    relays,
    saveRelays,
    isConnected,
    publishEvent,
    fetchMediaEvents
  };

  return (
    <RelaysContext.Provider value={value}>
      {children}
    </RelaysContext.Provider>
  );
}

export function useRelays() {
  const context = useContext(RelaysContext);
  if (!context) {
    throw new Error('useRelays must be used within a RelaysProvider');
  }
  return context;
}
