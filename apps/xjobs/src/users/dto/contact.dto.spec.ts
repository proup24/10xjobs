import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateContactDto } from './create-contact.dto';
import { UpdateContactDto } from './update-contact.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

async function errorsFor(body: object) {
  const errors = await validate(plainToInstance(CreateContactDto, body), options);
  return errors.map((error) => error.property);
}

describe('CreateContactDto', () => {
  it.each([
    ['phone', '+212612345678'],
    ['email', 'me@example.com'],
    ['linkedin', 'https://www.linkedin.com/in/me'],
    ['github', 'https://github.com/me'],
    ['gitlab', 'https://gitlab.com/me'],
    ['portfolio', 'https://me.dev'],
    ['website', 'http://example.com'],
    ['other', 'Telegram @me'],
  ])('accepts a %s contact', async (kind, value) => {
    expect(await errorsFor({ kind, value })).toEqual([]);
  });

  it.each([
    ['phone', '0612345678'],
    ['email', 'not-an-email'],
    ['github', 'github.com/me'],
    ['website', 'ftp://example.com'],
    ['other', ''],
    ['other', 'x'.repeat(501)],
  ])('rejects a %s contact of %j', async (kind, value) => {
    expect(await errorsFor({ kind, value })).toEqual(['value']);
  });

  it('rejects an unknown kind', async () => {
    expect(await errorsFor({ kind: 'fax', value: '+212612345678' })).toContain(
      'kind',
    );
  });
});

describe('UpdateContactDto', () => {
  async function updateErrors(body: object) {
    const errors = await validate(
      plainToInstance(UpdateContactDto, body),
      options,
    );
    return errors.map((error) => error.property);
  }

  it.each(['kind', 'value', 'isPrimary'])('rejects %s: null', async (field) => {
    expect(await updateErrors({ [field]: null })).toEqual([field]);
  });

  it('accepts label: null to clear the label', async () => {
    expect(await updateErrors({ label: null })).toEqual([]);
  });
});
