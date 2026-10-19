import { browserRequestTimeoutMs } from "./request-timeouts.ts";
import { browserStorage as storage } from "./browser-storage";
export const headers = (code?: string) => ({
  "Content-Type": "application/json",
  "X-Afterparty-Visitor": storage.get("afterparty-visitor") ?? "",
  ...(code && storage.get(`afterparty-host:${code}`)
    ? { Authorization: `Bearer ${storage.get(`afterparty-host:${code}`)}` }
    : {}),
});
export async function request<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      ...options,
      signal: options.signal ?? AbortSignal.timeout(browserRequestTimeoutMs(path)),
    });
  } catch (error) {
    if (browserRequestTimeoutMs(path) === 75000 && error instanceof Error && error.name === "TimeoutError")
      throw new Error("Music search timed out. Try a more specific search or a YouTube link.");
    throw error;
  }
  let data: T & { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error("Tjenesten svarer ikke. Prøv igjen.");
  }
  if (!response.ok)
    throw Object.assign(new Error(data.error ?? "Tjenesten svarer ikke. Prøv igjen."), { status: response.status });
  return data;
}
