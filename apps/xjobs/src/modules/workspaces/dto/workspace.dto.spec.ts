import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateWorkspaceDto } from './create-workspace.dto';
import { UpdateWorkspaceDto } from './update-workspace.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

async function errorsFor(cls: new () => object, body: object) {
  const errors = await validate(plainToInstance(cls, body), options);
  return errors.map((error) => error.property);
}

describe('CreateWorkspaceDto', () => {
  it('accepts a name and a slug', async () => {
    expect(
      await errorsFor(CreateWorkspaceDto, { name: 'Mine', slug: 'my-space' }),
    ).toEqual([]);
  });

  it.each(['My Space', 'a', 'a'.repeat(65)])(
    'rejects slug %j',
    async (slug) => {
      expect(
        await errorsFor(CreateWorkspaceDto, { name: 'Mine', slug }),
      ).toEqual(['slug']);
    },
  );

  it('rejects an empty name', async () => {
    expect(
      await errorsFor(CreateWorkspaceDto, { name: '', slug: 'my-space' }),
    ).toEqual(['name']);
  });
});

describe('UpdateWorkspaceDto', () => {
  it('accepts an empty body', async () => {
    expect(await errorsFor(UpdateWorkspaceDto, {})).toEqual([]);
  });
});

describe('UpdateWorkspaceDto nulls', () => {
  it.each(['name', 'slug'])('rejects %s: null', async (field) => {
    expect(await errorsFor(UpdateWorkspaceDto, { [field]: null })).toEqual([
      field,
    ]);
  });
});
