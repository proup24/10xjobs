import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { setupSwagger } from 'src/swagger';
import { expect, it, vi } from 'vitest';

it('documents application routes with the API prefix and the engine key', async () => {
  class HealthController {
    health() {
      return { ok: true };
    }
  }
  Controller('health')(HealthController);
  Get()(
    HealthController.prototype,
    'health',
    Object.getOwnPropertyDescriptor(HealthController.prototype, 'health')!,
  );
  class TestModule {}
  Module({ controllers: [HealthController] })(TestModule);
  const app = await NestFactory.create(TestModule, { logger: false });
  app.setGlobalPrefix('api');
  const setup = vi.spyOn(SwaggerModule, 'setup');
  try {
    setupSwagger(app);
    const [path, , document] = setup.mock.calls[0];
    expect(path).toBe('docs');
    expect(document).toMatchObject({
      paths: { '/api/health': { get: expect.any(Object) } },
      components: {
        securitySchemes: {
          'engine-key': { type: 'apiKey', name: 'X-Engine-Key', in: 'header' },
          bearer: { type: 'http', scheme: 'bearer' },
        },
      },
      security: [{ 'engine-key': [] }],
    });
  } finally {
    setup.mockRestore();
    await app.close();
  }
});
