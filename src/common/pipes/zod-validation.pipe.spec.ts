import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
import { ZodValidationPipe } from './zod-validation.pipe.js';

describe('ZodValidationPipe', () => {
  const schema = z.object({ name: z.string().min(1) });
  const pipe = new ZodValidationPipe(schema);

  it('returns parsed data (with defaults/coercion applied)', () => {
    expect(pipe.transform({ name: 'Ada' })).toEqual({ name: 'Ada' });
  });

  it('throws BadRequest with field details on failure', () => {
    try {
      pipe.transform({});
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(BadRequestException);
      const response = (error as BadRequestException).getResponse() as {
        message: string | string[];
      };
      expect(JSON.stringify(response.message)).toContain('name');
    }
  });
});
