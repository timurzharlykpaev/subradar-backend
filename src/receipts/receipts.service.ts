import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { Receipt } from './entities/receipt.entity';

@Injectable()
export class ReceiptsService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly cdnUrl: string;

  constructor(
    @InjectRepository(Receipt) private readonly repo: Repository<Receipt>,
    private readonly cfg: ConfigService,
  ) {
    this.s3 = new S3Client({
      endpoint: cfg.get(
        'DO_SPACES_ENDPOINT',
        'https://nyc3.digitaloceanspaces.com',
      ),
      region: 'us-east-1',
      credentials: {
        accessKeyId: cfg.get('DO_SPACES_KEY', ''),
        secretAccessKey: cfg.get('DO_SPACES_SECRET', ''),
      },
    });
    this.bucket = cfg.get('DO_SPACES_BUCKET', 'subradar');
    this.cdnUrl = cfg.get('DO_SPACES_CDN_URL', '');
  }

  async upload(
    userId: string,
    file: Express.Multer.File,
    subscriptionId?: string,
  ): Promise<Receipt> {
    const key = `receipts/${userId}/${Date.now()}-${file.originalname}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'private',
      }),
    );

    const fileUrl = `${this.cdnUrl}/${key}`;
    const receipt = this.repo.create({
      userId,
      filename: file.originalname,
      fileUrl,
      subscriptionId,
    });
    return this.repo.save(receipt);
  }

  async findAll(userId: string): Promise<Receipt[]> {
    return this.repo.find({ where: { userId }, order: { uploadedAt: 'DESC' } });
  }
}
