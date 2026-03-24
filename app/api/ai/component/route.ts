import { NextResponse } from 'next/server';
import { analyzeComponentWithOpenAi } from '@/lib/server/openai';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      componentType?: string;
      imageDataUrl?: string;
    };

    if (!body.componentType?.trim() || !body.imageDataUrl?.trim()) {
      return NextResponse.json(
        { error: 'Komponenttyp och bild krävs.' },
        { status: 400 }
      );
    }

    const result = await analyzeComponentWithOpenAi(
      body.componentType,
      body.imageDataUrl
    );

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte analysera komponentbild: ${String(error)}` },
      { status: 500 }
    );
  }
}
