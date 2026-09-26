import { ApiQuery } from '@nestjs/swagger';
import type { SchemaObject } from '@nestjs/swagger';
import { z } from 'zod';

/**
 * Zod schemas are the single source of truth for the API contract. These
 * helpers derive OpenAPI from them so docs can never drift from validation.
 *
 * - Query params: property order in the Zod object = order in Swagger UI.
 * - Dates: JSON Schema has no date type → { type: 'string', format: 'date-time' }.
 *   Any other unrepresentable type throws at boot (fail fast, not silent `{}`).
 */
const dateOrThrow = ({ zodSchema }: { zodSchema: z.ZodType }): unknown =>
  zodSchema._zod.def.type === 'date' ? { type: 'string', format: 'date-time' } : undefined;

/** Emit an OAS 3.0 Schema Object from a Zod schema (for @ApiOkResponse etc.). */
export const toOpenApiSchema = (
  schema: z.ZodType,
  io: 'input' | 'output' = 'output',
): SchemaObject =>
  z.toJSONSchema(schema, {
    target: 'openapi-3.0',
    io,
    unrepresentable: dateOrThrow as never,
  }) as unknown as SchemaObject;

/**
 * Document a route's query parameters from its Zod query schema.
 * Replaces per-field @ApiQuery blocks; ordering, types, enums, defaults,
 * formats, and bounds all come from the schema keys, in declaration order.
 */
export const ApiZodQuery =
  (schema: z.ZodType): MethodDecorator =>
  (target, key, descriptor) => {
    const doc = z.toJSONSchema(schema, {
      target: 'openapi-3.0',
      io: 'input',
      unrepresentable: dateOrThrow as never,
    }) as unknown as {
      properties?: Record<string, SchemaObject>;
      required?: string[];
    };
    const required = new Set(doc.required ?? []);
    for (const [name, prop] of Object.entries(doc.properties ?? {})) {
      const { description, ...schemaProps } = prop;
      ApiQuery({
        name,
        required: required.has(name),
        description,
        schema: schemaProps,
      })(target, key, descriptor);
    }
    return descriptor;
  };
