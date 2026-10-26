import { api, body, hash, limit, fail } from "@/lib/server";
import { adminContext } from "@/lib/discord-auth";
import { coreRequest } from "@/lib/core-server";
import { visitorIdentity } from "@/lib/visitor-identity";
async function call(request: Request, input: Record<string, unknown>) {
  const guildId = input.guildId;
  if (typeof guildId !== "string" || !/^\d{14,22}$/.test(guildId))
    fail(400, "Velg en Discord-server.");
  const action = String(input.action ?? "read");
  const publicAction = ["read", "vote", "skip-vote"].includes(action);
  let context: Record<string, unknown> = { guildId };
  let admin = false;
  try {
    context = await adminContext(request, guildId);
    admin = true;
  } catch (error) {
    if (!publicAction) throw error;
  }
  const actor = visitorIdentity(request.headers);
  if (action !== "read" && !actor) fail(403, "Bli med i rommet først.");
  const payload = {
    ...context,
    admin,
    action,
    revision: input.revision,
    videoId: input.videoId,
    to: input.to,
    enabled: input.enabled,
    playbackKey: input.playbackKey,
    participantHash: actor ? await hash(guildId + ":" + actor) : undefined,
  };
  try {
    return await coreRequest("/v1/concert-queue", "POST", payload);
  } catch (error) {
    // A Discord session may administer another server. Reading a public queue
    // remains allowed, but mutation never falls back from failed authorization.
    if (action === "read" && admin)
      return coreRequest("/v1/concert-queue", "POST", {
        guildId,
        action: "read",
      });
    throw error;
  }
}
export const GET = (request: Request) =>
  api(async () => {
    await limit(request, "concert-queue-read", 120, 60000);
    return call(request, {
      guildId: new URL(request.url).searchParams.get("guildId"),
      action: "read",
    });
  });
export const POST = (request: Request) =>
  api(async () => {
    await limit(request, "concert-queue-write", 30, 60000);
    return call(request, await body(request));
  });
