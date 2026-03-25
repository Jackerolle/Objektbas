import { NextResponse } from 'next/server';
import { createRound, listRounds } from '@/lib/server/roundRepository';
import { CreateRoundPayload, RoundStatus } from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function formatRoundError(error: unknown, fallback: string): string {
  const message = String(error);
  if (message.includes('ventilation_rounds')) {
    return 'Ronderingstabellerna saknas i Supabase. Kör migrationen 20260325_rounds_history.sql och prova igen.';
  }

  return `${fallback}: ${message}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? '';
    const department = searchParams.get('department') ?? '';
    const rawStatus = searchParams.get('status') ?? '';
    const status =
      rawStatus === 'ongoing' || rawStatus === 'completed'
        ? (rawStatus as RoundStatus)
        : '';

    const rounds = await listRounds({ query, department, status });
    return NextResponse.json(rounds);
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte hämta ronderingar') },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CreateRoundPayload;
    const created = await createRound(payload);
    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: formatRoundError(error, 'Kunde inte skapa rondering') },
      { status: 500 }
    );
  }
}
