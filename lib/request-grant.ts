// Internal Request identity capability. No HTTP header or cookie can mint this.
const grants = new WeakMap<Request, string>();
export function bindActivityGrant(request: Request, tokenCipher: string) { grants.set(request, tokenCipher); }
export function activityGrant(request: Request) { return grants.get(request); }
