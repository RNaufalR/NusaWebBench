import { describe, expect, it } from 'vitest';
import {
  AppError,
  createFinding,
  createModuleResult,
  createRun,
  ID_PATTERN,
} from '../src/index.js';
import { validModule, validFinding, ids } from './fixtures.js';

describe('factories', () => {
  it('createRun menghasilkan Run QUEUED dengan ID dan waktu sistem', () => {
    const run = createRun({
      targetId: ids.target,
      targetOrigin: 'http://127.0.0.1:4178',
      targetMode: 'fixture',
      authorization: {
        acknowledged: true,
        scopeSummary: 'fixture lokal',
        scopeHash: null,
        approvedAt: '2026-10-09T02:00:00.000Z',
      },
      configSnapshot: {},
      now: new Date('2026-10-09T02:00:00.000Z'),
    });
    expect(run.status).toBe('QUEUED');
    expect(run.createdAt).toBe('2026-10-09T02:00:00.000Z');
    expect(run.id).toMatch(/^run_[a-f0-9]{32}$/);
    expect(ID_PATTERN.test(run.id)).toBe(true);
  });

  it('createRun menolak target origin tidak valid tanpa memantulkan input', () => {
    let caught: unknown;
    try {
      createRun({
        targetId: ids.target,
        targetOrigin: 'javascript:alert(1)',
        targetMode: 'url',
        authorization: {
          acknowledged: false,
          scopeSummary: 'x',
          scopeHash: null,
          approvedAt: null,
        },
        configSnapshot: {},
      });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('VALIDATION_FAILED');
    expect((caught as AppError).safeMessage).not.toContain('javascript');
    expect((caught as AppError).debugDetail).toContain('targetOrigin:');
  });

  it('createModuleResult menolak PASS dengan errorCode', () => {
    expect(() =>
      createModuleResult({ ...validModule(), status: 'PASS', errorCode: 'TIMEOUT' } as never),
    ).toThrow(AppError);
  });

  it('createFinding menolak CONFIRMED tanpa evidence', () => {
    expect(() => createFinding({ ...validFinding(), evidenceRefs: [] } as never)).toThrow(AppError);
  });

  it('createFinding menerima data valid dan menghasilkan id baru bila tidak diberikan', () => {
    const f = createFinding({ ...validFinding(), id: undefined } as never);
    expect(f.id).toMatch(/^fnd_[a-f0-9]{32}$/);
  });
});
