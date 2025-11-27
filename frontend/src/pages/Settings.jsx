import { useState } from "react";

export default function Settings() {
  const [theme, setTheme] = useState("dark")
  const [notifications, setNotifications] = useState(true)

  return (
    <div className="settings-wrapper">
      <h2>Settings</h2>

      <div className="setting-item">
        <label>Theme:</label>
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="dark">Dark</option>
          <option value="light">Light</option>
        </select>
      </div>

      <div className="setting-item">
        <label>
          <input
            type="checkbox"
            checked={notifications}
            onChange={(e) => setNotifications(e.target.checked)}
          />
          Enable notifications
        </label>
      </div>

      <button className="save-btn">Save Changes</button>
    </div>
  )
}