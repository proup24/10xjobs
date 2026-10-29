import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { ContactKind } from 'src/common/enums';
import { ContactsService } from './contacts.service';
import { FakeContactsRepository, FakeUsersRepository } from '../testing/fakes';
import { UsersService } from './users.service';

describe('ContactsService', () => {
  let contacts: FakeContactsRepository;
  let service: ContactsService;
  let userA: string;
  let userB: string;

  beforeEach(async () => {
    const users = new UsersService(new FakeUsersRepository());
    contacts = new FakeContactsRepository();
    service = new ContactsService(users, contacts);
    userA = (await users.create('ws', { name: 'A', email: 'a@x.com' })).id;
    userB = (await users.create('ws', { name: 'B', email: 'b@x.com' })).id;
  });

  const primaryEmails = (userId: string) =>
    contacts.rows.filter(
      (row) => row.userId === userId && row.kind === 'email' && row.isPrimary,
    );

  it('a new primary contact demotes the old primary of the same kind', async () => {
    await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'one@x.com',
      isPrimary: true,
    });
    const second = await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'two@x.com',
      isPrimary: true,
    });
    expect(primaryEmails(userA).map((row) => row.id)).toEqual([second.id]);
  });

  it('marking a contact primary by update demotes the old primary', async () => {
    await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'one@x.com',
      isPrimary: true,
    });
    const second = await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'two@x.com',
    });
    await service.update('ws', userA, second.id, { isPrimary: true });
    expect(primaryEmails(userA).map((row) => row.id)).toEqual([second.id]);
  });

  it('409s a duplicate kind and value', async () => {
    await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'one@x.com',
    });
    await expect(
      service.create('ws', userA, {
        kind: ContactKind.email,
        value: 'one@x.com',
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it("404s another user's contact", async () => {
    const contact = await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'one@x.com',
    });
    await expect(
      service.update('ws', userB, contact.id, { label: 'stolen' }),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      service.delete('ws', userB, contact.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(contacts.rows[0].label).toBeNull();
  });

  it('404s an unknown user', async () => {
    await expect(service.list('ws', 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('400s a new value that does not fit the stored kind', async () => {
    const phone = await service.create('ws', userA, {
      kind: ContactKind.phone,
      value: '+212612345678',
    });
    await expect(
      service.update('ws', userA, phone.id, { value: 'not a phone' }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('400s a new kind that does not fit the stored value', async () => {
    const github = await service.create('ws', userA, {
      kind: ContactKind.github,
      value: 'https://github.com/a',
    });
    await expect(
      service.update('ws', userA, github.id, { kind: ContactKind.phone }),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(contacts.rows[0].kind).toBe(ContactKind.github);
  });

  it('moving a primary contact to another kind keeps one primary there', async () => {
    const other = await service.create('ws', userA, {
      kind: ContactKind.other,
      value: 'Telegram @a',
      isPrimary: true,
    });
    const email = await service.create('ws', userA, {
      kind: ContactKind.email,
      value: 'one@x.com',
      isPrimary: true,
    });
    await service.update('ws', userA, email.id, { kind: ContactKind.other });
    const primaries = contacts.rows.filter(
      (row) => row.kind === ContactKind.other && row.isPrimary,
    );
    expect(primaries.map((row) => row.id)).toEqual([email.id]);
    expect(other.id).not.toBe(email.id);
  });
});
