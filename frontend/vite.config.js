import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [
    react({
      babel: {
        babelrc: false,
        configFile: false,
      },
    }),
  ],
  server: {
    host: "127.0.0.1",
    port: 5174,
    proxy: {
      "/api": {
        target: "http://localhost:3000", // Must match the active local backend port
        changeOrigin: true,
        secure: false,
      },
      "/socket.io": {
        target: "http://localhost:3000", // Same backend port as /api
        ws: true,
      },
    },
  },
});
