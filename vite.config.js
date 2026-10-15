import { randomUUID } from "node:crypto";
import { defineConfig } from "vite";

const version = randomUUID();
// Relative assets and version checks support GitHub Pages and local preview.
export default defineConfig({
  base: "./",
  worker: { format: "es" },
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    {
      name: "lira-app-version",
      transformIndexHtml() {
        return [
          {
            tag: "meta",
            attrs: { name: "lira-app-version", content: version },
            injectTo: "head",
          },
        ];
      },
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "app-version.json",
          source: JSON.stringify({ version }),
        });
      },
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.split("?")[0] !== "/app-version.json") return next();
          res.setHeader("Content-Type", "application/json");
          res.setHeader("Cache-Control", "no-store");
          res.end(JSON.stringify({ version }));
        });
      },
    },
  ],
});
