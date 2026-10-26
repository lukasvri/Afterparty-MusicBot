import { api } from "@/lib/server";
import { coreRequest } from "@/lib/core-server";
import { socialInput } from "@/lib/social-server";

export const POST = (request: Request) => api(async () =>
  coreRequest("/v1/social", "POST", await socialInput(request)));
