import assert from "node:assert/strict";

const base = process.env.AFTERPARTY_TEST_URL ?? process.env.MUSE_TEST_URL ?? "http://127.0.0.1:5173";
if (new URL(base).hostname !== "127.0.0.1") throw Error("Synthetic identity checks are local-only.");
if (!process.env.GK_TEST_PASSWORD) throw Error("Set the temporary local GK_TEST_PASSWORD.");
const request = (path: string, options: RequestInit = {}) =>
  fetch(base + path, { signal: AbortSignal.timeout(20000), ...options });
const headers = { "Content-Type": "application/json", "X-Real-IP": "local-auth-regression" };

async function authenticated(cookie: string): Promise<unknown> {
  const response = await request("/api/admin/session", { headers: { Cookie: cookie } });
  const data: unknown = await response.json();
  assert(data !== null && typeof data === "object" && "authenticated" in data);
  return data.authenticated;
}

const login = await request("/api/admin/session", {
  method: "POST", headers,
  body: JSON.stringify({ password: process.env.GK_TEST_PASSWORD }),
});
assert.equal(login.status, 200, "Local password login succeeds");
const cookie = login.headers.getSetCookie()[0].split(";")[0];
assert.equal(await authenticated(cookie), true, "Password session authenticates");
const logout = await request("/api/admin/session", {
  method: "DELETE", headers: { ...headers, Cookie: cookie }, body: "{}",
});
assert.equal(logout.status, 200);
const result: unknown = await logout.json();
assert(result !== null && typeof result === "object" && "redirect" in result);
assert.equal(result.redirect, "/admin", "Password logout returns to login");
const cleared = logout.headers.getSetCookie();
assert.equal(cleared.length, 2, "Both admin and Discord cookies are cleared separately");
assert(cleared.every((value) => value.includes("Max-Age=0")));
assert.equal(await authenticated(cookie), false, "Deleted session cannot be reused");
console.log("PASS password login, session revocation, separate expired cookies, and local admin logout");
