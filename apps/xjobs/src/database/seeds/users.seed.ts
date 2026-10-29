import type { Seed } from './seed.interface';
import { defaultWorkspace } from 'src/common/constants';

const users = [
  { email: 'admin@xjobs.local', name: 'Admin' },
  { email: 'recruiter@xjobs.local', name: 'Recruiter' },
  { email: 'candidate@xjobs.local', name: 'Candidate' },
];

export const usersSeed: Seed = {
  name: 'users',
  async run(tx) {
    const workspace = await tx.orm.public.Workspace.where({
      slug: defaultWorkspace.slug,
    }).first();
    if (!workspace) {
      throw new Error('Run the workspaces seed before the users seed.');
    }
    const workspaceId = workspace.id;
    for (const user of users) {
      const existing = await tx.orm.public.User.where({
        workspaceId,
        email: user.email,
      }).first();
      if (existing) {
        await tx.orm.public.User.where({
          workspaceId,
          email: user.email,
        }).update({ name: user.name });
      } else {
        await tx.orm.public.User.create({ ...user, workspaceId });
      }
    }
  },
};
