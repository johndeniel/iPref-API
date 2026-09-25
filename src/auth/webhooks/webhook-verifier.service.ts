import { Injectable } from '@nestjs/common';
import { AuthService } from '../auth.service.js';
import { createNeonKeySet, type KeySet } from '../auth.jwt.js';
import { verifyNeonWebhookSignature, type NeonWebhookHeaders } from './webhook-signature.js';

/** Injectable wrapper around the pure webhook verifier (holds the remote JWKS). */
@Injectable()
export class WebhookVerifierService {
  private readonly keySet: KeySet;

  constructor(auth: AuthService) {
    this.keySet = createNeonKeySet(auth.options.jwksUrl);
  }

  verify(rawBody: string, headers: NeonWebhookHeaders): Promise<void> {
    return verifyNeonWebhookSignature(rawBody, headers, this.keySet);
  }
}
