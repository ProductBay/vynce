export default function Messages() {
  const messages = [
    { id:1, to:"+15038030780", text:"Hello, thanks for calling!", time:"9:42 AM" },
    { id:2, to:"+17187565352", text:"Call reminder sent.", time:"10:00 AM" },
  ];

  return (
    <div className="page-card">
      <h2>Recent Messages</h2>
      <div className="item-list">
        {messages.map((m) => (
          <div key={m.id} className="list-item">
            <div>
              <strong>{m.to}</strong><div className="label">{m.time}</div>
            </div>
            <p>{m.text}</p>
          </div>
        ))}
      </div>
      <button className="primary-btn" style={{marginTop:'1rem'}}>Compose Message</button>
    </div>
  );
}