import type { PostAuthor, PostDetail } from '../../ingest/normalize/record';
import type { JobForProcessing, PostingInput } from '../models/types';
import { cut } from './input';

/** Everything a post links to: what the assembler checks emails and links against. */
export type PostLinks = {
  emails: string[];
  linkedinJobIds: string[];
  urls: string[];
};

const CUT_NOTE = 'Note: this text was cut at "see more".';

type Original = {
  id: string | null;
  author: PostAuthor | null;
  text: string | null;
  truncated: boolean;
  attachedUrls: string[];
  postedAt: string | null;
};

/** The post a source is about: the shared post, or the source itself. */
function originalOf(source: PostDetail): Original {
  return source.original ?? source;
}

function who(author: PostAuthor | null, withType: boolean): string {
  const name = author?.name ?? 'an unknown author';
  const extra = [author?.headline, withType ? author?.type : null].filter(
    (v): v is string => !!v,
  );
  return extra.length ? `${name} (${extra.join(', ')})` : name;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * The text the model reads for a post job, and the links the post carries.
 * Sources are sorted by post id, so their stored order never changes the
 * input or its hash. When sources disagree about the original post, the one
 * of the lowest-id source is rendered; sources about another original are
 * left out of the text and the links.
 */
export function buildPostInput(job: JobForProcessing): {
  input: PostingInput;
  links: PostLinks;
} {
  const sources = [...(job.postSources ?? [])].sort((a, b) =>
    a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
  );
  const sections: string[] = [];
  const links: PostLinks = { emails: [], linkedinJobIds: [], urls: [] };
  let anyCut = false;

  if (sources.length) {
    const original = originalOf(sources[0]);
    const used = sources.filter((s) => originalOf(s).id === original.id);

    const date = original.postedAt?.slice(0, 10);
    let block = `Original post by ${who(original.author, true)}${date ? `, posted ${date}` : ''}:`;
    if (original.text) block += `\n${original.text}`;
    if (original.truncated) {
      block += `\n${CUT_NOTE}`;
      anyCut = true;
    }
    sections.push(block);

    for (const s of used) {
      if (!s.original || !s.text) continue;
      let share = `Shared by ${who(s.author, false)} with this added text:\n${s.text}`;
      if (s.truncated) {
        share += `\n${CUT_NOTE}`;
        anyCut = true;
      }
      sections.push(share);
    }

    for (const s of used) {
      links.emails.push(...s.links.emails);
      links.linkedinJobIds.push(...s.links.linkedinJobIds);
      links.urls.push(
        ...s.links.atsPostings.map((a) => a.url),
        ...s.links.other,
        ...s.attachedUrls,
        ...(s.original?.attachedUrls ?? []),
      );
    }
    links.emails = unique(links.emails);
    links.linkedinJobIds = unique(links.linkedinJobIds);
    links.urls = unique(links.urls);

    const lines = [
      ...links.emails,
      ...links.linkedinJobIds.map(
        (id) => `https://www.linkedin.com/jobs/view/${id}`,
      ),
      ...links.urls,
    ];
    if (lines.length) sections.push(`Links in the post:\n${lines.join('\n')}`);
  }

  const { text, truncated } = cut(sections.join('\n\n'));
  return {
    input: {
      jobId: job.id,
      title: null,
      description: text,
      truncated: truncated || anyCut,
    },
    links,
  };
}
