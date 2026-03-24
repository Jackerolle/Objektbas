import { NextResponse } from 'next/server';
import { analyzeSystemPositionWithOpenAi } from '@/lib/server/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as { imageDataUrl?: string };

    if (!body.imageDataUrl?.trim()) {
      return NextResponse.json({ error: 'Bild saknas.' }, { status: 400 });
    }

    const result = await analyzeSystemPositionWithOpenAi(body.imageDataUrl);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte analysera systemposition: ${String(error)}` },
      { status: 500 }
    );
  }
}
