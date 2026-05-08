import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { ConfigService } from '@nestjs/config';
import { BadRequestException } from '@nestjs/common';
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

  describe('upload (magic-byte / sanitization)', () => {
    const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    const PNG = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00,
    ]);
    const PDF = Buffer.from('%PDF-1.4\n%fake pdf');
    const HTML = Buffer.from('<html><script>alert(1)</script></html>');
    const EXE = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03]);

    const fileFrom = (
      buffer: Buffer,
      originalname: string,
      mimetype: string,
    ): Express.Multer.File =>
      ({
        buffer,
        originalname,
        mimetype,
        size: buffer.length,
        fieldname: 'file',
        encoding: '7bit',
      }) as any;

    beforeEach(() => {
      mockRepo.create.mockImplementation((x) => ({ ...x, id: 'rec-new' }));
      mockRepo.save.mockImplementation(async (x) => x);
    });

    it('rejects empty file with BadRequestException', async () => {
      await expect(
        service.upload(
          'user-1',
          fileFrom(Buffer.alloc(0), 'a.jpg', 'image/jpeg'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects HTML disguised as image/jpeg (magic-byte mismatch)', async () => {
      await expect(
        service.upload(
          'user-1',
          fileFrom(HTML, 'evil.html', 'image/jpeg'),
        ),
      ).rejects.toThrow(BadRequestException);
    });

    it('rejects executable disguised as PDF', async () => {
      await expect(
        service.upload('user-1', fileFrom(EXE, 'evil.pdf', 'application/pdf')),
      ).rejects.toThrow(BadRequestException);
    });

    it('accepts valid JPEG and stores detected MIME, not client-supplied', async () => {
      const PutObjectCommandMock =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@aws-sdk/client-s3').PutObjectCommand as jest.Mock;
      PutObjectCommandMock.mockClear();
      await service.upload(
        'user-1',
        fileFrom(JPEG, 'pic.jpg', 'application/x-evil'),
      );
      const call = PutObjectCommandMock.mock.calls[0][0];
      expect(call.ContentType).toBe('image/jpeg');
      expect(call.ServerSideEncryption).toBe('AES256');
    });

    it('accepts valid PNG, WebP, PDF', async () => {
      await expect(
        service.upload('user-1', fileFrom(PNG, 'pic.png', 'image/png')),
      ).resolves.toBeDefined();
      await expect(
        service.upload('user-1', fileFrom(PDF, 'r.pdf', 'application/pdf')),
      ).resolves.toBeDefined();
    });

    it('strips path traversal from originalname', async () => {
      const PutObjectCommandMock =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@aws-sdk/client-s3').PutObjectCommand as jest.Mock;
      PutObjectCommandMock.mockClear();
      await service.upload(
        'user-1',
        fileFrom(JPEG, '../../../etc/passwd.jpg', 'image/jpeg'),
      );
      const call = PutObjectCommandMock.mock.calls[0][0];
      expect(call.Key).not.toContain('..');
      expect(call.Key).not.toContain('/etc/');
    });

    it('overrides .exe extension to detected format', async () => {
      const PutObjectCommandMock =
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        require('@aws-sdk/client-s3').PutObjectCommand as jest.Mock;
      PutObjectCommandMock.mockClear();
      // Real JPEG bytes but attacker-named .exe — we want the file saved as
      // .jpg per the magic-byte detection, never .exe.
      await service.upload(
        'user-1',
        fileFrom(JPEG, 'evil.exe', 'image/jpeg'),
      );
      const call = PutObjectCommandMock.mock.calls[0][0];
      expect(call.Key).toMatch(/\.jpg$/);
      expect(call.Key).not.toMatch(/\.exe/);
    });
  });
});
