import React from "react";
import ReactDOM from "react-dom/client";
import {
  positions,
  Provider as AlertProvider,
  transitions,
  types,
} from "react-alert";
import { AlertContext } from "./alert-context";
import AlertTemplate from "./components/AlertTemplate";
import AuthGate from "./AuthGate";
import "./style.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <AlertProvider
      template={AlertTemplate}
      position={positions.BOTTOM_CENTER}
      timeout={4000}
      type={types.INFO}
      offset="max(16px, env(safe-area-inset-bottom, 0px))"
      transition={transitions.FADE}
      containerStyle={{ zIndex: 1000 }}
      context={AlertContext}
    >
      <AuthGate />
    </AlertProvider>
  </React.StrictMode>,
);
