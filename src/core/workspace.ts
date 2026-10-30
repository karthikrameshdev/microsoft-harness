import * as fs from 'node:fs';
import * as path from 'node:path';
import type { SandboxState } from '../types/index.ts';

export class WorkspaceSecurityViolation extends Error {
  constructor(message: string) {
    super(`[Workspace Sandbox Violation] ${message}`);
    this.name = 'WorkspaceSecurityViolation';
  }
}

export interface WorkspaceSnapshot {
  timestamp: number;
  files: Map<string, string>;
}

export class ConversationWorkspace {
  public state: SandboxState = 'allocated';
  private snapshots: WorkspaceSnapshot[] = [];

  public readonly conversationId: string;
  public readonly rootDir: string;

  constructor(conversationId: string, rootDir: string) {
    this.conversationId = conversationId;
    this.rootDir = rootDir;
    if (!fs.existsSync(this.rootDir)) {
      fs.mkdirSync(this.rootDir, { recursive: true });
    }
  }

  /**
   * Resolves and verifies that a relative path stays within the workspace sandbox
   */
  public resolveSafePath(relativePath: string): string {
    const resolved = path.resolve(this.rootDir, relativePath);
    const rootWithSep = this.rootDir.endsWith(path.sep) ? this.rootDir : this.rootDir + path.sep;

    if (!resolved.startsWith(rootWithSep) && resolved !== this.rootDir) {
      throw new WorkspaceSecurityViolation(
        `Path traversal attempt detected: '${relativePath}' escapes workspace sandbox '${this.rootDir}'.`
      );
    }
    return resolved;
  }

  public readFile(relativePath: string): string {
    const safePath = this.resolveSafePath(relativePath);
    if (!fs.existsSync(safePath)) {
      throw new Error(`File not found: '${relativePath}' in workspace.`);
    }
    return fs.readFileSync(safePath, 'utf-8');
  }

  public writeFile(relativePath: string, content: string): void {
    const safePath = this.resolveSafePath(relativePath);
    const dir = path.dirname(safePath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(safePath, content, 'utf-8');
  }

  public listFiles(): string[] {
    if (!fs.existsSync(this.rootDir)) return [];
    const results: string[] = [];

    const walk = (dir: string, prefix = '') => {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        const rel = prefix ? path.join(prefix, entry.name) : entry.name;
        if (entry.isDirectory()) {
          walk(path.join(dir, entry.name), rel);
        } else {
          results.push(rel);
        }
      }
    };

    walk(this.rootDir);
    return results;
  }

  /**
   * Captures snapshot for fail-safe rollback (HydraFusion Principle 4)
   */
  public createSnapshot(): void {
    const snapshot: WorkspaceSnapshot = {
      timestamp: Date.now(),
      files: new Map<string, string>(),
    };

    for (const rel of this.listFiles()) {
      try {
        snapshot.files.set(rel, this.readFile(rel));
      } catch {
        // Ignore unreadable files
      }
    }
    this.snapshots.push(snapshot);
  }

  /**
   * Rolls back workspace to last snapshot if validation fails or leg cancels
   */
  public rollback(): boolean {
    const last = this.snapshots.pop();
    if (!last) return false;

    // Remove any new files created since snapshot
    const currentFiles = this.listFiles();
    for (const file of currentFiles) {
      if (!last.files.has(file)) {
        try {
          fs.unlinkSync(this.resolveSafePath(file));
        } catch {
          // Ignore
        }
      }
    }

    // Restore snapshot files
    for (const [file, content] of last.files.entries()) {
      this.writeFile(file, content);
    }
    return true;
  }

  // Sandbox Lifecycle
  public markIdle(): void {
    this.state = 'idle';
  }

  public markResumed(): void {
    this.state = 'resumed';
  }

  public markReplaced(): void {
    this.state = 'replaced';
  }

  public teardown(): void {
    this.state = 'torn_down';
    if (fs.existsSync(this.rootDir)) {
      fs.rmSync(this.rootDir, { recursive: true, force: true });
    }
  }
}
