#!/usr/bin/env node
import * as path from 'node:path';
import { MicrosoftCopilotHarness } from '../src/core/harness.ts';
import { createServer } from '../src/server/api.ts';

const args = process.argv.slice(2);
const command = args[0] || 'run';

async function main() {
  const skillsDir = path.resolve(process.cwd(), 'skills');

  switch (command) {
    case 'run': {
      console.log('===============================================================');
      console.log(' Microsoft Copilot Harness & HydraFusion Engine (Foundry POC)');
      console.log('===============================================================\n');

      const harness = new MicrosoftCopilotHarness({
        conversationId: `cli-session-${Date.now()}`,
        tenantId: 'tenant-enterprise-prod',
        region: 'westus',
        skillsDir,
      });

      console.log(`[Harness] Session Initialized:`);
      console.log(`  Conversation ID: ${harness.session.conversationId}`);
      console.log(`  Tenant ID:       ${harness.session.tenantId}`);
      console.log(`  Foundry Region:  ${harness.session.region}`);
      console.log(`  Workspace Dir:   ${harness.session.workspaceDir}`);
      console.log(`  Skills Loaded:   ${harness.skillEngine.listInstallations().map((s) => s.name).join(', ')}\n`);

      console.log('[Orchestration] Launching HydraFusion multi-model workflow for incident investigation...');
      const response = await harness.executeIncidentWorkflow({
        serviceId: 'auth-service',
        incidentWindow: {
          start: '2026-10-28T14:00:00Z',
          end: '2026-10-28T15:30:00Z',
        },
        createTicketOnApproval: true,
        approvalToken: 'operator-token-approved-2026',
      });

      console.log('\n--- HYDRAFUSION EXECUTION TRACE ---');
      console.log(`Workflow ID:     ${response.trace.workflowId}`);
      console.log(`Task Complexity: ${response.trace.taskComplexity}`);
      console.log(`Total Duration:  ${response.trace.totalDurationMs} ms`);
      console.log(`Total Model Cost: $${response.trace.totalCostUsd.toFixed(6)} USD`);
      console.log(`Final Status:    ${response.trace.finalStatus.toUpperCase()}`);

      console.log('\nWorkflow Legs:');
      for (const [idx, leg] of response.trace.legs.entries()) {
        console.log(`  Leg #${idx + 1} [${leg.role.toUpperCase()}]:`);
        console.log(`    Model:           ${leg.modelId}`);
        console.log(`    Isolated Review: ${leg.isolatedReview ? 'YES (Tool-less context)' : 'NO'}`);
        console.log(`    Duration:        ${leg.durationMs} ms`);
        console.log(`    Tokens:          ${leg.usage.totalTokens} (Prompt: ${leg.usage.promptTokens}, Completion: ${leg.usage.completionTokens})`);
        console.log(`    Cost:            $${leg.usage.costUsd.toFixed(6)}`);
        console.log(`    Status:          ${leg.status}`);
        if (leg.critiqueNotes) {
          console.log(`    Critique Notes:`);
          for (const note of leg.critiqueNotes) {
            console.log(`      * ${note}`);
          }
        }
      }

      console.log('\n--- VERIFIED INCIDENT BRIEF ---');
      console.log(`Target Service:  ${response.brief.serviceId}`);
      console.log(`Incident Window: ${response.brief.incidentWindow.start} to ${response.brief.incidentWindow.end}`);
      console.log(`Observed Impact: ${response.brief.observedImpact}`);

      console.log('\nTimeline of Correlated Events:');
      for (const t of response.brief.timeline) {
        console.log(`  [${t.timestamp}] ${t.event} (Ref: ${t.evidenceSourceId})`);
      }

      console.log('\nContributing Deployments:');
      for (const c of response.brief.contributingChanges) {
        console.log(`  ${c.deploymentId} (${c.serviceId}) - Hypothesis: ${c.isHypothesis ? 'YES' : 'NO'}`);
        console.log(`    Evidence: ${c.evidence}`);
      }

      console.log('\n--- EVALUATION SCORECARD ---');
      console.log(`Factual Fidelity Score:        ${(response.scorecard.factualFidelityScore * 100).toFixed(1)}%`);
      console.log(`Required Coverage Score:       ${(response.scorecard.requiredCoverageScore * 100).toFixed(1)}%`);
      console.log(`Correct Abstention Rate:       ${(response.scorecard.correctAbstentionRate * 100).toFixed(1)}%`);
      console.log(`Unauthorized Action Attempts:  ${response.scorecard.unauthorizedActionAttempts}`);
      console.log(`Accepted Outcome:              ${response.scorecard.acceptedOutcome ? 'ACCEPTED' : 'REJECTED'}`);
      console.log(`Cost Per Accepted Outcome:     $${response.scorecard.costPerAcceptedOutcomeUsd.toFixed(6)} USD`);

      if (response.ticketResult) {
        console.log('\n--- GATED ACTION EXECUTION ---');
        console.log('Action Gate Result:', JSON.stringify(response.ticketResult, null, 2));
      }

      harness.teardown();
      console.log('\nWorkflow completed successfully.');
      break;
    }

    case 'serve': {
      const port = parseInt(process.env.PORT || '3000', 10);
      const server = createServer();
      server.listen(port, () => {
        console.log(`[Copilot Harness Server] Running on http://localhost:${port}`);
      });
      break;
    }

    case 'skills': {
      const harness = new MicrosoftCopilotHarness({
        conversationId: 'skills-listing',
        tenantId: 'tenant-enterprise-prod',
        region: 'westus',
        skillsDir,
      });
      console.log('Installed Agent Skills:');
      for (const s of harness.skillEngine.listInstallations()) {
        console.log(`  - ${s.name} (v${s.version}): ${s.definition.description}`);
      }
      harness.teardown();
      break;
    }

    case 'mcp': {
      const harness = new MicrosoftCopilotHarness({
        conversationId: 'mcp-listing',
        tenantId: 'tenant-enterprise-prod',
        region: 'westus',
        skillsDir,
      });
      console.log('Available MCP Tools:');
      for (const t of harness.mcpServer.listTools()) {
        console.log(`  - ${t.name} (Approval Required: ${t.requiresApproval}): ${t.description}`);
      }
      harness.teardown();
      break;
    }

    default:
      console.log(`Unknown command: ${command}`);
      console.log('Usage:');
      console.log('  microsoft-harness run     # Run incident investigation workflow');
      console.log('  microsoft-harness serve   # Start HTTP API server');
      console.log('  microsoft-harness skills  # List installed skills');
      console.log('  microsoft-harness mcp     # List registered MCP tools');
      break;
  }
}

main().catch((err) => {
  console.error('[CLI Error]', err);
  process.exit(1);
});
