import { fixtureDocument } from './fixture.testing';
import type { PostDocument } from './post-extraction';

const howToApply = (
  email: string | null,
): PostDocument['roles'][number]['howToApply'] => ({
  kinds: email ? ['email'] : ['connect_dm_comment'],
  email,
  emailQuote: email ? `Send your CV to ${email}` : '',
  links: [],
  quote: email ? `Send your CV to ${email}` : 'DM me',
});

/** A hiring post with two roles. */
export function fixtureHiringPost(): PostDocument {
  const facts = fixtureDocument();
  return {
    verdict: {
      value: 'hiring',
      reason: 'hiring',
      quote: 'We are hiring',
      confidence: 'sure',
    },
    roles: [
      {
        roleKey: 'backend-engineer',
        title: 'Backend Engineer',
        employer: { name: 'Acme', quote: 'Acme is hiring' },
        authorRelation: 'employer',
        howToApply: howToApply('jobs@acme.com'),
        facts,
      },
      {
        roleKey: 'senior-backend-engineer',
        title: 'Senior Backend Engineer',
        employer: { name: 'Acme', quote: 'Acme is hiring' },
        authorRelation: 'employer',
        howToApply: howToApply(null),
        facts: {
          ...facts,
          position: {
            ...facts.position,
            value: { roleKind: 'backend', title: 'Senior Backend Engineer' },
          },
        },
      },
    ],
    truncated: false,
    models: { generator: 'm' },
  };
}

/** A junk post: no roles. */
export function fixtureJunkPost(): PostDocument {
  return {
    verdict: {
      value: 'junk',
      reason: 'funnel',
      quote: 'Join our group',
      confidence: 'sure',
    },
    roles: [],
    truncated: false,
    models: { generator: 'm' },
  };
}
