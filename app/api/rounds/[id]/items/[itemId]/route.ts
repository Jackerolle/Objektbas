import { NextResponse } from 'next/server';
import { deleteRoundItem, updateRoundItem } from '@/lib/server/roundRepository';
import { RoundSeverity, UpdateRoundItemPayload } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
    itemId: string;
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

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as UpdateRoundItemPayload;
    if (
      Object.prototype.hasOwnProperty.call(payload, 'severity') &&
      !isValidSeverity(payload.severity)
    ) {
      return NextResponse.json({ error: 'Ogiltig prioritet.' }, { status: 400 });
    }

    const updatedRound = await updateRoundItem(
      context.params.id,
      context.params.itemId,
      payload
    );

    if (!updatedRound) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updatedRound);
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte uppdatera ronderingspunkt') },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const updatedRound = await deleteRoundItem(context.params.id, context.params.itemId);
    if (!updatedRound) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updatedRound);
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte ta bort ronderingspunkt') },
      { status: 500 }
    );
  }
}
