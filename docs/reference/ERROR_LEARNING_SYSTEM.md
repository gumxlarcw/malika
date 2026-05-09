# Error Learning System - Chat MALIKA

**Tanggal Implementasi:** 20 Januari 2026  
**Status:** Production Ready  
**Versi:** 1.0

---

## Ringkasan

Sistem Error Learning memungkinkan:
1. **Flagging** - Menandai response chat yang bermasalah
2. **Pattern Recognition** - Mengidentifikasi pola kesalahan
3. **Auto-Learning** - Memperbaiki system prompt berdasarkan kesalahan
4. **Knowledge Addition** - Menambah ke knowledge base dari koreksi

---

## Arsitektur

```
┌─────────────────────────────────────────────────────────────────────────┐
│                        ERROR LEARNING FLOW                              │
└─────────────────────────────────────────────────────────────────────────┘

  USER CHAT                    ADMIN REVIEW                  AUTO-LEARNING
     │                              │                             │
     ▼                              ▼                             ▼
┌──────────┐                 ┌──────────────┐              ┌──────────────┐
│ Response │──flag error────▶│ chat_message │──analyze────▶│ chat_error   │
│ Salah    │                 │ _flags       │              │ _patterns    │
└──────────┘                 └──────────────┘              └──────────────┘
                                    │                             │
                                    ▼                             ▼
                             ┌──────────────┐              ┌──────────────┐
                             │ Admin Review │──create fix─▶│ Prompt Fixes │
                             │ & Correct    │              │ (auto-inject)│
                             └──────────────┘              └──────────────┘
                                    │                             │
                                    ▼                             ▼
                             ┌──────────────┐              ┌──────────────┐
                             │ Add to       │              │ Next Chat    │
                             │ Knowledge    │              │ Uses Fixes   │
                             └──────────────┘              └──────────────┘
```

---

## Database Schema

### chat_message_flags
Menyimpan message yang di-flag sebagai bermasalah.

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| message_id | INT | Reference ke chat_messages.id |
| thread_id | INT | Reference ke chat_threads.id |
| flag_type | ENUM | Jenis error (hallucination, wrong_data, irrelevant, incomplete, formatting_issue, context_lost, wrong_source, other) |
| severity | ENUM | low, medium, high, critical |
| flagged_by | ENUM | user, admin, system, auto |
| user_query | TEXT | Query user yang memicu response salah |
| assistant_response | TEXT | Response yang bermasalah |
| expected_response | TEXT | Jawaban yang seharusnya (training data) |
| correction_notes | TEXT | Catatan admin tentang masalah |
| resolution_status | ENUM | pending, reviewed, fixed, ignored, training_added |

### chat_error_patterns
Menyimpan pola error yang teridentifikasi untuk mencegah berulang.

| Column | Type | Description |
|--------|------|-------------|
| id | INT | Primary key |
| pattern_name | VARCHAR | Nama pattern (e.g., "Hallucination Nama Kepala BPS") |
| pattern_type | ENUM | query_pattern, data_pattern, context_pattern, hallucination_pattern, prompt_issue |
| trigger_keywords | JSON | Keywords yang trigger error ini |
| trigger_regex | TEXT | Regex pattern untuk matching |
| error_description | TEXT | Deskripsi masalah |
| fix_type | ENUM | add_to_knowledge, add_to_prompt, special_handling, data_fix, cannot_fix |
| fix_content | TEXT | Content fix (tambahan prompt, teks knowledge, dll) |
| occurrence_count | INT | Berapa kali pattern ini terjadi |
| is_active | BOOLEAN | Apakah fix ini aktif |

---

## API Endpoints

### Public (User dapat flag)

#### POST /error-learning/flag
Flag sebuah message sebagai bermasalah.

**Headers:**
```
x-malika-uid: <user_uuid>
```

**Body:**
```json
{
  "message_id": 1234,
  "thread_id": 56,
  "flag_type": "hallucination",
  "expected_response": "Jawaban yang benar adalah..."
}
```

**Response:**
```json
{
  "ok": true,
  "flag": { "id": 1, "flag_type": "hallucination", ... },
  "created": true
}
```

### Admin Only

#### GET /error-learning/stats
Statistik error tracking.

```json
{
  "ok": true,
  "stats": {
    "totalFlags": 15,
    "pendingFlags": 8,
    "byType": {
      "hallucination": 5,
      "wrong_data": 3,
      "context_lost": 7
    },
    "byStatus": {
      "pending": 8,
      "fixed": 5,
      "ignored": 2
    },
    "recentFlags": [...],
    "topPatterns": [...]
  }
}
```

#### GET /error-learning/analyze
Analisis flags pending untuk identifikasi pattern.

#### GET /error-learning/flags?status=pending&flag_type=hallucination&page=1&limit=20
List flags dengan filter dan pagination.

#### PUT /error-learning/flags/:id/resolve
Resolve sebuah flag.

**Body:**
```json
{
  "status": "fixed",
  "notes": "Ditambahkan ke knowledge base"
}
```

#### POST /error-learning/flags/:id/add-to-knowledge
Konversi flag menjadi knowledge base entry.

**Body:**
```json
{
  "correction_text": "Kepala BPS Maluku Utara saat ini adalah..."
}
```

#### GET /error-learning/patterns
List semua error patterns.

#### POST /error-learning/patterns
Buat pattern baru.

**Body:**
```json
{
  "pattern_name": "Hallucination Nama Kepala BPS",
  "pattern_type": "hallucination_pattern",
  "trigger_keywords": ["kepala bps", "nama kepala", "siapa kepala"],
  "error_description": "LLM sering mengarang nama kepala BPS",
  "fix_type": "add_to_prompt",
  "fix_content": "- JANGAN menyebut nama pejabat/kepala BPS karena bisa berubah. Arahkan ke website resmi atau WhatsApp."
}
```

#### PUT /error-learning/patterns/:id
Update pattern.

#### DELETE /error-learning/patterns/:id
Hapus pattern.

---

## Workflow Penggunaan

### 1. User Menandai Response Bermasalah

Di frontend chat, user bisa klik tombol "Laporkan Masalah" pada bubble response.

```javascript
// Frontend example
async function reportProblem(messageId, threadId, type) {
  await fetch('/error-learning/flag', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-malika-uid': getMalikaUid(),
    },
    body: JSON.stringify({
      message_id: messageId,
      thread_id: threadId,
      flag_type: type, // 'hallucination', 'wrong_data', etc.
    }),
  });
}
```

### 2. Admin Review di Dashboard

Admin melihat daftar flags pending dan melakukan review:

```bash
# Get pending flags
curl -H "Authorization: Bearer <token>" \
  https://api-malika.bpsmalut.com/error-learning/flags?status=pending

# Resolve dengan catatan
curl -X PUT -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"status": "fixed", "notes": "Added prompt rule"}' \
  https://api-malika.bpsmalut.com/error-learning/flags/1/resolve
```

### 3. Membuat Error Pattern

Jika pattern berulang, admin buat pattern untuk mencegah:

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "pattern_name": "Tidak boleh menyebut grafik",
    "pattern_type": "prompt_issue",
    "trigger_keywords": ["grafik", "chart", "diagram"],
    "error_description": "MALIKA tidak bisa menampilkan grafik tapi kadang menjanjikan",
    "fix_type": "add_to_prompt",
    "fix_content": "- JANGAN menjanjikan menampilkan grafik/chart. Katakan bahwa fitur ini belum tersedia."
  }' \
  https://api-malika.bpsmalut.com/error-learning/patterns
```

### 4. Auto-Injection ke System Prompt

Setiap chat request, sistem otomatis:
1. Load semua patterns dengan `fix_type = 'add_to_prompt'`
2. Inject ke system prompt sebagai "KOREKSI PENTING"

```javascript
// Di streaming.service.js (sudah diimplementasikan)
const promptFixes = await errorLearningService.getPromptFixes();
// Fixes di-inject ke system prompt context
```

### 5. Menambah ke Knowledge Base

Untuk koreksi yang butuh konteks lebih, admin bisa konversi ke knowledge:

```bash
curl -X POST -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"correction_text": "Kepala BPS Provinsi Maluku Utara saat ini adalah Dr. Fulan, S.Si, M.Si. Untuk informasi terkini, silakan cek website resmi BPS Maluku Utara."}' \
  https://api-malika.bpsmalut.com/error-learning/flags/1/add-to-knowledge
```

---

## Contoh Error Patterns

### Pattern 1: Hallucination Nama Pejabat

```json
{
  "pattern_name": "Hallucination Nama Pejabat",
  "pattern_type": "hallucination_pattern",
  "trigger_keywords": ["kepala bps", "nama kepala", "siapa kepala", "pimpinan bps"],
  "error_description": "LLM sering mengarang nama kepala/pejabat BPS",
  "fix_type": "add_to_prompt",
  "fix_content": "- DILARANG menyebut nama pejabat BPS karena informasi bisa outdated. Arahkan ke website resmi atau WhatsApp."
}
```

### Pattern 2: Menjanjikan Fitur Tidak Ada

```json
{
  "pattern_name": "Menjanjikan Fitur Tidak Tersedia",
  "pattern_type": "prompt_issue",
  "trigger_keywords": ["grafik", "chart", "diagram", "visualisasi"],
  "error_description": "MALIKA tidak bisa menampilkan grafik tapi kadang menjanjikan akan menampilkan",
  "fix_type": "add_to_prompt",
  "fix_content": "- JANGAN menjanjikan grafik/chart/diagram karena fitur ini belum ada. Sarankan user membuka dashboard MALIKA atau Metabase."
}
```

### Pattern 3: Context Lost pada Follow-up

```json
{
  "pattern_name": "Context Lost Tahun",
  "pattern_type": "context_pattern",
  "trigger_keywords": ["tahun lalu", "tahun sebelumnya", "2023", "2022"],
  "error_description": "Saat user minta data tahun sebelumnya, context topik sering hilang",
  "fix_type": "special_handling",
  "fix_content": "merge_with_previous_topic"
}
```

---

## Integrasi Frontend (TODO)

Untuk mengaktifkan user flagging di frontend chat:

```tsx
// ChatPageClient.tsx - tambahkan tombol report
function MessageBubble({ message, onFlag }) {
  const [showFlagMenu, setShowFlagMenu] = useState(false);
  
  const flagTypes = [
    { value: 'hallucination', label: 'Angka/data salah' },
    { value: 'wrong_data', label: 'Data tidak sesuai pertanyaan' },
    { value: 'irrelevant', label: 'Jawaban tidak relevan' },
    { value: 'incomplete', label: 'Jawaban tidak lengkap' },
    { value: 'context_lost', label: 'Tidak paham pertanyaan saya' },
    { value: 'other', label: 'Masalah lain' },
  ];
  
  return (
    <div className="message-bubble">
      {message.content}
      {message.role === 'assistant' && (
        <button onClick={() => setShowFlagMenu(true)}>
          ⚠️ Laporkan Masalah
        </button>
      )}
      {showFlagMenu && (
        <FlagMenu types={flagTypes} onSelect={(type) => onFlag(message.id, type)} />
      )}
    </div>
  );
}
```

---

## Monitoring

### Query untuk cek error rate

```sql
-- Error rate per hari
SELECT 
  DATE(created_at) as date,
  COUNT(*) as total_flags,
  SUM(CASE WHEN flag_type = 'hallucination' THEN 1 ELSE 0 END) as hallucinations,
  SUM(CASE WHEN flag_type = 'wrong_data' THEN 1 ELSE 0 END) as wrong_data
FROM chat_message_flags
GROUP BY DATE(created_at)
ORDER BY date DESC
LIMIT 30;

-- Top error patterns
SELECT 
  pattern_name,
  occurrence_count,
  last_occurrence_at
FROM chat_error_patterns
WHERE is_active = 1
ORDER BY occurrence_count DESC
LIMIT 10;

-- Pending flags yang butuh review
SELECT 
  cmf.id,
  cmf.flag_type,
  cmf.severity,
  LEFT(cmf.user_query, 100) as query,
  cmf.created_at
FROM chat_message_flags cmf
WHERE cmf.resolution_status = 'pending'
ORDER BY 
  FIELD(cmf.severity, 'critical', 'high', 'medium', 'low'),
  cmf.created_at DESC
LIMIT 20;
```

---

## Catatan Penting

1. **Graceful Degradation**: Jika error learning service gagal, chat tetap berjalan normal
2. **Cache**: Prompt fixes di-load setiap request (ringan karena biasanya sedikit)
3. **Security**: Flag endpoint public tapi rate-limited; management endpoints require admin auth
4. **Training Data**: Expected response dari flags bisa digunakan untuk fine-tuning di masa depan

---

**Author:** AI Implementation  
**Last Updated:** 20 Januari 2026
