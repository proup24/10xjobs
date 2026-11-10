import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { API_VERSION } from 'src/common/constants';

export function setupSwagger(app: INestApplication): void {
  const config = new DocumentBuilder()
    .setTitle('10xJobs API')
    .setDescription('10xJobs APIs')
    .setVersion(API_VERSION)
    .addApiKey(
      { type: 'apiKey', name: 'X-Engine-Key', in: 'header' },
      'engine-key',
    )
    // Every route requires it; the Authorize button sends it on Try it out.
    .addSecurityRequirements('engine-key')
    .build();
  const document = SwaggerModule.createDocument(app, config);

  SwaggerModule.setup('docs', app, document, {
    jsonDocumentUrl: 'docs/swagger.json',
    yamlDocumentUrl: 'docs/swagger.yaml',
    swaggerOptions: { withCredentials: true },
  });
}
