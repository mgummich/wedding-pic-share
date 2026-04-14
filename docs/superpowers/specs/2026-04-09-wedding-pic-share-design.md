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
- **Monorepo:** `pnpm workspaces` + **Turborepo** — Frontend und Backend teilen das Prisma-Paket und TypeScript-Typen. Build-Reihenfolge: `packages/db`, `packages/shared` → `apps/backend`, `apps/frontend`. Package-Referenzen via `workspace:*` Protokoll: `"@wedding/db": "workspace:*"` in `apps/backend/package.json`.
- **CORS:** `@fastify/cors` — erlaubt ausschließlich `FRONTEND_URL` als Origin. Keine Wildcard.
- **TypeScript:** Strikt mandatiert (`strict: true`) in allen Packages. Geteilte Typen via `packages/db` eliminieren Typ-Drift zwischen Frontend und Backend.

### Repo-Struktur

```
wedding-pic-share/
├── apps/
│   ├── frontend/          # Next.js (App Router, TypeScript)
│   └── backend/           # Fastify (TypeScript)
├── packages/
│   ├── db/                # Prisma Schema, Migrations, generierte Typen
│   └── shared/            # Geteilte API Response Types (kein Prisma-Abhängigkeit)
├── turbo.json             # Build-Reihenfolge: db, shared → backend, frontend
├── docker-compose.yml
├── .env.example
└── docs/
    └── superpowers/specs/
```

**`packages/shared` — API Response Types:**
Alle Typen die zwischen Frontend und Backend geteilt werden, leben hier. Keine Prisma-Imports — nur Plain-TypeScript-Interfaces. Verhindert versehentliche Datenlecks (z.B. `passwordHash` im Response-Typ).

```typescript
// packages/shared/types/photo.ts
export interface PhotoResponse {
  id: string
  thumbUrl: string
  displayUrl: string
  guestName: string | null
  createdAt: string
}

// packages/shared/types/gallery.ts
export interface GalleryResponse {
  id: string
  name: string
  slug: string
  description: string | null
  layout: 'MASONRY' | 'GRID'
  allowGuestDownload: boolean
  guestNameMode: 'OPTIONAL' | 'REQUIRED' | 'HIDDEN'
  photoCount: number
  // KEIN secretKey, KEINE internen Felder
}

// packages/shared/types/photo.ts (erweitert)
export interface PhotoResponse {
  id: string
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string        // Für Videos: Poster-Frame URL
  displayUrl: string      // Für Videos: Original-Video URL
  duration: number | null // Videos: Länge in Sekunden
  guestName: string | null
  createdAt: string
}

// packages/shared/types/upload.ts
export interface UploadResponse {
  id: string
  status: 'PENDING' | 'APPROVED'
  mediaType: 'IMAGE' | 'VIDEO'
  thumbUrl: string
  duration: number | null
}
```

### Architecture Decision Records (ADRs)

**ADR-001: SQLite als Default-Datenbank**
- **Status:** Entschieden
- **Kontext:** Self-hosted, typisch < 5000 Fotos pro Event, Single-Instance
- **Entscheidung:** SQLite mit WAL-Mode. Zero-Config, Backup = eine Datei, kein separater DB-Service.
- **Mitigation:** WAL-Mode (`PRAGMA journal_mode=WAL`) aktiviert concurrent reads + serialized writes. Bei > 20 gleichzeitigen Uploads ausreichend für Hochzeits-Workload (Bursts, nicht sustained).

**ADR-002: SSE statt WebSocket für Realtime**
- **Status:** Entschieden
- **Entscheidung:** SSE. Unidirektionaler Push (Server→Client) reicht für Slideshow. Einfacher als WebSocket, HTTP-kompatibel, kein Upgrade-Handshake.
- **Mitigation:** Connection-ID-basiertes Dedup in der SSE-Map (verhindert Phantom-Connections bei Reconnect).

**ADR-003: In-Memory SSE-Map statt Redis**
- **Status:** Entschieden für MVP
- **Entscheidung:** In-Memory. Redis wäre Over-Engineering für Single-Instance MVP.
- **Upgrade-Pfad:** SSE-Handler-Interface bleibt stabil — nur die Map-Implementierung wird gegen Redis Pub/Sub ausgetauscht wenn horizontales Scaling nötig wird.

**ADR-004: REST statt tRPC**
- **Status:** Entschieden
- **Entscheidung:** REST. Begründung: (1) Breitere Client-Kompatibilität (Curl, externe Tools), (2) SSE ist native HTTP — kein tRPC-Overhead, (3) Externe API-Nutzung durch Community möglich, (4) `packages/shared` liefert Type-Safety ohne tRPC-Overhead.

**ADR-005: Direkter Upload (Fastify) statt Presigned S3 URLs**
- **Status:** Entschieden
- **Option A (gewählt):** `POST /g/:slug/upload` → Fastify → MIME-Check → Sharp/ffmpeg → Storage
  - Pro: Vollständige Kontrolle, EXIF-Strip vor Storage, Magic-Bytes-Validierung, funktioniert für Local-FS
  - Con: Fastify leitet alle Bytes durch — Memory-Pressure bei vielen großen Videos
- **Option B (verworfen):** Client → Presigned S3 URL direkt
  - Pro: Fastify hat keine Upload-Last
  - Con: EXIF-Strip und Validierung nur nachgelagert möglich, funktioniert nicht für Local-FS

**ADR-006: Alpine statt Debian für Docker-Images**
- **Status:** Entschieden
- **Entscheidung:** `node:20-alpine` + `apk add vips-heif ffmpeg`. ~50MB Base statt ~350MB. Sharp Pre-built-Binaries ab v0.32+ auf Alpine verfügbar.

### Bekannte Architektur-Einschränkungen

**Backend ist nicht stateless:** Die SSE-Verbindungen werden in einer In-Memory-Map gehalten (`galleryId → Set<SSEConnection>`). Das verhindert horizontales Scaling (mehrere Backend-Instanzen). Für MVP mit Single-Instance ist das akzeptabel und explizit dokumentiert.

**Upgrade-Pfad zu Redis Pub/Sub:** Wenn horizontales Scaling nötig wird, ersetzt Redis Pub/Sub die In-Memory-Map. Die SSE-Handler-Schnittstelle ist so designed, dass der Austausch ein lokales Refactoring bleibt (kein API-Change).

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

enum MediaType {
  IMAGE
  VIDEO
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
  slug               String
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

  @@unique([weddingId, slug])  // Slug unique pro Wedding, nicht global
                               // Zwei verschiedene Weddings können beide "party" haben
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
  mediaType        MediaType   @default(IMAGE)
  originalPath     String
  thumbPath        String      // Für Bilder: 400px WEBP; für Videos: Poster-Frame WEBP
  displayPath      String      // Für Bilder: 1920px WEBP; für Videos: identisch mit originalPath
  posterPath       String?     // Videos: Pfad zum extrahierten Poster-Frame (ffmpeg)
  blurDataUrl      String      // Base64 10px blur placeholder (aus thumbPath)
  duration         Int?        // Videos: Länge in Sekunden (aus ffprobe)
  mimeType         String
  status           PhotoStatus @default(PENDING)
  rejectionReason  String?
  exifStripped     Boolean     @default(false)
  createdAt        DateTime    @default(now())
  updatedAt        DateTime    @updatedAt

  deletedAt        DateTime?   // Soft Delete — null = aktiv; gesetzt = gelöscht
                               // Datei-Cleanup via Background-Job (verhindert Inkonsistenz bei S3-Fehler)

  @@unique([galleryId, fileHash])
  @@index([galleryId, status, createdAt(sort: Desc)])
  @@index([galleryId, status])
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

### SQLite-Konfiguration (WAL-Mode)

SQLite ohne WAL-Mode hat einen Write-Lock — bei gleichzeitigen Uploads entsteht `SQLITE_BUSY`. WAL-Mode aktiviert concurrent reads + serialized writes:

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA busy_timeout=5000;
```

Wird im Prisma-Client als `afterConnect`-Hook gesetzt:
```typescript
prisma.$executeRaw`PRAGMA journal_mode=WAL`
```

Bei PostgreSQL entfällt dieser Schritt. `.env.example` Hinweis für PostgreSQL Connection Pool:
```bash
DATABASE_URL=postgresql://user:pass@host/db?connection_limit=10&pool_timeout=20
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

### Jobs-to-be-Done

**Gast:**
- "Ich will meine schönsten Momente mit dem Brautpaar teilen" → Upload-Flow
- "Ich will die Fotos anderer Gäste sehen" → Galerie-Ansicht
- "Ich will meine eigenen Fotos runterladen" → Download (falls erlaubt)

**Brautpaar / Admin:**
- "Ich will alle Fotos am Ende des Tages haben" → ZIP-Export
- "Ich will keine peinlichen Fotos in der Galerie" → Pre-Moderation
- "Ich will, dass meine Gäste wirklich hochladen" → QR-Code, 10s-Friction-Ziel

**Explizit nicht adressiert im MVP:** "Gast will eigene Fotos wiederfinden" (kein Gastaccount) — ist Out-of-Scope und dokumentiert.

### Privacy-First — Was es bedeutet und wo die Grenzen sind

"Privacy by default" bedeutet konkret:
- Keine externen Services ohne explizite Konfiguration (SMTP, Webhooks sind opt-in, default: deaktiviert)
- Keine Tracking-Cookies, kein Analytics, keine CDN-Anfragen ohne Konfiguration
- Fotos werden lokal oder auf selbst-kontrolliertem S3 gespeichert
- EXIF/GPS standardmäßig entfernt
- Keine Indexierung durch Suchmaschinen

Was Privacy-First **nicht** bedeutet:
- SMTP-Benachrichtigungen senden Metadaten an den konfigurierten SMTP-Server — das ist bewusst opt-in
- Webhooks senden Event-Daten an externe URLs — ebenfalls opt-in
- Wenn S3 konfiguriert wird, verlassen Fotos den lokalen Server — bewusste Admin-Entscheidung

**DSGVO:** Der Admin ist verantwortlicher im Sinne der DSGVO. Die Dokumentation enthält einen DSGVO-Hinweis mit empfohlenen Maßnahmen (Löschfristen, keine Weitergabe an Dritte). Das Tool unterstützt DSGVO-Compliance, garantiert sie aber nicht.

### Moderation auf Mobile (während der Hochzeit)

Der Admin moderiert oft vom Smartphone auf der Tanzfläche. `AdminModerationPage` ist Mobile-first:
- Große Touch-Targets (min. 48px) für Freigeben/Ablehnen-Buttons
- Swipe-Geste: rechts = freigeben, links = ablehnen (Phase 2)
- Batch-Auswahl via Long-Press (Phase 2)
- Keyboard-Shortcuts nur als Desktop-Bonus, nicht primär

### Galerie-PIN-Distribution (Phase 3)

Wenn `secretKey` für eine Galerie gesetzt ist:
- PIN wird im Admin-Panel angezeigt und ist auf dem druckbaren Tischkärtchen enthalten
- PIN wird **nicht** in die QR-Code-URL eingebettet (Security: URL könnte geteilt werden)
- Gast gibt PIN auf separatem Screen ein, bevor er die Galerie sieht/uploadet
- PIN wird clientseitig mit dem Request mitgeschickt und serverseitig gegen den bcrypt-Hash geprüft
- Falsche PIN: max. 10 Versuche pro IP, dann temporärer Block (Rate Limiting)

### Event-Abschluss-Flow ("Ende der Hochzeit")

Wenn das Upload-Zeitfenster endet oder der Admin die Galerie abschließt:

**Gast-Seite:**
```
Upload-Zeitfenster endet
  → Galerie zeigt Banner: "Der Upload-Zeitraum ist beendet. Danke für eure Momente!"
  → Upload-Button verschwindet (nicht disabled, entfernt)
  → Galerie bleibt lesbar und downloadbar (falls erlaubt)
```

**Admin-Abschluss-Flow:**
- Admin klickt "Galerie abschließen" → Bestätigungsdialog mit ZIP-Export-Hinweis
- Nach Abschluss: Dashboard zeigt Zusammenfassung (Anzahl Fotos, Gäste, Zeitraum)
- E-Mail an Admin (falls SMTP konfiguriert): "Eure Galerie ist gesichert — XY Fotos von Z Gästen"

**Status-Übergänge:**
```
ACTIVE → CLOSED  (Uploads deaktiviert, Galerie lesbar)
ACTIVE → ARCHIVED (Unsichtbar für Gäste, Daten erhalten)
* → DELETED       (irreversibel, Bestätigungsdialog + ZIP-Hinweis)
```

**DSGVO-Hinweis** in der Doku: Empfohlene Löschfrist 6–12 Monate nach Event. Admin ist Verantwortlicher.

### Moderations-Erschöpfungs-UX

Szenario: 200 pending Fotos um Mitternacht nach der Feier.

- **"Alles freigeben"-Button:** Einmalige Bulk-Freigabe aller pending Fotos (mit Bestätigungsdialog)
- **Temporärer Auto-Approve-Modus:** Admin kann `moderationMode` auf `AUTO` schalten — neue Uploads erscheinen sofort. Rückkehr zu `MANUAL` jederzeit. Banner im Admin zeigt aktiven Modus.
- **Prioritäts-Sortierung:** Neueste Fotos zuerst in der Moderations-Queue (Admin will Live-Reaktionen sehen, nicht Fotos von vor 6 Stunden)

### Data Retention

- Admin kann eine Galerie löschen: Alle Fotos + DB-Einträge gelöscht (irreversibel, Bestätigungsdialog + ZIP-Hinweis)
- Soft-Delete für Photos: `deletedAt` gesetzt → Datei-Cleanup via Background-Job
- **DSGVO-Hinweis** in der Doku: Empfohlene Löschfrist 6–12 Monate nach Event.

---

## Design-System

Das ist ein emotionales Produkt. Die UI ist die Bühne — kein Tech-Tool, sondern ein stilles, elegantes Album. Aesthetik: **"Warmes Archiv" — Editorial + Natural**.

### Farbpalette & CSS Variables

```css
:root {
  /* Surface */
  --color-surface-base:   #FAF7F4;  /* cremeweiß, kein Startup-White */
  --color-surface-card:   #FFFFFF;
  --color-border:         #E8E2DC;  /* warm, nicht neutral-grau */

  /* Typografie */
  --color-text-primary:   #2C2C2C;  /* fast-schwarz, warm */
  --color-text-muted:     #7A746E;

  /* Accent */
  --color-accent:         #C4956A;  /* warmes Gold */
  --color-accent-hover:   #B08050;

  /* Status */
  --color-success:        #4A7C59;
  --color-error:          #C0392B;

  /* Spacing */
  --spacing-base: 8px;

  /* Radien */
  --radius-card:  12px;
  --radius-thumb: 4px;   /* Fotos: leicht gerundet, nicht circular */

  /* Slideshow (Beamer/TV) */
  --slideshow-bg:         #0F0E0C;  /* warmschwarzes Tief */
  --slideshow-surface:    #1A1916;
  --slideshow-text:       #F0EBE3;
  --slideshow-accent:     #D4A870;
}
```

Tailwind nutzt diese Tokens via `tailwind.config.ts` in `packages/shared` — geteilt zwischen allen Apps.

### Typografie

- **Body:** `DM Sans` (ruhig, lesbar, nicht korporativ) — ersetzt Inter
- **Display/Titel:** `Playfair Display` (Serif, romanisch, zeitlos) — für Galerie-Überschriften und emotionale Momente
- **Monospace:** System-default, nur Admin-Panel für technische Inhalte
- Beide Fonts via `next/font` self-hosted (kein externer CDN-Request)

### Icon-Set

**Lucide Icons** (`lucide-react`) — konsistente Strichstärke, MIT-Lizenz, tree-shakeable.

### Visuelle Differenzierungen

1. **Foto-Thumbnails:** Leichter Schatten + `--radius-thumb: 4px` — "auf dem Tisch ausgebreitet", nicht brutaler Grid
2. **Upload-Button:** Warmes Amber/Gold mit Kamera-Icon, sticky bottom. Label: "Moment festhalten" (nicht "Datei hochladen")
3. **Galerie-Hintergrund:** Subtile Noise-Textur, Opacity 3% — kein reines Weiß
4. **Slideshow-Hintergrund:** Vignette-Effekt (`box-shadow: inset 0 0 200px rgba(0,0,0,0.8)`) — Kinoatmosphäre

### Animation-Tokens & Motion-Strategie

```css
/* Slideshow */
--slideshow-crossfade-duration: 800ms;    /* weich, nicht träge */
--slideshow-crossfade-easing: ease-in-out;
--slideshow-display-duration: 8000ms;     /* konfigurierbar via Env */

/* UI Micro-Animations */
--transition-fast: 150ms ease;
--transition-base: 250ms ease;
--transition-slow: 400ms ease;
```

**Staggered Gallery Reveal:** Fotos erscheinen nacheinander beim Laden (max. 20 Items, dann synchron):
```css
.photo-card { animation: fadeUp 400ms ease-out both; }
.photo-card:nth-child(n) { animation-delay: calc(n * 60ms); }
@keyframes fadeUp { from { opacity: 0; transform: translateY(12px); } to { opacity: 1; transform: none; } }
```

**Upload-Button Pulse** (nur wenn Galerie leer):
```css
@keyframes gentle-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(196, 149, 106, 0.4); }
  50%       { box-shadow: 0 0 0 8px rgba(196, 149, 106, 0); }
}
```

**Reduced Motion (WCAG):**
```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

**Skeleton Shimmer:** Gradient `#FAF7F4 → #E8E2DC → #FAF7F4` — warm, kein kaltes Grau.

### QR-Code-Design

QR-Code ist das physische Interface zwischen Offline und Online — landet auf Tischkärtchen, Drucken, Präsentationen:

- **Error-Correction:** `M` (15%) für digitale Anzeige; `H` (30%) für gedruckte Karten (verträgt Kaffeeflecken, Knicke)
- **Farbe:** `#2C2C2C` auf `#FAF7F4` — passt zum Gesamt-Design, kein reines Schwarz-Weiß
- **Quiet Zone:** Mindestens 4 Module erzwungen (`margin: 4` in `qrcode`-Config)
- **Formate:** PNG (`scale: 10` = ~300dpi für Druck), SVG (vektorbasiert für Präsentationen)
- **Logo:** Optionaler Overlay in der Mitte (Phase 3, `qrcode` + Sharp compositing)

**Tischkärtchen-Export (Phase 3):** A6 Querformat (148×105mm). Layout: Galerie-Name oben, QR-Code mittig, kurze Anleitung unten ("Scanne den Code und teile deine Fotos"). PDF-Generierung via `@react-pdf/renderer`.

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

**Versionierungsstrategie:** v1 wird für mindestens 12 Monate nach einem v2-Release supported. Breaking Changes werden per `Sunset`-Header (`Sunset: Sat, 01 Jan 2028 00:00:00 GMT`) angekündigt. Non-breaking Additions (neue optionale Felder) erfordern keine neue Version.

### URL-Konvention

`/g/:slug` (Kurzform) ist bewusst gewählt für die Gast-URLs: QR-Codes müssen kurz und druckbar sein. Admin-URLs nutzen `/admin/galleries` (ausgeschrieben) für Lesbarkeit. Diese Inkonsistenz ist dokumentiert und intentional.

Fastify JSON Schema Validation ist auf allen Endpunkten aktiv — slug-Pattern: `^[a-z0-9-]+$`. Ungültige slugs geben 400 zurück, bevor der Handler läuft. `@fastify/multipart` wird für File-Uploads verwendet (nicht der built-in body parser).

### Öffentliche Endpunkte (kein Auth)

```
GET    /g/:slug?cursor=<id>&limit=20  → GalleryResponse + Photos (cursor-based)
POST   /g/:slug/upload                → UploadResponse (multipart, @fastify/multipart)
GET    /g/:slug/slideshow/stream      → SSE-Stream (neue Fotos, rate limited)
GET    /g/:slug/qr?format=png|svg     → QR-Code on-demand
GET    /g/:slug/download              → ZIP aller freigegebenen Fotos (Server prüft Gallery.allowGuestDownload — client-seitiges Verstecken des Buttons reicht nicht)
GET    /health                        → HealthResponse
GET    /ready                         → ReadyResponse
```

**Pagination:** Max. 20 Fotos pro Request. Response: `{ data: PhotoResponse[], pagination: { nextCursor: string|null, hasMore: boolean } }`. Cursor = ID des letzten Fotos (stabil, kein Offset-Drift).

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
  → Magic Bytes prüfen (file-type — MIME aus Dateiinhalt)
  → Erlaubte Typen: image/jpeg, image/png, image/webp, image/heic, video/mp4, video/quicktime
  → SHA-256 Hash berechnen → @@unique([galleryId, fileHash]) — Duplikat? → 409
  → mediaType bestimmen: image/* → IMAGE, video/* → VIDEO

  [IMAGE]
  → Sharp: thumb (400px WEBP) + display (1920px WEBP) + blur placeholder
  → EXIF: withMetadata({ icc: true }) — GPS entfernt, Farbprofil erhalten
  → Storage: thumb, display, original

  [VIDEO]
  → Original speichern
  → ffmpeg: Poster-Frame bei 1s → WEBP 400px (= thumbPath)
  → ffprobe: Dauer in Sekunden → Photo.duration
  → Sharp: blur placeholder aus Poster-Frame
  → Storage: original + poster

  → DB: Photo { status: PENDING, mediaType, thumbPath, displayPath, posterPath?, duration? }
  → SMTP-Notification an Admin (falls konfiguriert)
  → Response: { id, status: "PENDING", thumbUrl, mediaType, duration }
  // thumbUrl zeigt Poster-Frame für Videos — sofortige Vorschau auch für HEIC
```

**`@fastify/multipart` Limits (explizit konfiguriert):**
```typescript
fastify.register(multipart, {
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,  // Bilder
    files: 10,       // max Dateien pro Request — verhindert 100-Datei-Angriff
    fields: 5,
    headerPairs: 100,
  }
})
// Videos: separater Endpunkt mit MAX_VIDEO_SIZE_MB-Limit
```

**SMTP ist fire-and-forget:** SMTP-Fehler darf den Upload nicht blockieren:
```typescript
async function notifyAdmin(photo: Photo) {
  try { await sendMail(...) }
  catch (err) { logger.error({ err }, 'smtp.notification.failed') }
  // kein rethrow — Upload war erfolgreich
}
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

### Fehler-Format (RFC 7807 Problem Details)

Alle API-Fehler folgen RFC 7807:

```json
{
  "type": "https://wedding-pic-share/errors/upload-window-closed",
  "title": "Upload Window Closed",
  "status": 403,
  "detail": "Der Upload-Zeitraum für diese Galerie endete am 2026-04-09T22:00:00Z.",
  "instance": "/api/v1/g/standesamt/upload"
}
```

Definierte Error-Types:

| type | status | Trigger |
|---|---|---|
| `duplicate-photo` | 409 | SHA-256 bereits in dieser Galerie |
| `unsupported-mime-type` | 415 | Magic Bytes nicht erlaubt |
| `file-too-large` | 413 | Überschreitet bodyLimit |
| `upload-window-closed` | 403 | Außerhalb Zeitfenster (Phase 2) |
| `gallery-not-found` | 404 | Slug unbekannt |
| `invalid-pin` | 401 | Falscher Secret Key |
| `rate-limited` | 429 | Enthält `Retry-After` Header |
| `unauthorized` | 401 | Fehlende/abgelaufene Session |

### Idempotenz für Batch-Operationen

`POST /admin/photos/batch` akzeptiert optionalen `Idempotency-Key`-Header. Bei gleichem Key innerhalb von 5 Minuten: gecachte Response zurückgeben (In-Memory-Map im Backend). Verhindert Doppel-Ausführung bei Netzwerkfehlern.

### SSE-Event-Format (explizit definiert)

```
event: new-photo
data: {"id":"clxyz","mediaType":"VIDEO","thumbUrl":"/api/v1/files/standesamt/clxyz?v=thumb","displayUrl":"/api/v1/files/standesamt/clxyz?v=display","duration":42,"guestName":"Max M.","createdAt":"2026-04-09T18:30:00Z"}

event: ping
data: {"ts":1744220400}

event: gallery-closed
data: {"reason":"upload_window_expired"}
```

**SSE-Connection Cleanup:** Beim Client-Disconnect (Verbindungsabbruch) wird die Verbindung sofort aus der In-Memory-Map entfernt. Fastify `request.raw` `close`-Event triggert das Cleanup. Ohne das: Memory Leak bei vielen Slideshow-Clients.

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
  │     └── MediaCard          (Bild: next/image + blur; Video: <video> inline mit Poster-Frame,
  │                             Play-Button-Overlay, Dauer-Badge, autoplay on hover auf Desktop,
  │                             tap-to-play auf Mobile; muted default, Ton-Toggle)
  ├── MediaLightbox (Client)   (Vollbild; Bilder: next/image; Videos: <video controls autoplay>;
  │                             Vor/Zurück, Swipe-Gesture, Download, Error Boundary)
  ├── UploadButton             (→ /upload, prominent, sticky bottom auf Mobile)
  └── EmptyState               (falls keine freigegebenen Medien)

UploadPage (Client Component)
  ├── GuestNameInput           (optional/pflicht/versteckt per Config)
  ├── FileDropzone             (Drag & Drop; accept="image/jpeg,image/png,image/webp,image/heic,video/mp4,video/quicktime"; capture="environment" auf Mobile)
  ├── FileQueue                (pro Datei: client-side Größencheck vor Upload, Fortschrittsbalken, Cancel via AbortController, Retry-Button bei Fehler)
  ├── MaxConcurrentUploads     (3 parallele Uploads; weitere warten in Queue)
  └── SubmitFeedback           (Pending-Confirmation-Screen nach erfolgreichem Upload)

SlideshowPage (Client Component, eigenes layout.tsx)
  ├── MediaDisplay             (Bilder: <img> object-fit: contain, Crossfade 1.2s;
  │                             Videos: <video autoplay muted playsinline loop>,
  │                             läuft für `duration` Sekunden (oder max. SLIDESHOW_INTERVAL),
  │                             dann automatisch weiter zum nächsten Medium;
  │                             kein Crossfade bei Videos — harter Schnitt)
  ├── QRHintSlide              (text-2xl, alle N Medien eingeblendet)
  ├── Controls                 (Play/Pause, Vor/Zurück, Tastatur-Shortcuts)
  └── SlideshowErrorBoundary   (zeigt letztes Medium bei SSE-Fehler)

AdminModerationPage (Client Component)
  ├── ModerationStats          (gesamt / freigegeben / ausstehend / abgelehnt)
  ├── PhotoQueue               (TanStack Query, Batch-Auswahl)
  │     └── ModerationCard     (Freigeben / Ablehnen / Verschieben; Keyboard-Shortcuts: A=approve, R=reject)
  ├── BatchActionBar           (Batch-Aktionen für ausgewählte Fotos)
  └── EmptyState               (falls Queue leer)
```

### Upload-Details

- **Client-seitiger Größencheck:** `file.size > limit` vor Upload — sofortiger Fehler, kein Netzwerk-Request.
- **`accept`-Attribut:** `accept="image/*,video/mp4,video/quicktime"` — `image/*` auf iOS öffnet Kamera+Galerie-Auswahl automatisch. **Kein `capture`-Attribut** als Default — `capture="environment"` erzwingt nur Kamera und sperrt die Galerie-Auswahl. Optional: Toggle-Button "Kamera" / "Galerie" für explizite Auswahl.
- **Maximale Parallelität:** 3 gleichzeitige Uploads. Weitere Dateien warten in der Queue. Verhindert Netzwerküberlastung auf mobilem Netz.
- **AbortController:** Jeder Upload-Task hält eine `AbortController`-Instanz. Cancel-Button → `controller.abort()`.
- **Retry:** Bei Netzwerkfehler (nicht bei 409/413) zeigt die FileQueue einen "Erneut versuchen"-Button.
- **HEIC-Vorschau:** Keine clientseitige Konvertierung. Upload-Response enthält `thumbUrl` (serverseitiges WEBP-Thumbnail). FileQueue zeigt diesen Thumb — kein kaputtes `<img>`.

### Lightbox

- **Swipe-Gesture:** `touch-start` / `touch-end` Delta > 50px → Vor/Zurück. Implementiert ohne externe Library (native Touch-Events).
- **Tastatur:** ArrowLeft/ArrowRight navigieren, Escape schließt.
- **Download:** Direktlink auf `/files/:gallerySlug/:filename?original=true` (nur sichtbar falls `allowGuestDownload = true`). Lädt das Originalbild, nicht die optimierte Anzeige-Version.

---

## Browser-Kompatibilität & PWA

### Unterstützte Browser

**Mobile (primäre Zielgruppe):**

| Browser | Mindestversion | Besonderheiten |
|---|---|---|
| Safari iOS | 15+ | HEIC-Upload nativ, `capture="environment"` öffnet Kamera, `vh`-Einheit via `dvh` (dynamic viewport height) |
| Chrome Android | 108+ | Standard-Verhalten, kein HEIC-Support → serverseitige Konvertierung |
| Firefox Android | 115+ | Vollständig unterstützt |
| Samsung Internet | 20+ | Chromium-basiert, kein Sonderbedarf |

**Desktop:**

| Browser | Mindestversion |
|---|---|
| Chrome | 108+ |
| Firefox | 115+ |
| Safari macOS | 16+ |
| Edge (Chromium) | 108+ |

**Nicht unterstützt:** Internet Explorer, Legacy Edge (vor Chromium-Basis).

### iOS-spezifische Besonderheiten

- **Viewport Height:** `100vh` ist auf iOS Safari fehlerhaft (schließt URL-Leiste nicht ein). Slideshow und Fullscreen-UI nutzen `100dvh` (dynamic viewport height) mit `100vh` als Fallback.
- **HEIC-Upload:** iOS-Kamera schießt standardmäßig HEIC. `<input accept="image/*">` erlaubt iOS Safari, HEIC-Dateien zu liefern. Serverseitige WEBP-Konvertierung via Sharp.
- **Camera-Capture:** `<input capture="environment">` öffnet direkt die Rückkamera. Auf iOS nur in Safari vollständig unterstützt.
- **Scroll-Bounce:** `-webkit-overflow-scrolling: touch` deaktiviert für Slideshow-Vollbild.
- **Safe Areas:** `padding: env(safe-area-inset-*)` für Notch und Home-Indicator (iPhone X+).

### Progressive Web App (PWA)

Das Frontend wird als PWA ausgeliefert. Ziel: "Add to Home Screen" auf iOS und Android — kein App Store, kein Download, aber App-ähnliche UX.

**Implementierung:** `@ducanh2912/next-pwa` (basiert auf Workbox, aktiv gepflegt, Next.js App Router kompatibel).

**Web App Manifest (`/manifest.json`):**
```json
{
  "name": "Wedding Pics",
  "short_name": "WeddingPics",
  "description": "Teile deine Hochzeitsfotos",
  "start_url": "/",
  "display": "standalone",
  "background_color": "#FAFAF8",
  "theme_color": "#C4956A",
  "orientation": "any",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "/icons/icon-512-maskable.png", "sizes": "512x512", "type": "image/png", "purpose": "maskable" }
  ]
}
```

**Service Worker — Caching-Strategie:**

| Asset-Typ | Strategie | Begründung |
|---|---|---|
| Next.js Static Assets (JS, CSS) | `CacheFirst` | Selten geändert, sofort verfügbar |
| Galerie-Thumbnails | `StaleWhileRevalidate` | Zeige gecachte Version, update im Hintergrund |
| API-Responses (`/api/v1/g/*`) | `NetworkFirst` | Fotos müssen aktuell sein |
| Upload-Endpunkt | Kein Cache | Immer online |

**Offline-Verhalten:**
- Galerie bereits geladener Fotos ist offline lesbar (gecachte Thumbnails + API-Response)
- Upload offline nicht möglich → klare Fehlermeldung: "Kein Internet. Bitte versuche es erneut wenn du verbunden bist."
- Admin-Panel: offline nicht nutzbar → Offline-Fallback-Page

**"Add to Home Screen"-Prompt:**
- Kein aggressiver Install-Banner
- Dezenter Hinweis nach erstem erfolgreichem Upload: "Füge diese Seite zum Startbildschirm hinzu für schnelleren Zugriff"
- iOS: manuell via Share → "Zum Home-Bildschirm" (iOS unterstützt kein `beforeinstallprompt`)
- Android Chrome: `beforeinstallprompt` Event abfangen, Button anzeigen

### Styling & UX

- **Tailwind CSS** — Mobile-first, Dark Mode via `class`-Strategy (System-Präferenz + manueller Toggle)
- **WCAG 2.1 AA** — Kontrastverhältnisse, Alt-Texte, Keyboard-Navigation in Lightbox und Moderation
- **i18n:** `next-intl` mit App Router. **Entscheidung: Option C** — Locale nur im Admin; Gäste sehen immer `DEFAULT_LANG`. Begründung: Gast-URLs müssen kurz und QR-Code-freundlich bleiben (`/g/slug`, nicht `/de/g/slug`). Admin nutzt Locale via Cookie (`NEXT_LOCALE`). `middleware.ts` liest Cookie → setzt Locale für Admin-Routen; Gast-Routen ignorieren Locale-Präfix. Backend liefert immer englische Error-Types (RFC 7807), Frontend übersetzt.
- **Sharp vs. next/image:** Sharp für Upload-Zeit-Thumbnails (feste Größen, gecacht, WEBP). `next/image` nur für Admin-seitige Bilder mit flexiblen Größen (z.B. Cover-Image-Upload-Vorschau). Kein Double-Processing — klare Trennung.
- **Progressive Loading:** Thumbnails via `next/image` mit Lazy Loading und `blur`-Placeholder (generiert beim Upload)
- **Slow-Network-Degradation:** Thumbnails auf Mobilgeräten werden in kleinerer Größe angefordert (`sizes` Attribut via `next/image`). Vollbild nur bei Lightbox-Öffnung geladen.

---

## Bild-Pipeline (Optimierung & Qualitätsstufen)

### Docker-Abhängigkeiten für Media-Verarbeitung

Das Backend-Image braucht **Sharp (libheif via vips-heif)** für Bilder und **ffmpeg** für Videos.

**Entscheidung: `node:20-alpine`** — leichtgewichtig (~50MB Base statt ~350MB Debian). Alpine stellt `vips-heif` und `ffmpeg` direkt im Package-Repository bereit:

```dockerfile
FROM node:20-alpine AS runner
RUN apk add --no-cache \
    vips-heif \   # Sharp HEIC-Support (libvips + libheif)
    ffmpeg        # Poster-Frame-Extraktion + ffprobe
```

Sharp installiert auf Alpine automatisch Pre-built-Binaries (seit Sharp 0.32+, kein Kompilieren nötig). `vips-heif` stellt die HEIC-Codec-Unterstützung für libvips bereit.

### Media-Pipeline — Bilder (Sharp)

Jedes hochgeladene Bild erzeugt drei Varianten:

| Variante | Größe | Format | Qualität | Fit | Verwendung |
|---|---|---|---|---|---|
| `thumb` | max. 400px | WEBP | 75% | `inside` | Grid, Moderation, Poster-Placeholder |
| `display` | max. 1920px | WEBP | 85% | `inside` | Lightbox |
| `original` | unverändert | JPEG (HEIC→JPEG) oder PNG | 100% | — | Download |

```typescript
// thumb
sharp(input).resize(400, 400, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 75 })
// display
sharp(input).resize(1920, 1920, { fit: 'inside', withoutEnlargement: true }).webp({ quality: 85 })
// EXIF: ICC-Profil behalten (Farbgenauigkeit), nur GPS entfernen
.withMetadata({ icc: true })
```

- HEIC → JPEG für Original (universell kompatibel)
- `blurDataUrl`: 10px breites WEBP aus thumb, Base64-codiert → `next/image blurDataURL`

### Media-Pipeline — Videos (ffmpeg)

Videos werden **nicht** reencoded — Original bleibt unverändert. ffmpeg extrahiert nur einen Poster-Frame:

```
Video-Upload (MP4 / MOV)
  → Original gespeichert (kein Reencoding)
  → ffmpeg: Poster-Frame bei 1s extrahieren → WEBP 400px (thumb-Größe)
  → Sharp: Poster-Frame → blur placeholder
  → ffprobe: Videodauer in Sekunden → Photo.duration
  → Photo.thumbPath = posterPath (WEBP)
  → Photo.displayPath = originalPath (Video wird direkt gestreamt)
```

ffmpeg-Kommando für Poster-Frame:
```bash
ffmpeg -ss 00:00:01 -i input.mp4 -vframes 1 -vf "scale=400:-1" -f image2 poster.jpg
```

- **Größenlimit:** `MAX_VIDEO_SIZE_MB=200` (separates Limit von `MAX_FILE_SIZE_MB` für Bilder)
- **Kein Transcoding** in Phase 1 — 4K MOV wird direkt gespeichert
- **Phase 2:** Transcoding zu H.264 MP4 für universelle Browser-Kompatibilität (MOV auf Android-Geräten problematisch)

### Dateinamen-Schema im Storage

```
uploads/
  [galleryId]/
    [photoId]-thumb.webp
    [photoId]-display.webp
    [photoId]-original.jpg   (oder .png, .mp4, .mov)
```

### Was der Browser bekommt

```
Galerie-Grid:        → thumbUrl      (400px WEBP, ~20–50 KB)
Lightbox öffnen:     → displayUrl    (1920px WEBP, ~150–400 KB) — on-demand geladen
Slideshow:           → displayUrl    (1920px WEBP)
Download (Gast):     → originalUrl   (nur wenn allowGuestDownload = true)
Download (Admin):    → originalUrl   (immer verfügbar)
```

### API-Endpunkt: Datei-Serving

```
GET /files/:gallerySlug/:photoId?variant=thumb|display|original
  → Auth prüfen (original: immer Auth; display/thumb: nur bei secretKey)
  → Datei streamen (fs.createReadStream oder S3 presigned URL)
  → Cache-Control: public, max-age=31536000, immutable  (für thumb + display)
  → Cache-Control: private, no-store                    (für original)
```

Download-Header für Original:
```
Content-Disposition: attachment; filename="wedding-[photoId].jpg"
```

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
| Timing Attack (Slug-Enumeration) | PIN-geschützte Galerien: Response-Time normalisiert (immer ~gleiche Dauer, egal ob Galerie existiert). Public-Galerien: kein Timing-Schutz nötig (Design-Entscheidung). |
| Webhook-Sicherheit | HTTPS-only für `WEBHOOK_URL` (HTTP-URLs werden abgelehnt). Payload enthält kein PII, keine Original-Dateipfade — nur Event-Typ, Galerie-Slug, Zeitstempel. HMAC-Signatur via `WEBHOOK_SECRET` (Phase 3). |
| Path Traversal | `originalPath`/`thumbPath` werden nie direkt als Dateisystem-Pfad verwendet. Immer: `path.join(BASE_UPLOAD_DIR, path.basename(storedPath))`. Raw-DB-Pfad nie an `fs`-Funktionen übergeben. |
| ZIP-Export Limit | `GET /admin/galleries/:id/export` → max. 500MB oder 1000 Fotos pro Request. Bei Überschreitung: 413 mit Hinweis auf asynchronen Export (Phase 2: BullMQ Job + Download-Link). |
| noindex | `<meta name="robots" content="noindex,nofollow">` auf allen `/g/*` Seiten + `X-Robots-Tag: noindex` Header vom Backend. Social-Media-Crawler (Facebook, Telegram) ignorieren `robots.txt`. |

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

# Video
MAX_VIDEO_SIZE_MB=200

# Webhooks (optional, Phase 3)
WEBHOOK_URL=
NTFY_TOPIC=
```

### Docker Compose (vollständig)

```yaml
services:
  backend:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    restart: unless-stopped
    depends_on:
      backend-migrate:
        condition: service_completed_successfully
    ports:
      - "4000:4000"
    volumes:
      - uploads-data:/app/data/uploads
      - db-data:/app/data
    env_file: .env
    deploy:
      resources:
        limits:
          memory: 512m
          cpus: '1.0'
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:4000/health"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s

  backend-migrate:
    build:
      context: ./apps/backend
      dockerfile: Dockerfile
    command: npx prisma migrate deploy
    env_file: .env
    volumes:
      - db-data:/app/data

  frontend:
    build:
      context: ./apps/frontend
      dockerfile: Dockerfile
      args:
        NEXT_PUBLIC_API_URL: ${FRONTEND_URL}/api/v1
    restart: unless-stopped
    depends_on:
      - backend
    ports:
      - "3000:3000"
    env_file: .env

volumes:
  uploads-data:
  db-data:
```

### Multi-Stage Dockerfile (Backend)

```dockerfile
# Backend — Multi-Stage Alpine
FROM node:20-alpine AS deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build

FROM node:20-alpine AS runner
WORKDIR /app
# Native Deps: Sharp (HEIC) + ffmpeg
RUN apk add --no-cache vips-heif ffmpeg
# Security: non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist
COPY --from=builder --chown=appuser:appgroup /app/node_modules ./node_modules
COPY --from=builder /app/packages/db/prisma ./prisma
USER appuser
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD wget -qO- http://localhost:4000/health || exit 1
CMD ["node", "dist/server.js"]

# Frontend — Multi-Stage Alpine
FROM node:20-alpine AS fe-deps
WORKDIR /app
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:20-alpine AS fe-builder
WORKDIR /app
COPY --from=fe-deps /app/node_modules ./node_modules
COPY . .
ARG NEXT_PUBLIC_API_URL
RUN pnpm build

FROM node:20-alpine AS fe-runner
WORKDIR /app
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
COPY --from=fe-builder --chown=appuser:appgroup /app/.next/standalone ./
COPY --from=fe-builder --chown=appuser:appgroup /app/.next/static ./.next/static
COPY --from=fe-builder --chown=appuser:appgroup /app/public ./public
USER appuser
EXPOSE 3000
CMD ["node", "server.js"]
```

### Graceful Shutdown

```typescript
// apps/backend/src/server.ts
process.on('SIGTERM', async () => {
  await fastify.close()     // SSE-Verbindungen sauber schließen
  await prisma.$disconnect()
  process.exit(0)
})
```

Ohne Graceful Shutdown: Docker `stop` sendet SIGTERM, wartet 10s, sendet SIGKILL → laufende Sharp-Operationen abgebrochen → korrupte Dateien im Storage möglich.

### CI/CD Pipeline (GitHub Actions)

```yaml
# .github/workflows/ci.yml
on:
  push:
    branches: [main, develop]
  pull_request:

jobs:
  lint-typecheck:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo lint typecheck

  test-unit-integration:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: pnpm turbo build --filter=packages/db
      - run: pnpm vitest run --coverage

  test-e2e:
    runs-on: ubuntu-latest
    if: github.ref == 'refs/heads/main' || github.event_name == 'pull_request'
    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
      - run: pnpm install --frozen-lockfile
      - run: npx playwright install --with-deps chromium webkit
      - run: docker compose up -d
      - run: pnpm playwright test
      - run: docker compose down

  docker-build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: docker build ./apps/backend -t wedding-pic-share-backend
      - run: docker build ./apps/frontend -t wedding-pic-share-frontend
```

### Multi-Platform Docker Build (ARM64 Support)

Hochzeits-Hosts laufen oft auf Raspberry Pi (ARM64) oder Synology NAS. Sharp braucht plattform-spezifische Binaries:

```dockerfile
# Backend Dockerfile — platform-aware
FROM --platform=$TARGETPLATFORM node:20-alpine AS runner
ARG TARGETPLATFORM
# Sharp installiert automatisch die richtige Binary für amd64 oder arm64
RUN apk add --no-cache vips-heif ffmpeg
```

```yaml
# docker-compose.yml
services:
  backend:
    build:
      platforms:
        - linux/amd64
        - linux/arm64
```

CI baut beide Plattformen via `docker buildx`:
```bash
docker buildx build --platform linux/amd64,linux/arm64 -t wedding-pic-share/backend:latest .
```

### Update-Script (`update.sh`)

```bash
#!/bin/bash
set -e
echo "📦 Backup DB..."
docker compose exec backend sqlite3 /data/db.sqlite \
  ".backup /data/backup-$(date +%Y%m%d-%H%M).sqlite"

echo "⬇️  Pulling new version..."
docker compose pull

echo "🔄 Running migrations..."
docker compose run --rm backend-migrate

echo "🚀 Restarting..."
docker compose up -d

echo "✅ Health check..."
sleep 5
curl -f http://localhost:4000/health && echo "OK" || echo "WARN: Health check failed"
```

Im Repo als `update.sh` mit Dokumentation in `docs/deployment.md`.

### Secrets Management

```bash
# SESSION_SECRET sicher generieren:
openssl rand -hex 32

# Admin-Passwort-Hash generieren (Setup-Script):
docker compose run --rm backend node scripts/hash-password.js "meinPasswort"
# → gibt bcrypt-Hash aus → in .env eintragen

# Update-Prozedur:
docker compose pull
docker compose run --rm backend-migrate  # Migrations zuerst
docker compose up -d
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

1. Admin-Login (Passwort + Session + CSRF + Security-Headers)
2. First-Run via Umgebungsvariablen (`ADMIN_USERNAME` / `ADMIN_PASSWORD`)
3. Gäste-Upload ohne Account (Bilder: JPEG, PNG, WEBP, HEIC; Videos: MP4, MOV)
4. Video-Support: Poster-Frame via ffmpeg, Videos in Slideshow (autoplay muted)
5. Client-side Größencheck (`MAX_VIDEO_SIZE_MB`), Magic Bytes Validierung, Fastify bodyLimit
6. Pre-Moderation (Freigeben / Ablehnen / Batch)
7. Galerie-Ansicht: Masonry-Grid, Lightbox mit Swipe + Tastatur-Navigation, Lazy Loading
8. Navigation: Gast-Top-Bar (Galerie / Hochladen / Slideshow) + Admin-Sidebar (Galerie-Liste + Logout)
9. Pending-Confirmation-Screen nach Upload, vollständige Fehler-Screens, Empty States
10. QR-Code on-demand (PNG + SVG)
11. Live-Slideshow mit SSE + custom Reconnect-Wrapper, Dark-Mode-optimierter UI
12. SSE Disconnect-Cleanup (Memory-Leak-Schutz via `request.raw.on('close')`)
13. ZIP-Download (Admin Originalqualität + optional Gäste)
14. Cursor-based Pagination
15. PWA (Manifest, Service Worker, Offline-Shell, "Add to Home Screen")
16. Bild-Pipeline: 3 Varianten (thumb/display/original), WEBP-Optimierung, HEIC→JPEG, EXIF standardmäßig entfernt
17. Browser-Kompatibilität: iOS Safari 15+, Chrome Android 108+, Chrome/Firefox/Safari/Edge Desktop
18. Health-Check-Endpunkte, Pino-Logging
19. Docker Compose + automatische Migrations
20. Unit + Integration Tests (Vitest), E2E Tests (Playwright, Chromium + WebKit)

### Phase 2

1. Single-Gallery-Mode Feature-Flag (Routing + konditionelle UI)
2. First-Run Setup UI (`/setup`-Seite, interaktive Admin-Erstellung)
3. Brute-Force-Schutz (> 5 Fehlversuche → IP-Block)
4. Video Inline-Player in Gast-Galerie (Play/Pause/Seek/Volume)
5. Admin Direct-Upload mit Auto-Approval
6. Multi-Galerie-Mode UI
7. E-Mail-Benachrichtigungen (SMTP)
8. Upload-Zeitfenster (inkl. mehrtägige Events)
9. Retry-Mechanismus für fehlgeschlagene Uploads

### Phase 3

1. Konfigurierbare EXIF-Policy (aktuell immer entfernt; per-Galerie-Toggle)
2. 2FA (TOTP) mit AES-256-GCM verschlüsseltem Secret
3. Galerie-PIN-Schutz (Secret Key)
4. Weitere i18n-Sprachen (Community)
5. Druckbares Tischkärtchen (PDF-Export)
6. Webhook + NTFY-Integration
7. Worker Threads / BullMQ für Sharp-Processing
8. Galerie-Abschluss und Archivierungs-Flow
9. Fotograf-Modus (direkter Bulk-Upload mit Auto-Approval)

### Phase 4

1. S3-Speicher-Backend

---

## Test-Konzept

### Philosophie

Drei Ebenen: Unit → Integration → E2E. Kein Over-Testing von Implementierungsdetails — Tests sichern Verhalten, nicht Struktur. Hochzeits-kritische Pfade (Upload, Moderation, Slideshow) haben die höchste Testdichte.

### Test-Prioritäten (Tiers)

**TIER 1 — Kritische Pfade (müssen vor MVP grün sein):**
- Upload-Flow E2E: QR-URL → Dateiauswahl → POST → DB-Eintrag `PENDING`
- Moderation Unit: `approve` → Status `APPROVED` → SSE-Event ausgelöst
- Duplikat-Check Unit: gleicher SHA-256 in selber Galerie → 409; in anderer Galerie → OK
- Auth Integration: Admin-Endpunkte ohne Session → 401
- Brute-Force Integration: > 5 Fehlversuche → Account locked

**TIER 2 — Wichtige Pfade:**
- MIME-Validierung Unit: `.exe` mit `Content-Type: image/jpeg` → 415
- EXIF-Strip Unit: GPS-Tags vor/nach Sharp — keine Koordinaten im Output
- Session-Expiry Unit: abgelaufene Session → 401
- Galerie-Slug-Uniqueness Integration: Doppelter Slug → 409
- Slug-Sonderzeichen Integration: `../`, URL-Encoded Chars → 400 (JSON Schema Validation)

**TIER 3 — Qualitätssicherung:**
- SSE-Stream Integration: Photo approve → SSE event empfangen + Connection cleanup verifiziert
- ZIP-Export E2E: alle approved Fotos im Archiv
- QR-Code Unit: valider PNG/SVG Output für bekannten Slug
- Rate-Limiting Integration: > X Requests → 429 mit `Retry-After` Header

### Kritische Edge Cases (müssen explizit getestet werden)

| Szenario | Risiko | Test-Ebene |
|---|---|---|
| Sharp wirft bei korruptem Bild | Unkontrollierter 500er, Upload blockiert | Unit: graceful error, HTTP 422 |
| S3-Upload schlägt fehl nach DB-Eintrag (Phase 4) | Foto in DB, nicht im Storage — Inkonsistenz | Integration: Transaktion-Rollback |
| Gleichzeitige Uploads (Race Condition) | Doppelter SHA-256 übersteht DB-Unique-Check | Integration: concurrent requests, DB-Constraint als letzter Schutz |
| SSE-Connection nie geschlossen | Memory Leak in In-Memory-Map | Integration: disconnect → Map-Größe = 0 |
| Galerie-Slug mit Sonderzeichen | URL-Routing bricht | Unit: slug validation regex |
| Video-Upload (50MB MOV) | Sharp-Fehler (verarbeitet kein Video) | Integration: Video → ffmpeg, kein Sharp-Aufruf |
| ffmpeg wirft bei korruptem Video | Unkontrollierter 500er | Unit: graceful error → HTTP 422 |
| Video ohne Audio-Spur | Slideshow-Player-Verhalten undefined | Integration: `muted` immer gesetzt, kein Fehler |

### Monorepo Test-Konfiguration

**`vitest.workspace.ts`** (Root-Level):
```typescript
import { defineWorkspace } from 'vitest/config'

export default defineWorkspace([
  'apps/backend/vitest.config.ts',
  'apps/frontend/vitest.config.ts',
  'packages/shared/vitest.config.ts',
])
```

**Coverage-Schwellwerte** (in `vitest.config.ts` je Package):
```typescript
coverage: {
  provider: 'v8',
  thresholds: {
    statements: 80,
    branches: 80,
    functions: 80,
    lines: 80,
  },
  // Kritische Pfade: höhere Schwelle
  include: ['src/upload/**', 'src/moderation/**', 'src/auth/**'],
}
```

**Pre-commit Hooks** (`lint-staged` + `husky`):
```json
{
  "lint-staged": {
    "*.ts": ["eslint --fix", "vitest related --run"]
  }
}
```
`vitest related` führt nur Tests aus, die die geänderten Dateien betreffen — schnell, kein Full-Run beim Commit.

### Ebene 1 — Unit Tests (Vitest)

**Was:** Isolierte Funktionen und Utilities ohne I/O.  
**Wo:** `*.test.ts` neben der Quell-Datei.

| Bereich | Beispiele |
|---|---|
| Backend Utilities | `hashFile(buffer)`, `isMimeTypeAllowed(bytes)`, `isWithinUploadWindow(now, windows)` |
| Slug-Generierung | `generateSlug("Standesamt Berlin")` → `"standesamt-berlin"` |
| Duplikat-Erkennung | Hash-Kollision-Logik |
| Bild-Varianten-Pfade | `getPhotoPath(photoId, "thumb")` |
| i18n | Alle Übersetzungskeys vorhanden in DE + EN |

**Ziel:** >90% Coverage auf Utility-Funktionen.

### Ebene 2 — Integration Tests (Vitest + Supertest / Fastify inject)

**Was:** API-Endpunkte mit echter Datenbank (SQLite in-memory via Prisma) und gemocktem Storage.  
**Wo:** `apps/backend/tests/integration/`

| Endpunkt | Getestete Szenarien |
|---|---|
| `POST /g/:slug/upload` | Erfolgreicher Upload; Duplikat → 409; falscher MIME-Typ → 415; Datei zu groß → 413; Zeitfenster abgelaufen → 403 (Phase 2) |
| `GET /g/:slug` | Nur APPROVED Fotos zurückgegeben; Pagination korrekt; leere Galerie |
| `POST /admin/login` | Erfolg; falsches Passwort → 401; Lockout nach 5 Fehlversuchen |
| `POST /admin/photos/batch` | approve/reject/move; partial failure (207) |
| `GET /files/:gallerySlug/:photoId` | thumb/display ohne Auth; original erfordert Auth; 404 bei unbekanntem Foto |
| `GET /health` | DB up → 200; DB down → 503 |

**Prisma-Test-Setup:** `prisma migrate deploy` auf SQLite-Testdatei; nach jedem Test-Suite `prisma db push --force-reset`.

### Ebene 3 — E2E Tests (Playwright)

**Was:** Vollständige User Journeys im echten Browser (Chromium, WebKit für iOS-Safari-Simulation).  
**Wo:** `apps/frontend/tests/e2e/`

**Kritische Journeys:**

| Journey | Browser |
|---|---|
| Gast: QR-Scan-Simulation → Upload → Pending-Confirmation | Chromium + WebKit |
| Gast: Upload mit HEIC-Datei → Thumbnail sichtbar | WebKit (iOS-Simulation) |
| Gast: Galerie ansehen, Lightbox öffnen, Swipe-Navigation | Chromium + WebKit (touch) |
| Gast: Download einzelnes Foto | Chromium |
| Admin: Login → Galerie erstellen → QR-Code herunterladen | Chromium |
| Admin: Foto freigeben → erscheint in Galerie | Chromium |
| Admin: Batch-Ablehnen mehrerer Fotos | Chromium |
| Slideshow: startet, Foto erscheint nach Freigabe (SSE) | Chromium |
| PWA: Offline-Verhalten (gecachte Galerie sichtbar) | Chromium (Service Worker) |

**Playwright-Konfiguration:**
- `baseURL`: lokale Docker-Compose-Instanz (`http://localhost:3000`)
- Parallelausführung: 4 Worker
- Screenshots bei Fehler: automatisch
- Retry: 2x bei flaky Tests

### CI-Pipeline (GitHub Actions)

```yaml
jobs:
  test:
    steps:
      - pnpm install
      - turbo build --filter=packages/db  # Prisma generate
      - vitest run                         # Unit + Integration
      - playwright install --with-deps chromium webkit
      - docker-compose up -d              # Test-Instanz
      - playwright test                   # E2E
      - docker-compose down
```

**Branches:** Unit + Integration bei jedem Push; E2E nur auf `main` und Pull Requests.

### Konkrete Test-Beispiele

**Race-Condition-Test (Tier 1):**
```typescript
it('rejects duplicate upload under concurrent load', async () => {
  const file = readFixture('test-duplicate.jpg')
  const uploads = Array(10).fill(null).map(() =>
    fastify.inject({ method: 'POST', url: '/api/v1/g/test-gallery/upload', payload: file })
  )
  const results = await Promise.all(uploads)
  const accepted = results.filter(r => r.statusCode === 202)
  expect(accepted).toHaveLength(1)  // genau einer darf durch
})
```

**SSE Memory Leak Test (Tier 3):**
```typescript
it('removes connection from map on client disconnect', async () => {
  const connection = await openSSEConnection('/api/v1/g/test/slideshow/stream')
  expect(sseMap.get('gallery-id')?.size).toBe(1)
  connection.close()
  await nextTick()
  expect(sseMap.get('gallery-id')?.size).toBe(0)
})
```

**Wedding Day Smoke Test (E2E):**
```typescript
test('complete wedding day flow', async ({ browser }) => {
  const admin = await browser.newPage()
  // Admin erstellt Galerie, holt QR-URL
  await admin.goto('/admin')
  // ...login, create gallery, get slug

  // 5 gleichzeitige Gäste uploaden
  const guests = await Promise.all(Array(5).fill(null).map(() => browser.newPage()))
  await Promise.all(guests.map(async (page, i) => {
    await page.goto('/g/test-wedding/upload')
    await page.setInputFiles('input[type=file]', `fixtures/test-${i}.jpg`)
    await page.click('[data-testid=submit-upload]')
    await expect(page.locator('[data-testid=pending-confirmation]')).toBeVisible()
  }))

  // Admin genehmigt alle
  await admin.goto('/admin/galleries/test-id/moderate')
  await admin.click('[data-testid=approve-all]')

  // Galerie zeigt Fotos
  await expect(admin.locator('[data-testid=photo-count]')).toHaveText('5')
})
```

### Visual Regression Tests

Playwright Screenshot-Tests für design-sensitive Seiten:

```typescript
test('gallery page matches snapshot', async ({ page }) => {
  await page.goto('/g/test-gallery')
  await expect(page).toHaveScreenshot('gallery-50-photos.png', { threshold: 0.02 })
})
```

Getestete States:
- GalleryPage: leer, 1 Foto, 50 Fotos (Masonry)
- SlideshowPage: Vollbild 1920×1080 (Dark Mode)
- UploadPage: mobil 375×812 (iOS-Viewport)
- AdminModerationPage: mit pending Fotos

Tool: Playwright built-in Screenshot-Comparison (`toHaveScreenshot`). Snapshots in `tests/screenshots/`.

### Test-Fixtures

Dediziertes Fixtures-Verzeichnis mit Bildern bekannter Eigenschaften:

```
packages/shared/fixtures/
  ├── test-with-gps-exif.jpg    # Bekannte GPS-Koordinaten (52.520008, 13.404954)
  ├── test-no-exif.jpg          # Kein EXIF → Sharp soll nicht crashen
  ├── test-heic.heic            # iOS-Format → HEIC→JPEG Konvertierung
  ├── test-corrupt.jpg          # Korrupte Datei → graceful HTTP 422
  ├── test-5mb.jpg              # Normal-Fall
  ├── test-duplicate.jpg        # Bekannter SHA-256 für Duplikat-Tests
  ├── test-video.mp4            # 10s MP4 → Poster-Frame + Duration
  └── test-video.mov            # iOS MOV → Poster-Frame + Duration (Android-Kompatibilität Phase 2)
```

### Test-Utilities

- **Fixtures:** `createTestGallery()`, `createTestPhoto(status)`, `createAdminSession()` — wiederverwendbare Prisma-Seeder für Tests
- **Storage-Mock:** Lokaler Temp-Ordner für Integration Tests, kein S3-Aufruf
- **Zeitreise:** `vi.setSystemTime()` für Upload-Zeitfenster-Tests (Phase 2)
- **Race-Condition-Test:** `Promise.all([upload(sameFile), upload(sameFile)])` — DB-Unique-Constraint muss einen der beiden ablehnen

---

## Performance-Budgets

| Metrik | Ziel | Messung |
|---|---|---|
| LCP (Galerie-Seite) | < 2.5s | Lighthouse / Web Vitals |
| Time-to-Interactive | < 3s auf 4G | Lighthouse |
| Time-to-Upload-Start | < 10s (QR → erster Upload-Byte) | Server-Log `createdAt` |
| Upload-Throughput | 5 gleichzeitige Uploads ohne Degradation | k6 Phase 2 |
| SSE-Latenz | Photo approved → Event < 500ms | Integration-Test |
| Gallery-Load (100 Fotos) | < 1.5s initial render | Lighthouse |

**Masonry-Virtualisierung:** `react-masonry-css` rendert alle Elemente gleichzeitig. Ab 200 Fotos: Wechsel zu `masonic` (virtualisiertes Masonry) oder TanStack Virtual. Phase 2 — Entscheidung basierend auf gemessener Performance mit echten Daten.

**SSE Connection-Dedup:** Jede Verbindung erhält eine Connection-ID. Bei Reconnect wird die alte ID aus der Map entfernt bevor die neue eingetragen wird. Verhindert Phantom-Connections bei schlechtem Netz.

## Produktname & Open-Source-Strategie

### Projektname

`wedding-pic-share` ist der technische Repository-Name. Für die Community-Positionierung ist ein emotionalerer Name sinnvoll — "Moments not Files" als Prinzip sollte sich im Namen widerspiegeln. Vorschläge: `Candid` (ehrliche Momentaufnahmen), `Fête`. **Entscheidung steht aus** — nicht MVP-blockierend, sollte vor erstem GitHub-Release getroffen werden.

### Onboarding (First 5 Minutes)

Neuer User nach `docker-compose up`:
1. Browser öffnet `localhost:3000`
2. Kein Admin gesetzt → automatisch `/setup` angezeigt (nicht leeres Dashboard)
3. Setup-Wizard: (1) Dein Name / Hochzeitsname, (2) Passwort wählen, (3) Erste Galerie erstellen, (4) QR-Code anzeigen
4. Nach Setup: Dashboard mit "Deine erste Galerie ist bereit — QR-Code ausdrucken und loslegen"

### Open-Source-Strategie

- `LICENSE`: MIT ✓
- `CONTRIBUTING.md`: Wie man beiträgt (Branches, Tests, i18n)
- `CODE_OF_CONDUCT.md`: Contributor Covenant
- GitHub Issue-Templates: Bug Report, Feature Request, i18n Contribution
- Labels: `good first issue` (kleine UI-Fixes, neue Sprachen), `help wanted`, `Phase 2`
- Roadmap: GitHub Projects Board mit Phase 1/2/3

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
| PWA | `@ducanh2912/next-pwa` (Workbox Service Worker, Manifest, Offline-Support) |
| Fonts | DM Sans + Playfair Display via `next/font` (self-hosted) |
| Icons | Lucide React |
| State (Client) | TanStack Query (Server-Daten), Zustand (Upload-Queue, SSE-State) |
| Masonry | react-masonry-css (Phase 1); masonic für Virtualisierung ab Phase 2 |
| PDF | `@react-pdf/renderer` (Tischkärtchen-Export, Phase 3) |
| Backend | Fastify (Node.js) |
| ORM | Prisma mit Enums (SQLite default, PostgreSQL optional) |
| Bild-Processing | Sharp (thumb 400px WEBP, display 1920px WEBP, original; HEIC→JPEG, EXIF-Strip) |
| Video-Processing | ffmpeg (Poster-Frame-Extraktion), ffprobe (Dauer); kein Reencoding in Phase 1 |
| MIME-Validierung | `file-type` (Magic Bytes) |
| QR-Code | `qrcode` npm-Paket (serverseitig, on-demand) |
| Realtime | Server-Sent Events (SSE) + custom Reconnect-Wrapper |
| Storage | Lokales FS / S3-kompatibel (AWS SDK v3) |
| Auth | bcrypt, HTTP-only Sessions, otplib (TOTP Phase 3) |
| Verschlüsselung | Node.js `crypto` (AES-256-GCM für TOTP-Secrets, Phase 3) |
| Security | `@fastify/csrf-protection`, `@fastify/helmet`, `@fastify/cors`, `@fastify/rate-limit` |
| Logging | Pino (Fastify built-in) |
| Unit + Integration Tests | Vitest + Fastify `inject()` (kein HTTP-Server nötig) |
| Coverage | c8 (native V8) — Schwelle 80% |
| Pre-commit | lint-staged + husky + `vitest related` |
| E2E Tests | Playwright (Chromium + WebKit) |
| Load Tests | k6 (Phase 2, Hochzeits-Peak-Simulation) |
| CI | GitHub Actions (lint+typecheck, unit+integration, E2E auf main/PRs) |
| Monorepo | pnpm workspaces + Turborepo |
| Container | Docker (Alpine-Images) + Docker Compose |
| Lizenz | MIT |
