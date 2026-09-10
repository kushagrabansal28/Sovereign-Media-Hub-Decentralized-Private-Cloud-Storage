import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { NostrProvider } from './hooks/useNostr';
import { RelaysProvider } from './hooks/useRelays';

import Navbar from './components/Navbar';
import Gallery from './pages/Gallery';
import Upload from './pages/Upload';
import Settings from './pages/Settings';

export default function App() {
  return (
    <BrowserRouter>
      <NostrProvider>
        <RelaysProvider>
          <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
            <Navbar />
            <main style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
              <Routes>
                <Route path="/" element={<Gallery />} />
                <Route path="/upload" element={<Upload />} />
                <Route path="/settings" element={<Settings />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </main>
          </div>
        </RelaysProvider>
      </NostrProvider>
    </BrowserRouter>
  );
}
