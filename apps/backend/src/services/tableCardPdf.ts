import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib'
import QRCode from 'qrcode'

export type TableCardLocale = 'de' | 'en'

type TableCardOptions = {
  galleryName: string
  uploadUrl: string
  locale: TableCardLocale
}

const A6_LANDSCAPE_WIDTH_PT = 419.53
const A6_LANDSCAPE_HEIGHT_PT = 297.64

const messages = {
  de: {
    instruction: 'Scanne den Code und teile deine Fotos',
    uploadHint: 'Upload-Link',
  },
  en: {
    instruction: 'Scan the code and share your photos',
    uploadHint: 'Upload URL',
  },
} as const

function trimProtocol(url: string): string {
  return url.replace(/^https?:\/\//, '')
}

function fitFontSize(
  font: PDFFont,
  text: string,
  maxWidth: number,
  initialSize: number,
  minSize: number
): number {
  let currentSize = initialSize
  while (currentSize > minSize && font.widthOfTextAtSize(text, currentSize) > maxWidth) {
    currentSize -= 0.5
  }
  return currentSize
}

function drawCenteredText(
  page: PDFPage,
  font: PDFFont,
  text: string,
  size: number,
  y: number
): void {
  const width = font.widthOfTextAtSize(text, size)
  const x = (A6_LANDSCAPE_WIDTH_PT - width) / 2
  page.drawText(text, {
    x,
    y,
    size,
    font,
    color: rgb(0.1725, 0.1725, 0.1725),
  })
}

export async function renderTableCardPdf(options: TableCardOptions): Promise<Buffer> {
  const labels = messages[options.locale]
  const qrPng = await QRCode.toBuffer(options.uploadUrl, {
    errorCorrectionLevel: 'H',
    margin: 4,
    scale: 10,
    color: { dark: '#2C2C2C', light: '#FAF7F4' },
  })

  const pdf = await PDFDocument.create()
  const page = pdf.addPage([A6_LANDSCAPE_WIDTH_PT, A6_LANDSCAPE_HEIGHT_PT])

  page.drawRectangle({
    x: 0,
    y: 0,
    width: A6_LANDSCAPE_WIDTH_PT,
    height: A6_LANDSCAPE_HEIGHT_PT,
    color: rgb(0.9804, 0.9686, 0.9569),
  })

  const titleFont = await pdf.embedFont(StandardFonts.HelveticaBold)
  const bodyFont = await pdf.embedFont(StandardFonts.Helvetica)
  const qrImage = await pdf.embedPng(qrPng)

  const titleSize = fitFontSize(titleFont, options.galleryName, A6_LANDSCAPE_WIDTH_PT - 64, 22, 14)
  drawCenteredText(page, titleFont, options.galleryName, titleSize, A6_LANDSCAPE_HEIGHT_PT - 38)

  const qrSize = 160
  const qrX = (A6_LANDSCAPE_WIDTH_PT - qrSize) / 2
  const qrY = (A6_LANDSCAPE_HEIGHT_PT - qrSize) / 2 - 4
  page.drawImage(qrImage, {
    x: qrX,
    y: qrY,
    width: qrSize,
    height: qrSize,
  })

  const instructionSize = fitFontSize(bodyFont, labels.instruction, A6_LANDSCAPE_WIDTH_PT - 40, 12, 9)
  drawCenteredText(page, bodyFont, labels.instruction, instructionSize, 30)

  drawCenteredText(page, bodyFont, labels.uploadHint, 8, 18)
  drawCenteredText(page, bodyFont, trimProtocol(options.uploadUrl), 10, 7)

  const bytes = await pdf.save()
  return Buffer.from(bytes)
}
