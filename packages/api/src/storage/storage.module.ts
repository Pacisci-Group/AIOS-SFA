import { Global, Module } from '@nestjs/common';
import { StorageService } from './storage.service';

/**
 * Global, reusable S3-compatible storage module. Provides {@link StorageService}
 * (MinIO locally / DigitalOcean Spaces in cloud) to any feature that needs
 * presigned uploads or downloads.
 */
@Global()
@Module({
  providers: [StorageService],
  exports: [StorageService],
})
export class StorageModule {}
