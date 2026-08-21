import { forwardRef, Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ApiKeysModule } from '../apikeys/apikeys.module';
import { Asset } from '../assets/entities/assets.entity';
import { Vulnerability } from '../vulnerabilities/entities/vulnerability.entity';
import { WorkersModule } from '../workers/workers.module';
import { WorkerInstance } from '../workers/entities/worker.entity';
import { ToolUpdateState } from './entities/tool-update-state.entity';
import { Tool } from './entities/tools.entity';
import { WorkspaceTool } from './entities/workspace_tools.entity';
import { ToolsController } from './tools.controller';
import { ToolsService } from './tools.service';
import { ToolUpdateService } from './tool-update.service';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      Tool,
      WorkspaceTool,
      Asset,
      Vulnerability,
      ToolUpdateState,
      WorkerInstance,
    ]),
    HttpModule,
    ApiKeysModule,
    forwardRef(() => WorkersModule),
  ],
  controllers: [ToolsController],
  providers: [ToolsService, ToolUpdateService],
  exports: [ToolsService, ToolUpdateService],
})
export class ToolsModule {}
