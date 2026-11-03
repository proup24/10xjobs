import { GoneException, HttpStatus } from '@nestjs/common';
import type { ProfilesService } from '../services/profiles.service';
import type { ResumeService } from '../services/resume.service';
import { UsersService } from '../services/users.service';
import { FakeUsersRepository } from '../testing/fakes';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  it('answers POST /users with 410: users are created through Supabase Auth', () => {
    const repository = new FakeUsersRepository();
    const controller = new UsersController(
      new UsersService(repository),
      {} as ProfilesService,
      {} as ResumeService,
    );

    let thrown: unknown;
    try {
      controller.create();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GoneException);
    expect((thrown as GoneException).getStatus()).toBe(HttpStatus.GONE);
    expect((thrown as GoneException).message).toBe(
      'Users are created through Supabase Auth',
    );
    expect(repository.rows).toEqual([]);
  });
});
