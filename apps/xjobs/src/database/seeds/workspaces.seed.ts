import { defaultWorkspace } from 'src/common/constants';
import type { Seed } from './seed.interface';

export const workspacesSeed: Seed = {
  name: 'workspaces',
  async run(tx) {
    const existing = await tx.orm.public.Workspace.where({
      slug: defaultWorkspace.slug,
    }).first();
    if (existing) {
      await tx.orm.public.Workspace.where({
        slug: defaultWorkspace.slug,
      }).update({ name: defaultWorkspace.name });
    } else {
      await tx.orm.public.Workspace.create(defaultWorkspace);
    }
  },
};
