import path from "path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// When running plain `npm run dev` (no Tauri backend), alias all Tauri modules
// to local mock shims so the app renders with fixture data in a regular browser.
// @ts-expect-error process is a nodejs global
const isTauri = !!process.env.TAURI_ENV_TARGET_TRIPLE;

const mockDir = path.resolve(__dirname, "src/mock");

const tauriMockAliases = isTauri
  ? []
  : [
      { find: "@tauri-apps/api/app",                   replacement: path.join(mockDir, "tauri-app.ts")           },
      { find: "@tauri-apps/api/core",                  replacement: path.join(mockDir, "tauri-core.ts")          },
      { find: "@tauri-apps/api/event",                 replacement: path.join(mockDir, "tauri-event.ts")         },
      { find: "@tauri-apps/api/window",                replacement: path.join(mockDir, "tauri-window.ts")        },
      { find: "@tauri-apps/plugin-dialog",             replacement: path.join(mockDir, "tauri-dialog.ts")        },
      { find: "@tauri-apps/plugin-log",                replacement: path.join(mockDir, "tauri-log.ts")           },
      { find: "@tauri-apps/plugin-window-state",       replacement: path.join(mockDir, "tauri-window-state.ts")  },
      { find: "@tauri-apps/plugin-clipboard-manager",  replacement: path.join(mockDir, "tauri-clipboard.ts")     },
    ];

// https://vite.dev/config/
export default defineConfig(async () => ({
  plugins: [react()],

  resolve: {
    alias: tauriMockAliases,
  },

  // No network loading in Tauri — chunk size is irrelevant.
  build: { chunkSizeWarningLimit: Infinity },
  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  server: isTauri
    ? {
        // Tauri requires a fixed port and will fail if unavailable.
        port: 1420,
        strictPort: true,
        host: host || false,
        hmr: host ? { protocol: "ws", host, port: 1421 } : undefined,
        watch: { ignored: ["**/src-tauri/**"] },
      }
    : {
        // Browser mock mode — use a separate port so it can coexist with Tauri dev.
        port: 5173,
        strictPort: false,
        watch: { ignored: ["**/src-tauri/**"] },
      },
}));
