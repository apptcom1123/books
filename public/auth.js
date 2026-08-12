class LibraryAuth {
  constructor() {
    this.client = null;
    this.session = null;
    this.user = null;
    this.ready = this.initialize();
  }

  async initialize() {
    try {
      const response = await fetch("/api/auth/config", { credentials: "same-origin" });
      if (!response.ok) throw new Error("無法取得登入設定");
      const config = await response.json();
      if (!config.supabaseUrl || !config.supabasePublishableKey || !window.supabase) throw new Error("Supabase 登入尚未設定");
      this.client = window.supabase.createClient(config.supabaseUrl, config.supabasePublishableKey, {
        auth: { flowType: "pkce", persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        realtime: {
          heartbeatIntervalMs: 30_000,
          disconnectOnEmptyChannelsAfterMs: 12_000,
          reconnectAfterMs: (tries) => {
            const delays = [1_000, 2_000, 5_000, 10_000, 30_000];
            const base = delays[Math.min(Math.max(tries - 1, 0), delays.length - 1)];
            return base + Math.floor(Math.random() * Math.min(1_000, base * 0.2));
          },
          heartbeatCallback: (status, latency) => window.dispatchEvent(new CustomEvent("library-realtime-heartbeat", {
            detail: { status, latency: Number.isFinite(latency) ? latency : null, at: Date.now() },
          })),
        },
      });
      const { data } = await this.client.auth.getSession();
      this.session = data.session || null;
      await this.refreshProfile();
      this.client.auth.onAuthStateChange(async (_event, session) => {
        this.session = session;
        await this.refreshProfile();
      });
      this.restoreReturnPath();
    } catch (error) {
      console.warn(error.message);
      this.emit();
    }
    return this;
  }

  async refreshProfile() {
    if (!this.session) {
      this.user = null;
      this.emit();
      return;
    }
    try {
      const response = await fetch("/api/auth/status", { headers: { Authorization: `Bearer ${this.session.access_token}` } });
      const result = await response.json();
      this.user = result.loggedIn ? result.user : null;
    } catch {
      this.user = null;
    }
    this.emit();
  }

  emit() {
    window.dispatchEvent(new CustomEvent("library-auth-changed", { detail: { user: this.user } }));
  }

  restoreReturnPath() {
    if (!this.session || location.pathname !== "/") return;
    const returnTo = sessionStorage.getItem("mystery-library:return-to");
    if (!returnTo) return;
    sessionStorage.removeItem("mystery-library:return-to");
    const target = new URL(returnTo, location.origin);
    if (target.origin === location.origin && `${target.pathname}${target.search}` !== "/") location.replace(`${target.pathname}${target.search}`);
  }

  async login(returnTo = location.href) {
    await this.ready;
    if (!this.client) throw new Error("登入服務尚未設定");
    sessionStorage.setItem("mystery-library:return-to", returnTo);
    const { error } = await this.client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: `${location.origin}/`, scopes: "openid email profile" },
    });
    if (error) throw error;
  }

  async logout() {
    await this.ready;
    if (this.client) await this.client.auth.signOut();
    this.session = null;
    this.user = null;
    this.emit();
  }

  async token() {
    await this.ready;
    const { data } = this.client ? await this.client.auth.getSession() : { data: {} };
    this.session = data.session || null;
    return this.session?.access_token || null;
  }
}

window.libraryAuth = new LibraryAuth();
