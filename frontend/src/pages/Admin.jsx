export default function Admin() {
  const profile = {
    name: "Ashandie Powell",
    phone: "+15108689297",
    plan: "Starter",
    credit: 12.45,
  };

  return (
    <div className="page-card">
      <h2>Admin Profile</h2>
      <div className="admin-info">
        <div className="info-box"><h3>Name</h3><p>{profile.name}</p></div>
        <div className="info-box"><h3>Registered Number</h3><p>{profile.phone}</p></div>
        <div className="info-box"><h3>Plan</h3><p>{profile.plan}</p></div>
        <div className="info-box"><h3>Credit Balance</h3><p>${profile.credit.toFixed(2)}</p></div>
      </div>
      <button className="primary-btn" style={{marginTop:"1.5rem"}}>Upgrade Plan</button>
    </div>
  );
}