/** In-memory repositories for unit tests; not part of the application build. */
import type { Channel } from 'src/common/enums';
import type { QuerySearchBuilderRow } from 'src/database';
import { QuerySearchRepository } from '../repositories/queries.repository';
import type {
  QuerySearchRecipe,
  QuerySearchAttachResult,
  QuerySearchReplaceExpected,
  QuerySearchReplaceResult,
} from '../types';

export class FakeQuerySearchRepository extends QuerySearchRepository {
  rows: QuerySearchBuilderRow[] = [];
  links: { profileId: string; queryId: string }[] = [];
  /** Profile id → owning user id; profiles not listed here are not anyone's. */
  owners = new Map<string, string>();

  private adjust(queryId: string, delta: number): void {
    const row = this.rows.find((candidate) => candidate.id === queryId);
    if (!row) throw new Error('missing builder');
    row.associatedProfiles = Math.max(0, row.associatedProfiles + delta);
    row.isActive = row.associatedProfiles > 0 && !row.isDeleted;
  }

  /** Inserts a shared builder; a duplicate hash is a unique violation. */
  async create(recipe: QuerySearchRecipe): Promise<QuerySearchBuilderRow> {
    if (this.rows.some((row) => row.hash === recipe.hash)) {
      throw { sqlState: '23505' };
    }
    const {
      position: _position,
      languages: _languages,
      experienceLevel: _experienceLevel,
      ...columns
    } = recipe;
    const now = new Date();
    const row = {
      id: `qs-${this.rows.length + 1}`,
      ...columns,
      associatedProfiles: 0,
      isActive: false,
      isDeleted: false,
      coveredUntil: null,
      claimRunId: null,
      claimWindowStart: null,
      claimWindowEnd: null,
      claimExpiresAt: null,
      createdAt: now,
      updatedAt: now,
    } as QuerySearchBuilderRow;
    this.rows.push(row);
    return row;
  }

  async attach(
    profileId: string,
    recipes: QuerySearchRecipe[],
  ): Promise<QuerySearchAttachResult> {
    const result = { created: 0, existing: 0 };
    for (const recipe of recipes) {
      let row = this.rows.find((candidate) => candidate.hash === recipe.hash);
      if (row) {
        result.existing += 1;
      } else {
        row = await this.create(recipe);
        result.created += 1;
      }
      if (row.isDeleted) continue;
      const queryId = row.id;
      if (
        this.links.some(
          (link) => link.profileId === profileId && link.queryId === queryId,
        )
      )
        continue;
      this.links.push({ profileId, queryId });
      this.adjust(queryId, 1);
    }
    return result;
  }

  async detach(profileId: string): Promise<number> {
    const mine = this.links.filter((link) => link.profileId === profileId);
    this.links = this.links.filter((link) => link.profileId !== profileId);
    for (const link of mine) this.adjust(link.queryId, -1);
    return mine.length;
  }

  async detachChannel(profileId: string, channel: Channel): Promise<number> {
    const onChannel = new Set(
      this.rows.filter((row) => row.channel === channel).map((row) => row.id),
    );
    const mine = this.links.filter(
      (link) => link.profileId === profileId && onChannel.has(link.queryId),
    );
    this.links = this.links.filter((link) => !mine.includes(link));
    for (const link of mine) this.adjust(link.queryId, -1);
    return mine.length;
  }

  async list(
    userId: string,
    profileId: string,
    channel?: Channel,
  ): Promise<QuerySearchBuilderRow[] | null> {
    if (this.owners.get(profileId) !== userId) return null;
    const ids = new Set(
      this.links
        .filter((link) => link.profileId === profileId)
        .map((link) => link.queryId),
    );
    return this.rows.filter(
      (row) =>
        ids.has(row.id) &&
        !row.isDeleted &&
        (!channel || row.channel === channel),
    );
  }

  async listActive(channel: Channel): Promise<QuerySearchBuilderRow[]> {
    return this.rows
      .filter(
        (row) => row.channel === channel && row.isActive && !row.isDeleted,
      )
      .sort(
        (a, b) =>
          a.createdAt.getTime() - b.createdAt.getTime() ||
          (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
      );
  }

  async retireOutdated(version: number): Promise<number> {
    const outdated = this.rows.filter(
      (row) => row.version < version && !row.isActive && !row.isDeleted,
    );
    for (const row of outdated) row.isDeleted = true;
    return outdated.length;
  }

  /** Profile id → searchesVersion recorded by `replace`. */
  searchesVersions = new Map<string, number>();
  /** Profile ids that exist and are published; `releaseAndDelete` removes them. */
  published = new Set<string>();
  /** Profile id → stored post search switch; a profile not listed has it off. */
  postSearch = new Map<string, boolean>();

  async replace(
    profileId: string,
    recipes: QuerySearchRecipe[],
    expected: QuerySearchReplaceExpected,
  ): Promise<QuerySearchReplaceResult> {
    const nothing = { created: 0, existing: 0, released: 0 };
    if (!this.published.has(profileId))
      return { ...nothing, skipped: 'not_published' };
    if ((this.postSearch.get(profileId) ?? false) !== expected.postSearch)
      return { ...nothing, skipped: 'post_search_changed' };
    const attached = await this.attach(profileId, recipes);
    const wanted = new Set(recipes.map((recipe) => recipe.hash));
    const hashOf = (queryId: string): string => {
      const row = this.rows.find((candidate) => candidate.id === queryId);
      if (!row) throw new Error('missing builder');
      return row.hash;
    };
    const drop = this.links.filter(
      (link) =>
        link.profileId === profileId && !wanted.has(hashOf(link.queryId)),
    );
    this.links = this.links.filter((link) => !drop.includes(link));
    for (const link of drop) this.adjust(link.queryId, -1);
    this.searchesVersions.set(profileId, expected.searchesVersion);
    return { ...attached, released: drop.length, skipped: null };
  }

  async releaseAndDelete(profileId: string): Promise<boolean> {
    if (!this.published.has(profileId)) return false;
    await this.detach(profileId);
    this.published.delete(profileId);
    this.owners.delete(profileId);
    return true;
  }

  async softDelete(queryId: string): Promise<QuerySearchBuilderRow | null> {
    const row = this.rows.find((candidate) => candidate.id === queryId);
    if (!row) return null;
    this.links = this.links.filter((link) => link.queryId !== queryId);
    Object.assign(row, {
      isDeleted: true,
      isActive: false,
      associatedProfiles: 0,
    });
    return row;
  }
}
