import React from "react";
import ReactDOM from "react-dom/client";
import { MantineProvider } from "@mantine/core";
import "@mantine/core/styles.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { restoreStateCurrent } from "@tauri-apps/plugin-window-state";
// Self-hosted fonts (bundled — no CDN, works offline). Code/diff view uses the
// platform's native editor font instead (see --lg-font-code in tokens.css).
import "@fontsource-variable/fraunces";
import "@fontsource/ibm-plex-sans/400.css";
import "@fontsource/ibm-plex-sans/500.css";
import "@fontsource/ibm-plex-sans/600.css";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./tokens.css";
import App from "./App";
import { theme } from "./theme";
import ErrorBoundary from "./components/ErrorBoundary";
import AppCrash from "./components/AppCrash";

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
      <MantineProvider theme={theme} defaultColorScheme="light">
        <ErrorBoundary fallback={(error, reset) => <AppCrash error={error} reset={reset} />}>
          <App />
        </ErrorBoundary>
      </MantineProvider>
    </QueryClientProvider>
  </React.StrictMode>,
);
