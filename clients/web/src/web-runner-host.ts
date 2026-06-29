import type { Disposable } from "@traycer-clients/shared/platform/uri-callback";
import type {
  AuthCallbackResult,
  AuthTokenRefreshResult,
  AuthTokenValidationResult,
  IHostManagement,
  IHostPicker,
  INotificationHost,
  IRunnerHost,
  ISecureStorage,
  ITokenStore,
  ITrayState,
  ITraycerCli,
  IWorkspaceFoldersHost,
  LocalHostSnapshot,
  StoredAuthTokens,
  TrayEpic,
  TrayIndicatorState,
} from "@traycer-clients/shared/platform/runner-host";
import {
  exchangeCodeForTokens,
  refreshAuthTokenViaHttp,
  validateAuthTokenIdentityViaHttp,
  validateAuthTokenViaHttp,
} from "@traycer-clients/shared/auth/auth-validation";
import type { AuthIdentityValidationResult } from "@traycer-clients/shared/auth/auth-validation-types";

/**
 * Browser surfaces the runner host depends on, injected so the host is unit
 * testable without a real DOM. `createBrowserEnv()` wires the defaults.
 */
export interface WebEnv {
  /** `window.location.search` at app load (e.g. `?code=…`). */
  readonly initialSearch: string;
  /** Same-tab navigation (used for the sign-in redirect). */
  navigate(url: string): void;
  /** New-tab open (used for every other external link). */
  openTab(url: string): void;
  /** Strip the OAuth params from the address bar after capture. */
  cleanAuthParamsFromUrl(): void;
  /**
   * Subscribe to "app resumed / network back" — `visibilitychange` (visible)
   * plus `online`. Returns an unsubscribe. This is the web equivalent of the
   * desktop `powerMonitor` wake signal that drives stream reconnect.
   */
  onResume(handler: () => void): () => void;
}

export function createBrowserEnv(): WebEnv {
  return {
    initialSearch: window.location.search,
    navigate: (url: string) => {
      window.location.assign(url);
    },
    openTab: (url: string) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    cleanAuthParamsFromUrl: () => {
      const url = new URL(window.location.href);
      url.searchParams.delete("code");
      url.searchParams.delete("error");
      window.history.replaceState(null, "", url.toString());
    },
    onResume: (handler: () => void) => {
      const onVisible = (): void => {
        if (document.visibilityState === "visible") {
          handler();
        }
      };
      document.addEventListener("visibilitychange", onVisible);
      window.addEventListener("online", handler);
      return () => {
        document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("online", handler);
      };
    },
  };
}

export interface WebRunnerHostOptions {
  readonly signInUrl: string;
  readonly authnBaseUrl: string;
  /** Used to decide same-tab (sign-in) vs new-tab for `openExternalLink`. */
  readonly signInBaseUrl: string;
  readonly secureStorage: ISecureStorage;
  readonly tokenStore: ITokenStore;
  readonly env: WebEnv;
  /** Best-effort OS notifications via the Web Notifications API. */
  readonly notificationApi?: NotificationApi | null;
}

interface NotificationApi {
  readonly permission: NotificationPermission;
  show(title: string, body: string): void;
}

/** Parse the OAuth callback params out of a `?code=…` / `?error=…` query. */
export function parseAuthCallback(search: string): AuthCallbackResult | null {
  const params = new URLSearchParams(search);
  const error = params.get("error");
  if (error !== null && error.length > 0) {
    return { error };
  }
  const code = params.get("code");
  if (code !== null && code.length > 0) {
    return { code };
  }
  return null;
}

/**
 * `IRunnerHost` for the browser/PWA shell. Mirrors `MockRunnerHost`'s no-op
 * surfaces but with real web implementations for the members that matter:
 * auth via the shared HTTP helpers (pointed at the same-origin `/authn`
 * proxy), `localStorage`-backed token/secure storage, `window.open`/navigation
 * for external links, an OAuth-redirect `onAuthCallback`, and — critically — a
 * real `onSystemResumed` so the existing reconnect stack fires the instant the
 * PWA is foregrounded. `hasLocalHost` is `false`: the host is always remote.
 */
export class WebRunnerHost implements IRunnerHost {
  readonly signInUrl: string;
  readonly authnBaseUrl: string;
  readonly hasLocalHost = false;
  readonly secureStorage: ISecureStorage;
  readonly tokenStore: ITokenStore;

  readonly service: null = null;
  readonly traycerCli: ITraycerCli | null = null;
  readonly migration: null = null;
  readonly hostManagement: IHostManagement | null = null;
  readonly hostTray: null = null;

  private readonly signInBaseUrl: string;
  private readonly env: WebEnv;
  private readonly notificationApi: NotificationApi | null;
  private pendingAuthCallback: AuthCallbackResult | null;

  private readonly authCallbackHandlers = new Set<
    (result: AuthCallbackResult) => void
  >();

  constructor(options: WebRunnerHostOptions) {
    this.signInUrl = options.signInUrl;
    this.authnBaseUrl = options.authnBaseUrl;
    this.signInBaseUrl = options.signInBaseUrl;
    this.secureStorage = options.secureStorage;
    this.tokenStore = options.tokenStore;
    this.env = options.env;
    this.notificationApi = options.notificationApi ?? null;
    // Capture an OAuth redirect landing (`?code` / `?error`) once, then scrub
    // it from the URL so a reload can't replay a one-time code.
    this.pendingAuthCallback = parseAuthCallback(options.env.initialSearch);
    if (this.pendingAuthCallback !== null) {
      options.env.cleanAuthParamsFromUrl();
    }
  }

  // ---- Auth ------------------------------------------------------------- //

  beginAuthAttempt(): void {
    // The web redirect flow recovers the PKCE verifier from secureStorage and
    // ignores stale in-flight windows, so no dedupe window is needed here.
  }

  validateAuthToken(
    token: string,
    refreshToken: string,
  ): Promise<AuthTokenValidationResult> {
    return validateAuthTokenViaHttp(this.authnBaseUrl, token, refreshToken);
  }

  validateAuthTokenIdentity(
    token: string,
    refreshToken: string,
  ): Promise<AuthIdentityValidationResult> {
    return validateAuthTokenIdentityViaHttp(
      this.authnBaseUrl,
      token,
      refreshToken,
    );
  }

  refreshAuthToken(
    token: string,
    refreshToken: string,
  ): Promise<AuthTokenRefreshResult> {
    return refreshAuthTokenViaHttp(this.authnBaseUrl, token, refreshToken);
  }

  async exchangeAuthCode(
    code: string,
    codeVerifier: string,
  ): Promise<StoredAuthTokens | null> {
    // The shared helper returns a discriminated result; `IRunnerHost` wants
    // tokens-or-null. Both `rejected` and `network-error` collapse to null
    // (the auth controller treats a null exchange as a failed sign-in).
    const result = await exchangeCodeForTokens(
      this.authnBaseUrl,
      code,
      codeVerifier,
    );
    return result.kind === "exchanged"
      ? { token: result.token, refreshToken: result.refreshToken }
      : null;
  }

  onAuthCallback(handler: (result: AuthCallbackResult) => void): Disposable {
    this.authCallbackHandlers.add(handler);
    // Deliver a redirect landing captured before this subscription. Defer so
    // the caller finishes wiring before the handler runs.
    if (this.pendingAuthCallback !== null) {
      const pending = this.pendingAuthCallback;
      this.pendingAuthCallback = null;
      queueMicrotask(() => handler(pending));
    }
    return {
      dispose: () => {
        this.authCallbackHandlers.delete(handler);
      },
    };
  }

  async openExternalLink(url: string): Promise<void> {
    // The sign-in redirect must stay in this tab so the OAuth round-trip lands
    // back on the app origin (the PKCE verifier is recovered from
    // localStorage). Every other external link opens in a new tab.
    if (url.startsWith(this.signInBaseUrl)) {
      this.env.navigate(url);
      return;
    }
    this.env.openTab(url);
  }

  async getRegisteredUrlSchemes(): Promise<readonly string[]> {
    return [];
  }

  async requestMicrophoneAccess(): Promise<"granted" | "denied"> {
    // Let `getUserMedia` drive the real browser prompt.
    return "granted";
  }

  async openMicrophoneSettings(): Promise<void> {
    // No OS settings deep link on the web.
  }

  // ---- Local host (always remote on web) -------------------------------- //

  onLocalHostChange(
    handler: (snapshot: LocalHostSnapshot | null) => void,
  ): Disposable {
    // Web has no bundled local host: emit `null` once, never transition.
    handler(null);
    return { dispose: () => undefined };
  }

  async requestHostRespawn(): Promise<void> {
    // No local host to respawn.
  }

  // ---- Wake / resume ---------------------------------------------------- //

  onSystemResumed(handler: () => void): Disposable {
    const unsubscribe = this.env.onResume(handler);
    return { dispose: unsubscribe };
  }

  // ---- Notifications (best-effort Web Notifications) -------------------- //

  readonly notifications: INotificationHost = {
    show: async (title: string, body: string): Promise<void> => {
      if (
        this.notificationApi !== null &&
        this.notificationApi.permission === "granted"
      ) {
        this.notificationApi.show(title, body);
      }
    },
    onClick: (): Disposable => ({ dispose: () => undefined }),
  };

  // ---- No-op capability surfaces (parity with mobile/web shells) -------- //

  readonly tray: ITrayState = {
    setEpics: async (_epics: readonly TrayEpic[]): Promise<void> => undefined,
    setIndicator: async (_state: TrayIndicatorState): Promise<void> =>
      undefined,
    onEpicSelected: (): Disposable => ({ dispose: () => undefined }),
  };

  readonly hostPicker: IHostPicker = new WebHostPicker();

  readonly workspaceFolders: IWorkspaceFoldersHost = {
    pickFolders: async (): Promise<readonly string[]> => [],
  };

  readonly fileDrops = {
    resolveDroppedFilePaths: async (): Promise<readonly string[]> => [],
    copyDroppedFilePaths: async (
      paths: readonly string[],
    ): Promise<readonly string[]> => paths,
  };

  // ---- Test/dev helper -------------------------------------------------- //

  /** Fire a callback to subscribers (e.g. a postMessage-relayed code). */
  emitAuthCallback(result: AuthCallbackResult): void {
    for (const handler of this.authCallbackHandlers) {
      handler(result);
    }
  }
}

/** Minimal `IHostPicker`: tracks open state and notifies on transitions. */
class WebHostPicker implements IHostPicker {
  private open = false;
  private readonly handlers = new Set<(isOpen: boolean) => void>();

  get isOpen(): boolean {
    return this.open;
  }

  requestOpen(): void {
    if (this.open) {
      return;
    }
    this.open = true;
    this.emit();
  }

  requestClose(): void {
    if (!this.open) {
      return;
    }
    this.open = false;
    this.emit();
  }

  onChange(handler: (isOpen: boolean) => void): Disposable {
    this.handlers.add(handler);
    return {
      dispose: () => {
        this.handlers.delete(handler);
      },
    };
  }

  private emit(): void {
    for (const handler of this.handlers) {
      handler(this.open);
    }
  }
}
