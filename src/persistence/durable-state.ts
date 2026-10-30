import { DatabaseSync } from 'node:sqlite';
import type { ActionLifecycleState, HarnessSession, SandboxState } from '../types/index.ts';

export interface StageCheckpoint {
  id: string;
  conversationId: string;
  stageName: string;
  status: 'started' | 'completed' | 'failed';
  data: Record<string, unknown>;
  timestamp: string;
}

export class DurableStateManager {
  private db: DatabaseSync;

  constructor(dbPath = ':memory:') {
    this.db = new DatabaseSync(dbPath);
    this.initializeTables();
  }

  private initializeTables(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        conversation_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        region TEXT NOT NULL,
        workspace_dir TEXT NOT NULL,
        sandbox_state TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS stage_checkpoints (
        id TEXT PRIMARY KEY,
        conversation_id TEXT NOT NULL,
        stage_name TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        timestamp TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS durable_actions (
        idempotency_key TEXT PRIMARY KEY,
        action_name TEXT NOT NULL,
        tenant_id TEXT NOT NULL,
        service_id TEXT NOT NULL,
        status TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        result_json TEXT,
        error TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  // Session persistence
  public saveSession(session: HarnessSession): void {
    const stmt = this.db.prepare(`
      INSERT INTO sessions (conversation_id, tenant_id, region, workspace_dir, sandbox_state, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(conversation_id) DO UPDATE SET
        sandbox_state = excluded.sandbox_state,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      session.conversationId,
      session.tenantId,
      session.region,
      session.workspaceDir,
      session.sandboxState,
      session.createdAt,
      session.updatedAt
    );
  }

  public getSession(conversationId: string): HarnessSession | undefined {
    const stmt = this.db.prepare(`SELECT * FROM sessions WHERE conversation_id = ?`);
    const row = stmt.get(conversationId) as Record<string, string> | undefined;
    if (!row) return undefined;

    return {
      id: row.conversation_id,
      conversationId: row.conversation_id,
      tenantId: row.tenant_id,
      region: row.region as any,
      workspaceDir: row.workspace_dir,
      sandboxState: row.sandbox_state as SandboxState,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      store: true,
    };
  }

  // Stage Checkpoint persistence
  public recordCheckpoint(
    conversationId: string,
    stageName: string,
    status: 'started' | 'completed' | 'failed',
    data: Record<string, unknown>
  ): StageCheckpoint {
    const checkpoint: StageCheckpoint = {
      id: `chk-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
      conversationId,
      stageName,
      status,
      data,
      timestamp: new Date().toISOString(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO stage_checkpoints (id, conversation_id, stage_name, status, data_json, timestamp)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(
      checkpoint.id,
      checkpoint.conversationId,
      checkpoint.stageName,
      checkpoint.status,
      JSON.stringify(checkpoint.data),
      checkpoint.timestamp
    );

    return checkpoint;
  }

  public getCheckpoints(conversationId: string): StageCheckpoint[] {
    const stmt = this.db.prepare(
      `SELECT * FROM stage_checkpoints WHERE conversation_id = ? ORDER BY timestamp ASC`
    );
    const rows = stmt.all(conversationId) as Array<Record<string, string>>;
    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversation_id,
      stageName: r.stage_name,
      status: r.status as any,
      data: JSON.parse(r.data_json),
      timestamp: r.timestamp,
    }));
  }

  // Durable Action State Machine & Reconciliation
  public recordAction(action: {
    idempotencyKey: string;
    actionName: string;
    tenantId: string;
    serviceId: string;
    status: ActionLifecycleState;
    payload: Record<string, unknown>;
  }): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      INSERT INTO durable_actions (idempotency_key, action_name, tenant_id, service_id, status, payload_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(idempotency_key) DO UPDATE SET
        status = excluded.status,
        updated_at = excluded.updated_at
    `);
    stmt.run(
      action.idempotencyKey,
      action.actionName,
      action.tenantId,
      action.serviceId,
      action.status,
      JSON.stringify(action.payload),
      now,
      now
    );
  }

  public updateActionStatus(
    idempotencyKey: string,
    status: ActionLifecycleState,
    result?: unknown,
    error?: string
  ): void {
    const now = new Date().toISOString();
    const stmt = this.db.prepare(`
      UPDATE durable_actions
      SET status = ?, result_json = ?, error = ?, updated_at = ?
      WHERE idempotency_key = ?
    `);
    stmt.run(
      status,
      result !== undefined ? JSON.stringify(result) : null,
      error || null,
      now,
      idempotencyKey
    );
  }

  /**
   * Reconciles actions that were left in 'attempted' state during an unexpected restart/crash
   */
  public reconcileInterruptedActions(): Array<{ idempotencyKey: string; actionName: string }> {
    const stmt = this.db.prepare(`SELECT idempotency_key, action_name FROM durable_actions WHERE status = 'attempted'`);
    const rows = stmt.all() as Array<{ idempotency_key: string; action_name: string }>;

    // Transition interrupted actions to 'unresolved' requiring explicit verification
    const updateStmt = this.db.prepare(`
      UPDATE durable_actions SET status = 'unresolved', error = 'Process interrupted during write attempt' WHERE status = 'attempted'
    `);
    updateStmt.run();

    return rows.map((r) => ({ idempotencyKey: r.idempotency_key, actionName: r.action_name }));
  }

  public close(): void {
    this.db.close();
  }
}
