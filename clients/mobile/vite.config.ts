import babel from "@rolldown/plugin-babel";
import tailwindcss from "@tailwindcss/vite";
import { tanstackRouter } from "@tanstack/router-plugin/vite";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import { resolve } from "path";
import { defineConfig, type UserConfig } from "vite";

/**
 * Builds the Capacitor WebView bundle (`dist/`, Capacitor's `webDir`) from the
 * same gui-app library as the desktop renderer and the web shell. Mirrors their
 * plugin chain and aliases; additionally aliases `@traycer-clients/web` so the
 * mobile entry reuses `WebRunnerHost` + the remote-hosts bridge.
 */
export default defineConfig((): UserConfig => {
  const guiAppRoot = resolve(__dirname, "..", "gui-app");
  const sharedRoot = resolve(__dirname, "..", "shared");
  const webRoot = resolve(__dirname, "..", "web");
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
        "@traycer-clients/web": resolve(webRoot, "index.ts"),
        "@traycer-clients/shared": sharedRoot,
        "@traycer/protocol/utils": resolve(protocolRoot, "utils"),
        "@traycer/protocol": resolve(protocolRoot, "src"),
      },
    },
    build: {
      emptyOutDir: true,
      outDir: resolve(__dirname, "dist"),
      sourcemap: "hidden",
    },
  };
});
