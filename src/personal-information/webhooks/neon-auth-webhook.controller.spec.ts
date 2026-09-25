import { BadRequestException, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import type { WebhookVerifierService } from '../../auth/webhooks/webhook-verifier.service.js';
import type { ProfileProvisioningService } from '../provisioning/profile-provisioning.service.js';
import { NeonAuthWebhookController } from './neon-auth-webhook.controller.js';

type WebhookReq = RawBodyRequest<Request>;

const headers = {
  'x-neon-signature': 'sig',
  'x-neon-signature-kid': 'kid',
  'x-neon-timestamp': String(Date.now()),
  'x-neon-event-type': 'user.created',
  'x-neon-event-id': 'event-1',
};

const reqWith = (body: string, eventType = 'user.created'): WebhookReq =>
  ({
    headers: { ...headers, 'x-neon-event-type': eventType },
    rawBody: Buffer.from(body, 'utf8'),
  }) as unknown as WebhookReq;

const controllerWith = (verify: () => Promise<void> | void) => {
  const provisionFromWebhook = vi.fn().mockResolvedValue(undefined);
  const controller = new NeonAuthWebhookController(
    { verify: vi.fn().mockImplementation(verify) } as unknown as WebhookVerifierService,
    { provisionFromWebhook } as unknown as ProfileProvisioningService,
  );
  return { controller, provisionFromWebhook };
};

describe('NeonAuthWebhookController', () => {
  beforeEach(() => vi.clearAllMocks());

  it('provisions the profile on user.created and returns ok', async () => {
    const { controller, provisionFromWebhook } = controllerWith(() => {});
    const body = JSON.stringify({
      user: { id: 'user-1', name: 'Ada Lovelace', image: null },
    });

    const result = await controller.handle(reqWith(body));

    expect(result).toEqual({ ok: true });
    expect(provisionFromWebhook).toHaveBeenCalledWith({
      id: 'user-1',
      name: 'Ada Lovelace',
      image: null,
    });
  });

  it('ignores other event types without provisioning', async () => {
    const provisionFromWebhook = vi.fn();
    const controller = new NeonAuthWebhookController(
      { verify: vi.fn().mockResolvedValue(undefined) } as unknown as WebhookVerifierService,
      { provisionFromWebhook } as unknown as ProfileProvisioningService,
    );

    const result = await controller.handle(reqWith(JSON.stringify({}), 'send.otp'));

    expect(result).toEqual({ ok: true });
    expect(provisionFromWebhook).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures with 401', async () => {
    const { controller } = controllerWith(() => {
      throw new Error('bad signature');
    });

    await expect(controller.handle(reqWith(JSON.stringify({})))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('rejects missing headers with 400', async () => {
    const { controller } = controllerWith(() => {});

    await expect(
      controller.handle({ headers: {}, rawBody: Buffer.from('{}') } as unknown as WebhookReq),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects missing raw bodies with 400', async () => {
    const { controller } = controllerWith(() => {});

    await expect(controller.handle({ headers } as unknown as WebhookReq)).rejects.toThrow(
      BadRequestException,
    );
  });

  it('rejects invalid JSON and payloads without user.id with 400', async () => {
    const { controller } = controllerWith(() => {});

    await expect(controller.handle(reqWith('not-json'))).rejects.toThrow(BadRequestException);
    await expect(controller.handle(reqWith(JSON.stringify({ user: {} })))).rejects.toThrow(
      BadRequestException,
    );
  });
});
