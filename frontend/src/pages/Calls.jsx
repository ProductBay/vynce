// src/pages/Calls.jsx - FINAL COMPLETE VERSION (CONTACTS DISPLAYED IN TABLE + MODAL)
import React, { useState, useEffect, useCallback } from 'react'
import './Calls.css'
import API_BASE_URL from '../api'; 



export default function Calls() {
  const [calls, setCalls] = useState([])
  const [filter, setFilter] = useState('all')
  const [loading, setLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')
  const [sortBy, setSortBy] = useState('newest')
  const [selectedCalls, setSelectedCalls] = useState([])
  const [showCallModal, setShowCallModal] = useState(false)
  const [activeCall, setActiveCall] = useState(null)
  const [callNotes, setCallNotes] = useState('')
  const [callOutcome, setCallOutcome] = useState('')
  const [currentTime, setCurrentTime] = useState(Date.now()) // State for live clock tick

  // --- Live Timer Tick (Forces duration update every second) ---
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(Date.now())
    }, 1000)
    return () => clearInterval(timer)
  }, [])
  // --- End Timer Tick ---


  const fetchCalls = useCallback(async () => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/calls`)
      if (res.ok) {
        const data = await res.json()
        setCalls(Array.isArray(data) ? data : [])
      }
    } catch (err) {
      console.error('Failed to fetch calls:', err)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchCalls()
    const interval = setInterval(fetchCalls, 5000) // Fetch every 5s to sync data
    return () => clearInterval(interval)
  }, [fetchCalls])


  // CORE FIX: Duration calculation logic
  const formatDuration = (call) => {
    const status = call.status;
    
    // 1. If the call has a final fixed duration, use it and STOP counting.
    if (call.duration && call.duration.includes(':')) {
        return call.duration; 
    }

    // Define active states
    const isActive = ['dialing', 'ringing', 'answered', 'initiated'].includes(status);

    // 2. If status is ACTIVE, calculate LIVE duration.
    if (isActive && call.createdAt) {
      const startTime = new Date(call.createdAt).getTime();
      const diffSeconds = Math.floor((currentTime - startTime) / 1000);

      const mins = Math.floor(diffSeconds / 60);
      const secs = diffSeconds % 60;
      return `${mins}:${secs.toString().padStart(2, '0')}`;
    }
    
    // 3. Default for inactive/non-fixed
    return call.duration || '0:00';
  }


  // End single call
  const endCall = async (uuid) => {
    if (!uuid) return
    try {
      const res = await fetch(`${API_BASE_URL}/api/end-call`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uuid })
      })
      if (res.ok) {
        // Fetch immediately after successful end to get the final duration
        fetchCalls()
        setShowCallModal(false)
      }
    } catch (err) {
      console.error('Failed to end call:', err)
      alert('Failed to end call')
    }
  }

  // End multiple calls
  const endSelectedCalls = async () => {
    if (selectedCalls.length === 0) return
    for (const uuid of selectedCalls) {
      await endCall(uuid)
    }
    setSelectedCalls([])
  }

  // Save call notes
  const saveCallNotes = async () => {
    if (!activeCall) return
    try {
      // NOTE: Ensure your backend supports /api/calls/:uuid/notes and requires token
      await fetch(`${API_BASE_URL}/api/calls/${activeCall.uuid}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: callNotes,
          outcome: callOutcome
        })
      })
      alert('Notes saved!')
      setShowCallModal(false)
      fetchCalls()
    } catch (err) {
      console.error('Failed to save notes:', err)
    }
  }

  // Open call detail modal
  const openCallModal = (call) => {
    setActiveCall(call)
    setCallNotes(call.notes || '')
    setCallOutcome(call.outcome || '')
    setShowCallModal(true)
  }

  // Helper to extract and structure contact info for rendering
  const formatContactInfo = (call) => {
    if (!call || !call.number) return { name: 'Unknown', address: '' };
    
    // Use metadata as the source
    const name = call.metadata?.name || 'Unknown';
    const address = call.metadata?.address || '';

    return { name, address };
  }
  
  // Format phone number
  const formatPhone = (phone) => {
    if (!phone) return '--'
    const clean = phone.toString().replace(/\D/g, '')
    if (clean.length === 11 && clean.startsWith('1')) {
      return `+1 (${clean.slice(1,4)}) ${clean.slice(4,7)}-${clean.slice(7)}`
    }
    if (clean.length === 10) {
      return `(${clean.slice(0,3)}) ${clean.slice(3,6)}-${clean.slice(6)}`
    }
    return phone
  }

  // Format time (kept existing logic)
  const formatTime = (date) => {
    if (!date) return '--'
    return new Date(date).toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    })
  }

  // Format date (kept existing logic)
  const formatDate = (date) => {
    if (!date) return '--'
    return new Date(date).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    })
  }

  // Status badge (kept existing logic)
  const getStatusBadge = (status) => {
    const statusStyles = {
      initiated: { bg: '#dbeafe', color: '#1d4ed8', icon: '🔄', label: 'Initiated' },
      dialing: { bg: '#fef3c7', color: '#92400e', icon: '📞', label: 'Dialing' },
      ringing: { bg: '#e0e7ff', color: '#4338ca', icon: '🔔', label: 'Ringing' },
      answered: { bg: '#d1fae5', color: '#065f46', icon: '✅', label: 'Answered' },
      completed: { bg: '#f3f4f6', color: '#374151', icon: '✓', label: 'Completed' },
      ended: { bg: '#e5e7eb', color: '#6b7280', icon: '⏹️', label: 'Ended' },
      failed: { bg: '#fee2e2', color: '#991b1b', icon: '❌', label: 'Failed' },
      busy: { bg: '#fef3c7', color: '#92400e', icon: '📵', label: 'Busy' },
      voicemail: { bg: '#fae8ff', color: '#86198f', icon: '📬', label: 'Voicemail' },
      queued: { bg: '#f0fdf4', color: '#166534', icon: '⏳', label: 'Queued' }
    }
    const s = statusStyles[status] || statusStyles.ended
    return (
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '13px',
        fontWeight: '600',
        background: s.bg,
        color: s.color
      }}>
        <span>{s.icon}</span>
        <span>{s.label}</span>
      </span>
    )
  }

  // Type badge (kept existing logic)
  const getTypeBadge = (type) => {
    if (type === 'bulk' || type === 'csv') {
      return (
        <span style={{
          padding: '4px 10px',
          borderRadius: '12px',
          fontSize: '12px',
          fontWeight: '500',
          background: '#dbeafe',
          color: '#1d4ed8'
        }}>
          📋 Bulk/CSV
        </span>
      )
    }
    return (
      <span style={{
        padding: '4px 10px',
        borderRadius: '12px',
        fontSize: '12px',
        fontWeight: '500',
        background: '#f0fdf4',
        color: '#166534'
      }}>
        📞 Single
      </span>
    )
  }

  // Filter and sort calls (kept existing logic)
  const getFilteredCalls = () => {
    let filtered = [...calls]

    // Filter by status
    if (filter === 'active') {
      filtered = filtered.filter(c => ['dialing', 'ringing', 'answered', 'initiated'].includes(c.status))
    } else if (filter === 'completed') {
      filtered = filtered.filter(c => ['completed', 'ended'].includes(c.status))
    } else if (filter === 'failed') {
      filtered = filtered.filter(c => ['failed', 'busy'].includes(c.status))
    } else if (filter === 'voicemail') {
      filtered = filtered.filter(c => c.status === 'voicemail' || c.voicemailDetected)
    }

    // Search filter
    if (searchTerm) {
      const search = searchTerm.toLowerCase()
      filtered = filtered.filter(c => 
        c.number?.toLowerCase().includes(search) ||
        c.metadata?.name?.toLowerCase().includes(search) ||
        c.status?.toLowerCase().includes(search)
      )
    }

    // Sort
    if (sortBy === 'newest') {
      filtered.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    } else if (sortBy === 'oldest') {
      filtered.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    } else if (sortBy === 'status') {
      const statusOrder = ['answered', 'ringing', 'dialing', 'initiated', 'queued', 'completed', 'ended', 'failed']
      filtered.sort((a, b) => statusOrder.indexOf(a.status) - statusOrder.indexOf(b.status))
    }

    return filtered
  }

  const filteredCalls = getFilteredCalls()

  // Stats (kept existing logic)
  const stats = {
    total: calls.length,
    active: calls.filter(c => ['dialing', 'ringing', 'answered', 'initiated'].includes(c.status)).length,
    completed: calls.filter(c => ['completed', 'ended'].includes(c.status)).length,
    failed: calls.filter(c => ['failed', 'busy'].includes(c.status)).length,
    voicemail: calls.filter(c => c.status === 'voicemail' || c.voicemailDetected).length
  }

  // Toggle call selection (kept existing logic)
  const toggleCallSelection = (uuid) => {
    if (selectedCalls.includes(uuid)) {
      setSelectedCalls(selectedCalls.filter(id => id !== uuid))
    } else {
      setSelectedCalls([...selectedCalls, uuid])
    }
  }

  // Select all visible calls (kept existing logic)
  const selectAllCalls = () => {
    if (selectedCalls.length === filteredCalls.length) {
      setSelectedCalls([])
    } else {
      setSelectedCalls(filteredCalls.map(c => c.uuid))
    }
  }

  return (
    <div className="calls-page">
      
        
      {/* Page Header */}
      <div className="page-header">
        <div className="header-left">
          <h1>📞 Calls Dashboard</h1>
          <p className="header-subtitle">Live view of all calls - Single & Bulk CSV</p>
        </div>
        <div className="header-right">
          <button onClick={fetchCalls} className="btn btn-secondary">
            🔄 Refresh
          </button>
          {selectedCalls.length > 0 && (
            <button onClick={endSelectedCalls} className="btn btn-danger">
              🛑 End {selectedCalls.length} Calls
            </button>
          )}
        </div>
      </div>

      {/* Stats Cards */}
      <div className="stats-grid">
        <div className="stat-card total" onClick={() => setFilter('all')}>
          <div className="stat-icon">📊</div>
          <div className="stat-content">
            <div className="stat-number">{stats.total}</div>
            <div className="stat-label">Total Calls</div>
          </div>
        </div>
        <div className="stat-card active" onClick={() => setFilter('active')}>
          <div className="stat-icon pulse">📞</div>
          <div className="stat-content">
            <div className="stat-number">{stats.active}</div>
            <div className="stat-label">Active Now</div>
          </div>
        </div>
        <div className="stat-card completed" onClick={() => setFilter('completed')}>
          <div className="stat-icon">✅</div>
          <div className="stat-content">
            <div className="stat-number">{stats.completed}</div>
            <div className="stat-label">Completed</div>
          </div>
        </div>
        <div className="stat-card failed" onClick={() => setFilter('failed')}>
          <div className="stat-icon">❌</div>
          <div className="stat-content">
            <div className="stat-number">{stats.failed}</div>
            <div className="stat-label">Failed</div>
          </div>
        </div>
        <div className="stat-card voicemail" onClick={() => setFilter('voicemail')}>
          <div className="stat-icon">📬</div>
          <div className="stat-content">
            <div className="stat-number">{stats.voicemail}</div>
            <div className="stat-label">Voicemail</div>
          </div>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="controls-bar">
        <div className="filter-tabs">
          {[
            { key: 'all', label: 'All Calls' },
            { key: 'active', label: 'Active' },
            { key: 'completed', label: 'Completed' },
            { key: 'failed', label: 'Failed' },
            { key: 'voicemail', label: 'Voicemail' }
          ].map(f => (
            <button
              key={f.key}
              className={`filter-btn ${filter === f.key ? 'active' : ''}`}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key !== 'all' && (
                <span className="filter-count">
                  {f.key === 'active' ? stats.active : 
                   f.key === 'completed' ? stats.completed :
                   f.key === 'failed' ? stats.failed :
                   f.key === 'voicemail' ? stats.voicemail : ''}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="controls-right">
          <div className="search-box">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              placeholder="Search by number, name, status..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
            />
            {searchTerm && (
              <button className="clear-search" onClick={() => setSearchTerm('')}>✕</button>
            )}
          </div>

          <select 
            className="sort-select"
            value={sortBy} 
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="newest">Newest First</option>
            <option value="oldest">Oldest First</option>
            <option value="status">By Status</option>
          </select>
        </div>
      </div>

      {/* Calls Table */}
      <div className="calls-table-container">
        {loading ? (
          <div className="loading-state">
            <div className="spinner"></div>
            <p>Loading calls...</p>
          </div>
        ) : filteredCalls.length === 0 ? (
          <div className="empty-state">
            <div className="empty-icon">📭</div>
            <h3>No calls found</h3>
            <p>
              {filter !== 'all' 
                ? `No ${filter} calls. Try a different filter.`
                : 'Upload a CSV or make a single call from the Topbar to get started.'
              }
            </p>
            <button onClick={() => setFilter('all')} className="btn btn-primary">
              Show All Calls
            </button>
          </div>
        ) : (
          <table className="calls-table">
            <thead>
              <tr>
                <th className="checkbox-col">
                  <input
                    type="checkbox"
                    checked={selectedCalls.length === filteredCalls.length && filteredCalls.length > 0}
                    onChange={selectAllCalls}
                  />
                </th>
                <th>Contact</th>
                <th>Status</th>
                <th>Type</th>
                <th>Duration</th>
                <th>Started</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredCalls.map((call, idx) => {
                const contact = formatContactInfo(call); // Get structured contact data
                return (
                  <tr 
                    key={call.uuid || idx} 
                    className={`call-row ${selectedCalls.includes(call.uuid) ? 'selected' : ''}`}
                    onClick={() => openCallModal(call)}
                  >
                    <td className="checkbox-col" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selectedCalls.includes(call.uuid)}
                        onChange={() => toggleCallSelection(call.uuid)}
                      />
                    </td>
                    
                    {/* CONTACT CELL (Name + Address + Phone) */}
                    <td className="contact-cell">
                      <div className="contact-info">
                        <span className="phone-number">{formatPhone(call.number)}</span>
                        {contact.name !== 'Unknown' && (
                          <span className="contact-name">👤 {contact.name}</span>
                        )}
                        {contact.address && (
                          <span className="contact-address">📍 {contact.address}</span>
                        )}
                      </div>
                    </td>
                    
                    <td>{getStatusBadge(call.status)}</td>
                    <td>{getTypeBadge(call.type)}</td>
                    
                    {/* DURATION CELL (Uses formatDuration) */}
                    <td className="duration-cell" style={{ fontWeight: '600', fontFamily: 'monospace' }}>
                      <span className="live-duration">
                        {formatDuration(call)} {/* Passed the full call object */}
                        {['dialing', 'ringing', 'answered', 'initiated'].includes(call.status) && ' ⏱️'}
                      </span>
                    </td>
                    
                    <td className="time-cell">
                      <div className="time-info">
                        <span className="time">{formatTime(call.createdAt)}</span>
                        <span className="date">{formatDate(call.createdAt)}</span>
                      </div>
                    </td>
                    <td className="actions-cell" onClick={(e) => e.stopPropagation()}>
                      {['dialing', 'ringing', 'answered', 'initiated'].includes(call.status) ? (
                        <button className="btn btn-end" onClick={() => endCall(call.uuid)}>🛑 End</button>
                      ) : (
                        <button className="btn btn-view" onClick={() => openCallModal(call)}>👁️ View</button>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Results count */}
      <div className="results-footer">
        Showing {filteredCalls.length} of {calls.length} calls
        {searchTerm && ` matching "${searchTerm}"`}
      </div>

      {/* Call Detail Modal */}
      {showCallModal && activeCall && (
        <div className="modal-overlay" onClick={() => setShowCallModal(false)}>
          <div className="modal-content call-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>📞 Call Details</h2>
              <button className="close-btn" onClick={() => setShowCallModal(false)}>✕</button>
            </div>

            <div className="modal-body">
    {/* Call Info */}
    <div className="call-info-section">
        <div className="call-number-large">{formatPhone(activeCall.number)}</div>
        
        {/* Customer Name (Injecting here, outside the grid for large display) */}
        {activeCall.metadata?.name && activeCall.metadata.name !== 'Unknown' && (
            <div className="call-customer-name" style={{ marginBottom: '1.5rem', fontWeight: 600, fontSize: '1.1rem' }}>
                👤 {activeCall.metadata.name}
            </div>
        )}
        
        <div className="call-status-large">{getStatusBadge(activeCall.status)}</div>
        
        {/* Call Meta Grid */}
        <div className="call-meta-grid">
            
            {/* 🎯 NEW INJECTION POINT 1: Contact Name (inside grid, if needed) */}
            {activeCall.metadata?.name && activeCall.metadata.name !== 'Unknown' && (
                <div className="meta-item">
                    <span className="meta-label">Contact Name</span>
                    <span className="meta-value">{activeCall.metadata.name}</span>
                </div>
            )}
            
            {/* 🎯 NEW INJECTION POINT 2: Address */}
            {activeCall.metadata?.address && (
                <div className="meta-item">
                    <span className="meta-label">Address</span>
                    <span className="meta-value">{activeCall.metadata.address}</span>
                </div>
            )}
            
            <div className="meta-item">
                <span className="meta-label">Duration</span>
                <span className="meta-value">{formatDuration(activeCall)}</span>
            </div>
            <div className="meta-item">
                <span className="meta-label">Type</span>
                <span className="meta-value">{getTypeBadge(activeCall.type)}</span>
            </div>
            <div className="meta-item">
                <span className="meta-label">Started (Time)</span>
                <span className="meta-value">{formatTime(activeCall.createdAt)}</span>
            </div>
        </div>
    </div>

              {/* Notes Section */}
              <div className="notes-section">
                <h3>📝 Call Notes</h3>
                <textarea
                  placeholder="Add notes about this call..."
                  value={callNotes}
                  onChange={(e) => setCallNotes(e.target.value)}
                  rows={4}
                />

                <div className="outcome-row">
                  <label>Outcome:</label>
                  <select value={callOutcome} onChange={(e) => setCallOutcome(e.target.value)}>
                    <option value="">Select outcome...</option>
                    <option value="interested">✅ Interested</option>
                    <option value="not_interested">❌ Not Interested</option>
                    <option value="callback">📞 Callback Requested</option>
                    <option value="no_answer">📵 No Answer</option>
                    <option value="voicemail">📬 Left Voicemail</option>
                    <option value="wrong_number">🚫 Wrong Number</option>
                  </select>
                </div>
              </div>
            </div>

            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setShowCallModal(false)}>
                Close
              </button>
              <button className="btn btn-primary" onClick={saveCallNotes}>
                💾 Save Notes
              </button>
              {['dialing', 'ringing', 'answered', 'initiated'].includes(activeCall.status) && (
                <button className="btn btn-danger" onClick={() => endCall(activeCall.uuid)}>
                  🛑 End Call
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}