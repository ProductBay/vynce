import React, { useState, useEffect, useCallback } from 'react';
import axios from 'axios'; // Ensure you have 'axios' installed (npm i axios)
import './ScriptsManager.css';

const API_BASE_URL = 'http://localhost:3000';

export default function ScriptsManager() {
    const [scripts, setScripts] = useState([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editingScriptId, setEditingScriptId] = useState(null);
    const [formData, setFormData] = useState({ name: '', content: '', category: 'sales' });
    const [error, setError] = useState(null);

    const fetchScripts = useCallback(async () => {
        setLoading(true);
        try {
            const response = await axios.get(`${API_BASE_URL}/api/scripts`);
            setScripts(response.data.scripts);
            setError(null);
        } catch (error) {
            setError("Failed to load scripts. Check backend console.");
            console.error('Error fetching scripts:', error);
            setScripts([]);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchScripts();
    }, [fetchScripts]);

    const handleEdit = (script) => {
        setEditingScriptId(script.id);
        setFormData({ name: script.name, content: script.content, category: script.category });
    };

    const handleNew = () => {
        setEditingScriptId('new');
        setFormData({ name: 'New Script Name', content: '[Agent] introduces Vynce to [Name]...', category: 'sales' });
    };

    const handleDelete = async (e, id) => {
        e.stopPropagation();
        if (!confirm('Are you sure you want to delete this script? This cannot be undone.')) return;
        
        try {
            await axios.delete(`${API_BASE_URL}/api/scripts/${id}`);
            alert('Script deleted successfully.');
            fetchScripts();
        } catch (error) {
            alert('Failed to delete script. Check if ID exists.');
            console.error('Delete error:', error);
        }
    };

    const handleSubmit = async (e) => {
        e.preventDefault();
        setSaving(true);

        const isNew = editingScriptId === 'new';
        const method = isNew ? 'POST' : 'PUT';
        const url = isNew 
            ? `${API_BASE_URL}/api/scripts` 
            : `${API_BASE_URL}/api/scripts/${editingScriptId}`;
        
        try {
            await axios({ method, url, data: formData });
            
            setEditingScriptId(null);
            setSaving(false);
            fetchScripts();
            alert(`Script successfully ${isNew ? 'created' : 'updated'}!`);
        } catch (error) {
            setError("Failed to save script.");
            setSaving(false);
        }
    };

    const handleCancel = () => {
        setEditingScriptId(null);
        setFormData({ name: '', content: '', category: 'sales' });
        setError(null);
    };

    // Helper to format content for display
    const formatContent = (content, truncate = false) => {
        let html = content.replace(/\[(\w+)\]/g, (match) => 
            `<span style="color: #4f46e5; font-weight: 600;">${match}</span>`
        );
        if (truncate) {
            html = html.length > 100 ? html.slice(0, 100) + '...' : html;
        }
        return html;
    };

    return (
        <div className="scripts-manager-page">
            <div className="page-header">
                <h1>📝 Call Script Manager</h1>
                <button className="btn btn-primary" onClick={handleNew} disabled={editingScriptId !== null}>
                    + New Script
                </button>
            </div>
            
            {error && <div className="error-message" style={{color: '#dc2626', background: '#fee2e2', padding: '1rem', borderRadius: '8px'}}>{error}</div>}

            <div className="manager-grid">
                {/* Script List */}
                <div className="script-list-container">
                    <h2>Active Scripts ({scripts.length})</h2>
                    {loading ? (
                        <div className="loading">Loading scripts...</div>
                    ) : (
                        <div className="script-cards">
                            {scripts.map(script => (
                                <div 
                                    key={script.id} 
                                    className={`script-card ${editingScriptId === script.id ? 'editing' : ''}`} 
                                    onClick={() => handleEdit(script)}
                                >
                                    <div className="script-info">
                                        <h3>{script.name}</h3>
                                        <div className="script-category">{script.category.toUpperCase()}</div>
                                        <p dangerouslySetInnerHTML={{ __html: formatContent(script.content, true) }} />
                                    </div>
                                    <div className="script-actions" onClick={e => e.stopPropagation()}>
                                        <button className="btn btn-edit" onClick={() => handleEdit(script)}>Edit</button>
                                        <button className="btn btn-delete" onClick={(e) => handleDelete(e, script.id)}>Delete</button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Editor Panel */}
                <div className="script-editor-container">
                    {editingScriptId ? (
                        <form onSubmit={handleSubmit} className="script-editor">
                            <h2>{editingScriptId === 'new' ? 'Create New Script' : `Editing: ${formData.name}`}</h2>
                            
                            <label>Script Name</label>
                            <input type="text" value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})} required />

                            <label>Category</label>
                            <select value={formData.category} onChange={e => setFormData({...formData, category: e.target.value})}>
                                <option value="sales">Sales</option>
                                <option value="followup">Follow-up</option>
                                <option value="support">Support</option>
                                <option value="general">General</option>
                            </select>

                            <label>Content (Use [Name], [Agent] for dynamic fields)</label>
                            <textarea value={formData.content} onChange={e => setFormData({...formData, content: e.target.value})} rows="10" required />

                            <div className="button-group">
                                <button type="button" className="btn btn-secondary" onClick={handleCancel} disabled={saving}>Cancel</button>
                                <button type="submit" className="btn btn-primary" disabled={saving}>
                                    {saving ? 'Saving...' : (editingScriptId === 'new' ? 'Create Script' : 'Update Script')}
                                </button>
                            </div>

                            <div className="script-preview">
                                <h3>Live Preview:</h3>
                                <p dangerouslySetInnerHTML={{ __html: formatContent(formData.content) }} />
                            </div>

                        </form>
                    ) : (
                        <div className="editor-placeholder">
                            Select a script to edit or click '+ New Script' to begin managing content.
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}