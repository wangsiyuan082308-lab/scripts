import { PurchaseConfig, getSupplierAliases } from './config';

export interface SupplierRowMatchSummary {
  alias: string;
  matched: boolean;
}

export interface TableRowClassification {
  text: string;
  supplierMatched: boolean;
  matchedAlias?: string;
  allowedStatusMatched: boolean;
  matchedStatus?: string;
  conflictAlias?: string;
  conflictStatus?: string;
  classification: 'matched' | 'ambiguous' | 'conflicting';
  reasons: string[];
}

export interface TableVerificationDiagnostics {
  aliases: string[];
  allowedStatuses: string[];
  rowCount: number;
  matchedRows: TableRowClassification[];
  ambiguousRows: TableRowClassification[];
  conflictingRows: TableRowClassification[];
  aliasSummary: SupplierRowMatchSummary[];
}

const COMMON_CONFLICT_STATUSES = ['作废', '已作废', '已失效', '失效', '禁采', '不可补货', '不可下单', '终止'];

function normalizeText(value: string): string {
  return value
    .replace(/[（）()]/g, '')
    .replace(/供应商/g, '')
    .replace(/平台/g, '')
    .replace(/[\s\-_]/g, '')
    .toLowerCase()
    .trim();
}

function summarizeText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().substring(0, 200);
}

function buildOtherSupplierClues(config: PurchaseConfig, aliases: string[]): string[] {
  const aliasSet = new Set(aliases.map(alias => normalizeText(alias)).filter(Boolean));
  const clues = new Set<string>();

  for (const [key, supplierConfig] of Object.entries(config.suppliers || {})) {
    const candidates = [key, supplierConfig?.name, ...(supplierConfig?.aliases || []), supplierConfig?.code]
      .filter((value): value is string => Boolean(value && value.trim()));
    const belongsToTarget = candidates.some((candidate) => aliasSet.has(normalizeText(candidate)));
    if (belongsToTarget) continue;
    candidates.forEach((candidate) => clues.add(candidate));
  }

  return Array.from(clues).filter(Boolean);
}

export function verifyTableRows(options: {
  config: PurchaseConfig;
  supplier: string;
  rows: string[];
  enforceStatus: boolean;
}): TableVerificationDiagnostics {
  const aliases = getSupplierAliases(options.config, options.supplier);
  const allowedStatuses = options.enforceStatus ? (options.config.procurementRules.allowedCartStatuses || []) : [];
  const otherSupplierClues = buildOtherSupplierClues(options.config, aliases);

  const normalizedAliases = aliases
    .map((alias) => ({ raw: alias, normalized: normalizeText(alias) }))
    .filter((alias) => alias.normalized);
  const normalizedStatuses = allowedStatuses
    .map((status) => ({ raw: status, normalized: normalizeText(status) }))
    .filter((status) => status.normalized);
  const normalizedOtherSuppliers = otherSupplierClues
    .map((alias) => ({ raw: alias, normalized: normalizeText(alias) }))
    .filter((alias) => alias.normalized);
  const normalizedConflictStatuses = COMMON_CONFLICT_STATUSES
    .map((status) => ({ raw: status, normalized: normalizeText(status) }))
    .filter((status) => status.normalized && !normalizedStatuses.some((allowed) => allowed.normalized === status.normalized));

  const matchedRows: TableRowClassification[] = [];
  const ambiguousRows: TableRowClassification[] = [];
  const conflictingRows: TableRowClassification[] = [];
  const aliasMatchedSet = new Set<string>();

  for (const rawText of options.rows) {
    const text = summarizeText(rawText);
    if (!text) continue;

    const normalizedRow = normalizeText(text);
    const matchedAlias = normalizedAliases.find((alias) => normalizedRow.includes(alias.normalized));
    const matchedStatus = normalizedStatuses.find((status) => normalizedRow.includes(status.normalized));
    const conflictAlias = normalizedOtherSuppliers.find((alias) => normalizedRow.includes(alias.normalized));
    const conflictStatus = options.enforceStatus && normalizedStatuses.length > 0
      ? normalizedConflictStatuses.find((status) => normalizedRow.includes(status.normalized))
      : undefined;

    if (matchedAlias) aliasMatchedSet.add(matchedAlias.raw);

    const hasAllowedStatus = !options.enforceStatus || normalizedStatuses.length === 0 || Boolean(matchedStatus);
    const statusEvidenceMissing = options.enforceStatus && normalizedStatuses.length > 0 && !matchedStatus && !conflictStatus;

    const reasons: string[] = [];
    if (matchedAlias) reasons.push('supplier:' + matchedAlias.raw);
    if (matchedStatus) reasons.push('status:' + matchedStatus.raw);
    if (conflictAlias) reasons.push('otherSupplier:' + conflictAlias.raw);
    if (conflictStatus) reasons.push('conflictStatus:' + conflictStatus.raw);
    if (statusEvidenceMissing) reasons.push('missingAllowedStatus');

    let classification: TableRowClassification['classification'];
    if (conflictAlias || conflictStatus) {
      classification = 'conflicting';
    } else if (matchedAlias && hasAllowedStatus) {
      classification = 'matched';
    } else {
      classification = 'ambiguous';
    }

    const row: TableRowClassification = {
      text,
      supplierMatched: Boolean(matchedAlias),
      matchedAlias: matchedAlias?.raw,
      allowedStatusMatched: Boolean(matchedStatus),
      matchedStatus: matchedStatus?.raw,
      conflictAlias: conflictAlias?.raw,
      conflictStatus: conflictStatus?.raw,
      classification,
      reasons,
    };

    if (classification === 'matched') matchedRows.push(row);
    else if (classification === 'conflicting') conflictingRows.push(row);
    else ambiguousRows.push(row);
  }

  const aliasSummary = aliases.map((alias) => ({
    alias,
    matched: aliasMatchedSet.has(alias),
  }));

  return {
    aliases,
    allowedStatuses,
    rowCount: options.rows.length,
    matchedRows,
    ambiguousRows,
    conflictingRows,
    aliasSummary,
  };
}

export function formatVerificationDiagnostics(stage: string, diagnostics: TableVerificationDiagnostics): string {
  const aliasText = diagnostics.aliases.length > 0 ? diagnostics.aliases.join(', ') : '(空)';
  const statusText = diagnostics.allowedStatuses.length > 0 ? diagnostics.allowedStatuses.join(', ') : '(未校验状态)';
  const matchedSamples = diagnostics.matchedRows.slice(0, 3).map((row) => row.text).join(' || ') || '-';
  const ambiguousSamples = diagnostics.ambiguousRows.slice(0, 3).map((row) => row.text).join(' || ') || '-';
  const conflictSamples = diagnostics.conflictingRows.slice(0, 3).map((row) => row.text).join(' || ') || '-';
  return [
    '[' + stage + '] aliases=[' + aliasText + ']',
    'allowedStatuses=[' + statusText + ']',
    'matched=' + diagnostics.matchedRows.length,
    'ambiguous=' + diagnostics.ambiguousRows.length,
    'conflicting=' + diagnostics.conflictingRows.length,
    'matchedSamples=' + matchedSamples,
    'ambiguousSamples=' + ambiguousSamples,
    'conflictingSamples=' + conflictSamples,
  ].join(' | ');
}
