import { Injectable } from '@nestjs/common';
import { ExtractionInvalidError } from '../models/errors';
import type { ModelCallMeta, PostingInput } from '../models/types';
import type { Vocabulary } from '../repositories/vocab.repository';
import type { PostLinks } from '../rules/post-input';
import { roleKeys } from '../rules/role-key';
import { normalizeForQuote, quoteFinder } from '../rules/validate';
import { zodErrors } from '../schema/errors';
import {
  type PostDocument,
  type PostModelOutput,
  postDocumentSchema,
} from '../schema/post-extraction';
import {
  type AssembledDocument,
  FactAssembler,
} from './fact-assembler.service';

/** A validated post document, plus each role's listing assembly (same order as `doc.roles`). */
export interface AssembledPost {
  doc: PostDocument;
  roles: AssembledDocument[];
  /** Listing-fact, employer and how-to-apply quotes that were cleared; hard checks throw instead. */
  quoteFailures: number;
}

// Punctuation a model or a sentence leaves around an address.
const EDGE = /^[\s.,;:)>(<]+|[\s.,;:)>(<]+$/g;
const LINKEDIN_JOB = /^https?:\/\/(?:www\.)?linkedin\.com\/jobs\/view\/(\d+)$/i;

function invalid(path: string, message: string): ExtractionInvalidError {
  return new ExtractionInvalidError(path, `${path}: ${message}`);
}

/** Whether `quote` holds `email` as a whole address, not inside a longer one. */
function containsAddress(quote: string, email: string): boolean {
  const escaped = email.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(?<![\\w.+%@-])${escaped}(?![\\w@-]|\\.\\w)`).test(
    normalizeForQuote(quote),
  );
}

const cleanEmail = (email: string): string =>
  email.replace(EDGE, '').toLowerCase();

/**
 * Turns the generator's output for a post into one post document. The
 * contact email and the links are the last automatic check before slice 05
 * may email an author, so they are hard checks: a miss throws
 * ExtractionInvalidError with a path, never a cleared quote.
 * Pure, like FactAssembler.
 */
@Injectable()
export class PostAssembler {
  constructor(private readonly facts: FactAssembler) {}

  assemble(
    output: PostModelOutput,
    meta: ModelCallMeta,
    input: PostingInput,
    /** The post's text without the links block: the hard-check quotes must come from it. */
    postText: string,
    links: PostLinks,
    vocabulary: Vocabulary,
  ): AssembledPost {
    // The links block lists every address and link, so a quote from it proves nothing.
    const inText = quoteFinder(postText);

    const { verdict } = output;
    if (verdict.quote === '' || !inText(verdict.quote))
      throw invalid('verdict.quote', 'not found in the post');

    const emails = new Map(links.emails.map((e) => [cleanEmail(e), e]));
    const linkedinIds = new Set(links.linkedinJobIds);
    const urls = new Set(links.urls);

    let quoteFailures = 0;
    const assembled: AssembledDocument[] = [];
    const roles = output.roles.map((r, i) => {
      const { employer, authorRelation, howToApply, ...listing } = r;
      const base = `roles.${i}.howToApply`;

      let email: string | null = null;
      if (howToApply.email !== null) {
        const found = emails.get(cleanEmail(howToApply.email));
        if (found === undefined)
          throw invalid(`${base}.email`, 'not an email found in the post');
        email = found;
        const quote = howToApply.emailQuote;
        if (quote === '' || !inText(quote))
          throw invalid(`${base}.emailQuote`, 'not found in the post');
        if (!containsAddress(quote, email))
          throw invalid(`${base}.emailQuote`, 'does not contain the email');
      }

      const checkedLinks = howToApply.links.map((raw, j) => {
        const link = raw.trim();
        const id = LINKEDIN_JOB.exec(link)?.[1];
        if (!urls.has(link) && !(id && linkedinIds.has(id)))
          throw invalid(`${base}.links.${j}`, 'not a link found in the post');
        return link;
      });

      const clearBad = (quote: string): string => {
        if (quote === '' || inText(quote)) return quote;
        quoteFailures++;
        return '';
      };

      let listed: AssembledDocument;
      try {
        listed = this.facts.assemble(listing, meta, input, vocabulary);
      } catch (error) {
        if (!(error instanceof ExtractionInvalidError)) throw error;
        const path = `roles.${i}.${error.path}`;
        throw new ExtractionInvalidError(path, `roles.${i}.${error.message}`);
      }
      assembled.push(listed);
      quoteFailures += listed.quoteFailures;
      return {
        title: listed.doc.position.value?.title ?? '',
        employer: { ...employer, quote: clearBad(employer.quote) },
        authorRelation,
        howToApply: {
          ...howToApply,
          email,
          emailQuote: howToApply.emailQuote,
          links: checkedLinks,
          quote: clearBad(howToApply.quote),
        },
        facts: listed.doc,
      };
    });

    const keys = roleKeys(roles.map((r) => r.title));
    const doc = {
      verdict,
      roles: roles.map((r, i) => ({ roleKey: keys[i], ...r })),
      truncated: input.truncated,
      models: { generator: meta.model },
    };
    const parsed = postDocumentSchema.safeParse(doc);
    if (!parsed.success)
      throw new ExtractionInvalidError(
        parsed.error.issues[0]?.path.join('.') ?? '',
        zodErrors(parsed.error).join('; '),
      );
    return { doc: parsed.data, roles: assembled, quoteFailures };
  }
}
