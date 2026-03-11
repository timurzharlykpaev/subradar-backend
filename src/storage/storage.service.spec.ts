import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { StorageService } from './storage.service';

// Mock AWS SDK
jest.mock('@aws-sdk/client-s3', () => ({
  S3Client: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  PutObjectCommand: jest.fn(),
  DeleteObjectCommand: jest.fn(),
  GetObjectCommand: jest.fn(),
}));

jest.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: jest.fn().mockResolvedValue('https://signed-url.example.com/file.jpg'),
}));

const mockConfigService = {
  get: jest.fn().mockImplementation((key: string, def?: any) => def ?? ''),
};

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StorageService,
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();
    service = module.get<StorageService>(StorageService);
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('uploadFile', () => {
    it('uploads and returns URL', async () => {
      const result = await service.uploadFile(Buffer.from('test'), 'test.jpg', 'image/jpeg');
      expect(result).toContain('test.jpg');
    });
  });

  describe('getSignedUrl', () => {
    it('returns signed URL', async () => {
      const url = await service.getSignedUrl('some/key.jpg');
      expect(url).toBe('https://signed-url.example.com/file.jpg');
    });
  });

  describe('deleteFile', () => {
    it('deletes without throwing', async () => {
      await expect(service.deleteFile('some/key.jpg')).resolves.not.toThrow();
    });
  });
});
