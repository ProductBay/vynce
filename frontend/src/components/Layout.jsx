import React from "react";
import Sidebar from "./Sidebar.jsx";
import Topbar from "./Topbar.jsx";
import "./Layout.css";
import Footer from "./Footer";

export default function Layout({ children }) {
  const handleBulkCallStart = () => {};

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Topbar onBulkCallStart={handleBulkCallStart} />
        <div className="content-area">{children}</div>
        <Footer />
      </div>
    </div>
  );
}
