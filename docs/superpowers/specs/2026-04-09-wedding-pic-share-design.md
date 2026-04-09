# Wedding Pic Share — Design Spec
**Date:** 2026-04-09  
**Status:** Approved  
**License:** MIT

---

## Positionierung

Privacy-first, selfhosted, no-app wedding photo sharing. Kein vollständiges Hochzeitsplanungstool — ausschließlich Foto-Sharing.

### Kern-Prinzipien

1. **Friction first:** Gast kommt in unter 10 Sekunden vom QR-Code zum Upload-Start. Konkret: LCP < 2.5s, Time-to-Interactive < 3s auf mobilem 4G-Netz.
2. **Moments not files:** Alben/Sub-Events sind ein Kernkonzept, keine Nachgedanke.
3. **Privacy by default:** Kein Google Drive, kein Social Login, keine externe SaaS-Infrastruktur erforderlich.
4. **Extensible core:** KI-Funktionen und Messaging-Integrationen später als optionale Module.

### Erfolgsmetriken

- **Upload-Completion-Rate:** Gast scannt QR → Upload abgeschlossen (Ziel: >80%)
- **Time-to-Upload:** Erster Upload-Start in < 10s auf 4G (messbar via Server-Log `createdAt` vs. QR-Scan-Zeitstempel)
- **Foto-Approval-Rate:** Anteil freigegebener Fotos (Monitoring in Admin-Dashboard)
- **Slideshow-Session-Length:** Dauer einer Slideshow-Session (SSE-Verbindungszeit im Backend-Log)

---

## Architektur

### Überblick

```
┌─────────────────────────────────────────────────────┐
│                   Docker Compose                    │
│                                                     │
│  ┌──────────────┐      ┌──────────────────────────┐ │
│  │  Next.js     │ ───► │  Fastify API             │ │
│  │  Frontend    │      │  (REST + SSE)            │ │
│  │  :3000       │      │  :4000                   │ │
│  └──────────────┘      └────────┬─────────────────┘ │
│                                 │                   │
│                    ┌────────────┴──────────┐        │
│                    │  Prisma ORM           │        │
│                    ├──────────┬────────────┤        │
│                    │ SQLite   │ PostgreSQL │        │
│                    └──────────┴────────────┘        │
│                                                     │
│  Storage: Local FS  /  S3-kompatibel (per Env)      │
└─────────────────────────────────────────────────────┘
```

- **Frontend (Next.js App Router):** Kommuniziert ausschließlich über REST mit dem Fastify-Backend. Kein direkter DB-Zugriff. **App Router** ist explizit gewählt (nicht Pages Router) — ermöglicht Server Components für initiales Foto-Laden ohne Client-JS-Overhead.
- **Backend (Fastify):** Alle API-Endpunkte, Business-Logik, File-Handling, SSE-Endpunkt für Slideshow, Prisma für DB.
- **Deployment:** `docker-compose up` startet beide Services. Reverse Proxy (Traefik/Nginx) optional davor.
- **Monorepo:** `pnpm workspaces` + **Turborepo** — Frontend und Backend teilen das Prisma-Paket und TypeScript-Typen. Build-Reihenfolge: `packages/db` → `apps/backend` → `apps/frontend`.
- **CORS:** `@fastify/cors` — erlaubt ausschließlich `FRONTEND_URL` als Origin. Keine Wildcard.
- **TypeScript:** Strikt mandatiert (`strict: true`) in allen Packages. Geteilte Typen via `packages/db` eliminieren Typ-Drift zwischen Frontend und Backend.

### Repo-Struktur

```
wedding-pic-share/
├── apps/
│   ├── frontend/          # Next.js (App Router, TypeScript)
│   └── backend/           # Fastify (TypeScript)
├── packages/
│   └── db/                # Prisma Schema, Migrations, generierte Typen
├── turbo.json             # Build-Reihenfolge: db → backend, frontend
├── docker-compose.yml
├── .env.example
└── docs/
    └── superpowers/specs/
```

### Docker Volumes

```yaml
# docker-compose.yml (relevante Abschnitte)
services:
  backend:
    volumes:
      - ./data/uploads:/app/data/uploads   # Foto-Storage
      - ./data/db.sqlite:/app/data/db.sqlite  # SQLite (nur bei SQLite-Mode)
    environment:
      - DATABASE_URL=${DATABASE_URL}
  frontend:
    environment:
      - NEXT_PUBLIC_API_URL=http://backend:4000
```

### Datenbankmigrationen

`prisma migrate deploy` wird als erster Schritt im Docker-Entrypoint ausgeführt — vor dem Server-Start. Kein manueller Eingriff bei Updates nötig. Für SQLite→PostgreSQL-Migration: `prisma migrate dev --from-empty` auf Ziel-DB, Daten per Export-Script übertragen (dokumentiert in `docs/migration.md`).

---

## Datenmodell

### Schema-Philosophie: MVP-first

Das Prisma-Schema enthält nur MVP-Phase-1-Felder. Phase-2/3-Felder werden per Migration hinzugefügt, wenn die Phase implementiert wird. Felder wie `UploadWindow`, `secretKey`, `totpSecretEncrypted` sind in der Schema-Definition kommentiert als `// Phase 2` bzw. `// Phase 3` — sie existieren nicht in der initialen Migration.

```
Wedding (1)
  └── Gallery/Sub-Event (n)          ← z.B. Standesamt, Kirche, Party
        ├── uploadWindows (n)        ← Phase 2: Zeitfenster
        ├── Photo (n)
        │     ├── status: PENDING | APPROVED | REJECTED  (Enum)
        │     ├── guestName (optional)
        │     ├── fileHash (SHA-256, Duplikatprüfung per Galerie)
        │     ├── originalPath / thumbnailPath
        │     └── exifStripped: boolean
        └── QR-Code: on-demand generiert, kein DB-Eintrag
```

### Prisma-Schema (vollständig, mit Phasen-Markierungen)

```prisma
enum PhotoStatus {
  PENDING
  APPROVED
  REJECTED
}

enum GalleryLayout {
  MASONRY
  GRID
}

enum GuestNameMode {
  OPTIONAL
  REQUIRED
  HIDDEN
}

enum ModerationMode {
  MANUAL
  AUTO
}

// Phase 1
model Wedding {
  id        String    @id @default(cuid())
  name      String
  slug      String    @unique
  createdAt DateTime  @default(now())
  galleries Gallery[]
}

// Phase 1 (secretKey, uploadWindows: Phase 2/3)
model Gallery {
  id                 String         @id @default(cuid())
  weddingId          String
  wedding            Wedding        @relation(fields: [weddingId], references: [id])
  name               String
  slug               String         @unique
  description        String?
  coverImage         String?
  layout             GalleryLayout  @default(MASONRY)
  allowGuestDownload Boolean        @default(false)
  guestNameMode      GuestNameMode  @default(OPTIONAL)
  moderationMode     ModerationMode @default(MANUAL)
  secretKey          String?        // Phase 3: bcrypt-gehasht, PIN für Gäste
  createdAt          DateTime       @default(now())
  uploadWindows      UploadWindow[] // Phase 2
  photos             Photo[]
}

// Phase 2
model UploadWindow {
  id        String   @id @default(cuid())
  galleryId String
  gallery   Gallery  @relation(fields: [galleryId], references: [id])
  startsAt  DateTime
  endsAt    DateTime
}

// Phase 1
model Photo {
  id               String      @id @default(cuid())
  galleryId        String
  gallery          Gallery     @relation(fields: [galleryId], references: [id])
  guestName        String?
  fileHash         String
  originalPath     String
  thumbPath        String
  mimeType         String
  status           PhotoStatus @default(PENDING)
  rejectionReason  String?
  exifStripped     Boolean     @default(false)
  createdAt        DateTime    @default(now())

  @@unique([galleryId, fileHash])  // Duplikat-Scope: pro Galerie, nicht global
}

// Phase 1
model AdminUser {
  id                      String    @id @default(cuid())
  username                String    @unique
  passwordHash            String
  totpSecretEncrypted     String?   // Phase 3: AES-256-GCM, Key aus TOTP_ENCRYPTION_KEY
  failedAttempts          Int       @default(0)
  lockedUntil             DateTime?
  sessions                Session[]
}

// Phase 1
model Session {
  id          String    @id @default(cuid())
  adminUserId String
  admin       AdminUser @relation(fields: [adminUserId], references: [id])
  token       String    @unique
  createdAt   DateTime  @default(now())
  expiresAt   DateTime
}
```

### Gallery-Modi

- **Single-Gallery-Mode:** Eine Wedding + eine Gallery — vereinfachte UI via Feature-Flag (`SINGLE_GALLERY_MODE=true` in Env). Gleiche Codebasis, keine Sub-Event-Navigation sichtbar, `/g/[slug]` ist die Root-URL.
- **Multi-Gallery-Mode (default):** Eine Wedding + mehrere Galleries mit eigenem Slug, Zeitfenster und on-demand QR-Code.

---

## User Journeys

### Gast-Journey (vollständig)

```
QR-Code scannen
  → /g/[slug]/upload laden (LCP < 2.5s, TTI < 3s auf 4G)
  → [falls Galerie PIN-geschützt] PIN-Eingabe-Screen
  → [optional] Gastname eingeben
  → Datei(en) auswählen (Kamera öffnen oder Galerie)
  → Upload läuft (Fortschrittsbalken pro Datei, Cancel-Button)
  → Upload abgeschlossen → Pending-Confirmation-Screen:
      "Deine Fotos wurden eingereicht und werden bald freigegeben."
      [Button: Zur Galerie] [Button: Weitere Fotos hochladen]
  → Galerie-Ansicht (/g/[slug]) mit freigegebenen Fotos
  → [optional] Einzelfoto Download (falls erlaubt)
  → [optional] ZIP-Download (falls erlaubt)
```

**Fehler-Screens im Upload-Flow:**

| Fehlerfall | Meldung (DE) |
|---|---|
| Datei zu groß (> MAX_FILE_SIZE_MB) | "Diese Datei ist zu groß. Maximal erlaubt: 50 MB." |
| Nicht erlaubter Dateityp | "Dieser Dateityp wird nicht unterstützt. Erlaubt: JPEG, PNG, WEBP, HEIC, MP4, MOV." |
| Duplikat | "Dieses Foto wurde bereits hochgeladen." |
| Upload-Zeitfenster abgelaufen (Phase 2) | "Der Upload-Zeitraum für diese Galerie ist beendet. Du kannst die Fotos noch ansehen." |
| Netzwerkfehler | "Upload fehlgeschlagen. [Erneut versuchen]"-Button |
| Server-Fehler (5xx) | "Ein Fehler ist aufgetreten. Bitte versuche es erneut." |
| Galerie nicht gefunden | "Diese Galerie existiert nicht oder wurde deaktiviert." |

### Admin-Journey

```
/admin → Login (Passwort [+ TOTP Phase 3])
  → /admin/dashboard (Übersicht aller Galerien)
  → /admin/galleries/new (Galerie erstellen)
  → /admin/galleries/[id]/moderate (Fotos freigeben/ablehnen)
  → /admin/galleries/[id] (QR-Code herunterladen, Galerie-Settings)
  → /g/[slug]/slideshow (Slideshow starten, z.B. auf Beamer)
```

### Professioneller Fotograf vs. Gast

Hochzeiten haben typischerweise zwei Upload-Typen mit unterschiedlichen Anforderungen:

| | Gast | Profi-Fotograf |
|---|---|---|
| Anzahl Fotos | 5–20 | 200–1000 |
| Dateigröße | < 10 MB (Smartphone) | 5–50 MB (RAW/JPEG) |
| Upload-Weg | QR-Code, mobil | Admin-Panel, Desktop |
| Moderation | Pre-Moderation | Direkte Freigabe (Admin-Upload) |
| Qualität | Originalgröße | Originalgröße immer erhalten |

**MVP-Lösung:** Admin kann Fotos direkt über das Admin-Panel hochladen mit automatischer Freigabe (kein Pending). Gleicher Upload-Endpunkt, aber Admin-Auth setzt `status = APPROVED` direkt.

### Galerie-PIN-Distribution (Phase 3)

Wenn `secretKey` für eine Galerie gesetzt ist:
- PIN wird im Admin-Panel angezeigt und ist auf dem druckbaren Tischkärtchen enthalten
- PIN wird **nicht** in die QR-Code-URL eingebettet (Security: URL könnte geteilt werden)
- Gast gibt PIN auf separatem Screen ein, bevor er die Galerie sieht/uploadet
- PIN wird clientseitig mit dem Request mitgeschickt und serverseitig gegen den bcrypt-Hash geprüft
- Falsche PIN: max. 10 Versuche pro IP, dann temporärer Block (Rate Limiting)

### Data Retention / Event-Abschluss

- Admin kann eine Galerie "abschließen" (Status: `CLOSED`): Uploads deaktiviert, Galerie lesbar
- Admin kann eine Galerie "archivieren": Unsichtbar für Gäste, Daten erhalten
- Admin kann eine Galerie löschen: Alle Fotos und DB-Einträge werden gelöscht (irreversibel, Bestätigungsdialog)
- **DSGVO-Hinweis** in der Doku: Fotos enthalten ggf. personenbezogene Daten. Empfohlene Löschfrist nach Event: 6–12 Monate. Admin ist verantwortlich.
- ZIP-Export vor Löschung empfohlen (Hinweis im Lösch-Dialog)

---

## Design-System

Das ist ein emotionales Produkt. Die Benutzeroberfläche reflektiert "Moments not files".

### Farbpalette

```
Light Mode:
  Background:   #FAFAF8  (warmes Off-White)
  Surface:      #FFFFFF
  Border:       #E8E4DF
  Text primary: #1A1714
  Text muted:   #6B6560
  Accent:       #C4956A  (warmes Gold — Hochzeits-Assoziation)
  Accent hover: #B08050
  Success:      #4A7C59
  Error:        #C0392B

Dark Mode (primäre Slideshow-Nutzung auf Beamer):
  Background:   #0D0D0B  (fast Schwarz, warm)
  Surface:      #1A1A17
  Border:       #2E2E29
  Text primary: #F5F1EC
  Text muted:   #9E9890
  Accent:       #D4A870  (helles Gold auf dunklem Grund)
```

### Typografie

- **Primär:** `Inter` (system-ui Fallback) — lesbar, modern, weit verbreitet
- **Display/Titel:** `Playfair Display` (Google Fonts, self-hosted via `next/font`) — elegant, emotional für Galerie-Überschriften
- **Monospace:** System-default (nur Admin-Panel für technische Inhalte)
- **Skala:** Tailwind-Standard (`text-sm`, `text-base`, `text-lg`, `text-xl`, `text-2xl`, `text-4xl`)

### Icon-Set

**Lucide Icons** (`lucide-react`) — konsistente Strichstärke, MIT-Lizenz, tree-shakeable.

### Animation-Tokens

```css
/* Slideshow */
--slideshow-crossfade-duration: 1200ms;
--slideshow-crossfade-easing: ease-in-out;
--slideshow-display-duration: 8000ms;  /* konfigurierbar via Env */

/* UI Micro-Animations */
--transition-fast: 150ms ease;
--transition-base: 250ms ease;
--transition-slow: 400ms ease;
```

### Slideshow-Bilddarstellung (Beamer/TV)

- **Scaling:** `object-fit: contain` mit dunklem Hintergrund — kein Beschneiden von Hochzeitsfotos
- **QR-Hint-Schrift:** `text-2xl` (32px) — lesbar auf 4K-TV aus 3–4 Meter Entfernung
- **Bildwechsel-Timing:** 8s Standard, konfigurierbar via `SLIDESHOW_INTERVAL_SECONDS` Env
- **Crossfade:** 1.2s — weich genug für emotionale Fotos, nicht träge

### Empty States

| Kontext | Darstellung |
|---|---|
| Galerie ohne freigegebene Fotos | Illustration + "Noch keine Fotos freigegeben. Sei der Erste!" + Upload-Button |
| Galerie — alle Fotos pending | "Fotos werden gerade geprüft und erscheinen bald." |
| Galerie — alle Fotos rejected | "Noch keine Fotos verfügbar." (kein Hinweis auf Rejection) |
| Moderations-Queue leer | "Alles erledigt! Keine ausstehenden Fotos." + Konfetti-Micro-Animation |
| Slideshow ohne freigegebene Fotos | Vollbild: Galerie-Name + QR-Code + "Teile jetzt deine ersten Fotos" |
| Admin-Dashboard ohne Galerien | "Erstelle deine erste Galerie" + CTA |

### Skeleton Screens

- `GalleryPage` zeigt Skeleton-Grid (Tailwind `animate-pulse`) beim initalen Laden
- `AdminModerationPage` zeigt Skeleton-Cards beim Laden der Pending-Queue
- Kein Blank-Flash: Skeleton erscheint sofort, Content ersetzt ihn

---

## API-Design

**Fastify REST API** — Basis-URL: `/api/v1`

### Öffentliche Endpunkte (kein Auth)

```
GET    /g/:slug?cursor=<id>&limit=20  → Galerie-Info + freigegebene Fotos (cursor-based pagination)
POST   /g/:slug/upload                → Foto hochladen (multipart)
GET    /g/:slug/slideshow/stream      → SSE-Stream (neue Fotos, rate limited)
GET    /g/:slug/qr?format=png|svg     → QR-Code on-demand
GET    /g/:slug/download              → ZIP aller freigegebenen Fotos (falls erlaubt)
GET    /health                        → Health Check (DB + Storage)
GET    /ready                         → Readiness Check
```

**Pagination:** `GET /g/:slug` liefert max. 20 Fotos pro Request. Response: `{ photos: [...], nextCursor: "id|null" }`. Cursor = ID des letzten gelieferten Fotos (stabil bei neuem Content, kein Offset-Drift).

### Admin-Endpunkte (Session-Auth + CSRF-Token)

```
POST   /admin/login
POST   /admin/logout
GET    /admin/galleries
POST   /admin/galleries
PATCH  /admin/galleries/:id
DELETE /admin/galleries/:id
POST   /admin/galleries/:id/upload    → Admin-Upload (direkte Freigabe, kein Pending)
GET    /admin/galleries/:id/photos?status=PENDING|APPROVED|REJECTED&cursor=<id>&limit=50
PATCH  /admin/photos/:id
POST   /admin/photos/batch
DELETE /admin/photos/:id
GET    /admin/galleries/:id/export    → ZIP (Originalqualität)
POST   /admin/webhooks/test
```

### Batch-Endpunkt: `POST /admin/photos/batch`

```json
// Request
{
  "action": "approve" | "reject" | "move",
  "photoIds": ["id1", "id2", "id3"],
  "rejectionReason": "optional, nur bei reject",
  "targetGalleryId": "optional, nur bei move"
}

// Response 200
{ "processed": 3, "failed": [] }

// Response 207 (partial failure)
{ "processed": 2, "failed": [{ "id": "id3", "reason": "not found" }] }
```

### Health-Check-Endpunkte

```json
// GET /health — 200 OK oder 503 Service Unavailable
{
  "status": "ok" | "degraded",
  "db": "ok" | "error",
  "storage": "ok" | "error",
  "uptime": 12345
}

// GET /ready — 200 wenn bereit, 503 wenn noch nicht
{ "ready": true }
```

Docker Compose `HEALTHCHECK`: `curl -f http://localhost:4000/health || exit 1`

### Upload-Flow

```
Browser → POST /g/:slug/upload (multipart)
  → Fastify bodyLimit = MAX_FILE_SIZE_MB × 1024² (Limit VOR Buffer-Verarbeitung)
  → Upload-Zeitfenster prüfen (Phase 2)
  → Secret Key prüfen (Phase 3, falls konfiguriert)
  → Magic Bytes prüfen (file-type Paket — MIME aus Dateiinhalt, nicht Content-Type-Header)
  → Erlaubte Typen: image/jpeg, image/png, image/webp, image/heic, video/mp4, video/quicktime
  → SHA-256 Hash berechnen → @@unique([galleryId, fileHash]) — Duplikat? → 409 Conflict
  → Sharp: Thumbnail (300px) + WEBP-Konvertierung (Bilder); HEIC → WEBP serverseitig
  → EXIF entfernen (falls EXIF_STRIP=true)
  → Storage: lokal oder S3
  → DB: Photo mit status = PENDING, thumbPath gespeichert
  → SMTP-Notification an Admin (falls konfiguriert)
  → Response: { id, status: "PENDING", thumbUrl }
  // thumbUrl: sofortige Vorschau im Browser auch für HEIC (serverseitiges WEBP-Thumbnail)
```

**Known Limitation — Sharp CPU-Blocking:** Sharp ist CPU-intensiv. Bei vielen gleichzeitigen Uploads kann der Node.js Event Loop kurzzeitig blockieren. Für MVP akzeptabel (Hochzeits-Workload: Bursts, nicht kontinuierlich). Mittel-/langfristig: Worker Threads oder BullMQ-Queue als separates Modul.

### Datei-Auslieferung

Fotos werden **nicht** via `@fastify/static` als öffentliches Verzeichnis ausgeliefert. Stattdessen:

```
GET /files/:gallerySlug/:filename
  → Galerie-Zugriff prüfen (Secret Key, falls Phase 3)
  → Für Admin-Originals: Session-Auth prüfen
  → X-Accel-Redirect-Header setzen (falls Nginx vorgeschaltet)
  → Oder: Stream via fs.createReadStream (ohne Nginx)
```

Sicherheitsimplikation: Direkter Dateipfad-Zugriff ohne Auth-Check ist nicht möglich. Alle Datei-URLs enthalten den Gallery-Slug als Scope.

### SSE-Strategie

- Fastify hält eine In-Memory-Map `galleryId → Set<SSEConnection>`
- Rate Limiting: max. 10 gleichzeitige SSE-Verbindungen pro IP
- Nach Moderation: Server pusht `event: new-photo` mit `{ id, thumbUrl, createdAt }`
- Heartbeat alle 30s (`event: ping`) gegen Proxy-Timeouts
- **Client-seitiger SSE-Wrapper** mit exponential backoff: reconnect bei Netzwerkfehler und HTTP 5xx, kein Retry bei 401/403

### Logging (Pino)

Fastify nutzt Pino (eingebaut). Geloggt werden:

| Event | Log-Level |
|---|---|
| Upload gestartet (galleryId, mimeType, fileSize) | `info` |
| Upload abgeschlossen (photoId, duration) | `info` |
| Upload abgelehnt (Duplikat, falscher Typ, zu groß) | `warn` |
| Admin-Login (Erfolg/Fehler, IP) | `info` / `warn` |
| Moderation-Aktion (photoId, action, adminId) | `info` |
| SSE-Verbindung auf/zu (galleryId, connectionCount) | `debug` |
| Sharp-Fehler | `error` |
| DB-Fehler | `error` |

Logs in JSON-Format für einfaches Parsing mit Tools wie Loki oder grep.

---

## Frontend-Struktur

### Routing (Next.js App Router)

**App Router** ist explizit gewählt. Pages Router wird nicht verwendet.

```
/                               → Redirect zur ersten Galerie oder Setup-Page
/g/[slug]                       → Galerie-Ansicht        (Server Component)
/g/[slug]/upload                → Upload-Seite           (Client Component)
/g/[slug]/slideshow             → Vollbild-Slideshow     (Client Component, eigenes layout.tsx)
/admin                          → Login                  (Client Component)
/admin/dashboard                → Übersicht              (Server Component)
/admin/galleries/new            → Galerie erstellen      (Client Component)
/admin/galleries/[id]           → Galerie bearbeiten     (Client Component)
/admin/galleries/[id]/moderate  → Moderations-Dashboard  (Client Component)
/setup                          → First-Run Setup        (Client Component, nur bei fehlendem Admin)
```

**Layout-Regeln:**
- `/g/[slug]/slideshow` hat eigene `layout.tsx`: kein Header/Footer, `overflow: hidden`, `bg-black`.
- Alle anderen Routen erben das globale `app/layout.tsx`.

### Server vs. Client Components

| Route / Komponente | Typ | Begründung |
|---|---|---|
| `GalleryPage` | Server Component | Initiales Foto-Laden ohne Client-JS-Overhead |
| `PhotoGrid` | Server Component | Statisches Thumbnail-Rendering |
| `Lightbox` | Client Component | DOM-Events, Swipe-Gestures, Tastatur |
| `UploadPage` | Client Component | FileDropzone, Fortschrittsbalken, AbortController |
| `SlideshowPage` | Client Component | SSE-Stream, Animations-State |
| `AdminDashboard` | Server Component | Statische Übersicht, kein Client-State |
| `AdminModerationPage` | Client Component | Batch-Auswahl, optimistic updates |

### State Management

- **TanStack Query** für alle Server-Daten (Gallery-Fotos mit Cursor-Pagination, Admin-Listen). Automatischer Refetch, optimistic updates bei Moderation-Aktionen.
- **Zustand** für lokalen Client-State:
  - Upload-Queue: `{ files: FileItem[], addFile, updateProgress, cancelFile, removeFile }`
  - SSE-Photo-Stream: `{ photos: Photo[], appendPhoto }` — neues Foto via SSE → Array-Append → Slideshow-Render

### Komponenten-Hierarchie

```
GalleryPage (Server Component)
  ├── GalleryHeader           (Name, Beschreibung, Foto-Anzahl, QR-Hint)
  ├── PhotoGridSkeleton        (Skeleton beim Laden, Tailwind animate-pulse)
  ├── PhotoGrid (Server)       (react-masonry-css für Masonry; CSS Grid für gleichmäßig)
  │     └── PhotoCard          (next/image, Lazy Load)
  ├── Lightbox (Client)        (Vollbild, Vor/Zurück, Swipe-Gesture, Download, Error Boundary)
  ├── UploadButton             (→ /upload, prominent, sticky bottom auf Mobile)
  └── EmptyState               (falls keine freigegebenen Fotos)

UploadPage (Client Component)
  ├── GuestNameInput           (optional/pflicht/versteckt per Config)
  ├── FileDropzone             (Drag & Drop; accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"; capture="environment" auf Mobile)
  ├── FileQueue                (pro Datei: client-side Größencheck vor Upload, Fortschrittsbalken, Cancel via AbortController, Retry-Button bei Fehler)
  ├── MaxConcurrentUploads     (3 parallele Uploads; weitere warten in Queue)
  └── SubmitFeedback           (Pending-Confirmation-Screen nach erfolgreichem Upload)

SlideshowPage (Client Component, eigenes layout.tsx)
  ├── PhotoDisplay             (object-fit: contain, Crossfade 1.2s, SSE-getrieben)
  ├── QRHintSlide              (text-2xl, konfigurierbar, alle N Fotos eingeblendet)
  ├── Controls                 (Play/Pause, Vor/Zurück, Tastatur-Shortcuts)
  └── SlideshowErrorBoundary   (zeigt letztes Foto bei SSE-Fehler, kein Crash)

AdminModerationPage (Client Component)
  ├── ModerationStats          (gesamt / freigegeben / ausstehend / abgelehnt)
  ├── PhotoQueue               (TanStack Query, Batch-Auswahl)
  │     └── ModerationCard     (Freigeben / Ablehnen / Verschieben; Keyboard-Shortcuts: A=approve, R=reject)
  ├── BatchActionBar           (Batch-Aktionen für ausgewählte Fotos)
  └── EmptyState               (falls Queue leer)
```

### Upload-Details

- **Client-seitiger Größencheck:** Vor dem Upload-Start wird `file.size > MAX_FILE_SIZE_MB * 1024 * 1024` geprüft. Fehler sofort anzeigen, kein unnötiger Netzwerk-Request.
- **`accept`-Attribut:** `accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"` — filtert im Datei-Dialog (nicht sicherheitsrelevant, nur UX).
- **Maximale Parallelität:** 3 gleichzeitige Uploads. Weitere Dateien warten in der Queue. Verhindert Netzwerküberlastung auf mobilem Netz.
- **AbortController:** Jeder Upload-Task hält eine `AbortController`-Instanz. Cancel-Button → `controller.abort()`.
- **Retry:** Bei Netzwerkfehler (nicht bei 409/413) zeigt die FileQueue einen "Erneut versuchen"-Button.
- **HEIC-Vorschau:** Keine clientseitige Konvertierung. Upload-Response enthält `thumbUrl` (serverseitiges WEBP-Thumbnail). FileQueue zeigt diesen Thumb — kein kaputtes `<img>`.

### Lightbox

- **Swipe-Gesture:** `touch-start` / `touch-end` Delta > 50px → Vor/Zurück. Implementiert ohne externe Library (native Touch-Events).
- **Tastatur:** ArrowLeft/ArrowRight navigieren, Escape schließt.
- **Download:** Direktlink auf `/files/:gallerySlug/:filename` (nur sichtbar falls `allowGuestDownload = true`).

### Styling & UX

- **Tailwind CSS** — Mobile-first, Dark Mode via `class`-Strategy (System-Präferenz + manueller Toggle)
- **WCAG 2.1 AA** — Kontrastverhältnisse, Alt-Texte, Keyboard-Navigation in Lightbox und Moderation
- **i18n:** `next-intl`, Sprachdateien `src/i18n/de.json` + `en.json`; Sprache via `DEFAULT_LANG` Env oder `Accept-Language`-Header
- **Progressive Loading:** Thumbnails via `next/image` mit Lazy Loading und `blur`-Placeholder (generiert beim Upload)
- **Slow-Network-Degradation:** Thumbnails auf Mobilgeräten werden in kleinerer Größe angefordert (`sizes` Attribut via `next/image`). Vollbild nur bei Lightbox-Öffnung geladen.

---

## Sicherheit & Datenschutz

| Bereich | Maßnahme |
|---|---|
| Passwörter | bcrypt (cost 12) |
| Sessions | HTTP-only Cookie, 24h TTL, serverseitig invalidierbar, `createdAt` für Audit |
| CSRF | `@fastify/csrf-protection` (Double Submit Cookie) auf allen Admin-POST/PATCH/DELETE |
| Security-Headers | `@fastify/helmet` — CSP, `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: strict-origin` |
| Brute-Force Admin | Lockout nach X Fehlversuchen (default: 5), konfigurierbar |
| Brute-Force PIN | Max. 10 Versuche pro IP, 15min Block (Rate Limiting) |
| 2FA | TOTP (otplib), Phase 3, `TOTP_ENABLED=true`; Secret AES-256-GCM at-rest |
| MIME-Validierung | Magic Bytes via `file-type` — kein Vertrauen in `Content-Type`-Header |
| File-Size | Fastify `bodyLimit = MAX_FILE_SIZE_MB × 1024²` — vor Sharp-Verarbeitung |
| Rate Limiting | `@fastify/rate-limit`: Upload (20/min/IP), Login (5/min/IP), SSE (10 Verbindungen/IP) |
| Datei-Serving | Auth-geprüfte Route, kein öffentliches Static-Verzeichnis |
| EXIF | Sharp entfernt Geo-Metadaten vor Speicherung (`EXIF_STRIP=true` default) |
| Galerie-PIN | bcrypt-gehasht, nicht in QR-URL eingebettet, separater Eingabe-Screen |
| robots.txt | `Disallow: /g/`, `Disallow: /files/` |
| HTTPS | Redirect HTTP→HTTPS konfigurierbar, HSTS-Header via `@fastify/helmet` |
| Duplikate | `@@unique([galleryId, fileHash])` — Scope pro Galerie |
| CORS | `@fastify/cors`, nur `FRONTEND_URL` als erlaubter Origin |
| SESSION_SECRET Rotation | Rotation invalidiert alle aktiven Sessions. Dokumentiert in `docs/security.md`. Empfehlung: Rotation nach jedem Event. |

---

## Konfiguration

### `.env.example`

```bash
# Datenbank
DATABASE_URL=file:./data/db.sqlite   # oder postgresql://...

# Storage
STORAGE_TYPE=local                   # oder "s3"
STORAGE_LOCAL_PATH=./data/uploads
S3_ENDPOINT=
S3_BUCKET=
S3_ACCESS_KEY=
S3_SECRET_KEY=

# Admin
ADMIN_PASSWORD_HASH=                 # bcrypt-Hash (via First-Run-Setup gesetzt)
SESSION_SECRET=                      # zufälliger String, min. 32 Zeichen
TOTP_ENCRYPTION_KEY=                 # Phase 3: 32-Byte Hex für AES-256 TOTP-Verschlüsselung

# Frontend
FRONTEND_URL=http://localhost:3000   # für CORS

# Features
SINGLE_GALLERY_MODE=false            # true = vereinfachte UI ohne Sub-Event-Navigation
EXIF_STRIP=true
MAX_FILE_SIZE_MB=50
DEFAULT_LANG=de                      # de | en
TOTP_ENABLED=false                   # Phase 3

# Slideshow
SLIDESHOW_INTERVAL_SECONDS=8

# SMTP (optional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Webhooks (optional, Phase 3)
WEBHOOK_URL=
NTFY_TOPIC=
```

### Initial-Setup / First-Run

1. `docker-compose up` startet beide Services
2. Backend führt beim Start `prisma migrate deploy` aus (automatisch)
3. Kein `ADMIN_PASSWORD_HASH` gesetzt → Backend aktiviert einmaligen Setup-Endpunkt `POST /setup`
4. Frontend zeigt `/setup`-Seite: Username + Passwort eingeben
5. Backend hasht Passwort (bcrypt), schreibt Hash in `.env` (Docker-Volume), deaktiviert `/setup`
6. Normal-Betrieb startet. `/setup` antwortet ab jetzt mit 404.

### Backup

SQLite-Backup-Empfehlung (in `docs/deployment.md` dokumentiert):
```bash
# Tägliches Backup via Cron (auf dem Host)
cp data/db.sqlite backups/db-$(date +%Y%m%d).sqlite
tar -czf backups/uploads-$(date +%Y%m%d).tar.gz data/uploads/
```
Für PostgreSQL: `pg_dump` via Cron oder Managed-DB-Backup-Feature.

---

## Features

### Phase 1 — MVP

1. Admin-Login (Passwort + Session + Brute-Force + CSRF + Security-Headers)
2. First-Run Setup Flow
3. Single-Gallery-Mode und Multi-Gallery-Mode (Feature-Flag)
4. Gäste-Upload ohne Account (JPEG, PNG, WEBP, HEIC, MP4, MOV)
5. Client-side Größencheck, Magic Bytes Validierung, Fastify bodyLimit
6. Pre-Moderation (Freigeben / Ablehnen / Batch), Admin-Direct-Upload
7. Galerie-Ansicht: Masonry-Grid (react-masonry-css), Lightbox mit Swipe, Lazy Loading
8. Pending-Confirmation-Screen nach Upload, vollständige Fehler-Screens
9. Empty States für alle Leer-Szenarien
10. QR-Code on-demand (PNG + SVG)
11. Basis-Slideshow (manuell, kein Realtime) mit Dark-Mode-optimierter UI
12. Health-Check-Endpunkte, Pino-Logging
13. Docker Compose + automatische Migrations

### Phase 2

14. Live-Slideshow mit SSE + custom Reconnect-Wrapper
15. Multi-Galerie-Mode UI (falls in Phase 1 nur Single-Mode)
16. ZIP-Download (Admin Originalqualität + optional Gäste)
17. E-Mail-Benachrichtigungen (SMTP)
18. Upload-Zeitfenster (inkl. mehrtägige Events)
19. S3-Speicher-Backend
20. Cursor-based Pagination
21. Retry-Mechanismus für fehlgeschlagene Uploads

### Phase 3

22. EXIF-Entfernung (konfigurierbar, Sharp)
23. 2FA (TOTP) mit AES-256-GCM verschlüsseltem Secret
24. Galerie-PIN-Schutz (Secret Key)
25. Weitere i18n-Sprachen (Community)
26. Druckbares Tischkärtchen (PDF-Export)
27. Webhook + NTFY-Integration
28. Worker Threads / BullMQ für Sharp-Processing
29. Galerie-Abschluss und Archivierungs-Flow
30. Fotograf-Modus (direkter Bulk-Upload mit Auto-Approval)

---

## Out-of-Scope (MVP)

- KI-Gesichtserkennung / automatische Foto-Zuordnung
- Likes, Kommentare, Social Features
- Audio-/Video-Gästebuch
- RSVP / Hochzeitsplanung
- Bezahlmodell / Abonnements
- Native Mobile Apps (iOS / Android)
- Bildbearbeitung / Filter
- WhatsApp / Messenger-Suite

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Sprache | TypeScript (`strict: true`) überall |
| Frontend | Next.js 14+ (App Router), Tailwind CSS, next-intl |
| Fonts | Inter + Playfair Display via `next/font` (self-hosted) |
| Icons | Lucide React |
| State (Client) | TanStack Query (Server-Daten), Zustand (Upload-Queue, SSE-State) |
| Masonry | react-masonry-css |
| Backend | Fastify (Node.js) |
| ORM | Prisma mit Enums (SQLite default, PostgreSQL optional) |
| Bild-Processing | Sharp (Thumbnails, WEBP, EXIF-Strip, HEIC→WEBP) |
| MIME-Validierung | `file-type` (Magic Bytes) |
| QR-Code | `qrcode` npm-Paket (serverseitig, on-demand) |
| Realtime | Server-Sent Events (SSE) + custom Reconnect-Wrapper |
| Storage | Lokales FS / S3-kompatibel (AWS SDK v3) |
| Auth | bcrypt, HTTP-only Sessions, otplib (TOTP Phase 3) |
| Verschlüsselung | Node.js `crypto` (AES-256-GCM für TOTP-Secrets, Phase 3) |
| Security | `@fastify/csrf-protection`, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` |
| Logging | Pino (Fastify built-in) |
| Monorepo | pnpm workspaces + Turborepo |
| Container | Docker + Docker Compose |
| Lizenz | MIT |
