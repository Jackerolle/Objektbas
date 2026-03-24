import { NextResponse } from 'next/server';
import {
  listFilterListRows,
  repairAutoFilterRows
} from '@/lib/server/filterListRepository';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get('query') ?? '';
    const limitRaw = Number.parseInt(searchParams.get('limit') ?? '1000', 10);
    const limit = Number.isFinite(limitRaw) ? limitRaw : 1000;

    const result = await listFilterListRows(query, limit);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte hamta filterlista: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST() {
  try {
    const result = await repairAutoFilterRows();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte stada auto-rader i filterlista: ${String(error)}` },
      { status: 500 }
    );
  }
}
