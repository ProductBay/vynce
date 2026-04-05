import React from "react";
import { createRoot } from "react-dom/client";
import { ElectronApp } from "./ElectronApp.jsx";
import "./styles.css";

const rootElement = document.getElementById("root");

if (!rootElement) {
  throw new Error("Renderer root element not found");
}

createRoot(rootElement).render(<ElectronApp />);
