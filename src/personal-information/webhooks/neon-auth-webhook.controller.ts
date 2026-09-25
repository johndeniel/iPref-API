import {
  BadRequestException,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import {
  parseNeonWebhookHeaders,
  type NeonWebhookHeaders,
} from '../../auth/webhooks/webhook-signature.js';
import { WebhookVerifierService } from '../../auth/webhooks/webhook-verifier.service.js';
import {
  ProfileProvisioningService,
  type WebhookUser,
} from '../provisioning/profile-provisioning.service.js';

/**
 * Managed Neon Auth event receiver. Subscribe `user.created` in the Neon
 * Console (or API/CLI) so every signup auto-creates its profile row.
 *
 * Only `user.created` is processed; other events return 200 ignored.
 * Responses stay 4xx/2xx (never retryable 5xx/429/408): Neon treats other
 * 4xx as non-retryable, and `user_id` upserts make redeliveries idempotent.
 */
@ApiTags('webhooks')
@Controller('webhooks/neon-auth')
export class NeonAuthWebhookController {
  constructor(
    private readonly verifier: WebhookVerifierService,
    private readonly provisioning: ProfileProvisioningService,
  ) {}

  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Managed Neon Auth event webhook' })
  @ApiResponse({ status: 200, description: 'Event accepted' })
  @ApiResponse({ status: 400, description: 'Missing headers, raw body, or payload' })
  @ApiResponse({ status: 401, description: 'Invalid webhook signature' })
  async handle(@Req() req: RawBodyRequest<Request>): Promise<{ ok: true }> {
    let headers: NeonWebhookHeaders;
    try {
      headers = parseNeonWebhookHeaders(req.headers);
    } catch {
      throw new BadRequestException('Missing required X-Neon-* headers');
    }

    // Signature binds the exact bytes; requires `rawBody: true` in bootstrap.
    const rawBody = req.rawBody?.toString('utf8');
    if (!rawBody) {
      throw new BadRequestException('Missing raw body');
    }
    try {
      await this.verifier.verify(rawBody, headers);
    } catch {
      throw new UnauthorizedException('Invalid webhook signature');
    }

    if (headers.eventType !== 'user.created') {
      return { ok: true };
    }

    let user: WebhookUser | undefined;
    try {
      user = (JSON.parse(rawBody) as { user?: WebhookUser }).user;
    } catch {
      throw new BadRequestException('Invalid JSON payload');
    }
    if (!user || typeof user.id !== 'string' || user.id.length === 0) {
      throw new BadRequestException('Payload user.id is required');
    }

    await this.provisioning.provisionFromWebhook(user);
    return { ok: true };
  }
}
