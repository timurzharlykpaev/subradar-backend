import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';

const mockService = { create: jest.fn(), findById: jest.fn(), getMyWorkspace: jest.fn(), invite: jest.fn(), removeMember: jest.fn(), getWorkspaceAnalytics: jest.fn() };
const mockReq = { user: { id: 'user-1' } };

describe('WorkspaceController', () => {
  let controller: WorkspaceController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WorkspaceController],
      providers: [{ provide: WorkspaceService, useValue: mockService }],
    })
      .overrideGuard(require('../auth/guards/jwt-auth.guard').JwtAuthGuard).useValue({ canActivate: () => true })
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
