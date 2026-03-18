import { NextResponse } from 'next/server';
import { getAggregateById } from '@/lib/server/aggregateRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(_request: Request, context: RouteContext) {
  try {
    const aggregate = await getAggregateById(context.params.id);

    if (!aggregate) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(aggregate);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte hamta aggregat: ${String(error)}` },
      { status: 500 }
    );
  }
}
