/** Accept existing open clients while new clients use the Afterparty header. */
export function visitorIdentity(headers:Headers){
  return headers.get('x-afterparty-visitor')??headers.get('x-muse-visitor');
}
