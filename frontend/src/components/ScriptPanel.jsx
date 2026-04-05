import React, { useState, useEffect } from "react";
import API_BASE_URL from "../api";

export default function ScriptsPanel({ onScriptSelect, selectedScript, fetcher }) {
  const [scripts, setScripts] = useState([]);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    fetchScripts();
  }, []);

  const fetchScripts = async () => {
    setLoading(true);
    setError("");
    try {
      const request = fetcher
        ? (url, options) => fetcher(url.replace(API_BASE_URL, ""), options)
        : fetch;

      const response = await request(`${API_BASE_URL}/api/scripts`);
      if (!response.ok) {
        throw new Error(`Failed to load scripts (${response.status})`);
      }
      const data = await response.json();
      setScripts(Array.isArray(data?.scripts) ? data.scripts : []);
    } catch (error) {
      setScripts([]);
      setError(error?.message || "Unable to load scripts");
    } finally {
      setLoading(false);
    }
  };

  const filteredScripts =
    filter === "all"
      ? scripts
      : scripts.filter((script) => script.category === filter);

  const categories = [
    { value: "all", label: "All Scripts" },
    { value: "sales", label: "Sales" },
    { value: "followup", label: "Follow-up" },
    { value: "support", label: "Support" },
    { value: "collections", label: "Collections" },
  ];

  return (
    <div className="scripts-panel">
      <div className="scripts-filter">
        {categories.map((cat) => (
          <button
            key={cat.value}
            className={`filter-btn ${filter === cat.value ? "active" : ""}`}
            onClick={() => setFilter(cat.value)}
          >
            {cat.label}
          </button>
        ))}
      </div>
      
      <div className="scripts-list">
        {loading ? <div className="scripts-empty">Loading scripts...</div> : null}
        {!loading && error ? <div className="scripts-empty">{error}</div> : null}
        {!loading && !error && filteredScripts.length === 0 ? (
          <div className="scripts-empty">No scripts found</div>
        ) : null}
        {filteredScripts.map((script) => (
          <div
            key={script.id}
            className={`script-item ${selectedScript?.id === script.id ? "selected" : ""}`}
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
