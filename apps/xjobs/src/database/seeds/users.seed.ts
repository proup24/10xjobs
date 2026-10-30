import type { Seed } from './seed.interface';

const users = [
  { email: 'admin@xjobs.local', name: 'Admin' },
  { email: 'recruiter@xjobs.local', name: 'Recruiter' },
  { email: 'candidate@xjobs.local', name: 'Candidate' },
];

export const usersSeed: Seed = {
  name: 'users',
  async run(tx) {
    for (const user of users) {
      const existing = await tx.orm.public.User.where({
        email: user.email,
      }).first();
      if (existing) {
        await tx.orm.public.User.where({
          email: user.email,
        }).update({ name: user.name });
      } else {
        await tx.orm.public.User.create(user);
      }
    }
  },
};
