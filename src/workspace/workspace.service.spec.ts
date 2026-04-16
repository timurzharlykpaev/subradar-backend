import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ForbiddenException, NotFoundException, BadRequestException } from '@nestjs/common';
import { WorkspaceService } from './workspace.service';
import { Workspace } from './entities/workspace.entity';
import { WorkspaceMember, WorkspaceMemberRole, WorkspaceMemberStatus } from './entities/workspace-member.entity';
import { Subscription } from '../subscriptions/entities/subscription.entity';
import { InviteCode } from './entities/invite-code.entity';
import { UsersService } from '../users/users.service';

const mockWorkspaceRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn() };
const mockMemberRepo = { find: jest.fn(), findOne: jest.fn(), save: jest.fn(), create: jest.fn(), count: jest.fn(), delete: jest.fn() };
const mockSubRepo = { find: jest.fn() };

const mockWorkspace = {
  id: 'ws-1', name: 'My Workspace', ownerId: 'user-1', maxMembers: 5,
  members: [
    { id: 'mem-1', workspaceId: 'ws-1', userId: 'user-1', role: WorkspaceMemberRole.OWNER, status: WorkspaceMemberStatus.ACTIVE, user: { id: 'user-1', name: 'Owner', email: 'owner@example.com' } },
  ],
};

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        { provide: getRepositoryToken(Workspace), useValue: mockWorkspaceRepo },
        { provide: getRepositoryToken(WorkspaceMember), useValue: mockMemberRepo },
        { provide: getRepositoryToken(Subscription), useValue: mockSubRepo },
        {
          provide: getRepositoryToken(InviteCode),
          useValue: {
            find: jest.fn().mockResolvedValue([]),
            findOne: jest.fn().mockResolvedValue(null),
            save: jest.fn().mockImplementation((e) => Promise.resolve(e)),
            create: jest.fn().mockImplementation((d) => d),
            update: jest.fn().mockResolvedValue({ affected: 1 }),
            delete: jest.fn().mockResolvedValue({ affected: 1 }),
          },
        },
        {
          provide: UsersService,
          useValue: {
            findById: jest.fn().mockResolvedValue(null),
            findByEmail: jest.fn().mockResolvedValue(null),
            create: jest.fn().mockResolvedValue({ id: 'new-user', email: 'new@example.com' }),
            update: jest.fn().mockResolvedValue(undefined),
          },
        },
      ],
    }).compile();
    service = module.get<WorkspaceService>(WorkspaceService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('findById', () => {
    it('returns workspace', async () => {
      mockWorkspaceRepo.findOne.mockResolvedValue(mockWorkspace);
      expect(await service.findById('ws-1')).toEqual(mockWorkspace);
    });
    it('throws NotFoundException when not found', async () => {
      mockWorkspaceRepo.findOne.mockResolvedValue(null);
      await expect(service.findById('ws-1')).rejects.toThrow(NotFoundException);
    });
  });

  describe('getMyWorkspace', () => {
    it('returns workspace for member', async () => {
      mockMemberRepo.findOne.mockResolvedValue({ workspaceId: 'ws-1' });
      mockWorkspaceRepo.findOne.mockResolvedValue(mockWorkspace);
      expect(await service.getMyWorkspace('user-1')).toEqual(mockWorkspace);
    });
    it('returns null if not in any workspace', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      expect(await service.getMyWorkspace('user-1')).toBeNull();
    });
  });

  describe('create', () => {
    it('creates workspace and adds owner as member', async () => {
      mockWorkspaceRepo.create.mockReturnValue({ ...mockWorkspace });
      mockWorkspaceRepo.save.mockResolvedValue({ id: 'ws-1' });
      mockMemberRepo.create.mockReturnValue({ id: 'mem-1' });
      mockMemberRepo.save.mockResolvedValue({ id: 'mem-1' });
      // findById called after save
      mockWorkspaceRepo.findOne.mockResolvedValue(mockWorkspace);
      const result = await service.create('user-1', { name: 'My Workspace' });
      expect(result).toEqual(mockWorkspace);
      expect(mockMemberRepo.save).toHaveBeenCalled();
    });
  });

  describe('invite', () => {
    it('creates pending invite', async () => {
      mockWorkspaceRepo.findOne.mockResolvedValue(mockWorkspace);
      mockMemberRepo.count.mockResolvedValue(1);
      const pendingMember = { id: 'mem-2', status: WorkspaceMemberStatus.PENDING };
      mockMemberRepo.create.mockReturnValue(pendingMember);
      mockMemberRepo.save.mockResolvedValue(pendingMember);
      const result = await service.invite('ws-1', 'user-1', { email: 'invitee@example.com' });
      expect(result.status).toBe(WorkspaceMemberStatus.PENDING);
    });
    it('throws ForbiddenException if not owner', async () => {
      mockWorkspaceRepo.findOne.mockResolvedValue(mockWorkspace);
      await expect(service.invite('ws-1', 'not-owner', { email: 'x@x.com' })).rejects.toThrow(ForbiddenException);
    });
    it('throws BadRequestException when member limit reached', async () => {
      mockWorkspaceRepo.findOne.mockResolvedValue({ ...mockWorkspace, maxMembers: 1 });
      mockMemberRepo.count.mockResolvedValue(1);
      await expect(service.invite('ws-1', 'user-1', { email: 'x@x.com' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('getWorkspaceAnalytics', () => {
    it('returns analytics', async () => {
      mockMemberRepo.findOne.mockResolvedValue({ workspaceId: 'ws-1' });
      mockWorkspaceRepo.findOne.mockResolvedValue(mockWorkspace);
      mockSubRepo.find.mockResolvedValue([]);
      const result = await service.getWorkspaceAnalytics('user-1');
      expect(result).toHaveProperty('totalMonthly');
      expect(result).toHaveProperty('memberCount');
    });
    it('throws NotFoundException if no workspace', async () => {
      mockMemberRepo.findOne.mockResolvedValue(null);
      await expect(service.getWorkspaceAnalytics('user-1')).rejects.toThrow(NotFoundException);
    });
  });
});
