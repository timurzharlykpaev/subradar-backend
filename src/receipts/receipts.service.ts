import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Receipt } from './entities/receipt.entity';

// Allowed receipt content types — verified against magic bytes below, NOT
// against client-supplied MIME (which is trivially spoofed). Keep the list
// small: receipts are photos of paper or vendor PDFs.
const ALLOWED_TYPES: Record<
  string,
  { ext: string; check: (b: Buffer) => boolean }
> = {
  'image/jpeg': {
    ext: 'jpg',
    check: (b) =>
      b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  },
  'image/png': {
    ext: 'png',
    check: (b) =>
      b.length >= 8 &&
      b[0] === 0x89 &&
      b[1] === 0x50 &&
      b[2] === 0x4e &&
      b[3] === 0x47 &&
      b[4] === 0x0d &&
      b[5] === 0x0a &&
      b[6] === 0x1a &&
      b[7] === 0x0a,
  },
  'image/webp': {
    ext: 'webp',
    check: (b) =>
      b.length >= 12 &&
      b.slice(0, 4).toString('ascii') === 'RIFF' &&
      b.slice(8, 12).toString('ascii') === 'WEBP',
  },
  'application/pdf': {
    ext: 'pdf',
    check: (b) => b.length >= 4 && b.slice(0, 4).toString('ascii') === '%PDF',
  },
};

function detectAllowedMime(
  buffer: Buffer,
): { mime: string; ext: string } | null {
  for (const [mime, { ext, check }] of Object.entries(ALLOWED_TYPES)) {
    if (check(buffer)) return { mime, ext };
  }
  return null;
}

function sanitizeFilenameStem(name: string): string {
  // Strip directory traversal + control chars + anything that isn't a-z0-9._-
  // Keep at most one trailing extension; we control the actual S3-key extension
  // separately via the magic-byte detection result.
  const base =
    (name.split('/').pop() || 'receipt').split('\\').pop() || 'receipt';
  const stem = base.replace(/\.[^.]*$/, '');
  return stem.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80) || 'receipt';
}

@Injectable()
export class ReceiptsService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string;

  constructor(
    @InjectRepository(Receipt) private readonly repo: Repository<Receipt>,
    private readonly cfg: ConfigService,
  ) {
    const endpoint = cfg.get(
      'DO_SPACES_ENDPOINT',
      'https://fra1.digitaloceanspaces.com',
    );
    const region = cfg.get('DO_SPACES_REGION', 'fra1');
    this.s3 = new S3Client({
      endpoint,
      region,
      forcePathStyle: false,
      credentials: {
        accessKeyId: cfg.get('DO_SPACES_KEY', ''),
        secretAccessKey: cfg.get('DO_SPACES_SECRET', ''),
      },
    });
    this.bucket = cfg.get('DO_SPACES_BUCKET', 'steptogoal');
    this.cdnUrl = cfg.get(
      'DO_SPACES_CDN_URL',
      `https://${this.bucket}.fra1.digitaloceanspaces.com`,
    );
  }

  async upload(
    userId: string,
    file: Express.Multer.File,
    subscriptionId?: string,
  ): Promise<Receipt> {
    if (!file?.buffer || file.buffer.length === 0) {
      throw new BadRequestException('Empty file');
    }
    const detected = detectAllowedMime(file.buffer);
    if (!detected) {
      throw new BadRequestException(
        'Unsupported file type. Only JPEG, PNG, WebP, and PDF receipts are accepted.',
      );
    }
    const safeStem = sanitizeFilenameStem(file.originalname || 'receipt');
    const safeFilename = `${safeStem}.${detected.ext}`;
    const key = `receipts/${userId}/${Date.now()}-${safeFilename}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        // Use the magic-byte-derived MIME, never the client's claimed value.
        ContentType: detected.mime,
        // SSE at rest — DO Spaces honours the AWS S3 SSE header.
        ServerSideEncryption: 'AES256',
        ACL: 'private',
      }),
    );

    const fileUrl = `${this.cdnUrl}/${key}`;
    const receipt = this.repo.create({
      userId,
      filename: safeFilename,
      fileUrl,
      subscriptionId,
    });
    return this.repo.save(receipt);
  }

  async findAll(userId: string): Promise<Receipt[]> {
    return this.repo.find({ where: { userId }, order: { uploadedAt: 'DESC' } });
  }

  async findBySubscription(
    userId: string,
    subscriptionId: string,
  ): Promise<Receipt[]> {
    return this.repo.find({
      where: { userId, subscriptionId },
      order: { uploadedAt: 'DESC' },
    });
  }

  async remove(userId: string, receiptId: string): Promise<void> {
    await this.repo.delete({ id: receiptId, userId });
  }
}
