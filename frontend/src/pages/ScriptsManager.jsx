import React, { useState, useEffect } from 'react';
import './ScriptsManager.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3001';

export default function ScriptsManager() {
  const [scripts, setScripts] = useState([]);
  const [selectedScript, setSelectedScript] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [showNewScriptForm, setShowNewScriptForm] = useState(false);
  const [newScript, setNewScript] = useState({
    name: '',
    content: '',
    category: 'sales'
  });

  useEffect(() => {
    fetchScripts();
  }, []);

  const fetchScripts = async () => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/scripts`);
      if (response.ok) {
        const data = await response.json();
        setScripts(data.scripts);
      }
    } catch (error) {
      console.error('Error fetching scripts:', error);
    }
  };

  const handleCreateScript = async (e) => {
    e.preventDefault();
    setIsLoading(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/scripts`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(newScript),
      });

      if (response.ok) {
        const result = await response.json();
        setScripts(prev => [...prev, result.script]);
        setNewScript({ name: '', content: '', category: 'sales' });
        setShowNewScriptForm(false);
        alert('Script created successfully!');
      } else {
        throw new Error('Failed to create script');
      }
    } catch (error) {
      console.error('Error creating script:', error);
      alert('Error creating script');
    } finally {
      setIsLoading(false);
    }
  };

  const categories = [
    { value: 'sales', label: 'Sales', color: '#10b981' },
    { value: 'followup', label: 'Follow-up', color: '#3b82f6' },
    { value: 'support', label: 'Support', color: '#f59e0b' },
    { value: 'collections', label: 'Collections', color: '#ef4444' },
    { value: 'general', label: 'General', color: '#6b7280' }
  ];

  return (
    <div className="scripts-manager">
      <div className="scripts-header">
        <h2>Call Scripts</h2>
        <button 
          className="btn-primary"
          onClick={() => setShowNewScriptForm(true)}
        >
          + New Script
        </button>
      </div>

      {showNewScriptForm && (
        <div className="new-script-form">
          <h3>Create New Script</h3>
          <form onSubmit={handleCreateScript}>
            <div className="form-group">
              <label>Script Name</label>
              <input
                type="text"
                value={newScript.name}
                onChange={(e) => setNewScript({...newScript, name: e.target.value})}
                placeholder="e.g., Sales Introduction"
                required
              />
            </div>
            
            <div className="form-group">
              <label>Category</label>
              <select
                value={newScript.category}
                onChange={(e) => setNewScript({...newScript, category: e.target.value})}
              >
                {categories.map(cat => (
                  <option key={cat.value} value={cat.value}>
                    {cat.label}
                  </option>
                ))}
              </select>
            </div>
            
            <div className="form-group">
              <label>Script Content</label>
              <textarea
                value={newScript.content}
                onChange={(e) => setNewScript({...newScript, content: e.target.value})}
                placeholder="Enter your call script here... Use [Name], [Company], [Agent] as placeholders"
                rows="8"
                required
              />
            </div>
            
            <div className="form-actions">
              <button 
                type="button" 
                className="btn-secondary"
                onClick={() => setShowNewScriptForm(false)}
              >
                Cancel
              </button>
              <button 
                type="submit" 
                className="btn-primary"
                disabled={isLoading}
              >
                {isLoading ? 'Creating...' : 'Create Script'}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="scripts-grid">
        {scripts.map(script => (
          <div 
            key={script.id} 
            className={`script-card ${selectedScript?.id === script.id ? 'selected' : ''}`}
            onClick={() => setSelectedScript(script)}
          >
            <div className="script-header">
              <h4>{script.name}</h4>
              <span 
                className="script-category"
                style={{ 
                  backgroundColor: categories.find(c => c.value === script.category)?.color || '#6b7280'
                }}
              >
                {categories.find(c => c.value === script.category)?.label}
              </span>
            </div>
            <div className="script-preview">
              {script.content.substring(0, 100)}...
            </div>
            <div className="script-meta">
              Created: {new Date(script.createdAt).toLocaleDateString()}
            </div>
          </div>
        ))}
      </div>

      {selectedScript && (
        <div className="script-detail">
          <div className="script-detail-header">
            <h3>{selectedScript.name}</h3>
            <button 
              className="btn-secondary"
              onClick={() => setSelectedScript(null)}
            >
              Close
            </button>
          </div>
          <div className="script-content">
            {selectedScript.content.split('\n').map((line, index) => (
              <p key={index}>{line}</p>
            ))}
          </div>
          <div className="script-placeholders">
            <h4>Available Placeholders:</h4>
            <div className="placeholders-list">
              <span className="placeholder-tag">[Name]</span>
              <span className="placeholder-tag">[Company]</span>
              <span className="placeholder-tag">[Agent]</span>
              <span className="placeholder-tag">[Date]</span>
              <span className="placeholder-tag">[Product]</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}