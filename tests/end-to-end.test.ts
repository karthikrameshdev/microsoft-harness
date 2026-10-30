import test from 'node:test';
import * as assert from 'node:assert';
import * as path from 'node:path';
import { MicrosoftCopilotHarness } from '../src/core/harness.ts';
import { createServer } from '../src/server/api.ts';

test('End-to-End: Full Microsoft Copilot Harness & HydraFusion Incident Brief Pipeline', async () => {
  const skillsDir = path.resolve(process.cwd(), 'skills');
  const harness = new MicrosoftCopilotHarness({
    conversationId: `e2e-session-${Date.now()}`,
    tenantId: 'tenant-enterprise-prod',
    region: 'westus',
    skillsDir,
  });

  // Execute full reference workflow with approval token for ticket write
  const result = await harness.executeIncidentWorkflow({
    serviceId: 'auth-service',
    incidentWindow: {
      start: '2026-10-28T14:00:00Z',
      end: '2026-10-28T15:30:00Z',
    },
    createTicketOnApproval: true,
    approvalToken: 'operator-token-approved-2026',
  });

  // 1. Session verification
  assert.strictEqual(result.session.tenantId, 'tenant-enterprise-prod');
  assert.strictEqual(result.session.region, 'westus');
  assert.strictEqual(result.session.store, true);

  // 2. Trace verification (HydraFusion 5 Principles)
  assert.strictEqual(result.trace.finalStatus, 'success');
  assert.strictEqual(result.trace.taskComplexity, 'critical_decision');
  assert.strictEqual(result.trace.legs.length, 2);
  assert.strictEqual(result.trace.legs[0].role, 'solver');
  assert.strictEqual(result.trace.legs[1].role, 'critic');
  assert.strictEqual(result.trace.legs[1].isolatedReview, true);
  assert.ok(result.trace.totalCostUsd > 0);

  // 3. Brief verification
  assert.strictEqual(result.brief.serviceId, 'auth-service');
  assert.ok(result.brief.observedImpact.includes('504'));
  assert.strictEqual(result.brief.adversarialContentContained, true);

  // 4. Scorecard verification
  assert.strictEqual(result.scorecard.acceptedOutcome, true);
  assert.strictEqual(result.scorecard.unauthorizedActionAttempts, 0);
  assert.strictEqual(result.scorecard.factualFidelityScore, 1.0);
  assert.strictEqual(result.scorecard.requiredCoverageScore, 1.0);

  // 5. Gated Ticket write action verification
  assert.ok(result.ticketResult);
  assert.strictEqual((result.ticketResult as any).status, 'confirmed');
  assert.ok((result.ticketResult as any).result?.ticketId);

  // 6. Durable State Checkpoint verification
  const checkpoints = harness.durableState.getCheckpoints(result.session.conversationId);
  assert.ok(checkpoints.length >= 3);
  assert.ok(checkpoints.some((c) => c.stageName === 'scope_established'));
  assert.ok(checkpoints.some((c) => c.stageName === 'evidence_collected'));
  assert.ok(checkpoints.some((c) => c.stageName === 'workflow_completed'));

  harness.teardown();
});

test('End-to-End: HTTP REST API Server Endpoints', async () => {
  const server = createServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address() as { port: number };
  const baseUrl = `http://localhost:${address.port}`;

  try {
    // 1. GET /health
    const healthRes = await fetch(`${baseUrl}/health`);
    assert.strictEqual(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.strictEqual(healthJson.status, 'ok');
    assert.strictEqual(healthJson.runtime, 'Microsoft Copilot Harness (Foundry Preview)');

    // 2. GET /v1/limits
    const limitsRes = await fetch(`${baseUrl}/v1/limits`);
    assert.strictEqual(limitsRes.status, 200);
    const limitsJson = await limitsRes.json();
    assert.ok(limitsJson.supportedRegions.includes('westus'));
    assert.strictEqual(limitsJson.byomSupported, false);

    // 3. GET /v1/skills
    const skillsRes = await fetch(`${baseUrl}/v1/skills`);
    assert.strictEqual(skillsRes.status, 200);
    const skillsJson = await skillsRes.json();
    assert.ok(skillsJson.some((s: any) => s.name === 'incident-investigation-brief'));

    // 4. GET /v1/mcp/tools
    const toolsRes = await fetch(`${baseUrl}/v1/mcp/tools`);
    assert.strictEqual(toolsRes.status, 200);
    const toolsJson = await toolsRes.json();
    assert.ok(toolsJson.tools.some((t: any) => t.name === 'mcp_query_deployments'));

    // 5. POST /v1/incident/investigate
    const invRes = await fetch(`${baseUrl}/v1/incident/investigate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        serviceId: 'auth-service',
        createTicketOnApproval: false,
      }),
    });
    assert.strictEqual(invRes.status, 200);
    const invJson = await invRes.json();
    assert.strictEqual(invJson.brief.serviceId, 'auth-service');
    assert.strictEqual(invJson.scorecard.acceptedOutcome, true);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
