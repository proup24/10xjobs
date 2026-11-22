import { describe, expect, it } from 'vitest';
import { seedOptions } from '../rules/options.testing';
import { fixtureHiringPost, fixtureJunkPost } from './fixture-post.testing';
import {
  postDocumentSchema,
  postModelOutputSchema,
  type PostDocument,
} from './post-extraction';
import { flattenForStrict, modelOutputJsonSchema } from './model-output';
import { z } from 'zod';

const ok = (d: unknown) => postDocumentSchema.safeParse(d).success;

function hiring(edit: (d: PostDocument) => void): PostDocument {
  const d = fixtureHiringPost();
  edit(d);
  return d;
}

describe('postDocumentSchema', () => {
  it('accepts a two-role hiring post and a junk post', () => {
    expect(ok(fixtureHiringPost())).toBe(true);
    expect(fixtureHiringPost().roles).toHaveLength(2);
    expect(ok(fixtureJunkPost())).toBe(true);
  });

  it('rejects junk with a role', () => {
    const d = fixtureJunkPost();
    d.roles = fixtureHiringPost().roles.slice(0, 1);
    expect(ok(d)).toBe(false);
  });

  it('rejects hiring with no role', () => {
    expect(ok(hiring((d) => (d.roles = [])))).toBe(false);
  });

  it('rejects a reason that does not belong to its verdict', () => {
    const d = fixtureJunkPost();
    d.verdict = { ...d.verdict, value: 'not_hiring', reason: 'funnel' };
    expect(ok(d)).toBe(false);
    expect(ok(hiring((x) => (x.verdict.reason = 'other')))).toBe(false);
    const nh = fixtureJunkPost();
    nh.verdict = { ...nh.verdict, value: 'not_hiring', reason: 'role_filled' };
    expect(ok(nh)).toBe(true);
  });

  it('keeps unstated alone in kinds', () => {
    expect(
      ok(
        hiring((d) => {
          d.roles[1].howToApply.kinds = ['unstated', 'connect_dm_comment'];
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        hiring((d) => {
          d.roles[1].howToApply.kinds = ['unstated'];
        }),
      ),
    ).toBe(true);
  });

  it('ties email to the email kind', () => {
    expect(
      ok(
        hiring((d) => {
          d.roles[0].howToApply.email = null;
        }),
      ),
    ).toBe(false);
    expect(
      ok(
        hiring((d) => {
          d.roles[1].howToApply.email = 'a@b.com';
        }),
      ),
    ).toBe(false);
  });

  it('rejects empty kinds', () => {
    expect(
      ok(
        hiring((d) => {
          d.roles[1].howToApply.kinds = [];
        }),
      ),
    ).toBe(false);
  });

  it('ties links to the external_link and linkedin_job kinds', () => {
    const link = 'https://boards.greenhouse.io/acme/jobs/1';
    for (const kind of ['external_link', 'linkedin_job'] as const) {
      // The kind with no link.
      expect(
        ok(
          hiring((d) => {
            d.roles[1].howToApply.kinds = [kind];
          }),
        ),
      ).toBe(false);
      // The kind with its link.
      expect(
        ok(
          hiring((d) => {
            d.roles[1].howToApply.kinds = [kind];
            d.roles[1].howToApply.links = [link];
          }),
        ),
      ).toBe(true);
    }
    // A link with neither kind.
    expect(
      ok(
        hiring((d) => {
          d.roles[1].howToApply.links = [link];
        }),
      ),
    ).toBe(false);
  });
});

describe('postModelOutputSchema', () => {
  it('converts to a strict JSON schema and reuses the listing output per role', () => {
    const json = flattenForStrict(
      z.toJSONSchema(postModelOutputSchema(seedOptions())),
    ) as { properties: { roles: { items: { properties: object } } } };
    const roleProps = Object.keys(json.properties.roles.items.properties);
    const listing = modelOutputJsonSchema(seedOptions()) as {
      properties: object;
    };
    for (const k of Object.keys(listing.properties)) {
      expect(roleProps).toContain(k);
    }
    expect(roleProps).toEqual(
      expect.arrayContaining(['employer', 'authorRelation', 'howToApply']),
    );
  });
});
