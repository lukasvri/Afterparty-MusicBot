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
  const response = await fetch(path, {
    ...options,
    signal: options.signal ?? AbortSignal.timeout(12000),
  });
  let data: T & { error?: string };
  try {
    data = await response.json();
  } catch {
    throw new Error("Tjenesten svarer ikke. Prøv igjen.");
  }
  if (!response.ok)
    throw new Error(data.error ?? "Tjenesten svarer ikke. Prøv igjen.");
  return data;
}
