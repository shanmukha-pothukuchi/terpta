import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";

// GitHub Pages serves 404.html for unknown paths; copying index.html there
// lets the SPA router handle deep links and the AuthKit callback route.
function spaFallback(): Plugin {
  return {
    name: "spa-404-fallback",
    closeBundle() {
      copyFileSync(
        resolve(__dirname, "dist/index.html"),
        resolve(__dirname, "dist/404.html"),
      );
    },
  };
}

export default defineConfig({
  base: "/terpta/",
  plugins: [react(), tailwindcss(), spaFallback()],
});
