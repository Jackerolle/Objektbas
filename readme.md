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
