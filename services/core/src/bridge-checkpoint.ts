/** Shared wire contract only. No runtime services or credentials. */
export const BRIDGE_CHECKPOINT_MS = 60000;
export type BridgeCheckpoint = { bridgeRevision: number; checkpointRevision: number };

export function validBridgeCheckpoint(value: Record<string, unknown>): boolean {
  return Number.isSafeInteger(value.bridgeRevision) && Number(value.bridgeRevision) > 0 &&
    Number.isSafeInteger(value.checkpointRevision) && Number(value.checkpointRevision) > 0 &&
    Number(value.checkpointRevision) <= Number(value.bridgeRevision);
}

/** Opt-in presence negotiation. Fixed-origin authenticated reads use this deadline. */
export const CORE_PRESENCE_CAPABILITY = 'core-authority-v1';
export const CORE_PRESENCE_DEADLINE_MS = 1500;
export const BRIDGE_RECONCILIATION_REQUIRED = 'bridge_reconciliation_required';
export function validBridgeIntent(value: Record<string, unknown>): boolean {
  return typeof value.epoch === 'string' && value.epoch.length > 0 && value.epoch.length <= 100 &&
    Number.isSafeInteger(value.sequence) && Number(value.sequence) >= 0;
}
export function sameBridgeIntent(left: Record<string, unknown>, right: Record<string, unknown>): boolean {
  return validBridgeIntent(left) && validBridgeIntent(right) && left.epoch === right.epoch &&
    left.sequence === right.sequence && (left.buffering === true) === (right.buffering === true);
}
