import { NextResponse } from 'next/server';
import { analyzeComponentWithGemini } from '@/lib/server/gemini';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      componentType?: string;
      imageDataUrl?: string;
    };

    if (!body.componentType?.trim() || !body.imageDataUrl?.trim()) {
      return NextResponse.json(
        { error: 'Komponenttyp och bild kravs.' },
        { status: 400 }
      );
    }

    const result = await analyzeComponentWithGemini(
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
