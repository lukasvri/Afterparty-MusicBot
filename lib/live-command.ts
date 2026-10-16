export type CommandReceipt = { id: string; status?: string; ticket?: string; url?: string };
export type CommandResult = { command: { id: string; status: string; result?: string }; state: unknown };

export async function deliverCommand(receipt: CommandReceipt, request: typeof fetch = fetch): Promise<CommandResult | null> {
  if (!receipt.ticket || !receipt.url) return null;
  try {
    const response = await request(receipt.url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ticket: receipt.ticket }),
      signal: AbortSignal.timeout(28000),
      credentials: "omit",
    });
    if (!response.ok) return null;
    const value: unknown = await response.json();
    if (!value || typeof value !== "object" || !("command" in value) || !value.command || typeof value.command !== "object") return null;
    const command = value.command;
    if (!("id" in command) || command.id !== receipt.id || !("status" in command) || typeof command.status !== "string" ||
      !["pending", "processing", "done", "failed", "expired", "unknown"].includes(command.status) ||
      ("result" in command && command.result != null && typeof command.result !== "string")) return null;
    return {
      command: { id: receipt.id, status: command.status, ...("result" in command && typeof command.result === "string" ? { result: command.result } : {}) },
      state: "state" in value ? value.state : null,
    };
  } catch {
    return null;
  }
}
