import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync, type SQLInputValue, type SQLOutputValue } from "node:sqlite";
import { registerHooks, stripTypeScriptTypes } from "node:module";
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { pbkdf2Sync } from "node:crypto";

interface FixtureStatement {
  bind(...values: SQLInputValue[]): FixtureStatement;
  first(): Promise<Record<string, SQLOutputValue> | null>;
  run(): Promise<{ meta: { changes: number } }>;
  all(): Promise<{ results: Record<string, SQLOutputValue>[] }>;
}
interface FixtureDatabase {
  prepare(sql: string): FixtureStatement;
  batch(statements: FixtureStatement[]): Promise<unknown[]>;
}
type FixtureEnvironment = {
  DB?: FixtureDatabase;
  ADMIN_PASSWORD_HASH?: string;
  ADMIN_BRIDGE_KEY?: string;
  OWNER_EMAIL?: string;
};
const context: { env: FixtureEnvironment; coreCalls: unknown[][]; rejectAdmin: boolean } = { env: {}, coreCalls: [], rejectAdmin: false };
const globals = globalThis as typeof globalThis & { __afterpartyAuthTest: typeof context };
globals.__afterpartyAuthTest = context;
const root = new URL("../", import.meta.url);
const moduleUrl = (source: string) => "data:text/javascript," + encodeURIComponent(source);
const hooks = registerHooks({
  resolve(specifier, options, next) {
    if (specifier === "cloudflare:workers") return {
      url: moduleUrl("export const env=globalThis.__afterpartyAuthTest.env;"), shortCircuit: true,
    };
    if (specifier.endsWith("core-server")) return {
      url: moduleUrl(`
        export const coreUrl=()=>null;
        export const commandTicket=async()=>({});
        export const coreRequest=async(...args)=>{
          globalThis.__afterpartyAuthTest.coreCalls.push(args);
          if(args[0]==='/v1/application')return {
            clientId:'111111111111111111',defaultGuildId:'222222222222222222',oauthReady:true,
            guilds:[{id:'222222222222222222',name:'Owner test guild',roomCode:'TESTROOM'},
              {id:'333333333333333333',name:'Other test guild',roomCode:'OTHERONE'}]
          };
          if(args[0].startsWith('/v1/admin?')){
            if(globalThis.__afterpartyAuthTest.rejectAdmin)throw Object.assign(new Error('Synthetic Core permission rejection'),{status:403});
            return {guildId:new URL(args[0],'https://core.example').searchParams.get('guildId')};
          }
          if(args[0]==='/v1/concert-queue')return {state:{queue:[],revision:'synthetic'},canManage:args[2].admin===true};
          throw new Error('Unexpected upstream call');
        };
      `), shortCircuit: true,
    };
    if (specifier.startsWith("@/")) return next(new URL(specifier.slice(2) + ".ts", root).href, options);
    if (specifier.startsWith(".") && !/\.\w+$/.test(specifier)) {
      const url = new URL(specifier + ".ts", options.parentURL);
      if (existsSync(url)) return next(url.href, options);
    }
    return next(specifier, options);
  },
  load(url, options, next) {
    if (url.startsWith(root.href) && url.endsWith(".ts")) return {
      format: "module", source: stripTypeScriptTypes(readFileSync(new URL(url), "utf8"), { mode: "transform" }), shortCircuit: true,
    };
    return next(url, options);
  },
});
const { isAdmin, hash } = await import("../lib/server.ts");
const { login, hasPasswordSession } = await import("../lib/admin-session.ts");
const { adminGuilds, adminContext, adminState } = await import("../lib/discord-auth.ts");
const session = await import("../app/api/admin/session/route.ts");
const me = await import("../app/api/me/route.ts");
const queue = await import("../app/api/discord/queue/route.ts");
hooks.deregister();

function fixture() {
  const sqlite = new DatabaseSync(":memory:");
  for (const name of readdirSync(new URL("../drizzle/", import.meta.url)).filter(n => n.endsWith(".sql")).sort())
    sqlite.exec(readFileSync(new URL("../drizzle/" + name, import.meta.url), "utf8"));
  return sqlite;
}
// Reset fields without replacing the imported environment object.
const env = context.env;
function setup() {
  for (const key of Object.keys(env)) Reflect.deleteProperty(env, key);
  context.coreCalls.length = 0;
  context.rejectAdmin = false;
  const sqlite = fixture();
  const prepare = (sql: string, args: SQLInputValue[] = []): FixtureStatement => ({
    bind(...values) { return prepare(sql, values); },
    async first() { return sqlite.prepare(sql).get(...args) ?? null; },
    async run() { return { meta: { changes: Number(sqlite.prepare(sql).run(...args).changes) } }; },
    async all() { return { results: sqlite.prepare(sql).all(...args) }; },
  });
  env.DB = { prepare, async batch(statements) {
    sqlite.exec("BEGIN");
    try { const results = []; for (const statement of statements) results.push(await statement.run()); sqlite.exec("COMMIT"); return results; }
    catch (error) { sqlite.exec("ROLLBACK"); throw error; }
  }};
  const salt = "a1".repeat(16);
  env.ADMIN_PASSWORD_HASH = `pbkdf2$100000$${salt}$${pbkdf2Sync("synthetic-password", Buffer.from(salt, "hex"), 100000, 32, "sha256").toString("hex")}`;
  env.ADMIN_BRIDGE_KEY = "synthetic-bridge";
  const request = (cookie = "", method = "GET", input?: Record<string, unknown>) => new Request("https://afterparty.example/admin", {
    method, headers: { cookie, "Content-Type": "application/json" },
    ...(input === undefined ? {} : { body: JSON.stringify(input) }),
  });
  const signIn = async () => {
    const response = await login(request("", "POST", { password: "synthetic-password" }));
    assert.equal(response.status, 200);
    return response.headers.getSetCookie()[0].split(";")[0];
  };
  return { sqlite, request, signIn };
}

test("hosting identity headers cannot create an owner session", async () => {
  const f = setup();
  try {
    env.OWNER_EMAIL = "synthetic-owner@example.invalid";
    const request = new Request("https://afterparty.example/admin", { headers: {
      "oai-authenticated-user-id": "synthetic-owner",
      "oai-authenticated-user-email": env.OWNER_EMAIL,
    }});
    assert.equal(await isAdmin(request), false);
    assert.equal(await isAdmin(), false);
    assert.equal(await isAdmin(new Request(request, { headers: { Authorization: "Bearer wrong" } })), false);
    assert.equal(await isAdmin(new Request(request, { headers: { Authorization: "Bearer synthetic-bridge" } })), true);
  } finally { f.sqlite.close(); }
});

test("anonymous admin checks skip bridge hashing while supplied credentials are still verified", async () => {
  const f = setup();
  const digest = mock.method(crypto.subtle, "digest");
  try {
    assert.equal(await isAdmin(f.request()), false);
    assert.equal(digest.mock.callCount(), 0);
    assert.equal(await isAdmin(new Request(f.request().url, { headers: { Authorization: "Bearer wrong" } })), false);
    assert.equal(digest.mock.callCount(), 2);
    assert.equal(await isAdmin(new Request(f.request().url, { headers: { Authorization: "Bearer synthetic-bridge" } })), true);
    assert.equal(digest.mock.callCount(), 4);
  } finally { digest.mock.restore(); f.sqlite.close(); }
});

test("password sessions authenticate handlers and lose access after expiry or rotation", async () => {
  const f = setup();
  try {
    const cookie = await f.signIn();
    assert.equal(await isAdmin(f.request(cookie)), true);
    assert.deepEqual(await (await me.GET(f.request(cookie))).json(), { admin: true });
    const authenticated = await (await session.GET(f.request(cookie))).json();
    assert(authenticated && typeof authenticated === "object" && "authenticated" in authenticated && "method" in authenticated);
    assert.equal(authenticated.authenticated, true);
    assert.equal(authenticated.method, "password");
    f.sqlite.prepare("UPDATE admin_sessions SET expires_at=?").run(Date.now() - 1);
    assert.equal(await hasPasswordSession(f.request(cookie)), false);
    const rotated = await f.signIn();
    assert(env.ADMIN_PASSWORD_HASH);
    env.ADMIN_PASSWORD_HASH = env.ADMIN_PASSWORD_HASH.replace(/a1/g, "b2");
    assert.equal(await isAdmin(f.request(rotated)), false);
  } finally { f.sqlite.close(); }
});

test("logout revokes password and Discord sessions and clears both cookies", async () => {
  const f = setup();
  try {
    const ownerCookie = await f.signIn(), discordToken = "c3".repeat(32);
    f.sqlite.prepare("INSERT INTO discord_admin_sessions VALUES(?,?,?)").run(await hash(discordToken), "synthetic-encrypted-grant", Date.now() + 60000);
    const request = f.request(ownerCookie + "; gk-discord=" + discordToken, "DELETE", {});
    const badOrigin = new Request(request, { headers: { cookie: request.headers.get("cookie") ?? "", "Content-Type": "application/json", Origin: "https://foreign.example" } });
    assert.equal((await session.DELETE(badOrigin)).status, 403);
    assert.equal(await isAdmin(f.request(ownerCookie)), true);
    const response = await session.DELETE(f.request(ownerCookie + "; gk-discord=" + discordToken, "DELETE", {}));
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { authenticated: false, redirect: "/admin" });
    const cookies = response.headers.getSetCookie();
    assert.equal(cookies.length, 2);
    assert(cookies.every(cookie => cookie.includes("Max-Age=0") && cookie.includes("HttpOnly")));
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM admin_sessions").get()?.n, 0);
    assert.equal(f.sqlite.prepare("SELECT count(*) AS n FROM discord_admin_sessions").get()?.n, 0);
    assert.equal(await isAdmin(f.request(ownerCookie)), false);
  } finally { f.sqlite.close(); }
});

test("owner-password access remains limited to the initial guild", async () => {
  const f = setup();
  try {
    const cookie = await f.signIn(), request = f.request(cookie);
    const access = await adminGuilds(request);
    assert.deepEqual(access.guilds.map(g => g.id), ["222222222222222222"]);
    assert.deepEqual(await adminContext(request, "222222222222222222"), { guildId: "222222222222222222" });
    await assert.rejects(adminContext(request, "333333333333333333"), (error: unknown) => error instanceof Error && "status" in error && error.status === 403);
  } finally { f.sqlite.close(); }
});

test("explicit anonymous guild polling needs only the public queue Core request", async () => {
  const f = setup();
  try {
    const request = new Request(f.request().url + "?guildId=333333333333333333");
    const response = await queue.GET(request);
    assert.equal(response.status, 200);
    assert.deepEqual(context.coreCalls.map(call => call[0]), ["/v1/concert-queue"]);
    const payload = context.coreCalls[0][2] as { guildId: string; admin: boolean; tokenCipher?: string };
    assert.equal(payload.guildId, "333333333333333333");
    assert.equal(payload.admin, false);
    assert.equal(payload.tokenCipher, undefined);
  } finally { f.sqlite.close(); }
});

test("explicit Discord grant skips application lookup but Core still checks access on every call", async () => {
  const f = setup();
  try {
    const token = "d4".repeat(32), grant = "synthetic-encrypted-grant";
    f.sqlite.prepare("INSERT INTO discord_admin_sessions VALUES(?,?,?)")
      .run(await hash(token), grant, Date.now() + 60000);
    const request = f.request("gk-discord=" + token);
    assert.deepEqual(await adminContext(request, "333333333333333333"), {
      guildId: "333333333333333333", tokenCipher: grant,
    });
    assert.equal(context.coreCalls.length, 0);
    assert.deepEqual(await adminState(request, "333333333333333333"), { guildId: "333333333333333333" });
    assert.deepEqual(context.coreCalls.map(call => call[0]), ["/v1/admin?guildId=333333333333333333"]);
    assert.deepEqual(context.coreCalls[0][3], { "X-Discord-Grant": grant });
    context.rejectAdmin = true;
    await assert.rejects(adminState(request, "333333333333333333"),
      error => error instanceof Error && "status" in error && error.status === 403);
    assert.equal(context.coreCalls.length, 2, "permission responses must not be cached");
  } finally { f.sqlite.close(); }
});

test("invalid and expired explicit guild sessions fail before any Core lookup", async () => {
  const f = setup();
  try {
    const token = "e5".repeat(32);
    f.sqlite.prepare("INSERT INTO discord_admin_sessions VALUES(?,?,?)")
      .run(await hash(token), "synthetic-expired-grant", Date.now() - 1);
    await assert.rejects(adminContext(f.request("gk-discord=" + token), "333333333333333333"),
      error => error instanceof Error && "status" in error && error.status === 403);
    await assert.rejects(adminContext(f.request(), "invalid-guild"),
      error => error instanceof Error && "status" in error && error.status === 400);
    assert.equal(context.coreCalls.length, 0);
  } finally { f.sqlite.close(); }
});

test("implicit guild selection still reads the configured default for Discord and owner sessions", async () => {
  const f = setup();
  try {
    const token = "f6".repeat(32);
    f.sqlite.prepare("INSERT INTO discord_admin_sessions VALUES(?,?,?)")
      .run(await hash(token), "synthetic-encrypted-grant", Date.now() + 60000);
    assert.equal((await adminContext(f.request("gk-discord=" + token), undefined)).guildId, "222222222222222222");
    assert.deepEqual(context.coreCalls.map(call => call[0]), ["/v1/application"]);
    context.coreCalls.length = 0;
    const owner = await f.signIn();
    assert.deepEqual(await adminContext(f.request(owner), undefined), { guildId: "222222222222222222" });
    assert.deepEqual(context.coreCalls.map(call => call[0]), ["/v1/application"]);
  } finally { f.sqlite.close(); }
});
