import 'reflect-metadata';
import { Controller, Get, Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import { setupSwagger } from 'src/swagger';
import { expect, it, vi } from 'vitest';

it('documents application routes with the API prefix and basic authentication', async () => {
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
        securitySchemes: { basic: { type: 'http', scheme: 'basic' } },
      },
      security: [{ basic: [] }],
    });
  } finally {
    setup.mockRestore();
    await app.close();
  }
});
