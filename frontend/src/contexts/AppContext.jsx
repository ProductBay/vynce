// src/contexts/AppContext.jsx - REAL-TIME SOCKET.IO INTEGRATION
import { createContext, useContext, useState, useEffect } from 'react'
import io from 'socket.io-client'

const AppContext = createContext()

export function AppProvider({ children }) {
  const [calls, setCalls] = useState([])
  const [bulkProgress, setBulkProgress] = useState(null)
  const [socket, setSocket] = useState(null)
  const [isConnected, setIsConnected] = useState(false)

  const API_BASE_URL = 'http://localhost:3000'
  const SOCKET_URL = 'http://localhost:3000'

  // Initialize Socket.IO connection
  useEffect(() => {
    console.log('🔌 Initializing Socket.IO connection...')
    
    const socketInstance = io(SOCKET_URL, {
      path: '/socket.io/',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
      autoConnect: true
    })

    // Connection events
    socketInstance.on('connect', () => {
      console.log('✅ Socket.IO connected:', socketInstance.id)
      setIsConnected(true)
    })

    socketInstance.on('disconnect', () => {
      console.log('❌ Socket.IO disconnected')
      setIsConnected(false)
    })

    socketInstance.on('connect_error', (error) => {
      console.error('🔌 Socket connection error:', error)
    })

    // Live call updates from Vonage
    socketInstance.on('callUpdate', (updatedCall) => {
      console.log('📞 Call Update:', updatedCall)
      setCalls(prevCalls => {
        const index = prevCalls.findIndex(c => c.uuid === updatedCall.uuid)
        if (index > -1) {
          // Update existing call
          const newCalls = [...prevCalls]
          newCalls[index] = { ...newCalls[index], ...updatedCall }
          return newCalls
        } else {
          // New call added
          return [updatedCall, ...prevCalls]
        }
      })
    })

    // Bulk call progress
    socketInstance.on('bulkStart', (data) => {
      console.log('🚀 Bulk dialing started:', data)
      setBulkProgress({ status: 'started', ...data })
    })

    socketInstance.on('bulkProgress', (data) => {
      console.log('📊 Bulk progress:', data)
      setBulkProgress(prev => ({ ...prev, ...data }))
    })

    socketInstance.on('bulkComplete', (data) => {
      console.log('✅ Bulk complete:', data)
      setBulkProgress({ status: 'complete', ...data })
      // Auto-refresh calls after bulk complete
      setTimeout(() => refreshCalls(), 1000)
    })

    // Call ended event
    socketInstance.on('callEnded', (data) => {
      console.log('🛑 Call ended:', data)
      setCalls(prevCalls =>
        prevCalls.map(c =>
          c.uuid === data.uuid ? { ...c, status: 'completed' } : c
        )
      )
    })

    // Status updates (answered, ringing, etc.)
    socketInstance.on('callStatus', (data) => {
      console.log('📡 Call status update:', data)
      setCalls(prevCalls =>
        prevCalls.map(c =>
          c.uuid === data.uuid 
            ? { ...c, status: data.status, userStatus: data.userStatus, updatedAt: new Date() }
            : c
        )
      )
    })

    // Voicemail detected
    socketInstance.on('voicemailDetected', (data) => {
      console.log('📬 Voicemail detected:', data)
      setCalls(prevCalls =>
        prevCalls.map(c =>
          c.uuid === data.uuid
            ? { ...c, voicemailDetected: true, status: 'voicemail' }
            : c
        )
      )
    })

    // Job scheduled event
    socketInstance.on('jobScheduled', (job) => {
      console.log('⏰ Job scheduled:', job)
    })

    setSocket(socketInstance)

    // Initial calls fetch
    fetchCalls()

    return () => {
      socketInstance.disconnect()
    }
  }, [])

  // Fetch calls from backend
  const fetchCalls = async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/calls`)
      if (res.ok) {
        const data = await res.json()
        setCalls(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch calls:', err)
    }
  }

  // Refresh calls
  const refreshCalls = () => {
    fetchCalls()
  }

  // End call
  const endCall = async (uuid) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/end-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid })
      })
      if (res.ok) {
        refreshCalls()
      }
    } catch (err) {
      console.error('Failed to end call:', err)
    }
  }

  const value = {
    calls,
    setCalls,
    bulkProgress,
    setBulkProgress,
    socket,
    isConnected,
    refreshCalls,
    endCall
  }

  return (
    <AppContext.Provider value={value}>
      {children}
    </AppContext.Provider>
  )
}

export const useAppContext = () => {
  const context = useContext(AppContext)
  if (!context) {
    throw new Error('useAppContext must be used within AppProvider')
  }
  return context
}