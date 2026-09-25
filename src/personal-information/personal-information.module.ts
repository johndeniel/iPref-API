import { Module } from '@nestjs/common';
import { PersonalInformationController } from './controller/personal-information.controller.js';
import { PersonalInformationService } from './service/personal-information.service.js';

@Module({
  controllers: [PersonalInformationController],
  providers: [PersonalInformationService],
})
export class PersonalInformationModule {}
