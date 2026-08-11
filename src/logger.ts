import { AuditLog as CoreAuditLog } from "@rolists/mcp-core";

/**
 * Audit entry kinds. Widens the shared base with this server's own vocabulary: it drives
 * a toolchain and writes map files, where gmod-mcp drives a live engine.
 */
export type AuditKind =
  | "server_start"
  | "tool_call"
  | "tool_result"
  | "file_write"
  | "compile_start"
  | "compile_end"
  | "error";

/**
 * Append-only JSONL audit log, written to `<stateDir>/logs/audit.jsonl`.
 *
 * Writes are synchronous on purpose: volumes are low, and this server mutates map
 * sources and writes into `server-config/` -- if it dies mid-action we want the record
 * of what it had already touched.
 */
export class AuditLog extends CoreAuditLog<AuditKind> {}

export type { AuditEntry } from "@rolists/mcp-core";
