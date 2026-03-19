import { NextResponse } from 'next/server';
import {
  createAggregateRecord,
  listAggregates
} from '@/lib/server/aggregateRepository';
import { CreateAggregatePayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? '';

    const results = await listAggregates(query);
    return NextResponse.json(results);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte hämta aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
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

    const created = await createAggregateRecord({
      ...payload,
      systemPositionId: normalizedId
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte skapa aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}
