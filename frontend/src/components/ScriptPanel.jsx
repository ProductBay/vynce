import React, { useState, useEffect } from 'react';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'http://localhost:3000';

export default function ScriptsPanel({ onScriptSelect, selectedScript }) {
  const [scripts, setScripts] = useState([]);
  const [filter, setFilter] = useState('all');

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

  const filteredScripts = filter === 'all' 
    ? scripts 
    : scripts.filter(script => script.category === filter);

  const categories = [
    { value: 'all', label: 'All Scripts' },
    { value: 'sales', label: 'Sales' },
    { value: 'followup', label: 'Follow-up' },
    { value: 'support', label: 'Support' },
    { value: 'collections', label: 'Collections' }
  ];

  return (
    <div className="scripts-panel">
      <div className="scripts-filter">
        {categories.map(cat => (
          <button
            key={cat.value}
            className={`filter-btn ${filter === cat.value ? 'active' : ''}`}
            onClick={() => setFilter(cat.value)}
          >
            {cat.label}
          </button>
        ))}
      </div>
      
      <div className="scripts-list">
        {filteredScripts.map(script => (
          <div
            key={script.id}
            className={`script-item ${selectedScript?.id === script.id ? 'selected' : ''}`}
            onClick={() => onScriptSelect(script)}
          >
            <div className="script-item-name">{script.name}</div>
            <div className="script-item-category">{script.category}</div>
          </div>
        ))}
      </div>
    </div>
  );
}