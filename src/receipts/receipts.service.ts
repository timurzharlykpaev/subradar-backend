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
    const endpoint = cfg.get('DO_SPACES_ENDPOINT', 'https://fra1.digitaloceanspaces.com');
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
    this.cdnUrl = cfg.get('DO_SPACES_CDN_URL', `https://${this.bucket}.fra1.digitaloceanspaces.com`);
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

  async findBySubscription(userId: string, subscriptionId: string): Promise<Receipt[]> {
    return this.repo.find({
      where: { userId, subscriptionId },
      order: { uploadedAt: 'DESC' },
    });
  }

  async remove(userId: string, receiptId: string): Promise<void> {
    await this.repo.delete({ id: receiptId, userId });
  }
}
