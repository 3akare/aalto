/**
 * Just enough of `cloudflare:workers` to run a SQLite-backed Durable Object in
 * Node. `ctx.storage.sql` is backed by node:sqlite, so the ledger's real SQL -
 * upserts, MAX(), the sweep - is what the tests exercise, not a mock of it.
 */
import { DatabaseSync } from "node:sqlite";

export class DurableObject {
  constructor(ctx, env) {
    this.ctx = ctx;
    this.env = env;
  }
}

/** The SqlStorage surface the ledger uses: exec(query, ...bindings) → cursor. */
export function sqlStorage() {
  const db = new DatabaseSync(":memory:");
  return {
    exec(query, ...bindings) {
      // Several statements and no bindings is a schema script.
      if (bindings.length === 0 && query.split(";").filter((q) => q.trim()).length > 1) {
        db.exec(query);
        return cursor([]);
      }
      const statement = db.prepare(query);
      // node:sqlite has no "returns rows" flag; a statement with result
      // columns does, and only those may be read with all().
      if (statement.columns().length > 0) return cursor(statement.all(...bindings));
      statement.run(...bindings);
      return cursor([]);
    },
  };
}

function cursor(rows) {
  return {
    toArray: () => rows,
    one() {
      if (rows.length !== 1) throw new Error(`expected exactly one row, got ${rows.length}`);
      return rows[0];
    },
  };
}

export function durableObjectState() {
  return { storage: { sql: sqlStorage() } };
}
