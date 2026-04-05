import React from "react";

export default function ConfirmActionModal({
  open,
  title,
  message,
  confirmText,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  onConfirm,
  onCancel,
  loading = false,
}) {
  if (!open) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal">
        <h3>{title}</h3>

        <p className="modal-message">{message}</p>

        {confirmText && (
          <div className="modal-confirm-text">
            <p>
              Type <strong>{confirmText}</strong> to confirm:
            </p>
            <input
              type="text"
              placeholder={confirmText}
              onChange={(e) =>
                onConfirm.setTypedValue(e.target.value)
              }
            />
          </div>
        )}

        <div className="modal-actions">
          <button onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>

          <button
            className="danger"
            disabled={
              loading ||
              (confirmText &&
                onConfirm.typedValue !== confirmText)
            }
            onClick={onConfirm.handle}
          >
            {loading ? "Processing…" : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
