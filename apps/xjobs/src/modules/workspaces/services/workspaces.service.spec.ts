import { ConflictException, NotFoundException } from '@nestjs/common';
import { FakeWorkspacesRepository } from '../testing/fakes';
import { WorkspacesService } from './workspaces.service';

describe('WorkspacesService', () => {
  let service: WorkspacesService;

  beforeEach(() => {
    service = new WorkspacesService(new FakeWorkspacesRepository());
  });

  it('creates a workspace', async () => {
    const workspace = await service.create({ name: 'Mine', slug: 'mine' });
    expect(workspace).toMatchObject({ name: 'Mine', slug: 'mine' });
  });

  it('turns a duplicate slug into a 409', async () => {
    await service.create({ name: 'Mine', slug: 'mine' });
    await expect(
      service.create({ name: 'Other', slug: 'mine' }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('404s an unknown workspace', async () => {
    await expect(service.getOrThrow('missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('404s an update of an unknown workspace', async () => {
    await expect(
      service.update('missing', { name: 'x' }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
