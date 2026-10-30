import test from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { ConversationWorkspace, WorkspaceSecurityViolation } from '../src/core/workspace.ts';
import { BuiltinCapabilitiesManager } from '../src/core/builtins.ts';

test('Workspace: Sandbox isolation and directory traversal prevention', () => {
  const tmpDir = path.join(os.tmpdir(), `harness-test-${Date.now()}`);
  const ws = new ConversationWorkspace('test-conv-1', tmpDir);

  // Normal safe file write and read
  ws.writeFile('incident_notes.txt', 'Investigating latency spike');
  assert.strictEqual(ws.readFile('incident_notes.txt'), 'Investigating latency spike');

  // Traversal attempt to escape workspace sandbox
  assert.throws(
    () => ws.readFile('../../../etc/passwd'),
    (err: unknown) => {
      assert.ok(err instanceof WorkspaceSecurityViolation);
      return true;
    }
  );

  assert.throws(
    () => ws.writeFile('../malicious.sh', 'rm -rf /'),
    (err: unknown) => {
      assert.ok(err instanceof WorkspaceSecurityViolation);
      return true;
    }
  );

  ws.teardown();
});

test('Workspace: Snapshot creation and fail-safe rollback', () => {
  const tmpDir = path.join(os.tmpdir(), `harness-rollback-${Date.now()}`);
  const ws = new ConversationWorkspace('test-conv-rollback', tmpDir);

  ws.writeFile('baseline.txt', 'Original state');
  ws.createSnapshot();

  // Make speculative change during solver leg
  ws.writeFile('baseline.txt', 'Modified state during failed leg');
  ws.writeFile('draft_patch.diff', '+ broken code');

  // Validation fails or leg rejected -> rollback!
  const rolledBack = ws.rollback();
  assert.strictEqual(rolledBack, true);

  // Verifying original state restored
  assert.strictEqual(ws.readFile('baseline.txt'), 'Original state');
  assert.strictEqual(ws.listFiles().includes('draft_patch.diff'), false);

  ws.teardown();
});

test('Builtin Capabilities: Native 5 tools execution', async () => {
  const tmpDir = path.join(os.tmpdir(), `harness-builtins-${Date.now()}`);
  const ws = new ConversationWorkspace('test-conv-builtins', tmpDir);
  const manager = new BuiltinCapabilitiesManager({ workspace: ws, allowShell: true, allowWeb: true });

  const definitions = manager.getToolDefinitions();
  assert.strictEqual(definitions.length, 5);
  const names = definitions.map((d) => d.name);
  assert.ok(names.includes('file_read'));
  assert.ok(names.includes('file_write'));
  assert.ok(names.includes('shell'));
  assert.ok(names.includes('web'));
  assert.ok(names.includes('subagents'));

  // 1. file_write
  const writeRes = await manager.executeTool('file_write', {
    path: 'sample.json',
    content: JSON.stringify({ status: 'ok' }),
  });
  assert.strictEqual(writeRes.success, true);

  // 2. file_read
  const readRes = await manager.executeTool('file_read', { path: 'sample.json' });
  assert.strictEqual(readRes.success, true);
  assert.strictEqual(JSON.parse(readRes.output as string).status, 'ok');

  // 3. shell
  const shellRes = await manager.executeTool('shell', { command: 'echo "hello from sandbox"' });
  assert.strictEqual(shellRes.success, true);
  assert.strictEqual(shellRes.output, 'hello from sandbox');

  // 4. web
  const webRes = await manager.executeTool('web', { url: 'https://docs.microsoft.com/en-us/foundry' });
  assert.strictEqual(webRes.success, true);

  // 5. subagents
  const subagentRes = await manager.executeTool('subagents', { task: 'Verify cluster health' });
  assert.strictEqual(subagentRes.success, true);

  ws.teardown();
});
