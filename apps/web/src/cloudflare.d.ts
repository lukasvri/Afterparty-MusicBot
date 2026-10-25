declare module 'cloudflare:workers' {
  export const env: Record<string, unknown>;
}

declare namespace Cloudflare {
  interface Env {
    AFTERPARTY_HOST_TRANSITION?: string;
    COPYRIGHT_CONTACT_EMAIL?: string;
  }
}
