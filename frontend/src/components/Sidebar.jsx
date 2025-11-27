import { NavLink } from "react-router-dom"

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="logo">Vynce</div>
      <nav>
        <NavLink to="/" end>Dashboard</NavLink>
        <NavLink to="/admin">Admin</NavLink>
        <NavLink to="/calls">Calls</NavLink>
        <NavLink to="/messages">Messages</NavLink>
        <NavLink to="/contacts">Contacts</NavLink>
        <NavLink to="/settings">Settings</NavLink>
      </nav>
    </aside>
  )
}