import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from '../auth/entities/user.entity';
import { WorkspaceMembers } from '../workspaces/entities/workspace-members.entity';
import { Workspace } from '../workspaces/entities/workspace.entity';
import { PlatformUsersService } from './platform-users.service';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  imports: [TypeOrmModule.forFeature([User, WorkspaceMembers, Workspace])],
  controllers: [UsersController],
  providers: [UsersService, PlatformUsersService],
  exports: [UsersService, PlatformUsersService],
})
export class UsersModule {}
