import handler from "vinext/server/fetch-handler";
import { applyFramePolicy } from "../lib/frame-policy.ts";

const worker = {
  async fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    return applyFramePolicy(request, await handler.fetch(request, env, ctx));
  },
};

export default worker;
