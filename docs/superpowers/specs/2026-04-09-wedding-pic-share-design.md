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
        │     ├── status: pending | approved | rejected
        │     ├── guestName (optional)
        │     ├── fileHash (SHA-256, Duplikatprüfung)
        │     ├── originalPath / thumbnailPath
        │     └── exifStripped: boolean
        └── QRCode (1)               ← generiert beim Erstellen
```

### Prisma-Schema

```prisma
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
  layout             String         @default("masonry") // masonry | grid
  allowGuestDownload Boolean        @default(false)
  guestNameMode      String         @default("optional") // optional | required | hidden
  moderationMode     String         @default("manual") // manual | auto
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
  id               String   @id @default(cuid())
  galleryId        String
  gallery          Gallery  @relation(fields: [galleryId], references: [id])
  guestName        String?
  fileHash         String   @unique
  originalPath     String
  thumbPath        String
  mimeType         String
  status           String   @default("pending") // pending | approved | rejected
  rejectionReason  String?
  exifStripped     Boolean  @default(false)
  createdAt        DateTime @default(now())
}

model AdminUser {
  id             String    @id @default(cuid())
  username       String    @unique
  passwordHash   String
  totpSecret     String?
  failedAttempts Int       @default(0)
  lockedUntil    DateTime?
  sessions       Session[]
}

model Session {
  id          String    @id @default(cuid())
  adminUserId String
  admin       AdminUser @relation(fields: [adminUserId], references: [id])
  token       String    @unique
  expiresAt   DateTime
}
```

### Gallery-Modi

- **Single-Gallery-Mode:** Eine Wedding + eine Gallery — vereinfachte UI ohne Sub-Event-Navigation.
- **Multi-Gallery-Mode:** Eine Wedding + mehrere Galleries mit eigenem Slug, QR-Code und Zeitfenster.

---

## API-Design

**Fastify REST API** — Basis-URL: `/api/v1`

### Öffentliche Endpunkte (kein Auth)

```
GET    /g/:slug                    → Galerie-Info + freigegebene Fotos
POST   /g/:slug/upload             → Foto hochladen (multipart)
GET    /g/:slug/slideshow/stream   → SSE-Stream (neue Fotos)
GET    /g/:slug/qr                 → QR-Code (PNG/SVG)
GET    /g/:slug/download           → ZIP aller freigegebenen Fotos (falls erlaubt)
```

### Admin-Endpunkte (Session-Auth)

```
POST   /admin/login
POST   /admin/logout
GET    /admin/galleries
POST   /admin/galleries
PATCH  /admin/galleries/:id
DELETE /admin/galleries/:id
GET    /admin/galleries/:id/photos?status=pending|approved|rejected
PATCH  /admin/photos/:id
POST   /admin/photos/batch
DELETE /admin/photos/:id
GET    /admin/galleries/:id/export  → ZIP (Originalqualität)
POST   /admin/webhooks/test
```

### Upload-Flow

```
Browser → POST /g/:slug/upload (multipart)
  → Upload-Zeitfenster prüfen
  → Secret Key prüfen (falls konfiguriert)
  → SHA-256 Hash berechnen (Duplikat?)
  → Sharp: Thumbnail + WEBP-Konvertierung
  → EXIF entfernen (falls EXIF_STRIP=true)
  → Storage: lokal oder S3
  → DB: Photo mit status = "pending"
  → SMTP-Notification an Admin (falls konfiguriert)
  → Response: { id, status: "pending" }
```

### SSE-Strategie

- Fastify hält eine In-Memory-Map `galleryId → Set<SSEConnection>`
- Nach Moderation eines Fotos: Server pusht `event: new-photo` mit Foto-Daten an alle aktiven Slideshow-Verbindungen
- Kein Redis nötig für MVP (Single-Instance)
- Heartbeat alle 30s (`event: ping`) gegen Proxy-Timeouts
- Reconnect-Logik im Client via nativer `EventSource` API (automatischer Reconnect)

---

## Frontend-Struktur

### Routing (Next.js)

```
/                               → Landing / Redirect zur ersten Galerie
/g/[slug]                       → Galerie-Ansicht
/g/[slug]/upload                → Upload-Seite für Gäste
/g/[slug]/slideshow             → Vollbild-Slideshow (Beamer/TV)
/admin                          → Login
/admin/dashboard                → Übersicht aller Galerien
/admin/galleries/new            → Galerie erstellen
/admin/galleries/[id]           → Galerie bearbeiten + QR-Code
/admin/galleries/[id]/moderate  → Moderations-Dashboard
```

### Komponenten-Hierarchie

```
GalleryPage
  ├── GalleryHeader       (Name, Beschreibung, Foto-Anzahl, QR-Hint)
  ├── PhotoGrid           (Masonry oder gleichmäßig, konfigurierbar)
  │     └── PhotoCard     (Thumbnail, Lazy Load)
  ├── Lightbox            (Vollbild, Vor/Zurück, Download-Button)
  └── UploadButton        (→ /upload, prominent, mobile-first)

UploadPage
  ├── GuestNameInput      (optional/pflicht/versteckt per Config)
  ├── FileDropzone        (Drag & Drop + capture="camera")
  ├── FileQueue           (Liste mit Fortschrittsbalken pro Datei)
  └── SubmitButton

SlideshowPage             (kein Layout, Vollbild)
  ├── PhotoDisplay        (Überblend-Effekt, SSE-getrieben)
  ├── QRHintSlide         (konfigurierbar, zwischen Fotos)
  └── Controls            (Play/Pause, Vor/Zurück, Tastatur)

AdminModerationPage
  ├── PhotoQueue          (pending Fotos, Batch-Auswahl)
  │     └── ModerationCard (Freigeben / Ablehnen / Verschieben)
  └── BatchActionBar
```

### Styling & UX

- **Tailwind CSS** — Mobile-first, Dark Mode via `class`-Strategy
- **WCAG 2.1 AA** — Kontrastverhältnisse, Alt-Texte, Keyboard-Navigation
- **i18n:** `next-intl`, Sprachdateien `src/i18n/de.json` + `en.json`; Sprache via `DEFAULT_LANG` Env oder `Accept-Language`-Header
- Thumbnails serverseitig via Sharp, Lazy Loading im Browser

---

## Sicherheit & Datenschutz

| Bereich | Maßnahme |
|---|---|
| Passwörter | bcrypt (cost 12) |
| Sessions | HTTP-only Cookie, 24h TTL, serverseitig invalidierbar |
| Brute-Force | Lockout nach X Fehlversuchen (default: 5), konfigurierbar |
| 2FA | TOTP (otplib), optional per `TOTP_ENABLED=true` |
| Rate Limiting | `@fastify/rate-limit` auf Upload + Login-Endpunkten |
| EXIF | Sharp entfernt Geo-Metadaten vor Speicherung (konfigurierbar) |
| Galerie-Schutz | Optionaler Secret Key (PIN) pro Galerie, bcrypt-gehasht |
| robots.txt | `Disallow: /g/` — keine Indexierung von Galerien |
| HTTPS | Redirect HTTP→HTTPS konfigurierbar, HSTS-Header |
| Duplikate | SHA-256 Hash-Prüfung vor Speicherung |

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
ADMIN_PASSWORD_HASH=                 # bcrypt-Hash (Setup-Script generiert)
SESSION_SECRET=

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

---

## Features

### Kern-Features (MVP — Phase 1)

1. Admin-Login mit Passwort + Session + Brute-Force-Schutz
2. Single-Gallery-Mode: Galerie erstellen, bearbeiten
3. Gäste-Upload per QR-Code ohne Account (JPEG, PNG, WEBP, HEIC, MP4, MOV)
4. Pre-Moderation: Freigeben / Ablehnen / Batch-Aktionen
5. Galerie-Ansicht: Masonry-Grid, Lightbox, Lazy Loading
6. QR-Code-Export (PNG + SVG)
7. Basis-Slideshow (manuell, kein Realtime)
8. Docker Compose Setup

### Phase 2

9. Live-Slideshow mit SSE-Realtime-Updates
10. Multi-Galerie-Mode / Sub-Events
11. ZIP-Download (Admin + optional Gäste)
12. E-Mail-Benachrichtigungen (SMTP)
13. Upload-Zeitfenster (inkl. mehrtägige Events)
14. S3-Speicher-Backend
15. Duplikatprüfung (SHA-256)

### Phase 3

16. HEIC-Konvertierung serverseitig
17. EXIF-Daten-Entfernung
18. 2FA (TOTP)
19. Weitere i18n-Sprachen (Community)
20. Druckbares Tischkärtchen (PDF-Export)
21. Webhook- und NTFY-Integration
22. Galerie-Schutz per Secret Key (PIN)

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
| Frontend | Next.js 14+, Tailwind CSS, next-intl |
| Backend | Fastify (Node.js) |
| ORM | Prisma (SQLite default, PostgreSQL optional) |
| Bild-Processing | Sharp |
| QR-Code | `qrcode` npm-Paket (serverseitig) |
| Realtime | Server-Sent Events (SSE) |
| Storage | Lokales FS / S3-kompatibel (AWS SDK v3) |
| Auth | bcrypt, HTTP-only Sessions, otplib (TOTP) |
| Monorepo | pnpm workspaces |
| Container | Docker + Docker Compose |
| Lizenz | MIT |
