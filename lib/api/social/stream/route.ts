import { api } from "@/lib/server";
import { coreSocialStream } from "@/lib/core-server";
import { socialInput } from "@/lib/social-server";

export async function POST(request: Request) {
  let response: Response | undefined;
  const error = await api(async () => {
    response = await coreSocialStream(await socialInput(request, true), request.signal);
    return null;
  });
  return response ?? error;
}
