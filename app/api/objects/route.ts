import { NextResponse } from 'next/server';
import { createObjectRecord, listObjects } from '@/lib/server/objectRepository';

export const dynamic = 'force-dynamic';

type CreateObjectRequest = {
  name?: string;
  category?: string;
  location?: string;
  tags?: string[];
};

export async function GET() {
  try {
    const records = await listObjects();
    return NextResponse.json(records);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte hämta objekt: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as CreateObjectRequest;

    if (!payload.name?.trim()) {
      return NextResponse.json({ error: 'Namn krävs.' }, { status: 400 });
    }

    const created = await createObjectRecord({
      name: payload.name.trim(),
      category: payload.category?.trim() || 'Okänd',
      location: payload.location?.trim() || 'Okänd',
      tags: Array.isArray(payload.tags) ? payload.tags.filter(Boolean) : []
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte skapa objekt: ${String(error)}` },
      { status: 500 }
    );
  }
}
