import assert from "node:assert/strict";
import WebSocket, { WebSocketServer } from "ws";
import { spawnSync } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

test("Drizzle loads a TypeScript schema and generates a migration with the patched toolchain", () => {
  const directory = mkdtempSync(join(tmpdir(), "afterparty-toolchain-"));
  try {
    const schema = join(directory, "schema.ts");
    const output = join(directory, "migrations");
    const config = join(directory, "drizzle.config.ts");
    writeFileSync(schema, `import { sqliteTable, integer, text } from ${JSON.stringify(require.resolve("drizzle-orm/sqlite-core"))};
export const fixture = sqliteTable("security_fixture", { id: integer("id").primaryKey(), value: text("value").notNull() });
`);
    writeFileSync(config, `export default ${JSON.stringify({ dialect: "sqlite", schema, out: output })};
`);
    const result = spawnSync(process.execPath, [
      join(root, "node_modules/drizzle-kit/bin.cjs"), "generate", "--config", config,
    ], { cwd: root, encoding: "utf8", timeout: 30_000 });
    assert.ifError(result.error);
    assert.equal(result.status, 0, `${result.stdout}
${result.stderr}`);
    const migrations = readdirSync(output).filter((name) => name.endsWith(".sql"));
    assert.equal(migrations.length, 1);
    assert.match(readFileSync(join(output, migrations[0]), "utf8"), /CREATE TABLE [`"]security_fixture[`"]/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("patched ws exchanges a message over an isolated loopback connection", { timeout: 15_000 }, async (context) => {
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 });
  let client: WebSocket | undefined;
  try {
    await once(server, "listening", { signal: context.signal });
    server.once("connection", (socket) => {
      socket.once("message", (message) => socket.send(message));
    });
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    client = new WebSocket(`ws://127.0.0.1:${address.port}`);
    await once(client, "open", { signal: context.signal });
    const received = once(client, "message", { signal: context.signal });
    client.send("afterparty-security-fixture");
    const [message] = await received;
    assert.equal(message.toString(), "afterparty-security-fixture");
  } finally {
    client?.terminate();
    for (const socket of server.clients) socket.terminate();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
});
