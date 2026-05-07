# Vision OCR Implementation

## Overview

Implementasi OCR menggunakan OpenAI Vision (GPT-4o) untuk mengekstrak teks dari PDF yang berisi gambar/scan.

## Alur Kerja

1. **Upload PDF** → `knowledgeDoc.service.js`
2. **Coba ekstrak text layer** → `pdf-parse` 
3. **Jika text < 500 karakter ATAU forceOcr=true**:
   - Convert PDF pages ke images → `pdfToImage.service.js` (pdf2pic + sharp)
   - Kirim images ke OpenAI Vision → `visionOcr.service.js`
4. **Pilih hasil terbaik**:
   - Jika OCR > 1.5x text layer → gunakan OCR
   - Jika text layer > 1.5x OCR → gunakan text layer
   - Jika hampir sama → hybrid (gabungan)
5. **Chunk & embed** → simpan ke `knowledge_base`

## Files

```
backend/src/services/ai/
├── visionOcr.service.js      # OpenAI Vision API calls
├── pdfToImage.service.js     # PDF to PNG conversion
├── knowledgeDoc.service.js   # Main document processing
└── embedding.service.js      # Text embedding
```

## API Usage

```bash
# Upload PDF dengan Force OCR
curl -X POST /knowledge/documents/pdf \
  -F "file=@scanned.pdf" \
  -F "title=Dokumen Scan" \
  -F "forceOcr=1"

# Response
{
  "ok": true,
  "total": 5,
  "chunks": 5,
  "extractedLength": 12500,
  "extractionMethod": "vision-ocr",  # atau "text-layer", "hybrid"
  "pageCount": 10,
  "documents": [...]
}
```

## Environment Variables

```env
# Pilih salah satu (INTERPRETATION preferred untuk cost tracking)
OPENAI_API_KEY_INTERPRETATION=sk-...
OPENAI_API_KEY=sk-...
```

## Cost Considerations

- Vision OCR: ~$0.003 per halaman (1600px width)
- Embedding: ~$0.00002 per chunk
- Rate limiting: 2 concurrent pages per PDF

## Admin UI

Halaman `/backend/knowledge`:
- Upload PDF dengan checkbox "🔍 Force OCR (gunakan untuk PDF scan/gambar)"
- Dokumen yang diproses dengan OCR ditandai `source_type: pdf-ocr`

## Dependencies

```json
{
  "openai": "^4.x",
  "pdf-parse": "^2.4.5",
  "pdf-lib": "^1.x",
  "pdf2pic": "^3.x",
  "sharp": "^0.33.x"
}
```
