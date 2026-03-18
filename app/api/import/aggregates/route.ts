import { NextResponse } from 'next/server';
import {
  addComponentToAggregate,
  createAggregateRecord,
  findLatestAggregateBySystemPositionId,
  updateAggregateMetadata
} from '@/lib/server/aggregateRepository';
import { parseAggregateWorkbook } from '@/lib/server/importAggregates';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const dryRun =
      searchParams.get('dryRun')?.toLowerCase() === 'true' ||
      searchParams.get('preview')?.toLowerCase() === 'true';

    const formData = await request.formData();
    const file = formData.get('file');

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'Fil saknas.' }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const payload = parseAggregateWorkbook(Buffer.from(bytes));

    const parsedComponents = payload.aggregates.reduce(
      (sum, aggregate) => sum + aggregate.components.length,
      0
    );

    if (dryRun) {
      return NextResponse.json({
        totalRows: payload.totalRows,
        skippedRows: payload.skippedRows,
        parsedAggregates: payload.aggregates.length,
        parsedComponents,
        warnings: payload.warnings,
        previewAggregates: payload.aggregates.slice(0, 50).map((aggregate) => ({
          systemPositionId: aggregate.systemPositionId,
          position: aggregate.position,
          department: aggregate.department,
          notes: aggregate.notes,
          componentsCount: aggregate.components.length,
          sampleComponents: aggregate.components.slice(0, 5)
        }))
      });
    }

    let createdAggregates = 0;
    let updatedAggregates = 0;
    let importedComponents = 0;

    for (const aggregate of payload.aggregates) {
      let target = await findLatestAggregateBySystemPositionId(
        aggregate.systemPositionId
      );

      if (!target) {
        target = await createAggregateRecord({
          systemPositionId: aggregate.systemPositionId,
          position: aggregate.position,
          department: aggregate.department,
          notes: aggregate.notes
        });
        createdAggregates += 1;
      } else {
        const updated = await updateAggregateMetadata(target.id, {
          position: aggregate.position,
          department: aggregate.department,
          notes: aggregate.notes
        });

        if (updated) {
          target = updated;
        }

        updatedAggregates += 1;
      }

      for (const component of aggregate.components) {
        const updated = await addComponentToAggregate(target.id, {
          componentType: component.componentType,
          identifiedValue: component.identifiedValue,
          notes: component.notes,
          attributes: component.attributes
        });

        if (updated) {
          importedComponents += 1;
        }
      }
    }

    return NextResponse.json({
      totalRows: payload.totalRows,
      importedAggregates: payload.aggregates.length,
      createdAggregates,
      updatedAggregates,
      importedComponents,
      skippedRows: payload.skippedRows,
      warnings: payload.warnings
    });
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte importera filen: ${String(error)}` },
      { status: 500 }
    );
  }
}
