import { Module } from '@nestjs/common';
import { PersonalInformationController } from './controller/personal-information.controller.js';
import { ProfileProvisioningService } from './provisioning/profile-provisioning.service.js';
import { PersonalInformationService } from './service/personal-information.service.js';

@Module({
  controllers: [PersonalInformationController],
  providers: [PersonalInformationService, ProfileProvisioningService],
  exports: [ProfileProvisioningService],
})
export class PersonalInformationModule {}
