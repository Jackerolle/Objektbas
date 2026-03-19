import * as XLSX from 'xlsx';

export type ImportedFilterListRow = {
  rowNumber: number;
  data: Record<string, string>;
  searchText: string;
};

export type ParsedFilterListPayload = {
  columns: string[];
  totalRows: number;
  skippedRows: number;
  warnings: string[];
  rows: ImportedFilterListRow[];
};

function asString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function makeUniqueColumns(columns: string[]): string[] {
  const counters = new Map<string, number>();
  const unique: string[] = [];

  for (const column of columns) {
    const normalized = column || 'Kolumn';
    const seen = counters.get(normalized) ?? 0;
    counters.set(normalized, seen + 1);
    unique.push(seen === 0 ? normalized : `${normalized}_${seen + 1}`);
  }

  return unique;
}

function normalizeHeader(raw: unknown, index: number): string {
  const value = asString(raw);
  if (!value) {
    return `Kolumn ${index + 1}`;
  }

  return value.replace(/\s+/g, ' ').trim();
}

export function parseFilterListWorkbook(buffer: Buffer): ParsedFilterListPayload {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const firstSheetName = workbook.SheetNames[0];

  if (!firstSheetName) {
    throw new Error('Excel-filen innehaller inga blad.');
  }

  const sheet = workbook.Sheets[firstSheetName];
  const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: ''
  });

  if (!matrix.length) {
    throw new Error('Excel-filen ar tom.');
  }

  const headerRow = matrix[0] ?? [];
  const columns = makeUniqueColumns(
    headerRow.map((value, index) => normalizeHeader(value, index))
  );

  const rows: ImportedFilterListRow[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  for (let rowIndex = 1; rowIndex < matrix.length; rowIndex += 1) {
    const row = matrix[rowIndex] ?? [];
    const data: Record<string, string> = {};
    let hasValue = false;

    for (let colIndex = 0; colIndex < columns.length; colIndex += 1) {
      const column = columns[colIndex];
      const value = asString(row[colIndex]);
      data[column] = value;

      if (value) {
        hasValue = true;
      }
    }

    if (!hasValue) {
      skippedRows += 1;
      continue;
    }

    const searchText = columns
      .map((column) => `${column} ${data[column] ?? ''}`)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();

    if (!searchText) {
      skippedRows += 1;
      warnings.push(`Rad ${rowIndex + 1}: kunde inte skapa soktext.`);
      continue;
    }

    rows.push({
      rowNumber: rowIndex + 1,
      data,
      searchText
    });
  }

  return {
    columns,
    totalRows: Math.max(0, matrix.length - 1),
    skippedRows,
    warnings,
    rows
  };
}
