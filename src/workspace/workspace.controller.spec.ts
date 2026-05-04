import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { AnalysisService } from '../analysis/analysis.service';
import { ReportsService } from '../reports/reports.service';
import { AuditService } from '../common/audit/audit.service';

const mockService = {
  create: jest.fn(), findById: jest.fn(), getMyWorkspace: jest.fn(),
  invite: jest.fn(), removeMember: jest.fn(), getWorkspaceAnalytics: jest.fn(),
  listMembersPaginated: jest.fn(), getTeamOverlaps: jest.fn(),
};
const mockAnalysisService = { getLatest: jest.fn(), run: jest.fn() };
const mockReportsService = { generateTeam: jest.fn() };
const mockAudit = { log: jest.fn().mockResolvedValue(undefined) };
const mockReq = { user: { id: 'user-1' } };

describe('WorkspaceController', () => {
  let controller: WorkspaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [
        { provide: WorkspaceService, useValue: mockService },
        { provide: AnalysisService, useValue: mockAnalysisService },
        { provide: ReportsService, useValue: mockReportsService },
        { provide: AuditService, useValue: mockAudit },
      ],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard).useValue({ canActivate: () => true })
      .overrideGuard(require('../common/guards/plan.guard').PlanGuard).useValue({ canActivate: () => true })
      .compile();
    controller = module.get<WorkspaceController>(WorkspaceController);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(controller).toBeDefined(); });
  it('create calls service.create', async () => {
    mockService.create.mockResolvedValue({ id: 'ws-1' });
    expect(await controller.create(mockReq as any, { name: 'My Workspace' })).toEqual({ id: 'ws-1' });
  });
  it('getMyWorkspace returns workspace', async () => {
    mockService.getMyWorkspace.mockResolvedValue({ id: 'ws-1' });
    expect(await controller.getMyWorkspace(mockReq as any)).toEqual({ id: 'ws-1' });
  });
  it('getMyWorkspace returns null when no workspace', async () => {
    mockService.getMyWorkspace.mockResolvedValue(null);
    expect(await controller.getMyWorkspace(mockReq as any)).toBeNull();
  });
  it('getMyWorkspaceAnalytics calls service', async () => {
    mockService.getWorkspaceAnalytics.mockResolvedValue({ totalMonthly: 50 });
    expect(await controller.getMyWorkspaceAnalytics(mockReq as any)).toEqual({ totalMonthly: 50 });
  });
});
