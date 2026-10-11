import { randomUUID } from 'node:crypto';

/** Prefix ID per entitas. Format: `<prefix>_<32 hex>`. */
export const ID_PREFIXES = {
  run: 'run',
  module: 'mod',
  finding: 'fnd',
  evidence: 'evd',
  usage: 'use',
  remediation: 'rem',
  target: 'tgt',
  transition: 'trn',
} as const;
export type IdPrefix = keyof typeof ID_PREFIXES;

export const ID_PATTERN = /^[a-z]{3}_[a-f0-9]{32}$/;

export function newId(prefix: IdPrefix): string {
  return `${ID_PREFIXES[prefix]}_${randomUUID().replaceAll('-', '')}`;
}

/** Waktu ISO 8601 UTC, selalu dengan akhiran `Z`. */
export function nowIso(now: Date = new Date()): string {
  return now.toISOString();
}
