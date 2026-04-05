import { useEffect, useMemo, useState } from "react";
import apiClient from "../apiClient";
import { useAuth } from "../components/AuthContext";
import "../styles/Support.css";

export default function Messages() {
  const { user } = useAuth();
  const [conversations, setConversations] = useState([]);
  const [selectedId, setSelectedId] = useState("");
  const [messages, setMessages] = useState([]);
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);
  const [threadLoading, setThreadLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const [status, setStatus] = useState(null);

  const selectedConversation = useMemo(
    () => conversations.find((item) => item.id === selectedId) || null,
    [conversations, selectedId]
  );

  const loadConversations = async () => {
    setLoading(true);
    try {
      const res = await apiClient.get("/support/conversations");
      const nextConversations = res.data?.conversations || [];
      setConversations(nextConversations);
      if (!selectedId && nextConversations[0]?.id) {
        setSelectedId(nextConversations[0].id);
      }
    } catch (err) {
      setStatus({
        type: "error",
        message: "Failed to load inbox conversations.",
      });
    } finally {
      setLoading(false);
    }
  };

  const loadThread = async (conversationId) => {
    if (!conversationId) {
      setMessages([]);
      return;
    }

    setThreadLoading(true);
    try {
      const res = await apiClient.get(`/support/conversations/${conversationId}/messages`);
      setMessages(res.data?.messages || []);
    } catch (err) {
      setStatus({
        type: "error",
        message: "Failed to load conversation thread.",
      });
    } finally {
      setThreadLoading(false);
    }
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    loadThread(selectedId);
  }, [selectedId]);

  const sendReply = async (event) => {
    event.preventDefault();
    if (!selectedId || !reply.trim()) return;

    setSending(true);
    setStatus(null);
    try {
      await apiClient.post(`/support/conversations/${selectedId}/messages`, {
        content: reply.trim(),
      });
      setReply("");
      await loadThread(selectedId);
      await loadConversations();
      setStatus({
        type: "success",
        message: "Message sent.",
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: "Failed to send reply.",
      });
    } finally {
      setSending(false);
    }
  };

  const requestAiHandoff = async () => {
    if (!selectedId) return;

    try {
      await apiClient.post(`/support/conversations/${selectedId}/ai-handoff`, {
        requestedBy: user?.role === "admin" || user?.isSuperAdmin ? "admin_ui" : "user_ui",
        reason: "manual_review_requested",
        summary: "Conversation flagged for human follow-up from the inbox UI.",
      });
      await loadThread(selectedId);
      await loadConversations();
      setStatus({
        type: "success",
        message: "AI handoff recorded.",
      });
    } catch (err) {
      setStatus({
        type: "error",
        message: "Failed to request handoff.",
      });
    }
  };

  return (
    <div className="support-page">
      <header className="support-hero">
        <div>
          <h1>Operational Inbox</h1>
          <p>
            Track support conversations, provider-ingested threads, and AI-to-human handoffs in one place.
          </p>
        </div>
        <div className="support-contact-cta">
          <button type="button" className="support-btn-secondary" onClick={loadConversations}>
            Refresh Inbox
          </button>
          {selectedConversation ? (
            <button type="button" className="support-btn-primary" onClick={requestAiHandoff}>
              Request Human Follow-Up
            </button>
          ) : null}
        </div>
      </header>

      {status ? (
        <div
          className={
            "support-alert " +
            (status.type === "success" ? "support-alert-success" : "support-alert-error")
          }
        >
          {status.message}
        </div>
      ) : null}

      <div className="support-inbox-grid">
        <section className="support-card">
          <h2>Conversations</h2>
          {loading ? <p>Loading inbox...</p> : null}
          {!loading && conversations.length === 0 ? <p>No support conversations yet.</p> : null}

          <div className="support-thread-list">
            {conversations.map((conversation) => (
              <button
                key={conversation.id}
                type="button"
                className={`support-thread-item ${
                  selectedId === conversation.id ? "selected" : ""
                }`}
                onClick={() => setSelectedId(conversation.id)}
              >
                <div className="support-thread-top">
                  <strong>{conversation.subject || "Support conversation"}</strong>
                  <span className={`support-status-chip ${conversation.status || "open"}`}>
                    {conversation.status || "open"}
                  </span>
                </div>
                <div className="support-thread-meta">
                  {conversation.customer?.email || conversation.customer?.phone || "Unknown contact"}
                </div>
                <div className="support-thread-preview">
                  {conversation.lastMessage?.content || "No messages yet."}
                </div>
              </button>
            ))}
          </div>
        </section>

        <section className="support-card">
          <h2>Thread</h2>
          {!selectedConversation ? <p>Select a conversation to review it.</p> : null}

          {selectedConversation ? (
            <>
              <div className="support-thread-header">
                <div>
                  <strong>{selectedConversation.customer?.name || "Customer"}</strong>
                  <div className="support-thread-meta">
                    {selectedConversation.customer?.email || selectedConversation.customer?.phone || "No contact details"}
                  </div>
                </div>
                <span className={`support-status-chip ${selectedConversation.status || "open"}`}>
                  {selectedConversation.status || "open"}
                </span>
              </div>

              {threadLoading ? <p>Loading thread...</p> : null}

              <div className="support-message-list">
                {messages.map((message) => (
                  <div key={message._id || message.id} className={`support-message ${message.authorType}`}>
                    <div className="support-message-meta">
                      <strong>{message.authorName || message.authorType}</strong>
                      <span>{new Date(message.createdAt).toLocaleString()}</span>
                    </div>
                    <p>{message.content}</p>
                  </div>
                ))}
              </div>

              <form className="support-reply-form" onSubmit={sendReply}>
                <textarea
                  rows={4}
                  value={reply}
                  onChange={(event) => setReply(event.target.value)}
                  placeholder="Write a reply or internal follow-up..."
                />
                <button
                  type="submit"
                  className="support-btn-primary"
                  disabled={sending || !reply.trim()}
                >
                  {sending ? "Sending..." : "Send Reply"}
                </button>
              </form>
            </>
          ) : null}
        </section>
      </div>
    </div>
  );
}
