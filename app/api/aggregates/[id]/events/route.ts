import { NextResponse } from 'next/server';
import { getAggregateById } from '@/lib/server/aggregateRepository';
import { listAggregateEvents } from '@/lib/server/aggregateEventRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function GET(request: Request, context: RouteContext) {
  try {
    const aggregate = await getAggregateById(context.params.id);
    if (!aggregate) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const limitRaw = Number.parseInt(searchParams.get('limit') ?? '100', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 100;

    const events = await listAggregateEvents(context.params.id, limit);
    return NextResponse.json(events);
  } catch (error) {
    const message = String(error);
    if (/ventilation_aggregate_events|relation .* does not exist/i.test(message)) {
      return NextResponse.json(
        {
          error:
            'Handelseloggen saknas i Supabase. Kor migrationen 20260319_aggregate_events.sql och prova igen.'
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      { error: `Kunde inte hamta handelselogg: ${message}` },
      { status: 500 }
    );
  }
}
