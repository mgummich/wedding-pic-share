# Wedding Pic Share — Design Spec
**Date:** 2026-04-09  
**Status:** Approved  
**License:** MIT

---

## Positionierung

Privacy-first, selfhosted, no-app wedding photo sharing. Kein vollständiges Hochzeitsplanungstool — ausschließlich Foto-Sharing.

### Kern-Prinzipien

1. **Friction first:** Gast kommt in unter 10 Sekunden vom QR-Code zum Upload.
2. **Moments not files:** Alben/Sub-Events sind ein Kernkonzept, keine Nachgedanke.
3. **Privacy by default:** Kein Google Drive, kein Social Login, keine externe SaaS-Infrastruktur erforderlich.
4. **Extensible core:** KI-Funktionen und Messaging-Integrationen später als optionale Module.

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

- **Frontend (Next.js):** Kommuniziert ausschließlich über REST mit dem Fastify-Backend. Kein direkter DB-Zugriff.
- **Backend (Fastify):** Alle API-Endpunkte, Business-Logik, File-Handling, SSE-Endpunkt für Slideshow, Prisma für DB.
- **Deployment:** `docker-compose up` startet beide Services. Reverse Proxy (Traefik/Nginx) optional davor.
- **Monorepo:** `pnpm workspaces` — Frontend und Backend teilen das Prisma-Paket, unabhängig deploybar.
- **CORS:** `@fastify/cors` auf dem Backend konfiguriert — erlaubt ausschließlich den Frontend-Origin (`FRONTEND_URL` Env-Variable). In Produktion keine Wildcard-Origin.

### Repo-Struktur

```
wedding-pic-share/
├── apps/
│   ├── frontend/          # Next.js
│   └── backend/           # Fastify
├── packages/
│   └── db/                # Prisma Schema + Migrations
├── docker-compose.yml
├── .env.example
└── docs/
    └── superpowers/specs/
```

---

## Datenmodell

```
Wedding (1)
  └── Gallery/Sub-Event (n)          ← z.B. Standesamt, Kirche, Party
        ├── uploadWindows (n)        ← Zeitfenster (mehrere möglich)
        ├── Photo (n)
        │     ├── status: PENDING | APPROVED | REJECTED  (Enum)
        │     ├── guestName (optional)
        │     ├── fileHash (SHA-256, Duplikatprüfung per Galerie)
        │     ├── originalPath / thumbnailPath
        │     └── exifStripped: boolean
        └── QR-Code: on-demand generiert (kein DB-Eintrag)
```

**QR-Code:** Wird nicht in der DB gespeichert. Der Endpunkt `GET /g/:slug/qr` generiert den Code on-demand via `qrcode`-Paket aus dem Gallery-Slug. Kein persistenter State nötig.

### Prisma-Schema

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

model Wedding {
  id        String    @id @default(cuid())
  name      String
  slug      String    @unique
  createdAt DateTime  @default(now())
  galleries Gallery[]
}

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
  secretKey          String?        // bcrypt-gehasht
  createdAt          DateTime       @default(now())
  uploadWindows      UploadWindow[]
  photos             Photo[]
}

model UploadWindow {
  id        String   @id @default(cuid())
  galleryId String
  gallery   Gallery  @relation(fields: [galleryId], references: [id])
  startsAt  DateTime
  endsAt    DateTime
}

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

model AdminUser {
  id                String    @id @default(cuid())
  username          String    @unique
  passwordHash      String
  totpSecretEncrypted String? // AES-256-GCM verschlüsselt, Key aus TOTP_ENCRYPTION_KEY Env
  failedAttempts    Int       @default(0)
  lockedUntil       DateTime?
  sessions          Session[]
}

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

- **Single-Gallery-Mode:** Eine Wedding + eine Gallery — vereinfachte UI ohne Sub-Event-Navigation.
- **Multi-Gallery-Mode:** Eine Wedding + mehrere Galleries mit eigenem Slug, Zeitfenster und on-demand QR-Code.

---

## API-Design

**Fastify REST API** — Basis-URL: `/api/v1`

### Öffentliche Endpunkte (kein Auth)

```
GET    /g/:slug?cursor=<id>&limit=20  → Galerie-Info + freigegebene Fotos (cursor-based pagination)
POST   /g/:slug/upload                → Foto hochladen (multipart)
GET    /g/:slug/slideshow/stream      → SSE-Stream (neue Fotos)
GET    /g/:slug/qr?format=png|svg     → QR-Code on-demand
GET    /g/:slug/download              → ZIP aller freigegebenen Fotos (falls erlaubt)
```

**Pagination:** `GET /g/:slug` liefert max. 20 Fotos pro Request. Response enthält `nextCursor` (ID des letzten Fotos). Nächste Seite: `?cursor=<nextCursor>`. Kein Offset-basiertes Paging (instabil bei neuem Content).

### Admin-Endpunkte (Session-Auth + CSRF-Token)

```
POST   /admin/login
POST   /admin/logout
GET    /admin/galleries
POST   /admin/galleries
PATCH  /admin/galleries/:id
DELETE /admin/galleries/:id
GET    /admin/galleries/:id/photos?status=PENDING|APPROVED|REJECTED
PATCH  /admin/photos/:id
POST   /admin/photos/batch
DELETE /admin/photos/:id
GET    /admin/galleries/:id/export   → ZIP (Originalqualität)
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
{
  "processed": 3,
  "failed": []
}

// Response 207 (partial failure)
{
  "processed": 2,
  "failed": [{ "id": "id3", "reason": "not found" }]
}
```

### Upload-Flow

```
Browser → POST /g/:slug/upload (multipart)
  → Fastify bodyLimit prüfen (MAX_FILE_SIZE_MB, vor Buffer-Verarbeitung)
  → Upload-Zeitfenster prüfen
  → Secret Key prüfen (falls konfiguriert)
  → Magic Bytes prüfen (file-type Paket — MIME-Typ aus Dateiinhalt, nicht Content-Type-Header)
  → Erlaubte Typen: image/jpeg, image/png, image/webp, image/heic, video/mp4, video/quicktime
  → SHA-256 Hash berechnen → Duplikat in dieser Galerie? → 409 Conflict
  → Sharp: Thumbnail generieren + WEBP-Konvertierung (Bilder)
  → EXIF entfernen (falls EXIF_STRIP=true)
  → Storage: lokal oder S3
  → DB: Photo mit status = PENDING, thumbPath gespeichert
  → SMTP-Notification an Admin (falls konfiguriert)
  → Response: { id, status: "PENDING", thumbUrl }
  // thumbUrl erlaubt sofortige Vorschau im Browser, auch für HEIC (wird serverseitig zu WEBP konvertiert)
```

### SSE-Strategie

- Fastify hält eine In-Memory-Map `galleryId → Set<SSEConnection>`
- Rate Limiting auf `GET /g/:slug/slideshow/stream`: max. 10 gleichzeitige Verbindungen pro IP (`@fastify/rate-limit`)
- Nach Moderation eines Fotos: Server pusht `event: new-photo` mit `{ id, thumbUrl, createdAt }` an alle aktiven Verbindungen dieser Galerie
- Kein Redis nötig für MVP (Single-Instance)
- Heartbeat alle 30s (`event: ping`) gegen Proxy-Timeouts
- **Client-seitiger SSE-Wrapper** mit exponential backoff (nicht native `EventSource` allein): reconnect bei Netzwerkfehler und HTTP 5xx, nicht bei 401/403 (kein sinnloses Retry bei Auth-Fehler)

---

## Frontend-Struktur

### Routing (Next.js App Router)

```
/                               → Landing / Redirect zur ersten Galerie
/g/[slug]                       → Galerie-Ansicht        (Server Component, initiales Laden)
/g/[slug]/upload                → Upload-Seite           (Client Component)
/g/[slug]/slideshow             → Vollbild-Slideshow     (Client Component, eigenes layout.tsx)
/admin                          → Login                  (Client Component)
/admin/dashboard                → Übersicht              (Server Component)
/admin/galleries/new            → Galerie erstellen      (Client Component)
/admin/galleries/[id]           → Galerie bearbeiten     (Client Component)
/admin/galleries/[id]/moderate  → Moderations-Dashboard  (Client Component)
```

**Layout-Regeln:**
- `/g/[slug]/slideshow` erhält eine eigene `layout.tsx` (`export default function SlideshowLayout`) die das globale Layout vollständig überschreibt — kein Header, kein Footer, `<html>` mit `overflow: hidden`.
- Alle anderen Routen erben das globale `app/layout.tsx`.

### Server vs. Client Components

| Route / Komponente | Typ | Begründung |
|---|---|---|
| `GalleryPage` | Server Component | Initiales Foto-Laden via fetch, kein Client-State |
| `PhotoGrid` | Server Component | Statisches Rendering der Thumbnails |
| `Lightbox` | Client Component | Interaktion, DOM-Events |
| `UploadPage` | Client Component | FileDropzone, Fortschrittsbalken, AbortController |
| `SlideshowPage` | Client Component | SSE-Stream, Animations-State |
| `AdminModerationPage` | Client Component | Batch-Auswahl, optimistic updates |

### State Management

- **TanStack Query** für alle Server-Daten (Gallery-Fotos, Admin-Listen) — automatischer Refetch, optimistic updates bei Moderation.
- **Zustand** für lokalen Client-State:
  - Upload-Queue (Dateiliste, Fortschritt pro Datei, AbortController-Referenzen)
  - SSE-Photo-Stream in der Slideshow (neues Foto → Array-Append → Render-Trigger)
- Kein globaler State für alles andere — React local state reicht.

### Komponenten-Hierarchie

```
GalleryPage (Server Component)
  ├── GalleryHeader         (Name, Beschreibung, Foto-Anzahl, QR-Hint)
  ├── PhotoGrid (Server)    (Masonry oder Grid — react-masonry-css für Masonry-Layout)
  │     └── PhotoCard       (Thumbnail, Lazy Load via next/image)
  ├── Lightbox (Client)     (Vollbild, Vor/Zurück, Download-Button, Error Boundary)
  └── UploadButton          (→ /upload, prominent, mobile-first)

UploadPage (Client Component)
  ├── GuestNameInput        (optional/pflicht/versteckt per Config)
  ├── FileDropzone          (Drag & Drop + capture="camera", HEIC akzeptiert)
  ├── FileQueue             (pro Datei: Fortschrittsbalken, Cancel-Button via AbortController)
  └── SubmitButton

SlideshowPage (Client Component, eigenes layout.tsx)
  ├── PhotoDisplay          (Überblend-Effekt, SSE-getrieben via Zustand-Store)
  ├── QRHintSlide           (konfigurierbar, zwischen Fotos eingeblendet)
  ├── Controls              (Play/Pause, Vor/Zurück, Tastatur)
  └── SlideshowErrorBoundary (graceful degradation: zeigt letztes Foto bei SSE-Fehler)

AdminModerationPage (Client Component)
  ├── PhotoQueue            (pending Fotos, Batch-Auswahl via TanStack Query)
  │     └── ModerationCard  (Freigeben / Ablehnen / Verschieben)
  └── BatchActionBar
```

**Masonry:** `react-masonry-css` — CSS-basiertes Multi-Column-Layout, kein JavaScript-Resize-Observer, performant auf Mobile.

**HEIC-Vorschau:** Keine clientseitige Konvertierung. Der Upload-Response enthält `thumbUrl` (serverseitig generiertes WEBP-Thumbnail). Die FileQueue zeigt diesen Thumb nach erfolgreichem Upload — kein kaputtes `<img>` für HEIC.

**Upload-Abbruch:** Jeder Upload-Task in der FileQueue hält eine `AbortController`-Instanz. Cancel-Button ruft `controller.abort()` auf — bricht den `fetch`-Request ab und entfernt den Eintrag aus der Queue.

### Styling & UX

- **Tailwind CSS** — Mobile-first, Dark Mode via `class`-Strategy (System-Präferenz + manueller Toggle)
- **WCAG 2.1 AA** — Kontrastverhältnisse, Alt-Texte, Keyboard-Navigation
- **i18n:** `next-intl`, Sprachdateien `src/i18n/de.json` + `en.json`; Sprache via `DEFAULT_LANG` Env oder `Accept-Language`-Header
- Thumbnails via `next/image` mit Lazy Loading, serverseitig via Sharp generiert

---

## Sicherheit & Datenschutz

| Bereich | Maßnahme |
|---|---|
| Passwörter | bcrypt (cost 12) |
| Sessions | HTTP-only Cookie, 24h TTL, serverseitig invalidierbar, `createdAt` für Audit |
| CSRF | `@fastify/csrf-protection` — Double Submit Cookie auf allen Admin-POST/PATCH/DELETE-Endpunkten |
| Brute-Force | Lockout nach X Fehlversuchen (default: 5), konfigurierbar |
| 2FA | TOTP (otplib), optional per `TOTP_ENABLED=true`; Secret AES-256-GCM verschlüsselt at-rest |
| MIME-Validierung | Magic Bytes Prüfung via `file-type` Paket — kein Vertrauen in `Content-Type`-Header |
| Rate Limiting | `@fastify/rate-limit` auf Upload, Login **und SSE-Endpunkt** (max. 10 Verbindungen/IP) |
| File-Size-Enforcement | Fastify `bodyLimit` = `MAX_FILE_SIZE_MB × 1024 × 1024` — Limit vor Buffer-Verarbeitung |
| EXIF | Sharp entfernt Geo-Metadaten vor Speicherung (konfigurierbar via `EXIF_STRIP`) |
| Galerie-Schutz | Optionaler Secret Key (PIN) pro Galerie, bcrypt-gehasht |
| robots.txt | `Disallow: /g/` — keine Indexierung von Galerien |
| HTTPS | Redirect HTTP→HTTPS konfigurierbar, HSTS-Header |
| Duplikate | SHA-256 Hash-Prüfung, Scope: pro Galerie (`@@unique([galleryId, fileHash])`) |
| CORS | `@fastify/cors`, nur `FRONTEND_URL` als erlaubter Origin — keine Wildcard |

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
ADMIN_PASSWORD_HASH=                 # bcrypt-Hash (via setup-script generiert)
SESSION_SECRET=                      # zufälliger String, min. 32 Zeichen
TOTP_ENCRYPTION_KEY=                 # 32-Byte Hex-String für AES-256 TOTP-Secret-Verschlüsselung

# Frontend
FRONTEND_URL=http://localhost:3000   # für CORS-Konfiguration

# Features
EXIF_STRIP=true
MAX_FILE_SIZE_MB=50
DEFAULT_LANG=de                      # de | en
TOTP_ENABLED=false

# SMTP (optional)
SMTP_HOST=
SMTP_PORT=587
SMTP_USER=
SMTP_PASS=
SMTP_FROM=

# Webhooks (optional)
WEBHOOK_URL=
NTFY_TOPIC=
```

### Initial-Setup / First-Run

Neuer Nutzer ohne Entwickler-Hintergrund durchläuft folgende Schritte:

1. `docker-compose up` startet beide Services
2. Beim ersten Start erkennt das Backend, dass kein `ADMIN_PASSWORD_HASH` gesetzt ist
3. Backend startet im **Setup-Modus**: einmaliger Setup-Endpunkt `POST /setup` ist aktiv (deaktiviert sich nach erstem erfolgreichen Aufruf)
4. Frontend zeigt automatisch `/setup`-Seite: Nutzer gibt Username + Passwort ein
5. Backend hasht das Passwort, schreibt `ADMIN_PASSWORD_HASH` in die `.env`-Datei (Docker-Volume) und startet in den Normal-Modus
6. Alternativ: `pnpm setup` CLI-Script für manuelle Installation ohne Docker

---

## Features

### Kern-Features (MVP — Phase 1)

1. Admin-Login mit Passwort + Session + Brute-Force-Schutz + CSRF-Schutz
2. Single-Gallery-Mode: Galerie erstellen, bearbeiten
3. Gäste-Upload per QR-Code ohne Account (JPEG, PNG, WEBP, HEIC, MP4, MOV)
4. Magic Bytes MIME-Validierung + Fastify bodyLimit
5. Pre-Moderation: Freigeben / Ablehnen / Batch-Aktionen
6. Galerie-Ansicht: Masonry-Grid (react-masonry-css), Lightbox, Lazy Loading
7. QR-Code-Export on-demand (PNG + SVG)
8. Basis-Slideshow (manuell, kein Realtime)
9. Docker Compose Setup + First-Run Setup-Flow

### Phase 2

10. Live-Slideshow mit SSE-Realtime-Updates + custom Reconnect-Wrapper
11. Multi-Galerie-Mode / Sub-Events
12. ZIP-Download (Admin + optional Gäste)
13. E-Mail-Benachrichtigungen (SMTP)
14. Upload-Zeitfenster (inkl. mehrtägige Events)
15. S3-Speicher-Backend
16. Cursor-based Pagination für Galerie-Ansicht

### Phase 3

17. HEIC-Konvertierung serverseitig (bereits in Upload-Flow für Thumbnails)
18. EXIF-Daten-Entfernung (konfigurierbar)
19. 2FA (TOTP) mit verschlüsseltem Secret
20. Weitere i18n-Sprachen (Community)
21. Druckbares Tischkärtchen (PDF-Export)
22. Webhook- und NTFY-Integration
23. Galerie-Schutz per Secret Key (PIN)

---

## Out-of-Scope (MVP)

- KI-Gesichtserkennung
- Likes, Kommentare, Social Features
- Audio-/Video-Gästebuch
- RSVP / Hochzeitsplanung
- Bezahlmodell / Abonnements
- Native Mobile Apps
- Bildbearbeitung / Filter
- WhatsApp / Messenger-Suite

---

## Tech-Stack

| Bereich | Technologie |
|---|---|
| Frontend | Next.js 14+ (App Router), Tailwind CSS, next-intl |
| State (Client) | TanStack Query (Server-Daten), Zustand (Upload-Queue, SSE-State) |
| Masonry | react-masonry-css |
| Backend | Fastify (Node.js) |
| ORM | Prisma mit Enums (SQLite default, PostgreSQL optional) |
| Bild-Processing | Sharp (Thumbnails, WEBP-Konvertierung, EXIF-Strip) |
| MIME-Validierung | `file-type` (Magic Bytes) |
| QR-Code | `qrcode` npm-Paket (serverseitig, on-demand) |
| Realtime | Server-Sent Events (SSE) + custom Reconnect-Wrapper |
| Storage | Lokales FS / S3-kompatibel (AWS SDK v3) |
| Auth | bcrypt, HTTP-only Sessions, otplib (TOTP), AES-256-GCM für TOTP-Secrets |
| CSRF | `@fastify/csrf-protection` |
| CORS | `@fastify/cors` |
| Rate Limiting | `@fastify/rate-limit` |
| Monorepo | pnpm workspaces |
| Container | Docker + Docker Compose |
| Lizenz | MIT |
