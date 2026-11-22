import type {
  PostAuthor,
  PostDetail,
} from 'src/modules/ingest/normalize/record';

/**
 * Who a post source is by: a share's original author (null when the share
 * does not name one, never the sharer), or the source's own author for a
 * non-share. Automatic silencing keys authors by the same rule.
 */
export function originalAuthorOf(source: PostDetail): PostAuthor | null {
  return source.original ? source.original.author : source.author;
}
