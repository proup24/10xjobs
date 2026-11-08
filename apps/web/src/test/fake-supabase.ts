import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@xjobs/database/types';

/**
 * A recording stand-in for the supabase-js client: every awaited query and rpc becomes a
 * `Call`, in execution order, and `reply` decides what each returns.
 */

export type DbError = { code?: string; message?: string };
export type Reply = { data: unknown; error: DbError | null };

export type QueryCall = {
  kind: 'query';
  table: string;
  action: 'select' | 'insert' | 'update' | 'upsert' | 'delete';
  payload?: unknown;
  options?: unknown;
  columns?: string;
  filters: [string, ...unknown[]][];
  single: boolean;
};

export type RpcCall = { kind: 'rpc'; fn: string; args: unknown };

export type Call = QueryCall | RpcCall;

type Opts = {
  /** The reply for a query; undefined falls back to no rows and no error. */
  reply?: (call: QueryCall) => Reply | undefined;
  rpc?: (call: RpcCall) => Reply | undefined;
  claims?: Record<string, unknown> | null;
};

const FILTERS = ['eq', 'neq', 'in', 'not', 'is', 'order', 'limit', 'range'];

export function fakeSupabase(opts: Opts = {}) {
  const calls: Call[] = [];

  function from(table: string) {
    const call: QueryCall = {
      kind: 'query',
      table,
      action: 'select',
      filters: [],
      single: false,
    };
    const builder: Record<string, unknown> = {
      select(columns?: string) {
        call.columns = columns;
        return builder;
      },
      insert(payload: unknown, options?: unknown) {
        Object.assign(call, { action: 'insert', payload, options });
        return builder;
      },
      update(payload: unknown) {
        Object.assign(call, { action: 'update', payload });
        return builder;
      },
      upsert(payload: unknown, options?: unknown) {
        Object.assign(call, { action: 'upsert', payload, options });
        return builder;
      },
      delete() {
        call.action = 'delete';
        return builder;
      },
      maybeSingle() {
        call.single = true;
        return builder;
      },
      single() {
        call.single = true;
        return builder;
      },
      then(
        onFulfilled: (r: Reply) => unknown,
        onRejected?: (e: unknown) => unknown,
      ) {
        calls.push(call);
        const reply = opts.reply?.(call) ?? {
          data: call.single ? null : [],
          error: null,
        };
        return Promise.resolve(reply).then(onFulfilled, onRejected);
      },
    };
    for (const name of FILTERS) {
      builder[name] = (...args: unknown[]) => {
        call.filters.push([name, ...args]);
        return builder;
      };
    }
    return builder;
  }

  const raw = {
    from,
    rpc(fn: string, args: unknown) {
      const call: RpcCall = { kind: 'rpc', fn, args };
      calls.push(call);
      return Promise.resolve(opts.rpc?.(call) ?? { data: null, error: null });
    },
    auth: {
      getClaims: async () =>
        opts.claims === null
          ? { data: null, error: null }
          : {
              data: { claims: opts.claims ?? { sub: 'u1' } },
              error: null,
            },
    },
  };

  return {
    supabase: raw as unknown as SupabaseClient<Database>,
    calls,
    /** Every call in order: "table.action" for queries, "rpc fn" for rpcs. */
    trail: () =>
      calls.map((c) =>
        c.kind === 'rpc' ? `rpc ${c.fn}` : `${c.table}.${c.action}`,
      ),
    queries: (table: string, action?: QueryCall['action']) =>
      calls.filter(
        (c): c is QueryCall =>
          c.kind === 'query' &&
          c.table === table &&
          (action === undefined || c.action === action),
      ),
    rpcs: (fn: string) =>
      calls.filter((c): c is RpcCall => c.kind === 'rpc' && c.fn === fn),
  };
}
