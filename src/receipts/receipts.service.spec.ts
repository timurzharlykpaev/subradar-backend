import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { ReceiptsService } from './receipts.service';
import { Receipt } from './entities/receipt.entity';

jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({ send: jest.fn().mockResolvedValue({}) })),
  PutObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com'),
}));

const mockRepo = {
  create: jest.fn(), save: jest.fn(), find: jest.fn(),
  findOne: jest.fn(), remove: jest.fn(),
};

const mockConfigService = {
  get: jest.fn((key: string, defaultVal?: string) => defaultVal ?? ''),
};

const mockReceipt = { id: 'rec-1', userId: 'user-1', key: 'receipts/user-1/1234-file.jpg', url: 'http://example.com/receipt.jpg' };

describe('ReceiptsService', () => {
  let service: ReceiptsService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ReceiptsService,
        { provide: getRepositoryToken(Receipt), useValue: mockRepo },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<ReceiptsService>(ReceiptsService);
    jest.clearAllMocks();
  });

  it('should be defined', () => { expect(service).toBeDefined(); });

  describe('findAll', () => {
    it('returns all receipts for user', async () => {
      mockRepo.find.mockResolvedValue([mockReceipt]);
      const result = await service.findAll('user-1');
      expect(result).toEqual([mockReceipt]);
    });
  });
});
