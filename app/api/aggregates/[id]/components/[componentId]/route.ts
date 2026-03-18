import { NextResponse } from 'next/server';
import {
  createEmptyAttributes,
  getMissingRequiredFields,
  normalizeAttributes,
  resolveComponentType
} from '@/lib/componentSchema';
import {
  deleteComponentFromAggregate,
  updateComponentInAggregate
} from '@/lib/server/aggregateRepository';
import { CreateAggregateComponentPayload } from '@/lib/types';

export const dynamic = 'force-dynamic';

type RouteContext = {
  params: {
    id: string;
    componentId: string;
  };
};

export async function PATCH(request: Request, context: RouteContext) {
  try {
    const payload = (await request.json()) as CreateAggregateComponentPayload;

    if (!payload.componentType?.trim()) {
      return NextResponse.json({ error: 'Komponenttyp kravs.' }, { status: 400 });
    }

    if (!payload.identifiedValue?.trim()) {
      return NextResponse.json({ error: 'Identifierat varde kravs.' }, { status: 400 });
    }

    const resolvedComponentType = resolveComponentType(payload.componentType);
    if (!resolvedComponentType) {
      return NextResponse.json({ error: 'Okand komponenttyp.' }, { status: 400 });
    }

    const normalizedAttributes = {
      ...createEmptyAttributes(resolvedComponentType),
      ...normalizeAttributes(payload.attributes)
    };

    const missing = getMissingRequiredFields(
      resolvedComponentType,
      normalizedAttributes
    );

    if (missing.length > 0) {
      return NextResponse.json(
        {
          error: `Falt saknas for ${resolvedComponentType}: ${missing
            .map((field) => field.label)
            .join(', ')}.`
        },
        { status: 400 }
      );
    }

    const updated = await updateComponentInAggregate(
      context.params.id,
      context.params.componentId,
      {
        ...payload,
        componentType: resolvedComponentType,
        identifiedValue: payload.identifiedValue.trim(),
        assembly: payload.assembly?.trim() || undefined,
        subComponent: payload.subComponent?.trim() || undefined,
        attributes: normalizedAttributes
      }
    );

    if (!updated) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte uppdatera komponent: ${String(error)}` },
      { status: 500 }
    );
  }
}

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const updated = await deleteComponentFromAggregate(
      context.params.id,
      context.params.componentId
    );

    if (!updated) {
      return NextResponse.json({ error: 'Hittades inte.' }, { status: 404 });
    }

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      { error: `Kunde inte ta bort komponent: ${String(error)}` },
      { status: 500 }
    );
  }
}