export interface DeploymentRecord {
  deploymentId: string;
  serviceId: string;
  version: string;
  timestamp: string;
  deployedBy: string;
  commitHash: string;
  notes: string;
}

export class DeploymentService {
  private deployments: DeploymentRecord[] = [
    {
      deploymentId: 'deploy-auth-214',
      serviceId: 'auth-service',
      version: 'v2.14.0',
      timestamp: '2026-10-28T14:05:00Z',
      deployedBy: 'ci-bot@company.com',
      commitHash: 'a7c39f1',
      notes: 'Update redis client driver and connection pool configuration values',
    },
    {
      deploymentId: 'deploy-auth-rollback',
      serviceId: 'auth-service',
      version: 'v2.13.9',
      timestamp: '2026-10-28T14:45:00Z',
      deployedBy: 'oncall-lead@company.com',
      commitHash: '8b210e4',
      notes: 'Emergency rollback to v2.13.9 due to auth Redis timeouts',
    },
    // Distinct service deployment to test service-scope boundary enforcement
    {
      deploymentId: 'deploy-payment-99',
      serviceId: 'payment-service',
      version: 'v1.8.2',
      timestamp: '2026-10-28T14:20:00Z',
      deployedBy: 'pay-team@company.com',
      commitHash: '99fa34c',
      notes: 'Payment gateway currency format patch',
    },
  ];

  public queryDeployments(serviceId: string, startIso: string, endIso: string): DeploymentRecord[] {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();

    return this.deployments.filter((d) => {
      const t = new Date(d.timestamp).getTime();
      return d.serviceId === serviceId && t >= start && t <= end;
    });
  }

  public getAllDeployments(): DeploymentRecord[] {
    return [...this.deployments];
  }
}
