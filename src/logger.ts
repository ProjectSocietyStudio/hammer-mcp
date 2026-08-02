import { appendFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";

/** Audit entry kinds. */
export type AuditKind =
  | "server_start"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "compile_start"
  | "compile_end"
  | "error";

export interface AuditEntry {
  ts: number;
  kind: AuditKind;
  commandId?: string;
  /** Free-form payload, shaped by `kind`. */
  data?: Record<string, unknown>;
}

/**
 * Append-only JSONL audit log, written to `<stateDir>/logs/audit.jsonl`.
 *
 * Writes are synchronous on purpose: volumes are low, and this server mutates map
 * sources and writes into `server-config/` -- if it dies mid-action we want the record
 * of what it had already touched.
 */
export class AuditLog {
  private readonly file: string;

  constructor(stateDir: string) {
    const dir = join(stateDir, "logs");
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "audit.jsonl");
  }

  record(entry: Omit<AuditEntry, "ts"> & { ts?: number }): void {
    const full: AuditEntry = { ts: entry.ts ?? Date.now(), ...entry };
    appendFileSync(this.file, JSON.stringify(full) + "\n");
  }

  get path(): string {
    return this.file;
  }
}
