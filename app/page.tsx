'use client';

import { CameraCapture } from '@/components/CameraCapture';
import {
  addAggregateComponent,
  analyzeComponentImage,
  analyzeSystemPosition,
  createAggregate,
  importAggregatesFile,
  previewAggregatesFile,
  searchAggregates
} from '@/lib/api';
import {
  COMPONENT_FIELD_CONFIG,
  createEmptyAttributes,
  getMissingRequiredFields
} from '@/lib/componentSchema';
import {
  AggregateRecord,
  AppMode,
  ComponentAnalysis,
  ComponentType,
  ImportAggregatesResult,
  ImportPreviewResult,
  SystemPositionAnalysis
} from '@/lib/types';
import { useState } from 'react';

type MainCategory = 'Aggregat' | 'Motor' | 'Fl\u00e4kt' | '\u00d6vrigt';

type SubCategoryOption = {
  label: string;
  componentType: ComponentType;
};

const SUBCATEGORY_BY_MAIN: Record<MainCategory, SubCategoryOption[]> = {
  Aggregat: [
    { label: 'Kilrem', componentType: 'Kilrem' },
    { label: 'Filter', componentType: 'Filter' },
    { label: 'Kolfilter', componentType: 'Kolfilter' }
  ],
  Motor: [
    { label: 'Motorskylt', componentType: 'Motorskylt' },
    { label: 'Remskiva', componentType: 'Remskiva' },
    { label: 'Bussning', componentType: 'Bussning' },
    { label: 'Axeldiameter', componentType: 'Axeldiameter' },
    { label: 'Lager', componentType: 'Lager' }
  ],
  'Fl\u00e4kt': [
    { label: 'Remskiva', componentType: 'Remskiva' },
    { label: 'Bussning', componentType: 'Bussning' },
    { label: 'Axeldiameter', componentType: 'Axeldiameter' },
    { label: 'Lager', componentType: 'Lager' }
  ],
  '\u00d6vrigt': [{ label: 'Notering', componentType: '\u00d6vrigt' }]
};

const MULTI_VALUE_TYPES = new Set<ComponentType>([
  'Filter',
  'Kolfilter',
  '\u00d6vrigt'
]);

const MAIN_CATEGORY_OPTIONS = Object.keys(
  SUBCATEGORY_BY_MAIN
) as MainCategory[];

function splitLines(value: string): string[] {
  return value
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

function buildDefaultValue(
  componentType: ComponentType,
  typedValue: string,
  attributes: Record<string, string>
): string {
  const direct = typedValue.trim();
  if (direct) {
    return direct;
  }

  if (componentType === 'Lager') {
    const front = attributes.lagerFram?.trim();
    const back = attributes.lagerBak?.trim();
    if (front && back) {
      return `Fram: ${front}, Bak: ${back}`;
    }
    if (front) {
      return front;
    }
    if (back) {
      return back;
    }
  }

  if (componentType === 'Remskiva' && attributes.remskivaNamn?.trim()) {
    return attributes.remskivaNamn.trim();
  }

  if (componentType === 'Bussning' && attributes.bussningStorlek?.trim()) {
    return attributes.bussningStorlek.trim();
  }

  if (componentType === 'Axeldiameter' && attributes.axeldiameterMm?.trim()) {
    return `${attributes.axeldiameterMm.trim()} mm`;
  }

  if (componentType === 'Motorskylt' && attributes.motorModell?.trim()) {
    return attributes.motorModell.trim();
  }

  if (
    (componentType === 'Filter' || componentType === 'Kolfilter') &&
    attributes.filterNamn?.trim()
  ) {
    return attributes.filterNamn.trim();
  }

  return '';
}

function toPercent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

export default function HomePage() {
  const [mode, setMode] = useState<AppMode>('lagg-till');

  const [systemPositionImage, setSystemPositionImage] = useState<string | null>(null);
  const [systemPositionId, setSystemPositionId] = useState('');
  const [position, setPosition] = useState('');
  const [department, setDepartment] = useState('');
  const [aggregateNotes, setAggregateNotes] = useState('');
  const [systemAnalysis, setSystemAnalysis] = useState<SystemPositionAnalysis | null>(null);

  const [currentAggregate, setCurrentAggregate] = useState<AggregateRecord | null>(null);
  const [mainCategory, setMainCategory] = useState<MainCategory>('Aggregat');
  const [componentType, setComponentType] = useState<ComponentType>('Kilrem');
  const [componentValue, setComponentValue] = useState('');
  const [multiValueInput, setMultiValueInput] = useState('');
  const [componentAttributes, setComponentAttributes] = useState<Record<string, string>>(
    () => createEmptyAttributes('Kilrem')
  );
  const [componentNotes, setComponentNotes] = useState('');
  const [componentAnalysis, setComponentAnalysis] = useState<ComponentAnalysis | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<AggregateRecord[]>([]);
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<ImportPreviewResult | null>(null);
  const [importResult, setImportResult] = useState<ImportAggregatesResult | null>(null);
  const [importPreviewFingerprint, setImportPreviewFingerprint] = useState<string | null>(null);

  const [isAnalyzingSystem, setIsAnalyzingSystem] = useState(false);
  const [isCreatingAggregate, setIsCreatingAggregate] = useState(false);
  const [isAnalyzingComponent, setIsAnalyzingComponent] = useState(false);
  const [isSavingComponent, setIsSavingComponent] = useState(false);
  const [isSearching, setIsSearching] = useState(false);
  const [isPreviewingImport, setIsPreviewingImport] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>('');

  const clearStatus = () => {
    setError(null);
    setStatus('');
  };

  const getImportFingerprint = (file: File) =>
    `${file.name}:${file.size}:${file.lastModified}`;

  const subCategoryOptions = SUBCATEGORY_BY_MAIN[mainCategory];
  const selectedSubCategory =
    subCategoryOptions.find((option) => option.componentType === componentType) ??
    subCategoryOptions[0];
  const selectedComponentType = selectedSubCategory.componentType;
  const isMultiValueType = MULTI_VALUE_TYPES.has(selectedComponentType);

  const handleSystemCapture = async (imageDataUrl: string) => {
    clearStatus();
    setSystemPositionImage(imageDataUrl);
    setIsAnalyzingSystem(true);

    try {
      const analysis = await analyzeSystemPosition(imageDataUrl);
      setSystemAnalysis(analysis);
      setSystemPositionId(analysis.systemPositionId || '');
      setStatus('Systemposition analyserad. Bekrafta ID innan du sparar.');
    } catch (captureError) {
      setError(`Kunde inte analysera systemposition: ${String(captureError)}`);
    } finally {
      setIsAnalyzingSystem(false);
    }
  };

  const handleCreateAggregate = async () => {
    clearStatus();

    if (!systemPositionId.trim()) {
      setError('Systempositionens ID maste anges innan du kan spara aggregatet.');
      return;
    }

    setIsCreatingAggregate(true);

    try {
      const aggregate = await createAggregate({
        systemPositionId: systemPositionId.trim(),
        position: position.trim() || undefined,
        department: department.trim() || undefined,
        notes: aggregateNotes.trim() || undefined,
        systemPositionImageDataUrl: systemPositionImage || undefined
      });

      setCurrentAggregate(aggregate);
      setComponentValue('');
      setMultiValueInput('');
      setComponentNotes('');
      setComponentAnalysis(null);
      setComponentAttributes(createEmptyAttributes(selectedComponentType));
      setStatus(`Aggregat ${aggregate.systemPositionId} skapades. Nu kan du lagga till komponenter.`);
    } catch (createError) {
      setError(`Kunde inte skapa aggregat: ${String(createError)}`);
    } finally {
      setIsCreatingAggregate(false);
    }
  };

  const handleComponentCapture = async (imageDataUrl: string) => {
    clearStatus();

    if (!currentAggregate) {
      setError('Skapa aggregatet forst innan du lagger till komponenter.');
      return;
    }

    setIsAnalyzingComponent(true);

    try {
      const analysis = await analyzeComponentImage(selectedComponentType, imageDataUrl);
      setComponentAnalysis(analysis);
      setComponentValue(analysis.identifiedValue || '');
      setComponentAttributes((current) => ({
        ...createEmptyAttributes(selectedComponentType),
        ...current,
        ...analysis.suggestedAttributes
      }));
      setStatus('Komponent analyserad. Bekrafta eller justera faltet innan sparning.');
    } catch (analysisError) {
      setError(`Kunde inte analysera komponenten: ${String(analysisError)}`);
    } finally {
      setIsAnalyzingComponent(false);
    }
  };

  const handleSaveComponent = async () => {
    clearStatus();

    if (!currentAggregate) {
      setError('Inget aggregat ar valt.');
      return;
    }

    const defaultValue = buildDefaultValue(
      selectedComponentType,
      componentValue,
      componentAttributes
    );
    const valuesToSave = [
      defaultValue,
      ...(isMultiValueType ? splitLines(multiValueInput) : [])
    ].filter(Boolean);

    if (valuesToSave.length === 0) {
      setError('Komponentvarde maste fyllas i innan sparning.');
      return;
    }

    const missingAttributeLabels = getMissingRequiredFields(
      selectedComponentType,
      componentAttributes
    ).map((field) => field.label);

    if (missingAttributeLabels.length > 0) {
      setError(`Fyll i obligatoriska falt: ${missingAttributeLabels.join(', ')}.`);
      return;
    }

    setIsSavingComponent(true);

    try {
      let updated = currentAggregate;
      for (const identifiedValue of valuesToSave) {
        updated = await addAggregateComponent(updated.id, {
          componentType: selectedComponentType,
          identifiedValue,
          notes: componentNotes.trim() || undefined,
          assembly: mainCategory,
          subComponent: selectedSubCategory.label,
          attributes: componentAttributes
        });
      }

      setCurrentAggregate(updated);
      setComponentValue('');
      setMultiValueInput('');
      setComponentAttributes(createEmptyAttributes(selectedComponentType));
      setComponentNotes('');
      setComponentAnalysis(null);
      setStatus(
        `${valuesToSave.length} post(er) sparade under ${mainCategory} / ${selectedSubCategory.label}.`
      );
    } catch (saveError) {
      setError(`Kunde inte spara komponent: ${String(saveError)}`);
    } finally {
      setIsSavingComponent(false);
    }
  };

  const handleSearch = async (queryOverride?: string) => {
    clearStatus();
    setIsSearching(true);

    try {
      const query = queryOverride ?? searchQuery;
      const results = await searchAggregates(query);
      setSearchResults(results);
      setStatus(`${results.length} resultat hittades.`);
    } catch (searchError) {
      setError(`Kunde inte hamta resultat: ${String(searchError)}`);
    } finally {
      setIsSearching(false);
    }
  };

  const handleDownloadTemplate = () => {
    const csv = [
      'systemPositionId,position,department,notes,componentType,identifiedValue,componentNotes,attr_profil,attr_langd,attr_antal',
      'VP-1001,Takplan 2,Produktion,Importerad post,Kilrep,SPA 1180,Bytt i januari,SPA,1180,2',
      'VP-1001,Takplan 2,Produktion,Importerad post,Filter,F7 595x595x48,Kontrollerad,,,'
    ].join('\\n');

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'aggregat-import-template.csv';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const handlePreviewImport = async () => {
    clearStatus();

    if (!importFile) {
      setError('Valj en Excel- eller CSV-fil for forhandsgranskning.');
      return;
    }

    setIsPreviewingImport(true);

    try {
      const preview = await previewAggregatesFile(importFile);
      setImportPreview(preview);
      setImportPreviewFingerprint(getImportFingerprint(importFile));
      setImportResult(null);
      setStatus(
        `Forhandsgranskning klar: ${preview.parsedAggregates} aggregat och ${preview.parsedComponents} komponenter hittades.`
      );
    } catch (previewError) {
      setError(`Kunde inte forhandsgranska filen: ${String(previewError)}`);
    } finally {
      setIsPreviewingImport(false);
    }
  };

  const handleImport = async () => {
    clearStatus();

    if (!importFile) {
      setError('Valj en Excel- eller CSV-fil for import.');
      return;
    }

    if (importPreviewFingerprint !== getImportFingerprint(importFile)) {
      setError('Kor forhandsgranskning pa den valda filen innan import.');
      return;
    }

    setIsImporting(true);

    try {
      const result = await importAggregatesFile(importFile);
      setImportResult(result);
      setStatus(
        `Import klar: ${result.importedAggregates} aggregat och ${result.importedComponents} komponenter.`
      );
    } catch (importError) {
      setError(`Kunde inte importera filen: ${String(importError)}`);
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <main
      style={{
        padding: '1.25rem',
        maxWidth: '1200px',
        margin: '0 auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem'
      }}
    >
      <header>
        <p
          style={{
            margin: 0,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '0.1em',
            fontSize: '0.75rem'
          }}
        >
          Objektbas
        </p>
        <h1 style={{ marginTop: '0.25rem', marginBottom: '0.35rem' }}>
          Ventilation - registrering och sok
        </h1>
        <p style={{ margin: 0, color: '#cbd5f5' }}>
          Fota systempositionen, bekrafta AI-forslag, lagg till komponentdata och sok tidigare poster.
        </p>
      </header>

      <section style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
        <button
          onClick={() => setMode('lagg-till')}
          style={{
            borderRadius: '999px',
            border: mode === 'lagg-till' ? '1px solid #60a5fa' : '1px solid rgba(148,163,184,0.3)',
            background: mode === 'lagg-till' ? 'rgba(37,99,235,0.25)' : 'transparent',
            color: '#f8fafc',
            padding: '0.55rem 1rem',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Lagg till
        </button>
        <button
          onClick={() => {
            setMode('sok');
            void handleSearch('');
          }}
          style={{
            borderRadius: '999px',
            border: mode === 'sok' ? '1px solid #60a5fa' : '1px solid rgba(148,163,184,0.3)',
            background: mode === 'sok' ? 'rgba(37,99,235,0.25)' : 'transparent',
            color: '#f8fafc',
            padding: '0.55rem 1rem',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Sok
        </button>
        <button
          onClick={() => setMode('importera')}
          style={{
            borderRadius: '999px',
            border: mode === 'importera' ? '1px solid #60a5fa' : '1px solid rgba(148,163,184,0.3)',
            background: mode === 'importera' ? 'rgba(37,99,235,0.25)' : 'transparent',
            color: '#f8fafc',
            padding: '0.55rem 1rem',
            cursor: 'pointer',
            fontWeight: 600
          }}
        >
          Importera
        </button>
      </section>

      {error && (
        <p style={{ margin: 0, color: '#fb7185', fontWeight: 600 }}>
          {error}
        </p>
      )}
      {status && (
        <p style={{ margin: 0, color: '#93c5fd' }}>
          {status}
        </p>
      )}

      {mode === 'lagg-till' ? (
        <>
          <section
            style={{
              borderRadius: '1rem',
              border: '1px solid rgba(148,163,184,0.25)',
              background: '#0b1120',
              padding: '1rem',
              display: 'grid',
              gap: '1rem',
              gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))'
            }}
          >
            <CameraCapture
              onCapture={handleSystemCapture}
              title='Fota systemposition'
              subtitle='Steg 1 av 2'
              captureLabel='Ta bild pa ID'
            />

            <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <h2 style={{ margin: 0, fontSize: '1rem' }}>Bekrafta systemposition</h2>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Systemposition (ID)
                <input
                  value={systemPositionId}
                  onChange={(event) => setSystemPositionId(event.target.value)}
                  placeholder='Exempel: VP-1024'
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc'
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Position
                <input
                  value={position}
                  onChange={(event) => setPosition(event.target.value)}
                  placeholder='Exempel: Takplan 2'
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc'
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Avdelning
                <input
                  value={department}
                  onChange={(event) => setDepartment(event.target.value)}
                  placeholder='Exempel: Produktion'
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc'
                  }}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                Kommentar
                <textarea
                  value={aggregateNotes}
                  onChange={(event) => setAggregateNotes(event.target.value)}
                  placeholder='Valfri notering'
                  style={{
                    minHeight: '80px',
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(148,163,184,0.4)',
                    padding: '0.65rem',
                    background: '#020617',
                    color: '#f8fafc',
                    resize: 'vertical'
                  }}
                />
              </label>

              {systemAnalysis && (
                <div
                  style={{
                    borderRadius: '0.7rem',
                    border: '1px solid rgba(96,165,250,0.35)',
                    padding: '0.65rem',
                    background: 'rgba(30,64,175,0.15)',
                    fontSize: '0.9rem'
                  }}
                >
                  <p style={{ margin: '0 0 0.25rem' }}>
                    AI-forslag: <strong>{systemAnalysis.systemPositionId || 'Tomt'}</strong> ({toPercent(systemAnalysis.confidence)})
                  </p>
                  <p style={{ margin: 0, color: '#bfdbfe' }}>{systemAnalysis.notes}</p>
                </div>
              )}

              <button
                onClick={handleCreateAggregate}
                disabled={isAnalyzingSystem || isCreatingAggregate}
                style={{
                  marginTop: '0.25rem',
                  borderRadius: '0.75rem',
                  border: 'none',
                  padding: '0.8rem 1rem',
                  background: 'linear-gradient(120deg, #0ea5e9, #2563eb)',
                  color: '#f8fafc',
                  cursor: 'pointer',
                  fontWeight: 700,
                  opacity: isAnalyzingSystem || isCreatingAggregate ? 0.6 : 1
                }}
              >
                {isAnalyzingSystem
                  ? 'Analyserar bild...'
                  : isCreatingAggregate
                  ? 'Sparar aggregat...'
                  : 'Spara och starta aggregat'}
              </button>
            </section>
          </section>

          {currentAggregate && (
            <section
              style={{
                borderRadius: '1rem',
                border: '1px solid rgba(148,163,184,0.25)',
                background: '#0b1120',
                padding: '1rem',
                display: 'grid',
                gap: '1rem',
                gridTemplateColumns: 'repeat(auto-fit, minmax(290px, 1fr))'
              }}
            >
              <CameraCapture
                onCapture={handleComponentCapture}
                title={`Fota ${selectedSubCategory.label.toLowerCase()}`}
                subtitle='Steg 2 av 2'
                captureLabel='Ta komponentbild'
              />

              <section style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>
                  Lagg till komponent pa {currentAggregate.systemPositionId}
                </h2>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  Huvudkategori
                  <select
                    value={mainCategory}
                    onChange={(event) => {
                      const nextMain = event.target.value as MainCategory;
                      const firstSubCategory = SUBCATEGORY_BY_MAIN[nextMain][0];
                      setMainCategory(nextMain);
                      setComponentType(firstSubCategory.componentType);
                      setComponentValue('');
                      setMultiValueInput('');
                      setComponentAttributes(
                        createEmptyAttributes(firstSubCategory.componentType)
                      );
                      setComponentNotes('');
                      setComponentAnalysis(null);
                    }}
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc'
                    }}
                  >
                    {MAIN_CATEGORY_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  Underkategori
                  <select
                    value={selectedComponentType}
                    onChange={(event) => {
                      const next = event.target.value as ComponentType;
                      setComponentType(next);
                      setComponentValue('');
                      setMultiValueInput('');
                      setComponentAttributes(createEmptyAttributes(next));
                      setComponentNotes('');
                      setComponentAnalysis(null);
                    }}
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc'
                    }}
                  >
                    {subCategoryOptions.map((option) => (
                      <option key={`${mainCategory}-${option.label}`} value={option.componentType}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  {selectedComponentType === '\u00d6vrigt' ? 'Notering' : 'Identifierat varde'}
                  <input
                    value={componentValue}
                    onChange={(event) => setComponentValue(event.target.value)}
                    placeholder={
                      selectedComponentType === '\u00d6vrigt'
                        ? 'Skriv en notering'
                        : 'Ex: SPA 1180, C3-lager 6205, F7-595x595'
                    }
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc'
                    }}
                  />
                </label>

                {isMultiValueType && (
                  <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                    Fler poster (en per rad)
                    <textarea
                      value={multiValueInput}
                      onChange={(event) => setMultiValueInput(event.target.value)}
                      placeholder='Ex: Filter 2\\nFilter 3'
                      style={{
                        minHeight: '80px',
                        borderRadius: '0.7rem',
                        border: '1px solid rgba(148,163,184,0.4)',
                        padding: '0.65rem',
                        background: '#020617',
                        color: '#f8fafc',
                        resize: 'vertical'
                      }}
                    />
                  </label>
                )}

                {COMPONENT_FIELD_CONFIG[selectedComponentType].map((field) => (
                  <label
                    key={field.key}
                    style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}
                  >
                    {field.label}
                    <input
                      value={componentAttributes[field.key] ?? ''}
                      onChange={(event) =>
                        setComponentAttributes((current) => ({
                          ...current,
                          [field.key]: event.target.value
                        }))
                      }
                      placeholder={field.placeholder}
                      style={{
                        borderRadius: '0.7rem',
                        border: '1px solid rgba(148,163,184,0.4)',
                        padding: '0.65rem',
                        background: '#020617',
                        color: '#f8fafc'
                      }}
                    />
                  </label>
                ))}

                <label style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', fontSize: '0.9rem' }}>
                  Notering
                  <textarea
                    value={componentNotes}
                    onChange={(event) => setComponentNotes(event.target.value)}
                    placeholder='Valfri notering om komponentens skick eller byte'
                    style={{
                      minHeight: '80px',
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(148,163,184,0.4)',
                      padding: '0.65rem',
                      background: '#020617',
                      color: '#f8fafc',
                      resize: 'vertical'
                    }}
                  />
                </label>

                {componentAnalysis && (
                  <div
                    style={{
                      borderRadius: '0.7rem',
                      border: '1px solid rgba(45,212,191,0.35)',
                      padding: '0.65rem',
                      background: 'rgba(13,148,136,0.12)',
                      fontSize: '0.9rem'
                    }}
                  >
                    <p style={{ margin: '0 0 0.25rem' }}>
                      AI-forslag ({componentAnalysis.componentType}):{' '}
                      <strong>{componentAnalysis.identifiedValue}</strong> ({toPercent(componentAnalysis.confidence)})
                    </p>
                    <p style={{ margin: 0, color: '#99f6e4' }}>{componentAnalysis.notes}</p>
                  </div>
                )}

                <button
                  onClick={handleSaveComponent}
                  disabled={isAnalyzingComponent || isSavingComponent}
                  style={{
                    marginTop: '0.25rem',
                    borderRadius: '0.75rem',
                    border: 'none',
                    padding: '0.8rem 1rem',
                    background: 'linear-gradient(120deg, #14b8a6, #0ea5e9)',
                    color: '#f8fafc',
                    cursor: 'pointer',
                    fontWeight: 700,
                    opacity: isAnalyzingComponent || isSavingComponent ? 0.6 : 1
                  }}
                >
                  {isAnalyzingComponent
                    ? 'Analyserar komponentbild...'
                    : isSavingComponent
                    ? 'Sparar komponent...'
                    : 'Spara komponent'}
                </button>

                <section
                  style={{
                    marginTop: '0.5rem',
                    borderTop: '1px solid rgba(148,163,184,0.2)',
                    paddingTop: '0.75rem'
                  }}
                >
                  <p style={{ margin: '0 0 0.35rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                    Sparade komponenter ({currentAggregate.components.length})
                  </p>

                  <ul
                    style={{
                      listStyle: 'none',
                      margin: 0,
                      padding: 0,
                      display: 'flex',
                      flexDirection: 'column',
                      gap: '0.4rem'
                    }}
                  >
                    {currentAggregate.components.map((component) => (
                      <li
                        key={component.id}
                        style={{
                          borderRadius: '0.65rem',
                          border: '1px solid rgba(148,163,184,0.2)',
                          padding: '0.55rem',
                          background: '#020617'
                        }}
                      >
                        <p style={{ margin: '0 0 0.2rem' }}>
                          <strong>
                            {component.assembly || 'Okand'} /{' '}
                            {component.subComponent || component.componentType}
                          </strong>
                          : {component.identifiedValue}
                        </p>
                        {Object.keys(component.attributes || {}).length > 0 && (
                          <p style={{ margin: '0 0 0.2rem', color: '#93c5fd', fontSize: '0.8rem' }}>
                            {Object.entries(component.attributes)
                              .map(([key, value]) => `${key}: ${value}`)
                              .join(' | ')}
                          </p>
                        )}
                        {component.notes && (
                          <p style={{ margin: 0, color: '#cbd5f5', fontSize: '0.85rem' }}>
                            {component.notes}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </section>
              </section>
            </section>
          )}
        </>
      ) : mode === 'sok' ? (
        <section
          style={{
            borderRadius: '1rem',
            border: '1px solid rgba(148,163,184,0.25)',
            background: '#0b1120',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.75rem'
          }}
        >
          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder='Sok pa systemposition, avdelning, position eller komponent'
              style={{
                flex: 1,
                minWidth: '220px',
                borderRadius: '0.7rem',
                border: '1px solid rgba(148,163,184,0.4)',
                padding: '0.7rem',
                background: '#020617',
                color: '#f8fafc'
              }}
            />
            <button
              onClick={() => void handleSearch()}
              disabled={isSearching}
              style={{
                borderRadius: '0.7rem',
                border: 'none',
                padding: '0.7rem 1rem',
                background: 'linear-gradient(120deg, #38bdf8, #6366f1)',
                color: '#f8fafc',
                cursor: 'pointer',
                fontWeight: 700,
                opacity: isSearching ? 0.6 : 1
              }}
            >
              {isSearching ? 'Soker...' : 'Sok'}
            </button>
          </div>

          <ul
            style={{
              listStyle: 'none',
              margin: 0,
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '0.7rem'
            }}
          >
            {searchResults.map((aggregate) => (
              <li
                key={aggregate.id}
                style={{
                  borderRadius: '0.8rem',
                  border: '1px solid rgba(148,163,184,0.25)',
                  padding: '0.8rem',
                  background: '#020617'
                }}
              >
                <p style={{ margin: '0 0 0.25rem' }}>
                  <strong>{aggregate.systemPositionId}</strong>
                  {' - '}
                  {aggregate.position || 'Ingen position angiven'}
                </p>
                <p style={{ margin: '0 0 0.4rem', color: '#94a3b8', fontSize: '0.85rem' }}>
                  Avdelning: {aggregate.department || 'Ej satt'} | Komponenter: {aggregate.components.length} | Uppdaterad:{' '}
                  {new Date(aggregate.updatedAt).toLocaleString('sv-SE')}
                </p>

                {!!aggregate.components.length && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.35rem' }}>
                    {aggregate.components.slice(0, 6).map((component) => (
                      <span
                        key={component.id}
                        style={{
                          fontSize: '0.75rem',
                          borderRadius: '999px',
                          padding: '0.2rem 0.55rem',
                          background: 'rgba(14,165,233,0.15)',
                          color: '#7dd3fc'
                        }}
                      >
                        {(component.assembly || component.componentType) +
                          ' / ' +
                          (component.subComponent || component.componentType)}
                        : {component.identifiedValue}
                        {Object.keys(component.attributes || {}).length > 0
                          ? ` (${Object.entries(component.attributes)
                              .slice(0, 1)
                              .map((entry) => entry[1])
                              .join(', ')})`
                          : ''}
                      </span>
                    ))}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {!isSearching && searchResults.length === 0 && (
            <p style={{ margin: 0, color: '#94a3b8' }}>Inga sparade poster hittades.</p>
          )}
        </section>
      ) : (
        <section
          style={{
            borderRadius: '1rem',
            border: '1px solid rgba(148,163,184,0.25)',
            background: '#0b1120',
            padding: '1rem',
            display: 'flex',
            flexDirection: 'column',
            gap: '0.9rem'
          }}
        >
          <h2 style={{ margin: 0, fontSize: '1rem' }}>Importera aggregat fran Excel</h2>
          <p style={{ margin: 0, color: '#94a3b8', fontSize: '0.9rem' }}>
            Stod for `.xlsx`, `.xls` och `.csv`. En rad kan innehalla ett aggregat och valfri komponent.
            Anvand kolumner som `systemPositionId`, `componentType`, `identifiedValue` och `attr_*` for attribut.
            Kor forst `Forhandsgranska`, och importera sedan.
          </p>

          <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              type='file'
              accept='.xlsx,.xls,.csv'
              onChange={(event) => {
                const file = event.target.files?.[0] ?? null;
                setImportFile(file);
                setImportPreview(null);
                setImportResult(null);
                setImportPreviewFingerprint(null);
              }}
              style={{
                borderRadius: '0.7rem',
                border: '1px solid rgba(148,163,184,0.4)',
                padding: '0.55rem',
                background: '#020617',
                color: '#f8fafc'
              }}
            />
            <button
              onClick={handlePreviewImport}
              disabled={isPreviewingImport}
              style={{
                borderRadius: '0.7rem',
                border: 'none',
                padding: '0.65rem 1rem',
                background: 'linear-gradient(120deg, #14b8a6, #0ea5e9)',
                color: '#f8fafc',
                cursor: 'pointer',
                fontWeight: 700,
                opacity: isPreviewingImport ? 0.6 : 1
              }}
            >
              {isPreviewingImport ? 'Forhandsgranskar...' : 'Forhandsgranska'}
            </button>
            <button
              onClick={handleImport}
              disabled={
                isImporting ||
                isPreviewingImport ||
                !importFile ||
                importPreviewFingerprint !==
                  (importFile ? getImportFingerprint(importFile) : null)
              }
              style={{
                borderRadius: '0.7rem',
                border: 'none',
                padding: '0.65rem 1rem',
                background: 'linear-gradient(120deg, #0ea5e9, #2563eb)',
                color: '#f8fafc',
                cursor: 'pointer',
                fontWeight: 700,
                opacity:
                  isImporting ||
                  isPreviewingImport ||
                  !importFile ||
                  importPreviewFingerprint !==
                    (importFile ? getImportFingerprint(importFile) : null)
                    ? 0.6
                    : 1
              }}
            >
              {isImporting ? 'Importerar...' : 'Importera fil'}
            </button>
            <button
              onClick={handleDownloadTemplate}
              style={{
                borderRadius: '0.7rem',
                border: '1px solid rgba(148,163,184,0.6)',
                padding: '0.65rem 1rem',
                background: 'transparent',
                color: '#f8fafc',
                cursor: 'pointer',
                fontWeight: 600
              }}
            >
              Ladda ner mall (CSV)
            </button>
          </div>

          {importFile && (
            <p style={{ margin: 0, color: '#cbd5f5', fontSize: '0.85rem' }}>
              Vald fil: <strong>{importFile.name}</strong>
            </p>
          )}

          {importPreview && (
            <section
              style={{
                borderRadius: '0.8rem',
                border: '1px solid rgba(148,163,184,0.3)',
                background: '#020617',
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem'
              }}
            >
              <p style={{ margin: 0, color: '#cbd5f5' }}>
                Forhandsvisning: rader {importPreview.totalRows}, aggregat {importPreview.parsedAggregates}, komponenter {importPreview.parsedComponents}, hoppade over {importPreview.skippedRows}
              </p>
              {importPreview.previewAggregates.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '1rem', color: '#93c5fd' }}>
                  {importPreview.previewAggregates.slice(0, 8).map((aggregate) => (
                    <li key={aggregate.systemPositionId}>
                      <strong>{aggregate.systemPositionId}</strong>
                      {aggregate.position ? ` (${aggregate.position})` : ''} - {aggregate.componentsCount} komponent(er)
                    </li>
                  ))}
                </ul>
              )}
              {importPreview.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '1rem', color: '#fbbf24' }}>
                  {importPreview.warnings.slice(0, 10).map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>
          )}

          {importResult && (
            <section
              style={{
                borderRadius: '0.8rem',
                border: '1px solid rgba(148,163,184,0.3)',
                background: '#020617',
                padding: '0.75rem',
                display: 'flex',
                flexDirection: 'column',
                gap: '0.45rem'
              }}
            >
              <p style={{ margin: 0, color: '#cbd5f5' }}>
                Rader: {importResult.totalRows} | Aggregat: {importResult.importedAggregates} ({importResult.createdAggregates} skapade, {importResult.updatedAggregates} uppdaterade) | Komponenter: {importResult.importedComponents} | Hoppade over: {importResult.skippedRows}
              </p>
              {importResult.warnings.length > 0 && (
                <ul style={{ margin: 0, paddingLeft: '1rem', color: '#fbbf24' }}>
                  {importResult.warnings.slice(0, 10).map((warning, index) => (
                    <li key={`${warning}-${index}`}>{warning}</li>
                  ))}
                </ul>
              )}
            </section>
          )}
        </section>
      )}
    </main>
  );
}
