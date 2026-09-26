import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiHeader,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.guard.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ApiZodQuery, toOpenApiSchema } from '../../common/openapi/zod-openapi.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  createPersonalInformationSchema,
  listPersonalInformationQuerySchema,
  paginatedPersonalInformationSchema,
  updatePersonalInformationSchema,
  type CreatePersonalInformationInput,
  type ListPersonalInformationQuery,
  type UpdatePersonalInformationInput,
} from '../model/personal-information.model.js';
import { PersonalInformationService } from '../service/personal-information.service.js';

const createPipe = new ZodValidationPipe<CreatePersonalInformationInput>(
  createPersonalInformationSchema,
);
const updatePipe = new ZodValidationPipe<UpdatePersonalInformationInput>(
  updatePersonalInformationSchema,
);
const queryPipe = new ZodValidationPipe<ListPersonalInformationQuery>(
  listPersonalInformationQuerySchema,
);

@ApiTags('personal-information')
@ApiBearerAuth()
@ApiResponse({ status: 401, description: 'Missing, invalid, or expired bearer token' })
@ApiResponse({ status: 403, description: 'User is banned' })
@UseGuards(JwtAuthGuard)
@Controller('v1/personal-information')
export class PersonalInformationController {
  constructor(private readonly service: PersonalInformationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Create personal information',
    description: 'Profiles are auto-created on signup; this returns 409 when yours already exists.',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    description:
      'Unique key for idempotent request (UUID v4). Replays the first completed response for this key, regardless of retry body.',
    required: true,
  })
  @ApiBody({
    description: 'Profile fields to store.',
    schema: toOpenApiSchema(createPersonalInformationSchema, 'input'),
    examples: {
      profile: {
        summary: 'Complete profile',
        value: {
          fullName: 'Ada Lovelace',
          blobUrl: 'https://cdn.example.com/avatars/ada.png',
          blobId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          phoneNumber: '+639171234567',
        },
      },
    },
  })
  @ApiResponse({ status: 201, description: 'Personal information created' })
  @ApiResponse({
    status: 400,
    description: 'Missing/invalid Idempotency-Key or validation failure',
  })
  @ApiResponse({
    status: 409,
    description:
      'Request with this Idempotency-Key is already processing, or personal information already exists for this user',
  })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createPipe) dto: CreatePersonalInformationInput,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get('me')
  @ApiOperation({
    summary: 'Get own profile',
    description: 'Post-login who-am-I. Auto-provisions the profile on first call.',
  })
  @ApiResponse({ status: 200, description: 'Own personal information' })
  getMine(@CurrentUser() user: AuthenticatedUser) {
    return this.service.getMine(user.id);
  }

  @Get()
  @ApiOperation({ summary: 'List personal information (paginated)' })
  @ApiZodQuery(listPersonalInformationQuerySchema)
  @ApiOkResponse({
    schema: toOpenApiSchema(paginatedPersonalInformationSchema),
    description: 'Matching personal information rows (own rows only; normally at most one)',
  })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(queryPipe) query: ListPersonalInformationQuery,
  ) {
    return this.service.list(user.id, query);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update personal information' })
  @ApiBody({
    description: 'Fields to change (partial update; omit what stays).',
    schema: toOpenApiSchema(updatePersonalInformationSchema, 'input'),
    examples: {
      profile: {
        summary: 'Complete update',
        value: {
          fullName: 'Ada Lovelace',
          blobUrl: 'https://cdn.example.com/avatars/ada.png',
          blobId: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          phoneNumber: '+639171234567',
        },
      },
    },
  })
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body(updatePipe) dto: UpdatePersonalInformationInput,
  ) {
    return this.service.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete personal information' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(user.id, id);
  }
}
