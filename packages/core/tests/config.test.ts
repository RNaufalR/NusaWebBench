import { describe, expect, it } from 'vitest';
import { AppError, configSnapshot, loadConfig } from '../src/index.js';

describe('loadConfig defaults (taskbook §2.3)', () => {
  it('default aman: AI off, lock aktif, remote tools off, bind loopback', () => {
    const cfg = loadConfig({});
    expect(cfg.HOST).toBe('127.0.0.1');
    expect(cfg.PORT).toBe(4178);
    expect(cfg.AI_PROVIDER).toBe('none');
    expect(cfg.FREE_TIER_LOCK).toBe(true);
    expect(cfg.AI_FALLBACK_ENABLED).toBe(false);
    expect(cfg.AI_ALLOW_EXTERNAL_DATA).toBe(false);
    expect(cfg.STRIX_ENABLED).toBe(false);
    expect(cfg.K6_ENABLED).toBe(false);
    expect(cfg.LOW_RESOURCE_MODE).toBe(true);
    expect(cfg.AI_MAX_REQUESTS_PER_DAY).toBe(20);
    expect(cfg.AI_MAX_REQUESTS_PER_RUN).toBe(3);
  });

  it('variabel kosong diperlakukan sebagai default', () => {
    const cfg = loadConfig({ PORT: '', FREE_TIER_LOCK: '', AI_PROVIDER: 'none' });
    expect(cfg.PORT).toBe(4178);
    expect(cfg.FREE_TIER_LOCK).toBe(true);
  });
});

describe('loadConfig negative cases', () => {
  it.each([
    [{ PORT: '80' }, 'PORT'],
    [{ PORT: 'abc' }, 'PORT'],
    [{ PORT: '70000' }, 'PORT'],
    [{ AI_PROVIDER: 'openai' }, 'AI_PROVIDER'],
    [{ FREE_TIER_LOCK: 'yes' }, 'FREE_TIER_LOCK'],
    [{ AI_MAX_REQUESTS_PER_DAY: '-1' }, 'AI_MAX_REQUESTS_PER_DAY'],
    [{ AI_REQUEST_TIMEOUT_MS: '999999999' }, 'AI_REQUEST_TIMEOUT_MS'],
    [{ GEMINI_MODEL: 'bad model; rm -rf' }, 'GEMINI_MODEL'],
    [{ HOST: 'host name with spaces' }, 'HOST'],
  ])('menolak %j dan menyebut nama variabel %s', (env, name) => {
    let caught: unknown;
    try {
      loadConfig(env);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(AppError);
    expect((caught as AppError).code).toBe('CONFIG_INVALID');
    expect((caught as AppError).debugDetail).toContain(name);
  });

  it('bind non-loopback ditolak kecuali ALLOW_EXTERNAL_BIND=true', () => {
    expect(() => loadConfig({ HOST: '0.0.0.0' })).toThrow(AppError);
    expect(loadConfig({ HOST: '0.0.0.0', ALLOW_EXTERNAL_BIND: 'true' }).HOST).toBe('0.0.0.0');
  });

  it('provider aktif tanpa free-tier lock ditolak', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'groq', FREE_TIER_LOCK: 'false' })).toThrow(AppError);
  });

  it('model kosong saat key diset ditolak', () => {
    expect(() => loadConfig({ AI_PROVIDER: 'groq', GROQ_API_KEY: 'abcdefghijklmnop' })).toThrow(
      AppError,
    );
  });

  it('batas per run tidak boleh melebihi batas harian', () => {
    expect(() =>
      loadConfig({ AI_MAX_REQUESTS_PER_RUN: '50', AI_MAX_REQUESTS_PER_DAY: '10' }),
    ).toThrow(AppError);
  });

  it('pesan error tidak menampilkan nilai secret', () => {
    const secret = 'ZZSECRETCANARYVALUE12345';
    let debug = '';
    try {
      loadConfig({ GROQ_API_KEY: secret, PORT: 'abc' });
    } catch (err) {
      debug = (err as AppError).debugDetail ?? '';
      expect(JSON.stringify(err)).not.toContain(secret);
    }
    expect(debug).not.toContain(secret);
    expect(debug).toContain('PORT');
  });
});

describe('configSnapshot', () => {
  it('tidak menyertakan nilai key, hanya status terkonfigurasi', () => {
    const cfg = loadConfig({ GROQ_API_KEY: 'gsk_CANARYSYNTHETICVALUE0000000000000000000000' });
    const snap = configSnapshot(cfg);
    expect(JSON.stringify(snap)).not.toContain('CANARYSYNTHETIC');
    expect(snap['GROQ_API_KEY_CONFIGURED']).toBe(true);
    expect(snap['GEMINI_API_KEY_CONFIGURED']).toBe(false);
    expect(snap).not.toHaveProperty('GROQ_API_KEY');
  });
});
