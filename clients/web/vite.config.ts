import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig, type UserConfig } from "vite";

/**
 * Web/PWA Vite config. Builds `index.html` + `src/main.tsx` into `dist/`,
 * consuming `@traycer-clients/gui-app` as a workspace library (no separate
 * gui-app build). Mirrors the desktop renderer plugin chain (TanStack Router
 * codegen, React + compiler preset, Tailwind v4) and the same `@/…` →
 * `gui-app/src` aliases so gui-app's internal imports resolve. The `dist/`
 * output is also what the Capacitor shell wraps as its `webDir`.
 */
export default defineConfig((): UserConfig => {
  const guiAppRoot = resolve(__dirname, "..", "gui-app");
  const sharedRoot = resolve(__dirname, "..", "shared");
  const protocolRoot = resolve(__dirname, "..", "..", "protocol");

  return {
    root: __dirname,
    base: "./",
    envPrefix: ["VITE_"],
    plugins: [
      tanstackRouter({
        target: "react",
        quoteStyle: "double",
        semicolons: true,
        autoCodeSplitting: true,
        routeFileIgnorePattern: "__tests__|route-components|route-search",
        routesDirectory: resolve(guiAppRoot, "src", "routes"),
        generatedRouteTree: resolve(guiAppRoot, "src", "routeTree.gen.ts"),
      }),
      react(),
      tailwindcss(),
      babel({ presets: [reactCompilerPreset()] }).then((plugin) => ({
        ...plugin,
        enforce: "post" as const,
      })),
    ],
    resolve: {
      alias: {
        "@": resolve(guiAppRoot, "src"),
        "@traycer-clients/gui-app": resolve(guiAppRoot, "index.ts"),
        "@traycer-clients/shared": sharedRoot,
        // `utils` must precede the bare `@traycer/protocol` so vite matches the
        // longer prefix first.
        "@traycer/protocol/utils": resolve(protocolRoot, "utils"),
        "@traycer/protocol": resolve(protocolRoot, "src"),
      },
    },
    build: {
      emptyOutDir: true,
      outDir: resolve(__dirname, "dist"),
      sourcemap: "hidden",
    },
    server: {
      host: "127.0.0.1",
      port: 4173,
      strictPort: true,
    },
  };
});
