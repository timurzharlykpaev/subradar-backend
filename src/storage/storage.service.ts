import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

@Injectable()
export class StorageService {
  private readonly s3: S3Client;
  private readonly bucket: string;
  private readonly publicEndpoint: string;

  constructor(private readonly cfg: ConfigService) {
    const endpoint = cfg.get('DO_SPACES_ENDPOINT', 'https://fra1.digitaloceanspaces.com');
    this.bucket = cfg.get('DO_SPACES_BUCKET', 'subradar');
    this.publicEndpoint = cfg.get('DO_SPACES_CDN_URL') || `${endpoint}/${this.bucket}`;

    this.s3 = new S3Client({
      endpoint,
      region: 'us-east-1',
      credentials: {
        accessKeyId: cfg.get('DO_SPACES_KEY', ''),
        secretAccessKey: cfg.get('DO_SPACES_SECRET', ''),
      },
      forcePathStyle: false,
    });
  }

  async uploadFile(buffer: Buffer, filename: string, mimetype: string, isPublic = true): Promise<string> {
    const key = `${Date.now()}-${filename.replace(/[^a-zA-Z0-9._-]/g, '_')}`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: buffer,
        ContentType: mimetype,
        ACL: isPublic ? 'public-read' : 'private',
      }),
    );

    return isPublic ? `${this.publicEndpoint}/${key}` : key;
  }

  async getSignedUrl(key: string, expiresInSeconds = 3600): Promise<string> {
    const command = new GetObjectCommand({ Bucket: this.bucket, Key: key });
    return getSignedUrl(this.s3, command, { expiresIn: expiresInSeconds });
  }

  async deleteFile(key: string): Promise<void> {
    await this.s3.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: key }));
  }
}
