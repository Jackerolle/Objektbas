# Objektbas - oversikt

Den har appen ska fungera som ett mobilt register over alla objekt och deras utrustning. Anvandaren tar ett foto med enheten, appen matchar bilden mot befintliga objekt och foreslar ratt objektkort dar nya uppgifter kan sparas utan manuell sokning.

## Malbild
- Snabb inventering ute i falt - oppna appen, ta en bild, fa fram objektinformation direkt.
- Automatisk koppling av utrustningstillbehor till ratt objektkort.
- Offline-lage for att samla data utan nat och synka senare.
- Rollebaserade behorigheter sa att tekniker kan foresla andringar medan administratorer godkanner dem.

## Viktig funktionalitet
1. **Bildinsamling** - kamera via mobil/PWA. Styra landskaps-/portrattlage och komprimera lokalt.
2. **Visuell matchning** - kor en embeddings-/feature-extraktor (t.ex. MobileNet, ONNX Runtime) i appen eller i backend. Jamfor mot referensbilder i en vektor-databas (t.ex. PostgreSQL + pgvector).
3. **Metadata-uppslag** - nar traff hittas hamtas objektdata (serienummer, tillbehor, senaste service, ansvarig).
4. **Redigering** - formular for att lagga till/uppdatera utrustning, status, placering, bilder, anteckningar.
5. **Synk & historik** - auditlogg for andringar och versionshantering av objekt.

## Vald plattform (webapp i mobilen)
- **Klient:** Next.js 14 (React + TypeScript) som PWA med offline-stod via Service Workers och IndexedDB. Ger samma kodbas for webb och "installera pa hemskarmen" i iOS/Android.
- **Kamera & filer:** Inbyggt `MediaDevices.getUserMedia` + File System Access API for snabb fotografering direkt i webblasen. Vid behov kan vi wrappa samma PWA i Capacitor for App Store-distribution.
- **Delning av information:** Realtidsuppdateringar via WebSockets/SignalR i webblasen sa att flera tekniker ser senast sparade uppgifter.
- **UI-kit:** Chakra UI eller MUI Joy med responsiva komponenter och gestanpassade vyer.

## Arkitekturforslag
| Del | Vald teknik | Motivering |
| --- | --- | --- |
| Mobil/webbklient | Next.js 14 PWA | Snabb SSR/ISR, enkel distribution pa webb, installeras som ikon pa mobilen. |
| Backend API | .NET 8 Minimal API | Stark typning, bra OpenAPI-stod, enkel hosting i Azure App Service. |
| Databas | PostgreSQL | Relationsdata + `pgvector`-extension for embeddings. |
| Vektorindex | pgvector | Lagra/frogan embeddings i samma databas for enklare drift. |
| Filer/bilder | Azure Blob Storage | Billig lagring, CDN-koppling, lifecycle policies. |

## Datamodell (forenklad)
- **Objekt**: id, namn, kategori, serienummer, lokation_id, status.
- **Utrustning**: id, objekt_id, typ, modell, kvantitet, status.
- **Bild**: id, objekt_id, url, embedding, skapad_datum.
- **Lokation**: id, namn, adress, koordinater.
- **Historik**: id, objekt_id, handelse, anvandare, tidsstampel.

## Flode for bildmatchning
1. Ta bild -> klienten extraherar feature-vektor eller skickar bilden till backend.
2. Backend normaliserar bilden (skalning, beskarning) och beraknar embedding (ONNX-modell i docker-container).
3. Kor vektorsokning efter narmaste grannar i indexet, filtrera pa kategori/lokation vid behov.
4. Presentera topptraffar i appen; anvandaren bekraftar ratt objekt.
5. Efter bekraftelse oppnas objektkortet, nya falt kan fyllas i och skickas till API:t.

## Nasta steg
1. Samla representativa referensbilder per objekt och tagga dem korrekt.
2. Bootstrapa Next.js 14 PWA med kamera-komponent och offline-cache.
3. Skapa .NET 8 Minimal API, generera OpenAPI och migrera PostgreSQL med pgvector.
4. Implementera enklaste flodet: skapa objekt manuellt -> ta bild -> foresla match via dummy-embedding.
5. Bygg SignalR-kanal for delning i realtid och lagg till revisionssparning.

## Implementation v0 (detta repo)
- **Klient:** Next.js 14 PWA med kamera (MediaDevices API), offline-cache (IndexedDB via `idb-keyval`), service worker och manifest.
- **UI-moduler:** Kameravy, objektlista med utrustning och realtidsflode (simulerat) + synkstatus.
- **Backend:** .NET 8 Minimal API (`api/Objektbas.Api`) med minneslagring for objekt och observationer, OpenAPI via Swashbuckle, CORS-stod for `http://localhost:3000`.

## Kom igang lokalt
1. Installera Node 18+ och .NET 8 SDK.
2. Installera klientberoenden:
   ```bash
   npm install
   npm run dev
   ```
   - PWA körs på `http://localhost:3000`. Sätt `.env.local` med `NEXT_PUBLIC_API_BASE_URL=http://localhost:5298` om du ändrar port.
3. Starta API:
   ```bash
   dotnet restore api/Objektbas.Api/Objektbas.Api.csproj
   dotnet run --project api/Objektbas.Api/Objektbas.Api.csproj
   ```
   - Swagger finns på `http://localhost:5298/swagger`. API exponerar `/objects`, `/observations` och `/healthz`.
4. Testa flödet:
   - Öppna webbappen i mobilens webbläsare (lägg till på hemskärmen för PWA).
   - Tillåt kameran, välj ett objekt och ta en bild.
   - Stäng av nätet för att se offline-kö, slå på igen för automatisk synk.

## Nya funktioner (Lagg till/Sok + Gemini)
- Startsidan har nu tva lagen: `Lagg till` och `Sok`.
- `Lagg till`-flode:
  1. Fota systempositionens ID.
  2. API anropar Gemini for OCR-lik tolkning och foreslar ID.
  3. Anvandaren bekraftar/rattar ID och sparar aggregatet.
  4. Komponenter (Motorbricka, Flakt, Kilrep, Remskivor, Filter) kan laggas till via bild + AI-forslag.
  5. Varje komponent har obligatoriska falt som valideras i API:t innan sparning.
- `Sok`-laget visar sparade aggregat och komponentdata.

### Nya API-endpoints
- `POST /ai/systemposition`
- `POST /ai/component`
- `POST /aggregates`
- `GET /aggregates?query=...`
- `GET /aggregates/{id}`
- `POST /aggregates/{id}/components`

### Miljovariabler for Gemini
Satt dessa innan du startar API:t:

```bash
GEMINI_API_KEY=din-nyckel
GEMINI_MODEL=gemini-2.0-flash
```

Om `GEMINI_API_KEY` saknas anvander API:t fallback-svar sa att flodet fortfarande kan testas manuellt.

## Deploy pa Vercel med Supabase
Nya versionen av webbappen kan deployas utan .NET-backend genom Next.js API-routes under `app/api/*`.

### 1. Skapa Supabase-projekt
1. Skapa ett nytt projekt i Supabase.
2. Kor SQL-filen `supabase/schema.sql` i Supabase SQL Editor.
3. Bekrafta att tabellerna `ventilation_aggregates` och `ventilation_components` skapats.

### 2. Satt miljo-variabler i Vercel
Lagg in foljande variabler i Vercel-projektet:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `GEMINI_API_KEY`
- `GEMINI_MODEL` (valfritt, default `gemini-2.0-flash`)
- `NEXT_PUBLIC_API_BASE_URL` (lamna tom for interna `/api`-routes)

Se ocksa `.env.example`.

### 3. Deploy
1. Pusha koden till GitHub.
2. Importera repo i Vercel.
3. Vercel bygger Next.js-appen och exponerar frontend + API-routes tillsammans.

### 4. Verifiera efter deploy
- `POST /api/ai/systemposition` fungerar (Gemini/fallback).
- `POST /api/aggregates` skapar poster i Supabase.
- `POST /api/aggregates/{id}/components` validerar obligatoriska falt.
- Sok i appen visar sparade poster fran Supabase.
