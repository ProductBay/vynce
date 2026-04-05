export default function LicenseBanner({ message }) {
  if (!message) return null;

  return (
    <div
      style={{
        background: "#7f1d1d",
        color: "#fee2e2",
        padding: "10px 14px",
        borderRadius: 8,
        marginBottom: 12,
        fontSize: "0.9rem",
      }}
    >
      🚫 {message}
    </div>
  );
}
