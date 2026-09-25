import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { DatabaseService } from './database.service.js';

@ApiTags('health')
@Controller('health/db')
export class DbHealthController {
  constructor(private readonly db: DatabaseService) {}

  @Get()
  @ApiOperation({ summary: 'Postgres connectivity check' })
  @ApiResponse({ status: 200, description: 'Postgres is reachable' })
  @ApiResponse({ status: 503, description: 'Postgres is unreachable' })
  async check(): Promise<{ status: string; latencyMs: number; timestamp: string }> {
    try {
      const { latencyMs } = await this.db.checkHealth();
      return { status: 'ok', latencyMs, timestamp: new Date().toISOString() };
    } catch (error) {
      throw new HttpException(
        {
          status: 'error',
          message: (error as Error).message,
          timestamp: new Date().toISOString(),
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }
  }
}
