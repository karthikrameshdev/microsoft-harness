import * as http from 'node:http';
import * as path from 'node:path';
import { MicrosoftCopilotHarness } from '../core/harness.ts';
import { SUPPORTED_REGIONS, NATIVE_CAPABILITIES, MAX_TOP_LEVEL_SKILLS } from '../config/foundry-limits.ts';

const PORT = parseInt(process.env.PORT || '3000', 10);
const skillsDir = path.resolve(process.cwd(), 'skills');

const harness = new MicrosoftCopilotHarness({
  conversationId: 'api-server-session',
  tenantId: 'tenant-enterprise-prod',
  region: 'westus',
  skillsDir,
});

export function createServer(): http.Server {
  const server = http.createServer(async (req, res) => {
    const parsedUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = parsedUrl.pathname;
    const method = req.method || 'GET';

    // CORS Headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    try {
      if (pathname === '/health' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            status: 'ok',
            runtime: 'Microsoft Copilot Harness (Foundry Preview)',
            version: '1.0.0',
            region: harness.session.region,
            store: harness.session.store,
          })
        );
        return;
      }

      if (pathname === '/v1/limits' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            supportedRegions: SUPPORTED_REGIONS,
            nativeCapabilities: NATIVE_CAPABILITIES,
            maxTopLevelSkills: MAX_TOP_LEVEL_SKILLS,
            byomSupported: false,
            strictFunctionSchemasSupported: false,
          })
        );
        return;
      }

      if (pathname === '/v1/skills' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(harness.skillEngine.listInstallations()));
        return;
      }

      if (pathname === '/v1/mcp/tools' && method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ tools: harness.mcpServer.listTools() }));
        return;
      }

      if (pathname === '/v1/mcp/rpc' && method === 'POST') {
        const body = await parseJsonBody(req);
        const rpc = harness.mcpServer.getRPCServer();
        const rpcResponse = await rpc.handleMessage(body);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(rpcResponse));
        return;
      }

      if (pathname === '/v1/incident/investigate' && method === 'POST') {
        const body = await parseJsonBody(req);
        const result = await harness.executeIncidentWorkflow({
          serviceId: body.serviceId || 'auth-service',
          incidentWindow: body.incidentWindow || {
            start: '2026-10-28T14:00:00Z',
            end: '2026-10-28T15:30:00Z',
          },
          createTicketOnApproval: body.createTicketOnApproval === true,
          approvalToken: body.approvalToken,
        });

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(result));
        return;
      }

      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: `Not found: ${method} ${pathname}` }));
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: message }));
    }
  });

  return server;
}

function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => (raw += chunk));
    req.on('end', () => {
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch (e) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

// Auto-start when executed directly
if (process.argv[1]?.endsWith('api.ts')) {
  const server = createServer();
  server.listen(PORT, () => {
    console.log(`[Copilot Harness Server] Running on http://localhost:${PORT}`);
  });
}
