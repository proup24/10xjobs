import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { CreateUserDto } from './create-user.dto';
import { UpdateUserDto } from './update-user.dto';

const options = { whitelist: true, forbidNonWhitelisted: true };

const valid = {
  name: 'Youssef',
  email: 'me@example.com',
  address: { line1: '1 Rue X', city: 'Rabat', country: 'MA' },
};

async function errorsFor(cls: new () => object, body: object) {
  const errors = await validate(plainToInstance(cls, body), options);
  return errors.map((error) => error.property);
}

describe('CreateUserDto', () => {
  it('accepts a user with an address', async () => {
    expect(await errorsFor(CreateUserDto, valid)).toEqual([]);
  });

  it('rejects an invalid email', async () => {
    expect(
      await errorsFor(CreateUserDto, { ...valid, email: 'not-an-email' }),
    ).toEqual(['email']);
  });

  it('rejects a lowercase country code', async () => {
    expect(
      await errorsFor(CreateUserDto, {
        ...valid,
        address: { ...valid.address, country: 'ma' },
      }),
    ).toEqual(['address']);
  });

  it('rejects an address without line1', async () => {
    expect(
      await errorsFor(CreateUserDto, {
        ...valid,
        address: { city: 'Rabat', country: 'MA' },
      }),
    ).toEqual(['address']);
  });

  it('trims and lowercases the email', () => {
    const dto = plainToInstance(CreateUserDto, {
      ...valid,
      email: ' Bob@Example.com ',
    }) as CreateUserDto;
    expect(dto.email).toBe('bob@example.com');
  });

  it('rejects unknown properties', async () => {
    expect(await errorsFor(CreateUserDto, { ...valid, role: 'admin' })).toEqual(
      ['role'],
    );
  });
});

describe('UpdateUserDto', () => {
  it('accepts null to clear the address', async () => {
    expect(await errorsFor(UpdateUserDto, { address: null })).toEqual([]);
  });
});

describe('UpdateUserDto nulls', () => {
  it.each(['name', 'email'])('rejects %s: null', async (field) => {
    expect(await errorsFor(UpdateUserDto, { [field]: null })).toEqual([field]);
  });
});
