import React, { useState, useEffect } from 'react';
import './VoicemailManager.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export default function VoicemailManager() {  // Make sure this says 'export default'
  const [messages, setMessages] = useState([]);
  const [isEnabled, setIsEnabled] = useState(true);
  const [showNewMessageForm, setShowNewMessageForm] = useState(false);
  const [newMessage, setNewMessage] = useState({
    name: '',
    content: ''
  });

  useEffect(() => {
    fetchVoicemailMessages();
  }, []);

  const fetchVoicemailMessages = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/voicemail-messages`);
      if (response.ok) {
        const data = await response.json();
        setMessages(data.messages);
        setIsEnabled(data.enabled);
      }
    } catch (error) {
      console.error('Error fetching voicemail messages:', error);
    }
  };

  const handleCreateMessage = async (e) => {
    e.preventDefault();
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/voicemail-messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newMessage),
      });

      if (response.ok) {
        const result = await response.json();
        setMessages(prev => [...prev, result.voicemailMessage]);
        setNewMessage({ name: '', content: '' });
        setShowNewMessageForm(false);
        alert('Voicemail message created successfully!');
      } else {
        throw new Error('Failed to create message');
      }
    } catch (error) {
      console.error('Error creating voicemail message:', error);
      alert('Error creating voicemail message');
    }
  };

  const toggleVoicemail = async () => {
    setIsEnabled(!isEnabled);
    alert(`Voicemail messaging ${!isEnabled ? 'enabled' : 'disabled'}`);
  };

  return (
    <div className="voicemail-manager">
      <div className="voicemail-header">
        <div className="header-info">
          <h2>Voicemail Messaging</h2>
          <div className={`status-badge ${isEnabled ? 'enabled' : 'disabled'}`}>
            {isEnabled ? '🟢 Enabled' : '🔴 Disabled'}
          </div>
        </div>
        <div className="header-actions">
          <button 
            className={`toggle-btn ${isEnabled ? 'disable' : 'enable'}`}
            onClick={toggleVoicemail}
          >
            {isEnabled ? 'Disable' : 'Enable'} Voicemail
          </button>
          <button 
            className="btn-primary"
            onClick={() => setShowNewMessageForm(true)}
          >
            + New Message
          </button>
        </div>
      </div>

      <div className="voicemail-description">
        <p>
          When a call goes to voicemail, Vynce will automatically leave one of these messages. 
          Use placeholders like <code>[Agent]</code>, <code>[Number]</code>, and <code>[Company]</code> for personalization.
        </p>
      </div>

      {showNewMessageForm && (
        <div className="new-message-form">
          <h3>Create New Voicemail Message</h3>
          <form onSubmit={handleCreateMessage}>
            <div className="form-group">
              <label>Message Name</label>
              <input
                type="text"
                value={newMessage.name}
                onChange={(e) => setNewMessage({...newMessage, name: e.target.value})}
                placeholder="e.g., Sales Follow-up"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Message Content</label>
              <textarea
                value={newMessage.content}
                onChange={(e) => setNewMessage({...newMessage, content: e.target.value})}
                placeholder="Hello, this is [Agent] from Vynce calling..."
                rows="6"
                required
              />
              <div className="character-count">
                {newMessage.content.length} characters
                {newMessage.content.length > 160 && (
                  <span className="warning"> (Message might be too long)</span>
                )}
              </div>
            </div>
            
            <div className="placeholders-guide">
              <strong>Available Placeholders:</strong>
              <div className="placeholders-list">
                <span><code>[Agent]</code> - Agent name</span>
                <span><code>[Number]</code> - Callback number</span>
                <span><code>[Company]</code> - Customer company</span>
                <span><code>[Product]</code> - Product name</span>
              </div>
            </div>
            
            <div className="form-actions">
              <button 
                type="button" 
                className="btn-secondary"
                onClick={() => setShowNewMessageForm(false)}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn-primary"
              >
                Create Message
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="messages-grid">
        {messages.map(message => (
          <div key={message.id} className="message-card">
            <div className="message-header">
              <h4>{message.name}</h4>
              <div className="message-status">
                {message.isActive ? '🟢 Active' : '🔴 Inactive'}
              </div>
            </div>
            <div className="message-content">
              {message.content}
            </div>
            <div className="message-preview">
              <strong>Preview:</strong> 
              <div className="preview-text">
                {message.content
                  .replace(/\[Agent\]/g, 'Sarah')
                  .replace(/\[Number\]/g, '555-0123')
                  .replace(/\[Company\]/g, 'Acme Inc')
                }
              </div>
            </div>
          </div>
        ))}
      </div>

      {messages.length === 0 && !showNewMessageForm && (
        <div className="no-messages">
          <div className="no-messages-icon">📱</div>
          <h3>No Voicemail Messages</h3>
          <p>Create your first voicemail message to start leaving automated voicemails.</p>
          <button 
            className="btn-primary"
            onClick={() => setShowNewMessageForm(true)}
          >
            Create First Message
          </button>
        </div>
      )}
    </div>
  );
}