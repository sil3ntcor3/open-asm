import { BOT_EMAIL, BOT_ID, BOT_NAME } from '@/common/constants/app.constants';
import { Role } from '@/common/enums/enum';
import { ForbiddenException, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { User } from '../auth/entities/user.entity';
import { AuthService } from './../auth/auth.service';

type AdminAuth = {
  api: {
    createUser(args: {
      body: {
        name: string;
        email: string;
        password: string;
        role: Role.ADMIN;
        data: { emailVerified: boolean };
      };
    }): Promise<{ user: { id: string } }>;
  };
};

const FIRST_ADMIN_LOCK_ID = 725_019_002;

@Injectable()
export class UsersService implements OnModuleInit {
  constructor(
    @InjectRepository(User)
    public usersRepository: Repository<User>,
    private authService: AuthService<AdminAuth>,
    private readonly dataSource: DataSource,
  ) {}

  async onModuleInit() {
    // Check if bot already exists in DB
    const existingBot = await this.usersRepository.findOne({
      where: { id: BOT_ID },
    });

    if (!existingBot) {
      // Create bot user if not exists
      const bot = this.usersRepository.create({
        id: BOT_ID,
        name: BOT_NAME,
        email: BOT_EMAIL,
        role: Role.BOT,
        emailVerified: true,
      });
      await this.usersRepository.save(bot);
    }
  }
  /**
   * Creates the first admin user in the system.
   * @param email The email address to use for the admin user.
   * @param password The password to use for the admin user.
   * @returns The newly created user object.
   */
  public async createFirstAdmin(email: string, password: string) {
    await this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [
        FIRST_ADMIN_LOCK_ID,
      ]);
      const usersRepository = manager.getRepository(User);
      if (
        (await usersRepository.count({
          where: { role: Role.ADMIN },
        })) > 0
      ) {
        throw new ForbiddenException();
      }

      await this.authService.api.createUser({
        body: {
          name: 'Admin',
          email: email.trim().toLowerCase(),
          password,
          role: Role.ADMIN,
          data: { emailVerified: true },
        },
      });
    });
  }
}
