import { NextResponse } from 'next/server';
import {
  createObservationRecord,
  listObservations
} from '@/lib/server/objectRepository';
import { ObservationPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const records = await listObservations();
    return NextResponse.json(records);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte hamta observationer: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const payload = (await request.json()) as ObservationPayload;

    if (!payload.objectId?.trim()) {
      return NextResponse.json({ error: 'objectId kravs.' }, { status: 400 });
    }

    const created = await createObservationRecord({
      objectId: payload.objectId.trim(),
      notes: payload.notes ?? '',
      imageDataUrl: payload.imageDataUrl,
      timestamp: payload.timestamp || new Date().toISOString()
    });

    return NextResponse.json(created, { status: 201 });
  } catch (error) {
    const message = String(error);
    const isNotFound = message.toLowerCase().includes('saknas');
    return NextResponse.json(
      { error: `Kunde inte skapa observation: ${message}` },
      { status: isNotFound ? 400 : 500 }
    );
  }
}
