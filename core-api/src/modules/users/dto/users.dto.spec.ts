import { Role } from '@/common/enums/enum';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ProvisionPlatformUserDto, SetPlatformRoleDto } from './users.dto';

describe('platform user DTOs', () => {
  it('rejects internal account roles when provisioning a user', async () => {
    const dto = plainToInstance(ProvisionPlatformUserDto, {
      name: 'Automation Account',
      email: 'automation@example.com',
      password: 'long-enough-password',
      platformRole: Role.BOT,
      workspaceAssignments: [],
    });

    const errors = await validate(dto);

    expect(errors.some((error) => error.property === 'platformRole')).toBe(true);
  });

  it('accepts only user and admin as assignable platform roles', async () => {
    for (const role of [Role.USER, Role.ADMIN]) {
      const dto = plainToInstance(SetPlatformRoleDto, { role });

      await expect(validate(dto)).resolves.toHaveLength(0);
    }

    const botDto = plainToInstance(SetPlatformRoleDto, { role: Role.BOT });
    const errors = await validate(botDto);
    expect(errors.some((error) => error.property === 'role')).toBe(true);
  });
});
