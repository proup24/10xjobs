import { Controller, Get } from '@nestjs/common';
import { Public } from 'src/common/decorators';
import { AppService } from './app.service';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  /** Health check: open so probes need no credentials. */
  @Public()
  @Get()
  getData() {
    return this.appService.getData();
  }
}
