export default function Contacts() {
  const contacts = [
    { name:"John Smith", number:"+15038030780", label:"Client" },
    { name:"Laura M.", number:"+15108689297", label:"Internal" },
  ];

  return (
    <div className="page-card">
      <h2>Contacts</h2>
      <div className="item-list">
        {contacts.map((c)=>(
          <div className="list-item" key={c.number}>
            <div>
              <strong>{c.name}</strong>
              <div className="label">{c.number}</div>
            </div>
            <span className="label">{c.label}</span>
          </div>
        ))}
      </div>
      <button className="primary-btn" style={{marginTop:'1rem'}}>Add Contact</button>
    </div>
  );
}