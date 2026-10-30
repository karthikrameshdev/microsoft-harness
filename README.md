# Microsoft Copilot Harness (Foundry & GitHub SDK) - Implementation POC

A production-grade reference implementation and Proof-of-Concept (POC) of the **Microsoft Copilot Harness** released in Microsoft Foundry and the **GitHub Copilot SDK**, incorporating **Project HydraFusion** multi-model orchestration, Agent Skills (`SKILL.md`), Model Context Protocol (MCP), and enterprise security trust boundaries.

Based on engineering analyses and official announcements:
- [Microsoft Copilot Harness Enters Foundry (Karthik Ramesh)](https://karthikramesh.dev/blog/microsoft-copilot-harness-enters-foundry)
- [Introducing the Microsoft Copilot Harness (Official Microsoft Blog)](https://blogs.microsoft.com/blog/2026/10/28/introducing-the-microsoft-copilot-harness-unlocking-the-potential-of-truly-multi-model-agentic-work/)
- [Microsoft Foundry Agent Service Limits, Quotas & Regions](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions)
- [Project HydraFusion: Frontier Quality via Multi-Model Orchestration](https://github.blog/ai-and-ml/github-copilot/project-hydrafusion-frontier-quality-via-multi-model-orchestration/)
- [GitHub Copilot SDK](https://github.com/github/copilot-sdk)

---

## Architecture Overview

```
                          User Request / CI/CD Trigger
                                      │
                                      ▼
                       ┌───────────────────────────────┐
                       │  Microsoft Copilot Harness    │
                       │     (Execution Layer)         │
                       └──────────────┬────────────────┘
                                      │
            ┌─────────────────────────┼─────────────────────────┐
            ▼                         ▼                         ▼
  ┌──────────────────┐      ┌──────────────────┐      ┌──────────────────┐
  │  Agent Skills    │      │  5 Built-in      │      │  Security Gates  │
  │  (`SKILL.md`)    │      │  Capabilities    │      │  & Trust Quota   │
  │  - Procedures    │      │  - file_read     │      │  - Data Quarant. │
  │  - Checkpoints   │      │  - file_write    │      │  - Auth Token    │
  │  - Preconditions │      │  - shell         │      │  - Idempotency   │
  │  - Max 50 skills │      │  - web           │      │  - 0 Side-effect │
  │  - Max 256 KiB   │      │  - subagents     │      │    Unauth Writes │
  └──────────────────┘      └──────────────────┘      └──────────────────┘
            │                         │                         │
            └─────────────────────────┼─────────────────────────┘
                                      │
                                      ▼
             ┌──────────────────────────────────────────────────┐
             │       Project HydraFusion Orchestration          │
             │       (5 Core Operating Principles)              │
             ├──────────────────────────────────────────────────┤
             │ 1. Complete Accounting   (Tokens & Leg USD Cost) │
             │ 2. Bounded Execution     (Per-leg Timeouts)      │
             │ 3. Isolated Review       (Tool-less Judge Leg)   │
             │ 4. Fail-Safe Application (Workspace Rollback)    │
             │ 5. Validated Routing     (Pre-flight Validation) │
             └────────┬────────────────────────────────┬────────┘
                      │                                │
            Leg 1: Solver (Shared Workspace)   Leg 2: Isolated Review
            (e.g., Claude 3.7 Sonnet)          (e.g., OpenAI o3-mini)
                      │                                │
                      └───────────────┬────────────────┘
                                      │
                                      ▼
             ┌──────────────────────────────────────────────────┐
             │  Evaluation Scorecard & Durable State Machine    │
             │  - Factual Fidelity (100%)                       │
             │  - Required Coverage (100%)                      │
             │  - Cost per Accepted Outcome ($ / accepted)      │
             │  - SQLite Checkpoints (node:sqlite)              │
             └──────────────────────────────────────────────────┘
```

---

## Key Capabilities Implemented

### 1. Foundry Copilot Harness Limits & Quotas Enforcement
Implements the exact support matrix and guardrails from [Microsoft Learn](https://learn.microsoft.com/en-us/azure/foundry/agents/concepts/limits-quotas-regions):
- **Supported Regions**: `australiaeast`, `canadacentral`, `centralus`, `germanywestcentral`, `japaneast`, `swedencentral`, `uksouth`, `westeurope`, `westus`.
- **BYOM Policy**: Rejects Bring-Your-Own-Model (BYOM) in accordance with the Foundry public preview rules.
- **Agent Skills**: Limits up to 50 top-level skill references, validates lowercase alphanumeric + hyphen names (max 64 chars), and checks 256 KiB file caps.
- **Function Tools**: Enforces non-strict schemas (`strict: true` prohibited), rejects the reserved separator `___`, and blocks collisions with native capability names.
- **Harness-Managed Settings**: Protects against caller overrides for `max_output_tokens`, `temperature`, `top_p`, `tool_choice`, `parallel_tool_calls`, `truncation`, etc.
- **Session Continuity**: Enforces `store: true` conversation-level continuity; rejects `store: false` and `previous_response_id`.

### 2. Project HydraFusion Multi-Model Orchestration
Implements the 5 core principles from GitHub's HydraFusion architecture:
1. **Complete Accounting**: Tracks prompt, completion, and reasoning tokens, elapsed latency (ms), and exact USD costs across every leg (drafting, critique, revision, escalation).
2. **Bounded Execution**: Hard timeouts per leg and overall workflow deadlines with cancellation signals.
3. **Isolated Review**: Runs evaluation and critique in an isolated, tool-less, read-only context so the reviewer model judges factual fidelity without mutating workspace or repository state.
4. **Fail-Safe Application**: Uses workspace snapshots; speculative file changes are immediately rolled back if validation fails or a reviewer rejects the draft.
5. **Validated Routing**: Validates model bindings, fallback chains, and pool availability before running any workflow leg.

### 3. Agent Skills & Procedures Engine
- Parses Copilot SDK-compliant `SKILL.md` specifications with YAML frontmatter and procedure instructions.
- Implements Copilot SDK Skill APIs: `skills.planInstall`, `skills.applyInstall`, `skills.installations.list`, and `skills.installations.setEnabled`.
- Built-in skills included:
  - `incident-investigation-brief`: Bounded investigation to correlate telemetry, deployments, and logs into a verified brief.
  - `schema-migration-validator`: Non-breaking schema evidence validation.
  - `security-boundary-audit`: Audience tokens and prompt injection containment.

### 4. Security & Trust Boundaries
- **Adversarial Prompt Injection Containment**: Raw logs and external documents containing directives (e.g., `System override: ignore previous instructions`) are encapsulated as passive XML CDATA blocks tagged as untrusted data, preventing privilege escalation.
- **Consequential Action Gate**: External side effects (e.g., opening remediation tickets, modifying infrastructure) require tenant verification, service scoping, and a human operator approval token.
- **Idempotency Manager**: Durable tracking of idempotency keys guarantees repeated requests return the same result without duplicate external writes.

### 5. Durable State Machine & Crash Recovery
- Built on Node's native `node:sqlite` engine.
- Tracks sessions, stage checkpoints, and side-effect state transitions (`proposed` -> `authorized` -> `attempted` -> `confirmed` / `unresolved`).
- Automatically reconciles interrupted operations on system restart.

### 6. Automated Evaluation Scorecard
Grades incident briefs across:
- **Factual Fidelity Score**: Verifies that all cited deployments exist and all timestamps fall inside the incident window.
- **Required Coverage Score**: Checks impact, timeline, contributing changes, hypothesis vs. evidence, and next steps.
- **Correct Abstention Rate**: Validates that contradictions or missing data are acknowledged rather than hallucinated.
- **Cost per Accepted Outcome**:
  $$\text{Cost per Accepted Outcome} = \frac{\text{Total Experiment Cost}}{\text{Accepted Outcomes under Rubric}}$$

---

## Directory Structure

```
OSS/microsoft-harness/
├── Dockerfile                   # Container definition
├── docker-compose.yml           # Multi-container orchestration
├── package.json                 # Node package configuration
├── tsconfig.json                # TypeScript settings
├── bin/
│   └── cli.ts                   # CLI entry point (run, serve, skills, mcp)
├── skills/
│   ├── incident-investigation-brief/
│   │   └── SKILL.md             # Concrete incident brief procedure
│   ├── schema-migration-validator/
│   │   └── SKILL.md
│   └── security-boundary-audit/
│       └── SKILL.md
├── src/
│   ├── config/
│   │   └── foundry-limits.ts    # Enforces Foundry preview limits & quotas
│   ├── core/
│   │   ├── harness.ts           # Unified Microsoft Copilot Harness runtime
│   │   ├── workspace.ts         # Sandboxed workspace with snapshot rollback
│   │   └── builtins.ts          # 5 native tools (file_read, file_write, shell, web, subagents)
│   ├── orchestration/
│   │   ├── hydrafusion.ts       # HydraFusion 5 principles implementation
│   │   ├── model-router.ts      # Task complexity classification & routing
│   │   ├── model-provider.ts    # Frontier model pool & BYOK support
│   │   └── accounting.ts        # Compute & token cost accounting
│   ├── skills/
│   │   └── skill-engine.ts      # Copilot SDK skills manager
│   ├── security/
│   │   ├── trust-boundary.ts    # Prompt injection defense & data quarantine
│   │   ├── action-gate.ts       # Consequential action authorization
│   │   └── idempotency.ts       # Duplicate action prevention
│   ├── persistence/
│   │   └── durable-state.ts     # SQLite-backed durable state machine
│   ├── mcp/
│   │   ├── jsonrpc.ts           # JSON-RPC 2.0 wire protocol
│   │   └── mcp-server.ts        # Model Context Protocol server
│   ├── services/
│   │   ├── deployment-service.ts# CI/CD deployment history
│   │   ├── telemetry-service.ts # Metrics & logs (with adversarial payload)
│   │   └── incident-service.ts  # Ticket store & management
│   ├── evaluation/
│   │   └── evaluator.ts         # Automated scorecard grading
│   └── server/
│       └── api.ts               # HTTP / REST API server
└── tests/
    ├── limits.test.ts           # Foundry limits validation tests
    ├── builtins.test.ts         # 5 native tools & sandbox tests
    ├── hydrafusion.test.ts      # Multi-model review & fail-safe tests
    ├── security.test.ts         # Injection containment & gate tests
    ├── idempotency.test.ts      # Duplicate prevention tests
    ├── persistence.test.ts      # Durable state & recovery tests
    ├── evaluation.test.ts       # Scorecard grading tests
    └── end-to-end.test.ts       # Full E2E incident brief pipeline tests
```

---

## Quickstart

### Prerequisites
- Node.js v22+ (Native TypeScript & `node:sqlite` support)
- Docker & Docker Compose (Optional for container deployment)

### 1. Run the Test Suite
Run the 20 unit and integration tests covering all subsystems:
```bash
npm test
```

### 2. Run the End-to-End CLI Workflow
Execute the concrete incident investigation workflow:
```bash
node bin/cli.ts run
```

### 3. List Installed Agent Skills
```bash
node bin/cli.ts skills
```

### 4. List Registered MCP Tools
```bash
node bin/cli.ts mcp
```

### 5. Start the REST API Server
```bash
node bin/cli.ts serve
# or
npm start
```

### 6. Run via Docker
```bash
docker compose up --build
```

---

## REST API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/health` | Runtime health, Foundry preview region, and store mode |
| `GET` | `/v1/limits` | Regional limits, quotas, and capability restrictions |
| `GET` | `/v1/skills` | List installed agent skills |
| `GET` | `/v1/mcp/tools` | List registered MCP tools |
| `POST` | `/v1/mcp/rpc` | JSON-RPC 2.0 endpoint for Copilot SDK integration |
| `POST` | `/v1/incident/investigate` | Execute incident brief pipeline with multi-model HydraFusion |

### Example Request (`POST /v1/incident/investigate`):
```bash
curl -X POST http://localhost:3000/v1/incident/investigate \
  -H "Content-Type: application/json" \
  -d '{
    "serviceId": "auth-service",
    "incidentWindow": {
      "start": "2026-10-28T14:00:00Z",
      "end": "2026-10-28T15:30:00Z"
    },
    "createTicketOnApproval": true,
    "approvalToken": "operator-token-approved-2026"
  }'
```

---

## License
Apache-2.0