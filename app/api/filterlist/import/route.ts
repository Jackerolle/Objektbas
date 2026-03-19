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

    if (!file.size) {
      return NextResponse.json({ error: 'Filen ar tom.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const parsed = parseFilterListWorkbook(Buffer.from(bytes));
    const importedRows = await replaceFilterListRows(file.name, parsed.rows);
    let syncResult = {
      syncedAggregates: 0,
      insertedFilterComponents: 0,
      skippedNoObjectMatch: 0,
      skippedNoFilterData: 0,
      skippedExistingFilter: 0
    };
    const warnings = [...parsed.warnings];

    try {
      syncResult = await syncFilterListRowsToAggregates(parsed.rows);
    } catch (syncError) {
      const syncMessage = String(syncError).replace(/\s+/g, ' ').trim();
      warnings.push(
        `Filterlista importerad, men auto-synk till aggregat misslyckades: ${syncMessage.slice(0, 220)}`
      );
      console.warn('Auto-synk av filterlista misslyckades', syncError);
    }

    return NextResponse.json({
      sourceFileName: file.name,
      totalRows: parsed.totalRows,
      skippedRows: parsed.skippedRows,
      importedRows,
      columns: parsed.columns,
      warnings,
      syncedAggregates: syncResult.syncedAggregates,
      insertedFilterComponents: syncResult.insertedFilterComponents,
      skippedNoObjectMatch: syncResult.skippedNoObjectMatch,
      skippedNoFilterData: syncResult.skippedNoFilterData,
      skippedExistingFilter: syncResult.skippedExistingFilter
    });
  } catch (error) {
    const message = String(error);
    if (/ventilation_filter_list_rows|relation .* does not exist/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'Filterlista-tabellen saknas i Supabase. Kor migrationen 20260319_filter_list_rows.sql och prova igen.'
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: `Kunde inte importera filterlista: ${message}` },
      { status: 500 }
    );
  }
}
