import { test } from "node:test";
import assert from "node:assert/strict";
import { deliverCommand } from "../lib/live-command.ts";

const receipt = { id: "synthetic-command", ticket: "synthetic-ticket", url: "https://core.invalid/v1/command" };

test("direct acknowledgement must belong to the submitted command", async () => {
  for (const reply of [null, {}, { command: { id: "another-command", status: "done" } }, { command: { id: receipt.id, status: "unexpected" } }, { command: { id: receipt.id, status: "done", result: {} } }]) {
    assert.equal(await deliverCommand(receipt, async () => Response.json(reply)), null);
  }
});

test("direct delivery preserves pending commands for status polling and never sends browser credentials", async () => {
  const result = await deliverCommand(receipt, async (url, options) => {
    assert.equal(url, receipt.url);
    assert.equal(options?.credentials, "omit");
    assert.deepEqual(JSON.parse(String(options?.body)), { ticket: receipt.ticket });
    return Response.json({ command: { id: receipt.id, status: "processing" }, state: null }, { status: 202 });
  });
  assert.deepEqual(result, { command: { id: receipt.id, status: "processing" }, state: null });
  const completed = await deliverCommand(receipt, async () => Response.json({ command: { id: receipt.id, status: "done", result: null } }));
  assert.deepEqual(completed?.command, { id: receipt.id, status: "done" });
});

test("missing tickets and failed direct delivery leave the queued command available for fallback", async () => {
  assert.equal(await deliverCommand({ id: receipt.id }, async () => assert.fail("must not send without a ticket")), null);
  assert.equal(await deliverCommand(receipt, async () => new Response("Unavailable", { status: 503 })), null);
  assert.equal(await deliverCommand(receipt, async () => { throw new Error("disconnected"); }), null);
});
