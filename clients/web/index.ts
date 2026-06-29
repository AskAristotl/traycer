/**
 * Public surface of the web shell, reused by the Capacitor mobile shell
 * (`clients/mobile`) so the native target wraps the same `WebRunnerHost` core
 * with native-flavored deps rather than reimplementing it.
 */
export {
  WebRunnerHost,
  createBrowserEnv,
  parseAuthCallback,
  type WebEnv,
  type WebRunnerHostOptions,
} from "./src/web-runner-host";
export { createWebSecureStorage, createWebTokenStore } from "./src/web-storage";
export {
  createWebRemoteHostsBridge,
  type FetchFn,
  type WebRemoteHostsBridge,
} from "./src/web-remote-hosts";
export { loadWebConfig, composeWebSignInUrl, type WebConfig } from "./src/web-config";
