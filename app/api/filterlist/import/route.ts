import { NextResponse } from 'next/server';
import { parseFilterListWorkbook } from '@/lib/server/importFilterList';
import {
  replaceFilterListRows,
  syncFilterListRowsToAggregates
} from '@/lib/server/filterListRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fil saknas.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const parsed = parseFilterListWorkbook(Buffer.from(bytes));
    const importedRows = await replaceFilterListRows(file.name, parsed.rows);
    const syncResult = await syncFilterListRowsToAggregates(parsed.rows);

    return NextResponse.json({
      sourceFileName: file.name,
      totalRows: parsed.totalRows,
      skippedRows: parsed.skippedRows,
      importedRows,
      columns: parsed.columns,
      warnings: parsed.warnings,
      syncedAggregates: syncResult.syncedAggregates,
      insertedFilterComponents: syncResult.insertedFilterComponents,
      skippedNoObjectMatch: syncResult.skippedNoObjectMatch,
      skippedNoFilterData: syncResult.skippedNoFilterData,
      skippedExistingFilter: syncResult.skippedExistingFilter
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte importera filterlista: ${String(error)}` },
      { status: 500 }
    );
  }
}
