import React from 'react';
import Sidebar from './Sidebar.jsx';
import Topbar from './Topbar.jsx';
import './Layout.css';
import Footer from './Footer';    

export default function Layout({ children }) {
  // This function will be passed to Topbar to handle bulk call updates
  const handleBulkCallStart = (result) => {
    console.log('Bulk calls started:', result);
    // You could add global state management here if needed
  };

  return (
    <div className="app-layout">
      <Sidebar />
      <div className="main-content">
        <Topbar onBulkCallStart={handleBulkCallStart} />
        <div className="content-area">
          {children}
        </div>
         <Footer />  
      </div>
    </div>
  );
}