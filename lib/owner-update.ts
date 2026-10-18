import { env } from "cloudflare:workers";
import { hasPasswordSession } from "./admin-session";

// Deployment-specific addresses must never enter public source or responses.
export async function ownerUpdateUrl(request: Request): Promise<string | undefined> {
  const configured = (env as unknown as { OWNER_UPDATE_URL?: string }).OWNER_UPDATE_URL?.trim();
  if (!configured) return undefined;
  let url: URL;
  try {
    url = new URL(configured);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return undefined;
  if (!await hasPasswordSession(request)) return undefined;
  return url.href;
}
