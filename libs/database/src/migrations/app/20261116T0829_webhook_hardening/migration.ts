#!/usr/bin/env -S node
import type {
  Contract as End,
  Contract as Start,
} from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract';
import endContract from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract.json' with { type: 'json' };
import startContract from '../../snapshots/9a48a4e77a746f4139019f4d84e5ccddfee3174d4b606a6626b8181d84715a60/contract.json' with { type: 'json' };
import {
  Migration,
  MigrationCLI,
  rawSql,
} from '@prisma/orm-postgres/migration';

// NOTE: this migration changes no contract (same start and end hash), so the
// `webhook-hardening` invariant in ../refs/db.json decides whether it runs on a fresh database.
// Keep it and the earlier invariants there.
//
// 1. match_reviews_webhook: a failure while enqueueing the webhook delivery must never block the
//    user's review. The call runs in its own block (a subtransaction): on any error its writes
//    are undone, a WARNING is logged, and the review insert goes on.
// 2. webhook_url_ok: a port must be 1 to 65535 (the earlier version took any 1-5 digits).
//    CREATE OR REPLACE keeps the owner and the grants of both functions.

const reviewTrigger = String.raw`CREATE OR REPLACE FUNCTION public.match_reviews_webhook() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  BEGIN
    PERFORM public.webhook_enqueue_match(NEW."matchId", 'review');
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'match_reviews_webhook: no webhook delivery for match %: % (%)',
      NEW."matchId", SQLERRM, SQLSTATE;
  END;
  RETURN NULL;
END $$;`;

const urlOk = String.raw`-- Whether a webhook URL may be saved: https, no userinfo, at most 2048 characters, a port (if
-- any) from 1 to 65535, and a host that is a DNS name (ASCII; IDNs in punycode) other than
-- localhost, *.localhost, *.local and *.internal. Any IP literal is refused: IPv6 in brackets,
-- and any host whose last label is a number (decimal, or hex with 0x), which URL parsers read
-- as IPv4 (10.0.0.1, 2130706433, 0x7f.0.0.1). The engine checks what the name resolves to
-- before each send.
CREATE OR REPLACE FUNCTION public.webhook_url_ok(p_url text) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_authority text;
  v_host text;
  v_port text;
BEGIN
  IF p_url IS NULL OR length(p_url) > 2048 OR p_url !~* '^https://'
     OR p_url ~ '[[:space:][:cntrl:]\\]' THEN
    RETURN false;
  END IF;
  -- Everything between "https://" and the path, query or fragment.
  v_authority := substring(substring(p_url from 9) from '^[^/?#]*');
  IF v_authority LIKE '%@%' OR v_authority LIKE '[%' THEN
    RETURN false;
  END IF;
  -- The host, without an optional port and trailing dots; null when the port is malformed.
  v_host := rtrim(lower(substring(v_authority from '^([^:]*)(:[0-9]{1,5})?$')), '.');
  IF v_host IS NULL OR v_host = '' OR v_host !~ '^[a-z0-9._-]+$' OR v_host ~ '(^\.|\.\.)' THEN
    RETURN false;
  END IF;
  v_port := substring(v_authority from '^[^:]*:([0-9]{1,5})$');
  IF v_port IS NOT NULL AND v_port::int NOT BETWEEN 1 AND 65535 THEN
    RETURN false;
  END IF;
  IF v_host = 'localhost' OR v_host ~ '\.(localhost|local|internal)$' THEN
    RETURN false;
  END IF;
  IF v_host ~ '(^|\.)(0x[0-9a-f]*|[0-9]+)$' THEN
    RETURN false;
  END IF;
  RETURN true;
END $$;`;

export default class M extends Migration<Start, End> {
  override readonly startContractJson = startContract;
  override readonly endContractJson = endContract;

  override get operations() {
    return [
      // operationClass is 'data' because the contract does not change: the planner
      // rejects a same-hash migration with no data op.
      rawSql({
        id: 'functions.match_reviews_webhook_never_blocks',
        invariantId: 'webhook-hardening',
        label:
          'match_reviews_webhook: an enqueue error logs a warning instead of failing the review',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: {
            schema: 'public',
            objectType: 'table',
            name: 'match_reviews',
          },
        },
        precheck: [],
        execute: [
          {
            description: 'replace match_reviews_webhook()',
            sql: reviewTrigger,
          },
        ],
        postcheck: [],
      }),
      rawSql({
        // The invariant is edge-level: the first op's invariantId routes this one too.
        id: 'functions.webhook_url_ok_port',
        label: 'webhook_url_ok: a port must be 1 to 65535',
        operationClass: 'data',
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: 'webhooks' },
        },
        precheck: [],
        execute: [
          {
            description: 'replace webhook_url_ok(text)',
            sql: urlOk,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
