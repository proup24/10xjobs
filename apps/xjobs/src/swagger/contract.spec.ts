import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';
import { HealthController } from 'src/app/controllers/health.controller';
import { QuerySearchController } from 'src/modules/queries/controllers/query-search.controller';
import { ContactsController } from 'src/modules/users/controllers/contacts.controller';
import { ProfilesController } from 'src/modules/users/controllers/profiles.controller';
import { ResumeController } from 'src/modules/users/controllers/resume.controller';
import { UsersController } from 'src/modules/users/controllers/users.controller';

type Schema = {
  $ref?: string;
  allOf?: Schema[];
  properties?: Record<string, Schema>;
  items?: Schema;
  type?: string;
};
type Operation = {
  parameters?: { in: string }[];
  requestBody?: unknown;
  responses: Record<string, { content?: Record<string, { schema: Schema }> }>;
};

const SUCCESS = '#/components/schemas/SuccessResponseDto';
const ERROR = '#/components/schemas/ErrorResponseDto';

async function buildDocument(): Promise<OpenAPIObject> {
  const moduleRef = await Test.createTestingModule({
    controllers: [
      HealthController,
      UsersController,
      ContactsController,
      ProfilesController,
      ResumeController,
      QuerySearchController,
    ],
  })
    .useMocker(() => ({}))
    .compile();
  const app = moduleRef.createNestApplication({ logger: false });
  app.setGlobalPrefix('api');
  await app.init();
  const document = SwaggerModule.createDocument(
    app,
    new DocumentBuilder().build(),
  );
  await app.close();
  return document;
}

function operations(document: OpenAPIObject) {
  return Object.entries(document.paths).flatMap(([path, item]) =>
    Object.entries(item as Record<string, Operation>).map(
      ([method, operation]) => ({
        name: `${method.toUpperCase()} ${path}`,
        operation,
      }),
    ),
  );
}

/** The schema of `data` inside a success envelope, or undefined. */
function dataSchema(schema: Schema): Schema | undefined {
  if (!schema.allOf?.some((part) => part.$ref === SUCCESS)) return undefined;
  return schema.allOf.find((part) => part.properties?.['data'])?.properties?.[
    'data'
  ];
}

describe('API contract', () => {
  let document: OpenAPIObject;

  beforeAll(async () => {
    document = await buildDocument();
  });

  it('documents a query search builder region as nullable', () => {
    const builder = document.components?.schemas?.[
      'QuerySearchBuilderResponseDto'
    ] as Schema & { properties: Record<string, Record<string, unknown>> };
    expect(JSON.stringify(builder.properties['locationRegion'])).toContain(
      '"nullable":true',
    );
  });

  it('covers every route', () => {
    expect(
      operations(document)
        .map((o) => o.name)
        .sort(),
    ).toEqual([
      'DELETE /api/users/{userId}',
      'DELETE /api/users/{userId}/contacts/{contactId}',
      'DELETE /api/users/{userId}/profiles/{profileId}',
      'DELETE /api/users/{userId}/profiles/{profileId}/resume',
      'GET /api/health',
      'GET /api/users',
      'GET /api/users/{userId}',
      'GET /api/users/{userId}/contacts',
      'GET /api/users/{userId}/profiles',
      'GET /api/users/{userId}/profiles/{profileId}',
      'GET /api/users/{userId}/profiles/{profileId}/query-search',
      'GET /api/users/{userId}/profiles/{profileId}/resume',
      'PATCH /api/users/{userId}',
      'PATCH /api/users/{userId}/contacts/{contactId}',
      'POST /api/users',
      'POST /api/users/{userId}/contacts',
      'POST /api/users/{userId}/profiles',
      'POST /api/users/{userId}/profiles/{profileId}/publish',
      'POST /api/users/{userId}/profiles/{profileId}/resume',
      'PUT /api/users/{userId}/profiles/{profileId}',
    ]);
  });

  it('has no workspace route or parameter', () => {
    for (const path of Object.keys(document.paths))
      expect(path).not.toMatch(/workspace/i);
  });

  it('documents every success body as a SuccessResponseDto with a typed data', () => {
    for (const { name, operation } of operations(document)) {
      const successes = Object.entries(operation.responses).filter(([status]) =>
        status.startsWith('2'),
      );
      expect(successes, name).not.toHaveLength(0);
      for (const [status, response] of successes) {
        if (status === '204') {
          expect(response.content, `${name} 204`).toBeUndefined();
          continue;
        }
        if (response.content?.['application/pdf']) continue;
        const schema = response.content?.['application/json']?.schema;
        expect(schema, `${name} ${status}`).toBeDefined();
        const data = dataSchema(schema as Schema);
        expect(data, `${name} ${status} data`).toBeDefined();
        expect(
          data?.$ref ?? data?.items?.$ref,
          `${name} ${status} data type`,
        ).toMatch(/^#\/components\/schemas\/\w+$/);
      }
    }
  });

  it('documents every error as an ErrorResponseDto', () => {
    for (const { name, operation } of operations(document)) {
      const errors = Object.entries(operation.responses).filter(
        ([status]) => status.startsWith('4') || status.startsWith('5'),
      );
      for (const [status, response] of errors) {
        expect(
          response.content?.['application/json']?.schema.$ref,
          `${name} ${status}`,
        ).toBe(ERROR);
      }
    }
  });

  it('documents the errors each route can return', () => {
    for (const { name, operation } of operations(document)) {
      const statuses = Object.keys(operation.responses);
      expect(statuses, name).toContain('500');
      if (name !== 'GET /api/health') expect(statuses, name).toContain('401');
      if (operation.parameters?.some((p) => p.in === 'path')) {
        expect(statuses, name).toContain('404');
      }
      if (operation.requestBody) expect(statuses, name).toContain('400');
    }
  });

  it('documents the resume upload limit and the PDF download', () => {
    const resume = document.paths[
      '/api/users/{userId}/profiles/{profileId}/resume'
    ] as Record<string, Operation>;
    expect(Object.keys(resume['post'].responses)).toContain('413');
    expect(resume['get'].responses['200'].content).toHaveProperty(
      'application/pdf',
    );
  });
});
