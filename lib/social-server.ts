import { body, fail, hash, limit, row } from "@/lib/server";
import { discordSession } from "@/lib/discord-auth";
import { coreRequest } from "@/lib/core-server";
import type { RoomState } from "@/lib/types";

/** Social traffic has its own budget and never enters a playback command route. */
export async function socialInput(request: Request, stream = false) {
  const input = await body(request, 4096);
  const { scope, scopeId } = input;
  const action = stream ? "stream" : input.action;
  if (!stream && action === "stream") fail(400, "Use the social stream endpoint.");
  if (scope !== "room" && scope !== "guild") fail(400, "Choose a room or server.");
  if (typeof scopeId !== "string" || !(scope === "room" ? /^[A-Z0-9]{8}$/ : /^\d{14,22}$/).test(scopeId))
    fail(400, "Invalid social scope.");
  if (!["stream", "join", "read", "reaction", "highlight", "remove-highlight", "bingo-start", "bingo-mark", "bingo-stop", "configure"].includes(String(action)))
    fail(400, "Unknown social action.");
  await limit(request, "social-visitor", 30, 60000);
  if (action === "join") await limit(request, "social-join", 6, 60000);
  // Reserve most of the existing shared proxy/Core request budget for playback.
  // Do not derive a new trust boundary from caller-controlled forwarding headers.
  await limit(request, "social-budget", 120, 60000, true);
  let authority: Record<string, unknown>;
  if (scope === "guild") {
    const session = await discordSession(request);
    if (!session) fail(401, "Sign in with Discord to join concert activities.");
    authority = { tokenCipher: session.token_cipher };
  } else {
    const value = await row(scopeId);
    if (value.guild_id || scopeId === "DISCORD1") fail(403, "Join this concert through its Discord server.");
    const state = JSON.parse(value.state) as RoomState;
    const credential = (request.headers.get("authorization") ?? "").replace(/^Bearer /, "");
    const actorHash = credential ? await hash(credential) : "";
    authority = { host: actorHash === value.owner_hash || Boolean(actorHash && state.cohostHashes?.includes(actorHash)) };
    // Import only on explicit panel join, using the existing immutable room authority.
    // All subsequent reads and social writes avoid room imports and playback mutations.
    if (action === "join") await coreRequest("/v1/rooms", "POST", {
      operation: "import", ...value, owner_hash: state.engineOwnerHash ?? value.owner_hash,
    });
  }
  // Explicit allowlist: roles, OAuth grants, actor IDs and timestamps are server-owned.
  return {
    scope, scopeId, action, ...authority,
    token: input.token, playbackKey: input.playbackKey, eventId: input.eventId,
    revision: input.revision, emoji: input.emoji, text: input.text,
    highlightId: input.highlightId, cells: input.cells, cell: input.cell, enabled: input.enabled,
  };
}
