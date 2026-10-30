export interface IncidentRecord {
  id: string;
  tenantId: string;
  serviceId: string;
  title: string;
  severity: 'sev-1' | 'sev-2' | 'sev-3';
  startTime: string;
  endTime?: string;
  status: 'active' | 'mitigated' | 'resolved';
}

export interface IncidentTicket {
  ticketId: string;
  idempotencyKey: string;
  tenantId: string;
  serviceId: string;
  title: string;
  briefSummary: string;
  createdAt: string;
}

export class IncidentService {
  private tickets = new Map<string, IncidentTicket>();
  private incidents = new Map<string, IncidentRecord>();

  constructor() {
    this.seedDefaultIncidents();
  }

  private seedDefaultIncidents(): void {
    this.incidents.set('inc-auth-101', {
      id: 'inc-auth-101',
      tenantId: 'tenant-enterprise-prod',
      serviceId: 'auth-service',
      title: 'High 504 Gateway Timeouts in Auth Validation',
      severity: 'sev-1',
      startTime: '2026-10-28T14:00:00Z',
      endTime: '2026-10-28T15:30:00Z',
      status: 'resolved',
    });
  }

  public getIncident(id: string): IncidentRecord | undefined {
    return this.incidents.get(id);
  }

  public createTicket(params: {
    idempotencyKey: string;
    tenantId: string;
    serviceId: string;
    title: string;
    briefSummary: string;
  }): IncidentTicket {
    const existing = this.tickets.get(params.idempotencyKey);
    if (existing) {
      return existing; // Idempotent return
    }

    const ticket: IncidentTicket = {
      ticketId: `TICKET-${Date.now()}-${Math.floor(Math.random() * 1000)}`,
      idempotencyKey: params.idempotencyKey,
      tenantId: params.tenantId,
      serviceId: params.serviceId,
      title: params.title,
      briefSummary: params.briefSummary,
      createdAt: new Date().toISOString(),
    };

    this.tickets.set(params.idempotencyKey, ticket);
    return ticket;
  }

  public getTicketByIdempotencyKey(key: string): IncidentTicket | undefined {
    return this.tickets.get(key);
  }

  public getAllTickets(): IncidentTicket[] {
    return Array.from(this.tickets.values());
  }
}
