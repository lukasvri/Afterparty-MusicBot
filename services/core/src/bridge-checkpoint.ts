/** Shared wire contract only. No runtime services or credentials. */
export const BRIDGE_CHECKPOINT_MS = 60000;
export type BridgeCheckpoint = { bridgeRevision: number; checkpointRevision: number };

export function validBridgeCheckpoint(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.bridgeRevision) && Number(value.bridgeRevision) > 0 &&
    Number.isSafeInteger(value.checkpointRevision) && Number(value.checkpointRevision) > 0 &&
    Number(value.checkpointRevision) <= Number(value.bridgeRevision);
}
