import handler from "vinext/server/fetch-handler";
import { applyFramePolicy } from "../lib/frame-policy.ts";
import type { ActivityLaunchSettings } from "../lib/activity-launch.ts";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return applyFramePolicy(request, await handler.fetch(request, env, ctx), env as ActivityLaunchSettings);
  },
};

export default worker;
