import type { ConsequentialAction, ActionLifecycleState } from '../types/index.ts';

export class IdempotencyManager {
  private store = new Map<string, ConsequentialAction>();

  public getAction(idempotencyKey: string): ConsequentialAction | undefined {
    return this.store.get(idempotencyKey);
  }

  public recordAction(action: ConsequentialAction): void {
    this.store.set(action.idempotencyKey, { ...action, updatedAt: new Date().toISOString() });
  }

  public updateState(
    idempotencyKey: string,
    status: ActionLifecycleState,
    result?: unknown,
    error?: string
  ): ConsequentialAction {
    const existing = this.store.get(idempotencyKey);
    if (!existing) {
      throw new Error(`Cannot update non-existent action with key '${idempotencyKey}'.`);
    }

    const updated: ConsequentialAction = {
      ...existing,
      status,
      result: result !== undefined ? result : existing.result,
      error: error !== undefined ? error : existing.error,
      updatedAt: new Date().toISOString(),
    };

    this.store.set(idempotencyKey, updated);
    return updated;
  }
}
