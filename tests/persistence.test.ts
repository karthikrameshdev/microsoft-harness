import test from 'node:test';
import * as assert from 'node:assert';
import { DurableStateManager } from '../src/persistence/durable-state.ts';
import type { HarnessSession } from '../src/types/index.ts';

test('Persistence: SQLite durable state, checkpoints, and crash reconciliation', () => {
  const manager = new DurableStateManager(':memory:');

  const session: HarnessSession = {
    id: 'sess-101',
    conversationId: 'conv-101',
    tenantId: 'tenant-enterprise',
    region: 'westus',
    workspaceDir: '/tmp/workspaces/conv-101',
    sandboxState: 'allocated',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    store: true,
  };

  // 1. Session persistence
  manager.saveSession(session);
  const loaded = manager.getSession('conv-101');
  assert.ok(loaded);
  assert.strictEqual(loaded.conversationId, 'conv-101');
  assert.strictEqual(loaded.tenantId, 'tenant-enterprise');

  // 2. Stage Checkpoints
  manager.recordCheckpoint('conv-101', 'scope_established', 'completed', { scope: 'auth-service' });
  manager.recordCheckpoint('conv-101', 'solver_leg_finished', 'completed', { tokens: 420 });

  const checkpoints = manager.getCheckpoints('conv-101');
  assert.strictEqual(checkpoints.length, 2);
  assert.strictEqual(checkpoints[0].stageName, 'scope_established');
  assert.strictEqual(checkpoints[1].stageName, 'solver_leg_finished');

  // 3. Simulated crash with in-flight attempted action
  manager.recordAction({
    idempotencyKey: 'key-in-flight',
    actionName: 'external_ticket_write',
    tenantId: 'tenant-enterprise',
    serviceId: 'auth-service',
    status: 'attempted', // Process died here before confirmation!
    payload: { details: 'write payload' },
  });

  // System restart -> reconciliation
  const reconciled = manager.reconcileInterruptedActions();
  assert.strictEqual(reconciled.length, 1);
  assert.strictEqual(reconciled[0].idempotencyKey, 'key-in-flight');

  manager.close();
});
