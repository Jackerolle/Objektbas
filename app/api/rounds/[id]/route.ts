import { NextResponse } from 'next/server';
import { deleteRound, getRoundById, updateRound } from '@/lib/server/roundRepository';
import { UpdateRoundPayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

function formatRoundError(error: unknown, fallback: string): string {
  const message = String(error);
  if (message.includes('ventilation_rounds')) {
    return 'Ronderingstabellerna saknas i Supabase. Kör migrationen 20260325_rounds_history.sql och prova igen.';
  }

  return `${fallback}: ${message}`;
}

export async function GET(_request: Request, context: RouteContext) {
  try {
    const round = await getRoundById(context.params.id);
    if (!round) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(round);
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte hämta rondering') },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as UpdateRoundPayload;
    const updated = await updateRound(context.params.id, payload);
    if (!updated) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte uppdatera rondering') },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    await deleteRound(context.params.id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte ta bort rondering') },
      { status: 500 }
    );
  }
}
