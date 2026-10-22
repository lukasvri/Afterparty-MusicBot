import handler from "vinext/server/fetch-handler";
import { hostingTransition } from "../lib/hosting-transition";

const worker = {
  fetch(request: Request, env: Cloudflare.Env, ctx: ExecutionContext) {
    const transition = hostingTransition(request,
      (env as Cloudflare.Env & { AFTERPARTY_HOST_TRANSITION?: string }).AFTERPARTY_HOST_TRANSITION);
    if (transition) return transition;
    return handler.fetch(request, env, ctx);
  },
};

export default worker;
