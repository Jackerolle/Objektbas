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

function countNonEmptyCells(row: unknown[] | undefined): number {
  if (!row?.length) {
    return 0;
  }

  let count = 0;
  for (const cell of row) {
    if (asString(cell)) {
      count += 1;
    }
  }

  return count;
}

type ParsedSheetCandidate = ParsedFilterListPayload & {
  headerIndex: number;
  headerNonEmptyCells: number;
};

function parseMatrixFromHeader(
  matrix: unknown[][],
  headerIndex: number
): ParsedSheetCandidate {
  const headerRow = matrix[headerIndex] ?? [];
  const maxColumnCount = Math.max(
    headerRow.length,
    ...matrix.slice(headerIndex + 1).map((row) => (row ?? []).length),
    1
  );

  const columns = makeUniqueColumns(
    Array.from({ length: maxColumnCount }, (_, index) =>
      normalizeHeader(headerRow[index], index)
    )
  );

  const rows: ImportedFilterListRow[] = [];
  const warnings: string[] = [];
  let skippedRows = 0;

  for (let rowIndex = headerIndex + 1; rowIndex < matrix.length; rowIndex += 1) {
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
    totalRows: Math.max(0, matrix.length - (headerIndex + 1)),
    skippedRows,
    warnings,
    rows,
    headerIndex,
    headerNonEmptyCells: countNonEmptyCells(headerRow)
  };
}

export function parseFilterListWorkbook(buffer: Buffer): ParsedFilterListPayload {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  if (!workbook.SheetNames.length) {
    throw new Error('Excel-filen innehaller inga blad.');
  }

  const parseSheet = (sheetName: string): ParsedFilterListPayload => {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      return {
        columns: [],
        totalRows: 0,
        skippedRows: 0,
        warnings: [`Blad "${sheetName}" kunde inte lasas.`],
        rows: []
      };
    }

    const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: '',
      raw: false,
      blankrows: true
    });

    if (!matrix.length) {
      return {
        columns: [],
        totalRows: 0,
        skippedRows: 0,
        warnings: [],
        rows: []
      };
    }

    const nonEmptyRowIndexes = matrix
      .map((row, index) => ({ index, nonEmpty: countNonEmptyCells(row ?? []) }))
      .filter((entry) => entry.nonEmpty > 0);

    if (!nonEmptyRowIndexes.length) {
      return {
        columns: [],
        totalRows: 0,
        skippedRows: 0,
        warnings: [],
        rows: []
      };
    }

    const firstNonEmptyHeaderIndex = nonEmptyRowIndexes[0].index;
    const richestHeaderIndex = nonEmptyRowIndexes.reduce((best, current) =>
      current.nonEmpty > best.nonEmpty ? current : best
    ).index;

    const headerCandidates = new Set<number>();
    headerCandidates.add(firstNonEmptyHeaderIndex);
    headerCandidates.add(richestHeaderIndex);

    for (const candidate of nonEmptyRowIndexes.slice(0, 40)) {
      if (candidate.nonEmpty >= 2) {
        headerCandidates.add(candidate.index);
      }
    }

    const candidateResults = Array.from(headerCandidates).map((headerIndex) =>
      parseMatrixFromHeader(matrix, headerIndex)
    );

    const bestCandidate = candidateResults.sort((a, b) => {
      const byRows = b.rows.length - a.rows.length;
      if (byRows !== 0) {
        return byRows;
      }

      const byHeaderWidth = b.headerNonEmptyCells - a.headerNonEmptyCells;
      if (byHeaderWidth !== 0) {
        return byHeaderWidth;
      }

      return a.skippedRows - b.skippedRows;
    })[0];

    if (!bestCandidate) {
      return {
        columns: [],
        totalRows: 0,
        skippedRows: 0,
        warnings: [],
        rows: []
      };
    }

    const warnings = [...bestCandidate.warnings];
    if (bestCandidate.headerIndex !== firstNonEmptyHeaderIndex) {
      warnings.unshift(
        `Rubrikrad autodetekterad till rad ${bestCandidate.headerIndex + 1}.`
      );
    }

    return {
      columns: bestCandidate.columns,
      totalRows: bestCandidate.totalRows,
      skippedRows: bestCandidate.skippedRows,
      warnings,
      rows: bestCandidate.rows
    };
  };

  const parsedSheets = workbook.SheetNames.map((sheetName) => ({
    sheetName,
    payload: parseSheet(sheetName)
  }));

  const best = parsedSheets.sort((a, b) => {
    const byRows = b.payload.rows.length - a.payload.rows.length;
    if (byRows !== 0) {
      return byRows;
    }
    return b.payload.totalRows - a.payload.totalRows;
  })[0];

  if (!best) {
    throw new Error('Excel-filen kunde inte tolkas.');
  }

  const warnings = [...best.payload.warnings];
  if (best.sheetName !== workbook.SheetNames[0]) {
    warnings.unshift(
      `Importerade blad "${best.sheetName}" (valde bladet med mest data).`
    );
  }

  return {
    ...best.payload,
    warnings
  };
}
