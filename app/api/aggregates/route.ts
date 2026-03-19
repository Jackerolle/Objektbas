import { NextResponse } from 'next/server';
import {
  createAggregateRecord,
  listAggregates
} from '@/lib/server/aggregateRepository';
import { CreateAggregatePayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

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
        { error: 'AG-systempositionens ID krävs.' },
        { status: 400 }
      );
    }

    const created = await createAggregateRecord({
      ...payload,
      systemPositionId: payload.systemPositionId.trim()
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte skapa aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}
