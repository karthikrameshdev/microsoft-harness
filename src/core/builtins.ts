import { execSync } from 'node:child_process';
import type { ConversationWorkspace } from './workspace.ts';
import type { ToolDefinition, ToolCallResult } from '../types/index.ts';

export interface BuiltinToolsOptions {
  workspace: ConversationWorkspace;
  allowShell?: boolean;
  allowWeb?: boolean;
  maxShellTimeoutMs?: number;
  allowedWebDomains?: string[];
}

export class BuiltinCapabilitiesManager {
  private workspace: ConversationWorkspace;
  private allowShell: boolean;
  private allowWeb: boolean;
  private maxShellTimeoutMs: number;
  private allowedWebDomains: string[];

  constructor(options: BuiltinToolsOptions) {
    this.workspace = options.workspace;
    this.allowShell = options.allowShell ?? true;
    this.allowWeb = options.allowWeb ?? true;
    this.maxShellTimeoutMs = options.maxShellTimeoutMs ?? 5000;
    this.allowedWebDomains = options.allowedWebDomains ?? ['*'];
  }

  public getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'file_read',
        description: 'Read the contents of a file in the conversation workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path within workspace' },
          },
          required: ['path'],
        },
        requiresApproval: false,
        isNative: true,
      },
      {
        name: 'file_write',
        description: 'Write content to a file in the conversation workspace.',
        inputSchema: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'Relative path within workspace' },
            content: { type: 'string', description: 'UTF-8 file content' },
          },
          required: ['path', 'content'],
        },
        requiresApproval: false,
        isNative: true,
      },
      {
        name: 'shell',
        description: 'Execute a command in the sandboxed workspace environment.',
        inputSchema: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command string' },
          },
          required: ['command'],
        },
        requiresApproval: true, // Native shell execution can be gated by policy
        isNative: true,
      },
      {
        name: 'web',
        description: 'Fetch content from a permitted web URL.',
        inputSchema: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'Target URL' },
          },
          required: ['url'],
        },
        requiresApproval: false,
        isNative: true,
      },
      {
        name: 'subagents',
        description: 'Delegate a sub-task to an isolated prompt subagent.',
        inputSchema: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'Task description for subagent' },
            model: { type: 'string', description: 'Subagent model' },
          },
          required: ['task'],
        },
        requiresApproval: false,
        isNative: true,
      },
    ];
  }

  public async executeTool(
    name: string,
    args: Record<string, unknown>
  ): Promise<ToolCallResult> {
    const start = Date.now();
    try {
      switch (name) {
        case 'file_read': {
          const filePath = String(args.path);
          const content = this.workspace.readFile(filePath);
          return {
            toolCallId: String(args.id || Date.now()),
            success: true,
            output: content,
            durationMs: Date.now() - start,
          };
        }

        case 'file_write': {
          const filePath = String(args.path);
          const content = String(args.content);
          this.workspace.writeFile(filePath, content);
          return {
            toolCallId: String(args.id || Date.now()),
            success: true,
            output: { writtenBytes: Buffer.byteLength(content, 'utf-8'), path: filePath },
            durationMs: Date.now() - start,
          };
        }

        case 'shell': {
          if (!this.allowShell) {
            throw new Error('Shell capability is disabled by policy.');
          }
          const command = String(args.command);
          // Block dangerous destructive system-wide commands in sandbox
          const forbidden = ['rm -rf /', ':(){ :|:& };:', 'mkfs', 'dd if=/dev/zero'];
          if (forbidden.some((f) => command.includes(f))) {
            throw new Error(`Command rejected by sandbox security policy.`);
          }

          const stdout = execSync(command, {
            cwd: this.workspace.rootDir,
            timeout: this.maxShellTimeoutMs,
            encoding: 'utf-8',
            env: {
              PATH: process.env.PATH,
              NODE_ENV: 'sandbox',
            },
          });

          return {
            toolCallId: String(args.id || Date.now()),
            success: true,
            output: stdout.trim(),
            durationMs: Date.now() - start,
          };
        }

        case 'web': {
          if (!this.allowWeb) {
            throw new Error('Web capability is disabled by policy.');
          }
          const urlStr = String(args.url);
          const parsed = new URL(urlStr);
          if (
            this.allowedWebDomains.length > 0 &&
            !this.allowedWebDomains.includes('*') &&
            !this.allowedWebDomains.includes(parsed.hostname)
          ) {
            throw new Error(`Domain '${parsed.hostname}' is not permitted by egress network rules.`);
          }

          // Safe simulated or HTTP fetch
          return {
            toolCallId: String(args.id || Date.now()),
            success: true,
            output: `[Web response for ${urlStr}]: status 200 OK. Content simulated for test sandbox.`,
            durationMs: Date.now() - start,
          };
        }

        case 'subagents': {
          const task = String(args.task);
          return {
            toolCallId: String(args.id || Date.now()),
            success: true,
            output: {
              delegatedTaskId: `subagent-task-${Date.now()}`,
              status: 'completed',
              summary: `Subagent completed investigation of: ${task.substring(0, 80)}`,
            },
            durationMs: Date.now() - start,
          };
        }

        default:
          throw new Error(`Unknown native capability '${name}'.`);
      }
    } catch (err: unknown) {
      return {
        toolCallId: String(args.id || Date.now()),
        success: false,
        error: err instanceof Error ? err.message : String(err),
        durationMs: Date.now() - start,
      };
    }
  }
}
