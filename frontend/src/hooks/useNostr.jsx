import { useState, useEffect, createContext, useContext, useCallback } from 'react';
import { generateSecretKey, getPublicKey, finalizeEvent } from 'nostr-tools/pure';
import { getServerURL } from '../services/api';

const bytesToHex = (bytes) => bytes.reduce((str, byte) => str + byte.toString(16).padStart(2, '0'), '');
const hexToBytes = (hex) => Uint8Array.from(hex.match(/.{1,2}/g).map((byte) => parseInt(byte, 16)));

const NostrContext = createContext(null);

export function NostrProvider({ children }) {
  const [pubkey, setPubkey] = useState(localStorage.getItem('nostr_pubkey') || null);
  const [isExtension, setIsExtension] = useState(localStorage.getItem('nostr_is_ext') === 'true');
  const [privkey, setPrivkey] = useState(localStorage.getItem('nostr_privkey') || null);
  const [hasExtension, setHasExtension] = useState(false);

  // Check for extension on mount
  useEffect(() => {
    const checkExt = () => {
      if (window.nostr) {
        setHasExtension(true);
      }
    };
    // It might load asynchronously
    checkExt();
    setTimeout(checkExt, 500);
    setTimeout(checkExt, 1000);
  }, []);

  const loginWithExtension = async () => {
    if (!window.nostr) throw new Error("No Nostr extension found");
    try {
      const pk = await window.nostr.getPublicKey();
      setPubkey(pk);
      setIsExtension(true);
      setPrivkey(null);
      localStorage.setItem('nostr_pubkey', pk);
      localStorage.setItem('nostr_is_ext', 'true');
      localStorage.removeItem('nostr_privkey');
      return pk;
    } catch (e) {
      console.error("Extension login failed", e);
      throw e;
    }
  };

  const loginWithPrivkey = (hexKey) => {
    try {
      const pk = getPublicKey(hexToBytes(hexKey));
      setPubkey(pk);
      setIsExtension(false);
      setPrivkey(hexKey);
      localStorage.setItem('nostr_pubkey', pk);
      localStorage.setItem('nostr_is_ext', 'false');
      localStorage.setItem('nostr_privkey', hexKey);
      return pk;
    } catch (e) {
      console.error("Privkey login failed", e);
      throw new Error("Invalid private key");
    }
  };

  const generateNewAccount = () => {
    const sk = generateSecretKey();
    const hexSk = bytesToHex(sk);
    return loginWithPrivkey(hexSk);
  };

  const logout = () => {
    setPubkey(null);
    setIsExtension(false);
    setPrivkey(null);
    localStorage.removeItem('nostr_pubkey');
    localStorage.removeItem('nostr_is_ext');
    localStorage.removeItem('nostr_privkey');
  };

  const signEvent = async (eventTemplate) => {
    if (!pubkey) throw new Error("Not logged in");
    
    if (isExtension) {
      if (!window.nostr) throw new Error("Extension not found");
      return await window.nostr.signEvent(eventTemplate);
    } else {
      if (!privkey) throw new Error("No private key available");
      // add pubkey and sign
      return finalizeEvent(eventTemplate, hexToBytes(privkey));
    }
  };

  const createNIP98Token = useCallback(async (url, method, payloadHash = null) => {
    const tags = [
      ['u', url],
      ['method', method.toUpperCase()]
    ];
    if (payloadHash) {
      tags.push(['payload', payloadHash]);
    }

    const eventTemplate = {
      kind: 27235,
      created_at: Math.floor(Date.now() / 1000),
      tags,
      content: ''
    };

    const signedEvent = await signEvent(eventTemplate);
    return btoa(JSON.stringify(signedEvent));
  }, [signEvent]);

  // Specific helper for Blossom server API URL building
  const getBlossomNIP98Token = useCallback(async (path, method) => {
      const serverURL = getServerURL();
      // Strip trailing slash from server URL, ensure path starts with /
      const base = serverURL.replace(/\/+$/, '');
      const cleanPath = path.startsWith('/') ? path : `/${path}`;
      const fullUrl = `${base}${cleanPath}`;
      
      return await createNIP98Token(fullUrl, method);
  }, [createNIP98Token]);


  const value = {
    pubkey,
    isExtension,
    hasExtension,
    loginWithExtension,
    loginWithPrivkey,
    generateNewAccount,
    logout,
    signEvent,
    createNIP98Token,
    getBlossomNIP98Token
  };

  return (
    <NostrContext.Provider value={value}>
      {children}
    </NostrContext.Provider>
  );
}

export function useNostr() {
  const context = useContext(NostrContext);
  if (!context) {
    throw new Error('useNostr must be used within a NostrProvider');
  }
  return context;
}
