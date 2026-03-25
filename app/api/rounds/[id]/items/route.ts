import { NextResponse } from 'next/server';
import { createRoundItem } from '@/lib/server/roundRepository';
import { CreateRoundItemPayload, RoundSeverity } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

function formatRoundError(error: unknown, fallback: string): string {
  const message = String(error);
  if (
    message.includes('ventilation_rounds') ||
    message.includes('ventilation_round_items')
  ) {
    return 'Ronderingstabellerna saknas i Supabase. Kör migrationen 20260325_rounds_history.sql och prova igen.';
  }

  return `${fallback}: ${message}`;
}

function isValidSeverity(value: string | undefined): value is RoundSeverity {
  return value === 'info' || value === 'atgard' || value === 'akut';
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as CreateRoundItemPayload;

    if (!payload.systemPositionId?.trim()) {
      return NextResponse.json({ error: 'Systemposition krävs.' }, { status: 400 });
    }
    if (!payload.title?.trim()) {
      return NextResponse.json({ error: 'Rubrik krävs.' }, { status: 400 });
    }
    if (!payload.observation?.trim()) {
      return NextResponse.json({ error: 'Observation krävs.' }, { status: 400 });
    }
    if (!payload.recommendedAction?.trim()) {
      return NextResponse.json(
        { error: 'Rekommenderad åtgärd krävs.' },
        { status: 400 }
      );
    }
    if (!isValidSeverity(payload.severity)) {
      return NextResponse.json({ error: 'Ogiltig prioritet.' }, { status: 400 });
    }

    const updatedRound = await createRoundItem(context.params.id, payload);
    if (!updatedRound) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updatedRound, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte skapa ronderingspunkt') },
      { status: 500 }
    );
  }
}
