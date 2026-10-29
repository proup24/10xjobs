import type { Seed } from './seed.interface';

export const DEFAULT_WORKSPACE = { name: 'Default', slug: 'default' };

export const workspacesSeed: Seed = {
  name: 'workspaces',
  async run(tx) {
    const existing = await tx.orm.public.Workspace.where({
      slug: DEFAULT_WORKSPACE.slug,
    }).first();
    if (existing) {
      await tx.orm.public.Workspace.where({
        slug: DEFAULT_WORKSPACE.slug,
      }).update({ name: DEFAULT_WORKSPACE.name });
    } else {
      await tx.orm.public.Workspace.create(DEFAULT_WORKSPACE);
    }
  },
};
