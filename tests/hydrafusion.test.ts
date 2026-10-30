import test from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import * as os from 'node:os';
import { ModelProviderPool } from '../src/orchestration/model-provider.ts';
import { ModelRouter } from '../src/orchestration/model-router.ts';
import { HydraFusionEngine } from '../src/orchestration/hydrafusion.ts';
import { ConversationWorkspace } from '../src/core/workspace.ts';

test('HydraFusion: Task classification & validated routing', () => {
  const pool = new ModelProviderPool();
  const router = new ModelRouter(pool);

  // Critical decision
  const c1 = router.classifyTask('Investigate production incident outage and migration plan');
  assert.strictEqual(c1, 'critical_decision');
  const r1 = router.routeWorkflow(c1);
  assert.strictEqual(r1.requiresIsolatedReview, true);
  assert.strictEqual(r1.primaryModel, 'claude-3-7-sonnet');
  assert.strictEqual(r1.reviewerModel, 'o3-mini');

  // Evidence synthesis
  const c2 = router.classifyTask('Synthesize metrics across multiple distributed logs', 5);
  assert.strictEqual(c2, 'evidence_synthesis');

  // Routine extraction
  const c3 = router.classifyTask('Format this JSON date to ISO-8601');
  assert.strictEqual(c3, 'routine_extraction');
  const r3 = router.routeWorkflow(c3);
  assert.strictEqual(r3.requiresIsolatedReview, false);
  assert.strictEqual(r3.primaryModel, 'gpt-4o-mini');
});

test('HydraFusion: Complete accounting, isolated review, and fail-safe application', async () => {
  const tmpDir = path.join(os.tmpdir(), `hydrafusion-test-${Date.now()}`);
  const ws = new ConversationWorkspace('conv-hydra-1', tmpDir);
  const pool = new ModelProviderPool();
  const router = new ModelRouter(pool);
  const engine = new HydraFusionEngine(pool, router);

  const { trace, finalOutput } = await engine.executeWorkflow({
    task: 'Investigate incident in auth-service',
    context: 'Deployment v2.14.0 caused connection pool exhaustion.',
    workspace: ws,
  });

  // Verify Principle 1: Complete Accounting
  assert.ok(trace.totalCostUsd > 0);
  assert.ok(trace.totalDurationMs >= 0);
  assert.strictEqual(trace.legs.length, 2); // Solver leg + Isolated Review leg

  // Verify Principle 3: Isolated Review
  const solverLeg = trace.legs[0];
  const reviewLeg = trace.legs[1];
  assert.strictEqual(solverLeg.role, 'solver');
  assert.strictEqual(solverLeg.isolatedReview, false);
  assert.strictEqual(reviewLeg.role, 'critic');
  assert.strictEqual(reviewLeg.isolatedReview, true);
  assert.ok(reviewLeg.critiqueNotes && reviewLeg.critiqueNotes.length > 0);

  // Verify status and output
  assert.strictEqual(trace.finalStatus, 'success');
  assert.ok(finalOutput.includes('auth-service'));

  ws.teardown();
});

test('HydraFusion: Fail-safe rollback when review leg rejects', async () => {
  const tmpDir = path.join(os.tmpdir(), `hydra-reject-${Date.now()}`);
  const ws = new ConversationWorkspace('conv-hydra-reject', tmpDir);
  ws.writeFile('important_spec.json', '{"status": "stable"}');

  const pool = new ModelProviderPool();
  // Inject mock reviewer that rejects due to hallucination
  pool.setMockHandler('incident_review_leg', () => ({
    content: JSON.stringify({
      verdict: 'REJECTED',
      critiqueNotes: ['Cited deployment deploy-999 does not belong to auth-service.'],
      confidenceScore: 0.1,
    }),
  }));

  const router = new ModelRouter(pool);
  const engine = new HydraFusionEngine(pool, router);

  const { trace } = await engine.executeWorkflow({
    task: 'Investigate incident with hallucinations',
    context: 'Raw logs...',
    workspace: ws,
  });

  assert.strictEqual(trace.finalStatus, 'rejected');
  assert.ok(trace.rejectionReasons?.some((r) => r.includes('deploy-999')));

  // Principle 4: Workspace must be intact
  assert.strictEqual(ws.readFile('important_spec.json'), '{"status": "stable"}');

  ws.teardown();
});
