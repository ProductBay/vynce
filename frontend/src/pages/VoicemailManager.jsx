import React, { useEffect, useMemo, useState } from "react";
import "./VoicemailManager.css";
import { useAuth } from "../components/AuthContext";

export default function VoicemailManager() {
  const { authFetch } = useAuth();
  const [messages, setMessages] = useState([]);
  const [voices, setVoices] = useState([]);
  const [activeId, setActiveId] = useState("");
  const [isEnabled, setIsEnabled] = useState(true);
  const [showNewMessageForm, setShowNewMessageForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newMessage, setNewMessage] = useState({
    name: "",
    content: "",
    voiceId: "Amy",
  });

  const activeMessage = useMemo(
    () => messages.find((message) => message.id === activeId || message._id === activeId),
    [activeId, messages]
  );

  const fetchVoicemailMessages = async () => {
    try {
      const response = await authFetch("/api/voicemail-messages");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data.message || "Failed to load voicemail messages.");
      }

      setMessages(data.messages || []);
      setVoices(data.voices || []);
      setActiveId(data.activeId || "");
      setIsEnabled(Boolean(data.enabled));
      setNewMessage((previous) => ({
        ...previous,
        voiceId: data.voices?.[0]?.id || previous.voiceId,
      }));
    } catch (error) {
      console.error("Error fetching voicemail messages:", error);
      alert(error.message || "Failed to load voicemail messages.");
    }
  };

  useEffect(() => {
    fetchVoicemailMessages();
  }, []);

  const handleCreateMessage = async (event) => {
    event.preventDefault();
    setSaving(true);

    try {
      const response = await authFetch("/api/voicemail-messages", {
        method: "POST",
        body: JSON.stringify({
          ...newMessage,
          isActive: messages.length === 0,
        }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Failed to save voicemail message.");
      }

      await fetchVoicemailMessages();
      setNewMessage({
        name: "",
        content: "",
        voiceId: voices[0]?.id || "Amy",
      });
      setShowNewMessageForm(false);
      alert("Voicemail message saved successfully.");
    } catch (error) {
      console.error("Error creating voicemail message:", error);
      alert(error.message || "Failed to save voicemail message.");
    } finally {
      setSaving(false);
    }
  };

  const toggleVoicemail = async () => {
    setSaving(true);
    try {
      const response = await authFetch("/api/voicemail-settings", {
        method: "POST",
        body: JSON.stringify({ enabled: !isEnabled }),
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Failed to update voicemail settings.");
      }

      setIsEnabled(Boolean(result.enabled));
    } catch (error) {
      console.error("Error updating voicemail settings:", error);
      alert(error.message || "Failed to update voicemail settings.");
    } finally {
      setSaving(false);
    }
  };

  const activateMessage = async (messageId) => {
    setSaving(true);
    try {
      const response = await authFetch(`/api/voicemail-messages/${messageId}/activate`, {
        method: "POST",
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(result.message || "Failed to activate voicemail message.");
      }

      await fetchVoicemailMessages();
    } catch (error) {
      console.error("Error activating voicemail message:", error);
      alert(error.message || "Failed to activate voicemail message.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="voicemail-manager">
      <div className="voicemail-header">
        <div className="header-info">
          <h2>Voicemail Messaging</h2>
          <div className={`status-badge ${isEnabled ? "enabled" : "disabled"}`}>
            {isEnabled ? "Enabled" : "Disabled"}
          </div>
          {activeMessage && (
            <div className="active-voicemail-meta">
              Active message: <strong>{activeMessage.name}</strong>
            </div>
          )}
        </div>
        <div className="header-actions">
          <button
            className={`toggle-btn ${isEnabled ? "disable" : "enable"}`}
            onClick={toggleVoicemail}
            disabled={saving}
          >
            {isEnabled ? "Disable" : "Enable"} Voicemail
          </button>
          <button
            className="btn-primary"
            onClick={() => setShowNewMessageForm(true)}
            disabled={saving}
          >
            + New Message
          </button>
        </div>
      </div>

      <div className="voicemail-description">
        <p>
          When a call is detected as voicemail, Vynce can transfer the live call
          into an AI text-to-speech message using the active template below.
          Use placeholders like <code>[Agent]</code>, <code>[Number]</code>,
          <code>[Company]</code>, <code>[Name]</code>, and <code>[Product]</code>.
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
                onChange={(event) =>
                  setNewMessage({ ...newMessage, name: event.target.value })
                }
                placeholder="e.g., Sales Follow-up"
                required
              />
            </div>

            <div className="form-group">
              <label>Voice</label>
              <select
                value={newMessage.voiceId}
                onChange={(event) =>
                  setNewMessage({ ...newMessage, voiceId: event.target.value })
                }
                required
              >
                {voices.map((voice) => (
                  <option key={voice.id} value={voice.id}>
                    {voice.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="form-group">
              <label>Message Content</label>
              <textarea
                value={newMessage.content}
                onChange={(event) =>
                  setNewMessage({ ...newMessage, content: event.target.value })
                }
                placeholder="Hello, this is [Agent] from [Company] calling..."
                rows="6"
                required
              />
              <div className="character-count">
                {newMessage.content.length} characters
              </div>
            </div>

            <div className="placeholders-guide">
              <strong>Available Placeholders:</strong>
              <div className="placeholders-list">
                <span>
                  <code>[Agent]</code> - Agent name
                </span>
                <span>
                  <code>[Number]</code> - Callback number
                </span>
                <span>
                  <code>[Company]</code> - Company name
                </span>
                <span>
                  <code>[Name]</code> - Contact name
                </span>
                <span>
                  <code>[Product]</code> - Product or offer
                </span>
              </div>
            </div>

            <div className="form-actions">
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setShowNewMessageForm(false)}
                disabled={saving}
              >
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={saving}>
                {saving ? "Saving..." : "Save Message"}
              </button>
            </div>
          </form>
        </div>
      )}

      <div className="messages-grid">
        {messages.map((message) => {
          const isActiveMessage =
            message.id === activeId || message._id === activeId || message.isActive;

          return (
            <div
              key={message.id || message._id}
              className={`message-card ${isActiveMessage ? "active-card" : ""}`}
            >
              <div className="message-header">
                <h4>{message.name}</h4>
                <div className="message-status">
                  {isActiveMessage ? "Active" : "Standby"}
                </div>
              </div>
              <div className="message-content">{message.content}</div>
              <div className="message-preview">
                <strong>Preview:</strong>
                <div className="preview-text">
                  {message.content
                    .replace(/\[Agent\]/g, "Sarah")
                    .replace(/\[Number\]/g, "(555) 010-1234")
                    .replace(/\[Company\]/g, "Vynce")
                    .replace(/\[Name\]/g, "Alex")
                    .replace(/\[Product\]/g, "our platform")}
                </div>
              </div>
              <div className="message-meta">
                <span>
                  Voice:{" "}
                  {voices.find((voice) => voice.id === message.voiceId)?.label ||
                    message.voiceId}
                </span>
                {!isActiveMessage && (
                  <button
                    className="btn-secondary"
                    onClick={() => activateMessage(message.id || message._id)}
                    disabled={saving}
                  >
                    Set Active
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {messages.length === 0 && !showNewMessageForm && (
        <div className="no-messages">
          <div className="no-messages-icon">Voicemail</div>
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
