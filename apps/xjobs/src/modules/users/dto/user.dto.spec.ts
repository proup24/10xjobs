import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { UpdateUserDto } from './update-user.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

const address = { line1: '1 Rue X', city: 'Rabat', country: 'MA' };

async function errorsFor(cls: new () => object, body: object) {
  const errors = await validate(plainToInstance(cls, body), options);
  return errors.map((error) => error.property);
}

describe('UpdateUserDto', () => {
  it('accepts a name and an address', async () => {
    expect(
      await errorsFor(UpdateUserDto, { name: 'Youssef', address }),
    ).toEqual([]);
  });

  it('accepts null to clear the address', async () => {
    expect(await errorsFor(UpdateUserDto, { address: null })).toEqual([]);
  });

  it('rejects name: null and an empty name', async () => {
    expect(await errorsFor(UpdateUserDto, { name: null })).toEqual(['name']);
    expect(await errorsFor(UpdateUserDto, { name: '' })).toEqual(['name']);
  });

  it('rejects a lowercase country code', async () => {
    expect(
      await errorsFor(UpdateUserDto, {
        address: { ...address, country: 'ma' },
      }),
    ).toEqual(['address']);
  });

  it('rejects an address without line1', async () => {
    expect(
      await errorsFor(UpdateUserDto, {
        address: { city: 'Rabat', country: 'MA' },
      }),
    ).toEqual(['address']);
  });

  it('rejects an email, which lives only in Supabase Auth', async () => {
    expect(await errorsFor(UpdateUserDto, { email: 'me@example.com' })).toEqual(
      ['email'],
    );
  });
});
