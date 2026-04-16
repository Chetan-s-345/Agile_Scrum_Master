import React, { Component, type ErrorInfo, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { HashRouter } from "react-router-dom";
import App from "./App";
import "./globals.css";

class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[ErrorBoundary] Render error:", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <div style={{ padding: "2rem", fontFamily: "monospace", background: "#0a0a0a", color: "#ff6b6b", minHeight: "100vh" }}>
          <h2 style={{ color: "#ff6b6b", marginBottom: "1rem" }}>⚠ Application Error</h2>
          <pre style={{ whiteSpace: "pre-wrap", fontSize: "12px", color: "#ffcccc" }}>
            {this.state.error.message}
            {"\n\n"}
            {this.state.error.stack}
          </pre>
        </div>
      );
    }
    return this.props.children;
  }
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <HashRouter>
        <App />
      </HashRouter>
    </ErrorBoundary>
  </React.StrictMode>
);
