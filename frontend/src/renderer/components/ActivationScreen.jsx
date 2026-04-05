import React, { useMemo, useState } from "react";

export function ActivationScreen({ state, onSubmit, onUpdateDeviceName, supportMessage }) {
  const [form, setForm] = useState({
    licenseKey: "",
    companyName: "",
    adminFirstName: "",
    adminLastName: "",
    adminEmail: "",
    deviceName: state.installIdentity?.deviceName || "",
  });
  const [error, setError] = useState(null);
  const [submitting, setSubmitting] = useState(false);

  const disabled = useMemo(() => {
    return (
      !form.licenseKey ||
      !form.companyName ||
      !form.adminFirstName ||
      !form.adminLastName ||
      !form.adminEmail ||
      !form.deviceName ||
      submitting
    );
  }, [form, submitting]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);
    setSubmitting(true);

    try {
      await onUpdateDeviceName(form.deviceName);
      const result = await onSubmit(form);
      if (result?.phase !== "active") {
        setError(result?.message || "Activation failed");
      }
    } catch (err) {
      setError(err?.message || "Activation failed");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="screen activation-screen">
      <div className="card">
        <h1>Activate Vynce Desktop</h1>
        <p className="muted">Connect this device to your Vynce subscription before loading the app.</p>

        {(error || supportMessage) && (
          <div className="error-banner">{error || supportMessage}</div>
        )}

        <form onSubmit={handleSubmit}>
          <div className="grid">
            <label>
              License key
              <input
                value={form.licenseKey}
                onChange={(e) => setForm({ ...form, licenseKey: e.target.value })}
                placeholder="ABCD-EFGH-IJKL-MNOP"
                autoComplete="off"
              />
            </label>

            <label>
              Company name
              <input
                value={form.companyName}
                onChange={(e) => setForm({ ...form, companyName: e.target.value })}
                placeholder="Acme Inc"
              />
            </label>

            <label>
              Admin first name
              <input
                value={form.adminFirstName}
                onChange={(e) => setForm({ ...form, adminFirstName: e.target.value })}
                placeholder="Jane"
              />
            </label>

            <label>
              Admin last name
              <input
                value={form.adminLastName}
                onChange={(e) => setForm({ ...form, adminLastName: e.target.value })}
                placeholder="Doe"
              />
            </label>

            <label>
              Admin email
              <input
                type="email"
                value={form.adminEmail}
                onChange={(e) => setForm({ ...form, adminEmail: e.target.value })}
                placeholder="jane@acme.com"
              />
            </label>

            <label>
              Device name
              <input
                value={form.deviceName}
                onChange={(e) => setForm({ ...form, deviceName: e.target.value })}
                placeholder="Sales-Desk-01"
              />
            </label>
          </div>

          <button className="primary" type="submit" disabled={disabled}>
            {submitting ? "Activating..." : "Activate Device"}
          </button>
        </form>
      </div>
    </div>
  );
}
