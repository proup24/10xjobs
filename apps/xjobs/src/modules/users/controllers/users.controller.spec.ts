import { GoneException, HttpStatus } from '@nestjs/common';
import { UsersService } from '../services/users.service';
import { FakeUsersRepository } from '../testing/fakes';
import { UsersController } from './users.controller';

describe('UsersController', () => {
  it('answers POST /users with 410: users are created through Supabase Auth', () => {
    const repository = new FakeUsersRepository();
    const controller = new UsersController(new UsersService(repository));

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

  it('answers DELETE /users/:id with 410: users are removed by deleting the Auth user', () => {
    const repository = new FakeUsersRepository();
    repository.add();
    const controller = new UsersController(new UsersService(repository));

    let thrown: unknown;
    try {
      controller.remove();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(GoneException);
    expect((thrown as GoneException).getStatus()).toBe(HttpStatus.GONE);
    expect((thrown as GoneException).message).toBe(
      'Users are removed by deleting the Supabase Auth user',
    );
    expect(repository.rows).toHaveLength(1);
  });
});
