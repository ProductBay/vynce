import React, { useState, useEffect, useCallback } from "react";
import apiClient from "../apiClient"; // axios instance with auth, baseURL, etc.
import "./ScriptsManager.css";

export default function ScriptsManager() {
  const [scripts, setScripts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editingScriptId, setEditingScriptId] = useState(null); // "new" | script._id | null
  const [formData, setFormData] = useState({
    name: "",
    content: "",
    category: "sales",
  });
  const [error, setError] = useState(null);

  /**
   * Load scripts (AUTHENTICATED)
   */
  const fetchScripts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await apiClient.get("/scripts");

      // Expecting { scripts: [...] } from backend
      const loadedScripts = response.data?.scripts || response.data || [];

      setScripts(loadedScripts);
      setError(null);
    } catch (err) {
      console.error("Error fetching scripts:", err);

      // If server returned a response, log details
      if (err.response) {
        console.error(
          "GET /api/scripts error response:",
          err.response.status,
          err.response.data
        );
      }

      setError("Failed to load scripts. Please try again.");
      setScripts([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchScripts();
  }, [fetchScripts]);

  /**
   * Normalize script ID field
   * Some backends use _id (Mongo), but UI currently uses script.id.
   */
  const getScriptId = (script) => script.id || script._id;

  const handleEdit = (script) => {
    const id = getScriptId(script);

    setEditingScriptId(id);
    setFormData({
      name: script.name || "",
      content: script.content || "",
      category: script.category || "sales",
    });
  };

  const handleNew = () => {
    setEditingScriptId("new");
    setFormData({
      name: "New Script Name",
      content: "[Agent] introduces Vynce to [Name]...",
      category: "sales",
    });
  };

  const handleDelete = async (e, id) => {
    e.stopPropagation();

    const scriptId = id || editingScriptId;
    if (!scriptId) return;

    if (!window.confirm("Are you sure you want to delete this script?")) return;

    try {
      const res = await apiClient.delete(`/scripts/${scriptId}`);

      await fetchScripts();
      alert("Script deleted successfully.");
    } catch (err) {
      console.error("Delete error:", err);
      if (err.response) {
        console.error(
          "DELETE /api/scripts error response:",
          err.response.status,
          err.response.data
        );
      }
      alert("Failed to delete script.");
    }
  };

  /**
   * Create or update a script
   * Backend contract (based on your earlier description):
   *   POST /api/scripts
   *     - If body has _id → update that script
   *     - Else → create new
   */
  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError(null);

    const isNew = editingScriptId === "new";

    // Build payload for backend: include _id when updating
    const payload = {
      ...formData,
      _id: isNew ? undefined : editingScriptId,
    };

    try {
      // Single POST endpoint for both create & update
      const res = await apiClient.post("/scripts", payload);

      setEditingScriptId(null);
      await fetchScripts();
      alert(`Script ${isNew ? "created" : "updated"} successfully.`);
    } catch (err) {
      console.error("Save error:", err);

      if (err.response) {
        console.error(
          "POST /api/scripts error response:",
          err.response.status,
          err.response.data
        );
      }

      setError("Failed to save script.");
    } finally {
      setSaving(false);
    }
  };

  const handleCancel = () => {
    setEditingScriptId(null);
    setFormData({ name: "", content: "", category: "sales" });
    setError(null);
  };

  /**
   * Format content for preview
   */
  const formatContent = (content, truncate = false) => {
    if (!content) return "";

    let html = content.replace(/\[(\w+)\]/g, (match) =>
      `<span style="color:#4f46e5;font-weight:600;">${match}</span>`
    );

    if (truncate && html.length > 100) {
      html = html.slice(0, 100) + "...";
    }

    return html;
  };

  return (
    <div className="scripts-manager-page">
      <div className="page-header">
        <h1>📝 Call Script Manager</h1>
        <button
          className="btn btn-primary"
          onClick={handleNew}
          disabled={editingScriptId !== null}
        >
          + New Script
        </button>
      </div>

      {error && (
        <div
          className="error-message"
          style={{
            color: "#dc2626",
            background: "#fee2e2",
            padding: "1rem",
            borderRadius: "8px",
          }}
        >
          {error}
        </div>
      )}

      <div className="manager-grid">
        {/* Script List */}
        <div className="script-list-container">
          <h2>Active Scripts ({scripts.length})</h2>

          {loading ? (
            <div className="loading">Loading scripts...</div>
          ) : (
            <div className="script-cards">
              {scripts.map((script) => {
                const id = getScriptId(script);
                return (
                  <div
                    key={id}
                    className={`script-card ${
                      editingScriptId === id ? "editing" : ""
                    }`}
                    onClick={() => handleEdit(script)}
                  >
                    <div className="script-info">
                      <h3>{script.name}</h3>
                      <div className="script-category">
                        {(script.category || "general").toUpperCase()}
                      </div>
                      <p
                        dangerouslySetInnerHTML={{
                          __html: formatContent(script.content, true),
                        }}
                      />
                    </div>

                    <div
                      className="script-actions"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <button
                        className="btn btn-edit"
                        onClick={() => handleEdit(script)}
                      >
                        Edit
                      </button>
                      <button
                        className="btn btn-delete"
                        onClick={(e) => handleDelete(e, id)}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Editor Panel */}
        <div className="script-editor-container">
          {editingScriptId ? (
            <form onSubmit={handleSubmit} className="script-editor">
              <h2>
                {editingScriptId === "new"
                  ? "Create New Script"
                  : `Editing: ${formData.name}`}
              </h2>

              <label>Script Name</label>
              <input
                type="text"
                value={formData.name}
                onChange={(e) =>
                  setFormData({ ...formData, name: e.target.value })
                }
                required
              />

              <label>Category</label>
              <select
                value={formData.category}
                onChange={(e) =>
                  setFormData({ ...formData, category: e.target.value })
                }
              >
                <option value="sales">Sales</option>
                <option value="followup">Follow-up</option>
                <option value="support">Support</option>
                <option value="general">General</option>
              </select>

              <label>Content (Use [Name], [Agent])</label>
              <textarea
                rows="10"
                value={formData.content}
                onChange={(e) =>
                  setFormData({ ...formData, content: e.target.value })
                }
                required
              />

              <div className="button-group">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={handleCancel}
                  disabled={saving}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={saving}
                >
                  {saving
                    ? "Saving..."
                    : editingScriptId === "new"
                    ? "Create Script"
                    : "Update Script"}
                </button>
              </div>

              <div className="script-preview">
                <h3>Live Preview</h3>
                <p
                  dangerouslySetInnerHTML={{
                    __html: formatContent(formData.content),
                  }}
                />
              </div>
            </form>
          ) : (
            <div className="editor-placeholder">
              Select a script or click “+ New Script” to begin.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
