import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('remote execution removal', () => {
  it('does not register a remote execution module or agent tool', () => {
    const combineModule = readFileSync(
      join(process.cwd(), 'src/modules/combine.module.ts'),
      'utf8',
    );
    const agentTools = readFileSync(
      join(process.cwd(), 'src/modules/agents/agents.tools.ts'),
      'utf8',
    );
    const agentPrompt = readFileSync(
      join(process.cwd(), 'src/modules/agents/prompts/AGENT.md'),
      'utf8',
    );

    expect(combineModule).not.toContain('RemoteExecuteModule');
    expect(agentTools).not.toContain('remoteExecuteTool');
    expect(agentTools).not.toContain('execute_remote_command');
    expect(agentPrompt).not.toContain('command-execution');
    expect(agentPrompt).not.toContain('CLI execution');
  });

  it('does not expose remote execution through the worker protocol', () => {
    const proto = readFileSync(
      join(process.cwd(), 'src/proto/workers.proto'),
      'utf8',
    );

    expect(proto).not.toContain('RemoteExecute');
  });

  it('does not ship the REST remote execution module', () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          'src/modules/remote-execute/remote-execute.module.ts',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(process.cwd(), 'src/modules/remote-execute/dto/run-command.dto.ts'),
      ),
    ).toBe(false);
  });

  it('does not ship worker or console remote execution clients', () => {
    expect(
      existsSync(
        join(
          process.cwd(),
          '../worker/internal/worker/remote_execute.go',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          process.cwd(),
          '../worker/third_party/oasm-sdk-go/oasm/remote_execute.go',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          process.cwd(),
          '../console/src/hooks/use-remote-execute-stream.ts',
        ),
      ),
    ).toBe(false);
    expect(
      existsSync(
        join(
          process.cwd(),
          '../console/src/components/common/remote-execute-terminal.tsx',
        ),
      ),
    ).toBe(false);
  });

  it('does not retain remote-worker fields in agent persistence', () => {
    const conversation = readFileSync(
      join(
        process.cwd(),
        'src/modules/agents/entities/agent-conversation.entity.ts',
      ),
      'utf8',
    );
    const toolCall = readFileSync(
      join(process.cwd(), 'src/modules/agents/entities/tool-call.entity.ts'),
      'utf8',
    );

    expect(conversation).not.toContain('workerId');
    expect(toolCall).not.toContain('workerId');
  });
});
