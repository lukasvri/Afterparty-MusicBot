declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}

// Optional during bridge previews; native mode uses the existing database/API contracts.
declare namespace Cloudflare {
  interface Env {
    AFTERPARTY_API?: { fetch(request: Request): Promise<Response> };
    AFTERPARTY_BETA_ENTRY?: string;
    AFTERPARTY_NATIVE_API?: string;
    COPYRIGHT_CONTACT_EMAIL?: string;
  }
}
