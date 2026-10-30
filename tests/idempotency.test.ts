import test from 'node:test';
import * as assert from 'node:assert';
import { IdempotencyManager } from '../src/security/idempotency.ts';
import { ConsequentialActionGate } from '../src/security/action-gate.ts';

test('Idempotency: Repeated execution with same key prevents duplicate writes', async () => {
  const idempotency = new IdempotencyManager();
  const gate = new ConsequentialActionGate(idempotency);

  const context = {
    tenantId: 'tenant-prod',
    allowedServices: ['auth-service'],
    validApprovalTokens: new Set(['token-approved']),
  };

  let executionCounter = 0;
  const runAction = async () => {
    return gate.executeGuardedAction(
      {
        actionName: 'publish_incident_update',
        idempotencyKey: 'idemp-key-auth-rollback-2026',
        tenantId: 'tenant-prod',
        serviceId: 'auth-service',
        payload: { summary: 'Traffic rolled back successfully' },
        requiresApproval: true,
        approvalToken: 'token-approved',
      },
      context,
      async () => {
        executionCounter++;
        return { publishedId: `PUB-${executionCounter}` };
      }
    );
  };

  // First execution -> confirmed, executionCounter = 1
  const first = await runAction();
  assert.strictEqual(first.status, 'confirmed');
  assert.strictEqual(first.result?.publishedId, 'PUB-1');
  assert.strictEqual(executionCounter, 1);

  // Second execution with same idempotency key -> cached, executionCounter stays 1!
  const second = await runAction();
  assert.strictEqual(second.status, 'cached');
  assert.strictEqual(second.result?.publishedId, 'PUB-1');
  assert.strictEqual(executionCounter, 1); // No second write performed!
});
