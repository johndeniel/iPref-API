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
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
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
@Controller('v1/personal-information')
export class PersonalInformationController {
  constructor(private readonly service: PersonalInformationService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Create personal information' })
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
    description: 'Request with this Idempotency-Key is already processing',
  })
  create(@Body(createPipe) dto: CreatePersonalInformationInput) {
    return this.service.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'List personal information (paginated)' })
  list(@Query(queryPipe) query: ListPersonalInformationQuery) {
    return this.service.list(query);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update personal information' })
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body(updatePipe) dto: UpdatePersonalInformationInput,
  ) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Delete personal information' })
  async remove(@Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.service.remove(id);
  }
}
