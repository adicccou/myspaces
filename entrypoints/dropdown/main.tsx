import React from "react";
import ReactDOM from "react-dom/client";
import App from "../sidepanel/App";
import "../sidepanel/style.css";
import "./style.css";

document.documentElement.classList.add("dropdown-layout");

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
