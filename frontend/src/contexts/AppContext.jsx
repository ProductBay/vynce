// src/contexts/AppContext.jsx - Socket/Calls Context (Fixes Circular Import)
import { createContext, useContext, useState, useEffect } from 'react';
import io from 'socket.io-client'; // npm i socket.io-client

const AppContext = createContext();

export function AppProvider({ children }) {
  const [calls, setCalls] = useState([]);
  const [bulkProgress, setBulkProgress] = useState(null);
  const [socket, setSocket] = useState(null);

  useEffect(() => {
    const s = io(import.meta.env.VITE_SOCKET_URL || 'http://localhost:3001', { // Backend URL
           path: '/socket.io/',
      transports: ['websocket', 'polling'], // Fallback
      timeout: 20000
    });

    s.on('connect', () => {
      console.log('🔌 Socket OK: 3001');
    });
    s.on('connect_error', (err) => {
      console.log('❌ Socket error:', err.message); // Log only
    });

    s.on('callUpdate', (call) => {
      setCalls(prev => {
        const idx = prev.findIndex(c => c.uuid === call.uuid);
        if (idx > -1) return prev.map((c, i) => i === idx ? call : c);
        return [call, ...prev];
      });
    });

    s.on('bulkStart', (data) => setBulkProgress({ ...data, status: 'start' }));
    s.on('bulkProgress', setBulkProgress);
    s.on('bulkComplete', (data) => setBulkProgress({ ...data, status: 'done' }));

    setSocket(s);

    // Fetch calls
    fetch('/api/calls').then(r => r.json()).then(setCalls);

    return () => s.disconnect();
  }, []);

  const refreshCalls = () => fetch('/api/calls').then(r => r.json()).then(setCalls);

  return (
    <AppContext.Provider value={{ calls, bulkProgress, socket, refreshCalls, setCalls }}>
      {children}
    </AppContext.Provider>
  );
}

export const useAppContext = () => useContext(AppContext);