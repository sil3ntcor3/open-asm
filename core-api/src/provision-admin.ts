import { AUTH_INSTANCE_KEY } from '@/common/constants/app.constants';
import { DatabaseModule } from '@/database/database.module';
import { auth } from '@/modules/auth/auth';
import { AuthService } from '@/modules/auth/auth.service';
import { User } from '@/modules/auth/entities/user.entity';
import { UsersService } from '@/modules/users/users.service';
import { ForbiddenException, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { TypeOrmModule } from '@nestjs/typeorm';
import 'dotenv/config';
import 'reflect-metadata';
import { parseAdminProvisioningInput } from './provision-admin-input';

@Module({
  imports: [
    ConfigModule.forRoot({ envFilePath: '.env', isGlobal: true }),
    DatabaseModule,
    TypeOrmModule.forFeature([User]),
  ],
  providers: [
    { provide: AUTH_INSTANCE_KEY, useValue: auth },
    AuthService,
    UsersService,
  ],
})
class AdminProvisioningModule {}

async function readStandardInput(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function provisionAdmin(): Promise<void> {
  const credentials = parseAdminProvisioningInput(await readStandardInput());
  const application = await NestFactory.createApplicationContext(
    AdminProvisioningModule,
    { logger: false },
  );

  try {
    await application
      .get(UsersService)
      .createFirstAdmin(credentials.email, credentials.password);
    process.stdout.write('Administrator account created successfully.\n');
  } finally {
    await application.close();
  }
}

async function main(): Promise<void> {
  try {
    await provisionAdmin();
  } catch (error) {
    const message =
      error instanceof ForbiddenException
        ? 'Administrator provisioning refused: an administrator already exists.'
        : error instanceof Error &&
            error.message === 'Invalid administrator credentials'
          ? error.message
          : 'Administrator provisioning failed. Verify the database configuration and migration status.';
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) void main();
