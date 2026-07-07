import { Controller, Get } from '@nestjs/common';
import { Public } from './common/decorators/access.decorators';

@Controller()
export class HealthController {
  @Public()
  @Get('health')
  health() {
    return {
      status: 'ok',
      service: 'sfa-api',
      timestamp: new Date().toISOString(),
    };
  }
}
