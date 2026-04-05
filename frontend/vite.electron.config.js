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
  base: "./",
  build: {
    outDir: "dist-electron",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        electron: "electron.html",
      },
    },
  },
});
