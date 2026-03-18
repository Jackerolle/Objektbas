import { NextResponse } from 'next/server';
import {
  createEmptyAttributes,
  getMissingRequiredFields,
  isKnownComponentType,
  normalizeAttributes
} from '@/lib/componentSchema';
import { addComponentToAggregate } from '@/lib/server/aggregateRepository';
import { CreateAggregateComponentPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
  };
};

export async function POST(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as CreateAggregateComponentPayload;

    if (!payload.componentType?.trim()) {
      return NextResponse.json({ error: 'Komponenttyp krävs.' }, { status: 400 });
    }

    if (!payload.identifiedValue?.trim()) {
      return NextResponse.json({ error: 'Identifierat värde krävs.' }, { status: 400 });
    }

    if (!isKnownComponentType(payload.componentType)) {
      return NextResponse.json(
        { error: 'Okänd komponenttyp.' },
        { status: 400 }
      );
    }

    const normalizedAttributes = {
      ...createEmptyAttributes(payload.componentType),
      ...normalizeAttributes(payload.attributes)
    };

    const missing = getMissingRequiredFields(
      payload.componentType,
      normalizedAttributes
    );

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Fält saknas för ${payload.componentType}: ${missing
            .map((field) => field.label)
            .join(', ')}.`
        },
        { status: 400 }
      );
    }

    const updated = await addComponentToAggregate(context.params.id, {
      ...payload,
      componentType: payload.componentType,
      identifiedValue: payload.identifiedValue.trim(),
      assembly: payload.assembly?.trim() || undefined,
      subComponent: payload.subComponent?.trim() || undefined,
      attributes: normalizedAttributes
    });

    if (!updated) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte spara komponent: ${String(error)}` },
      { status: 500 }
    );
  }
}
