import { describe, expect, it } from 'vitest';
import { fixtureDocument } from '../schema/fixture.testing';
import { fixtureDocumentV1 } from '../schema/fixture-v1.testing';
import { fixtureDocumentV2 } from '../schema/fixture-v2.testing';
import { readStoredData } from './processor.repository';

describe('readStoredData', () => {
  it('reads a current row as v3', () => {
    expect(readStoredData(fixtureDocument())).toEqual({
      schemaVersion: 3,
      data: fixtureDocument(),
    });
  });

  it('reads a row stored at v2 as v2', () => {
    expect(readStoredData(fixtureDocumentV2())).toEqual({
      schemaVersion: 2,
      data: fixtureDocumentV2(),
    });
  });

  it('reads a row stored before v2 as v1', () => {
    expect(readStoredData(fixtureDocumentV1())).toEqual({
      schemaVersion: 1,
      data: fixtureDocumentV1(),
    });
  });

  it('gives no document for data neither version reads', () => {
    expect(readStoredData({ nope: true })).toEqual({
      schemaVersion: null,
      data: null,
    });
  });
});
