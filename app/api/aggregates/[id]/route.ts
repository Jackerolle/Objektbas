import { NextResponse } from 'next/server';
import {
  deleteAggregateRecord,
  getAggregateById,
  updateAggregateRecord
} from '@/lib/server/aggregateRepository';
import { CreateAggregatePayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

function normalizeSystemPositionId(value: string): string {
  return value
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9]/g, '');
}

function isValidSystemPositionId(value: string): boolean {
  if (!value || value.length < 8 || value.length > 9) {
    return false;
  }

  if (!/^\d{3}[A-Z]{2}\d{3,4}$/.test(value)) {
    return false;
  }

  if (
    /(MANUELL-KRAVS|UNKNOWN|OKAND|GEMINI|QUOTA|RESOURCE|EXHAUSTED|ERROR|HTTP|RATE|GOOGLE|GENERATIVELANGUAGE|API)/.test(
      value
    )
  ) {
    return false;
  }

  return true;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const aggregate = await getAggregateById(context.params.id);

    if (!aggregate) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(aggregate);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte hämta aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as CreateAggregatePayload;

    if (!payload.systemPositionId?.trim()) {
      return NextResponse.json(
        { error: 'Systempositionens ID krävs.' },
        { status: 400 }
      );
    }

    const normalizedId = normalizeSystemPositionId(payload.systemPositionId);
    if (!isValidSystemPositionId(normalizedId)) {
      return NextResponse.json(
        {
          error:
            'Ogiltigt systempositions-ID. Kontrollera objektskylten eller mata in ID manuellt.'
        },
        { status: 400 }
      );
    }

    const updated = await updateAggregateRecord(context.params.id, {
      ...payload,
      systemPositionId: normalizedId
    });

    if (!updated) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte uppdatera aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const deleted = await deleteAggregateRecord(context.params.id);
    if (!deleted) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return new Response(null, { status: 204 });
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte ta bort aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}
