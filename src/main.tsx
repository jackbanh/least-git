import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { restoreStateCurrent } from "@tauri-apps/plugin-window-state";
import "./tokens.css";
import App from "./App";

restoreStateCurrent();

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Keep stale data while revalidating — zero flash on remount
      staleTime: 0,
      // Data lives in cache indefinitely (we invalidate manually via listKey)
      gcTime: Infinity,
      retry: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <MantineProvider>
        <App />
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
