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
import { ApiBearerAuth, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/auth.guard.js';
import type { AuthenticatedUser } from '../../auth/auth.types.js';
import { CurrentUser } from '../../auth/current-user.decorator.js';
import { ZodValidationPipe } from '../../common/pipes/zod-validation.pipe.js';
import {
  createPersonalInformationSchema,
  listPersonalInformationQuerySchema,
  updatePersonalInformationSchema,
  type CreatePersonalInformationInput,
  type ListPersonalInformationQuery,
  type UpdatePersonalInformationInput,
} from '../schema/personal-information.schema.js';
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
  @ApiResponse({ status: 401, description: 'Missing, invalid, or expired bearer token' })
  create(
    @CurrentUser() user: AuthenticatedUser,
    @Body(createPipe) dto: CreatePersonalInformationInput,
  ) {
    return this.service.create(user.id, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List personal information (paginated)' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, or expired bearer token' })
  list(
    @CurrentUser() user: AuthenticatedUser,
    @Query(queryPipe) query: ListPersonalInformationQuery,
  ) {
    return this.service.list(user.id, query);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update personal information' })
  @ApiResponse({ status: 401, description: 'Missing, invalid, or expired bearer token' })
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
  @ApiResponse({ status: 401, description: 'Missing, invalid, or expired bearer token' })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<void> {
    await this.service.remove(user.id, id);
  }
}
