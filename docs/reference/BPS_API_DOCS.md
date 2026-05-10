# BPS Web API Documentation

> **Source:** https://webapi.bps.go.id/documentation/
> **Provider:** Badan Pusat Statistik (BPS) — Statistics Indonesia
> **Base URL:** `https://webapi.bps.go.id`

## Overview

The BPS APIs provide programmatic access to read BPS data. Users can read about Publications, Press Releases, BPS Events, and various kinds of data presented in static and dynamic tables. The BPS API identifies users with a key token. Users can get a key token from the API-Portal website (every user can get two to three key tokens). All responses are returned in JSON.

---

## Table of Contents

1. [Domain](#1-domain)
2. [Subject](#2-subject)
3. [Subject Categories](#3-subject-categories)
4. [Dynamic Data](#4-dynamic-data)
5. [Census Data](#5-census-data)
6. [SIMDASI](#6-simdasi)
7. [Static Table](#7-static-table)
8. [CSA Subject](#8-csa-subject)
9. [Press Release](#9-press-release)
10. [Publication](#10-publication)
11. [Strategic Indicators](#11-strategic-indicators)
12. [Infographic](#12-infographic)
13. [Glosarium](#13-glosarium)
14. [Foreign Trade Data](#14-foreign-trade-data)
15. [Sustainable Development Goals (SDGs)](#15-sustainable-development-goals-sdgs)
16. [Special Data Dissemination Standard (SDDS)](#16-special-data-dissemination-standard-sdds)
17. [Statistical Classifications](#17-statistical-classifications)
18. [Searching](#18-searching)
19. [News](#19-news)

---

## 1. Domain

Displays all BPS Statistics domain websites.

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/domain`

### Parameters

| Field | Type | Description |
|---|---|---|
| `type` | String | `all` (all domains), `prov` (province), `kab` (city/regency), `kabbyprov` (all city/regency in a province) |
| `prov` *(optional)* | String | Province ID (4 digits). Required when `type=kabbyprov` |
| `key` | String | API key |

### Success Response (200)

```json
{
  "status": "OK",
  "data-availability": "available",
  "data": [
    {"page":1,"pages":1,"total":3},
    [
      {"domain_id":"0000","domain_name":"Pusat","domain_url":"https://www.bps.go.id"},
      {"domain_id":"1100","domain_name":"Aceh","domain_url":"https://aceh.bps.go.id"},
      {"domain_id":"1200","domain_name":"Sumatera Utara","domain_url":"https://sumut.bps.go.id"}
    ]
  ]
}
```

### Error Response (4xx)

```json
{ "error": "UserNotFound" }
```

---

## 2. Subject

Displays all subject data on the website.

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `subject` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID (4 digits) |
| `subcat` *(optional)* | Number | Subject category ID |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

### Success Response (200)

Returns: `sub_id`, `title`, `subcat_id`, `subcat`, `ntable` (number of tables in subject).

```json
{
  "status": "OK",
  "data-availability": "available",
  "data": [
    {"page":1,"pages":5,"per_page":10,"count":10,"total":48},
    [{"sub_id":40,"title":"Gender","subcat_id":1,"subcat":"Sosial dan Kependudukan","ntabel":null}]
  ]
}
```

---

## 3. Subject Categories

Displays all subject data categories.

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `subcat` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID (4 digits) |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

### Response Fields

`subcat_id`, `title`

```json
{
  "status": "OK",
  "data-availability": "available",
  "data": [
    {"page":1,"pages":1,"per_page":10,"count":4,"total":4},
    [{"subcat_id":1,"title":"Sosial dan Kependudukan"}]
  ]
}
```

---

## 4. Dynamic Data

### 4.1 Data

Displays data of dynamic tables on the website.

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `data` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID (4 digits) |
| `var` | Number | Variable ID |
| `turvar` *(optional)* | Number | Derived Variable ID |
| `vervar` *(optional)* | Number | Vertical Variable ID |
| `th` | Number | Period data ID (e.g. `1`, `2;3`, `2:6`) |
| `turth` *(optional)* | Number | Derived Period Data ID |
| `key` | String | API key |

#### Response Fields

`status`, `data-availability`, `var`, `turvar`, `labelvervar`, `vervar`, `tahun`, `turtahun`, `metadata`, `datacontent`.

```json
{
  "status": "OK",
  "data-availability": "available",
  "var":[{"val":145,"label":"Persentase Rumah Tangga Menurut Provinsi dan Sumber Penerangan","unit":"Persen","subj":"Lingkungan Hidup","def":"","decimal":"","note":"..."}],
  "turvar":[{"val":289,"label":"Listrik PLN"}],
  "labelvervar":"Provinsi",
  "vervar":[{"val":9999,"label":"INDONESIA"}],
  "tahun":[{"val":100,"label":"2000"}],
  "turtahun":[{"val":0,"label":"Tahun"}],
  "metadata":{"activity":null},
  "datacontent":{"99991452891000":83.68}
}
```

---

### 4.2 List Derived Period Data

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `turth` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `var` *(optional)* | Number | Variable ID |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

#### Response Fields

`turth_id`, `turth`, `group_turth_id`, `name_group_turth`

---

### 4.3 List Derived Variable

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `turvar` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `var` *(optional)* | Number | Variable ID |
| `group` *(optional)* | Number | Group Vertical Variable |
| `nopage` *(optional)* | Boolean | `1` to disable pagination |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

#### Response Fields

`turvar_id`, `turvar`, `group_turvar_id`, `name_group_turvar`

---

### 4.4 List Period Data

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `th` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `var` *(optional)* | Number | Variable ID |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

#### Response Fields

`th_id`, `th`

---

### 4.5 List Unit Data

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `unit` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

#### Response Fields

`unit_id`, `unit`

---

### 4.6 List Variable

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `var` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `subject` *(optional)* | Number | Subject ID |
| `page` *(optional)* | Number | Page number |
| `year` *(optional)* | Number | Year |
| `area` *(optional)* | Boolean | `1` shows variables existing on domain |
| `vervar` *(optional)* | Number | Vertical Variable ID |
| `key` | String | API key |

#### Response Fields

`var_id`, `title`, `sub_id`, `sub_name`, `def`, `notes`, `vertical`, `unit`, `graph_id`, `graph_name`

---

### 4.7 List Vertical Variable

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

#### Parameters

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `vervar` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `var` *(optional)* | Number | Variable ID |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

#### Response Fields

`vervar_id`, `vervar`, `item_ver_id`, `group_ver_id`, `name_group_ver_id`

---

## 5. Census Data

Source: `sensus.bps.go.id`

### 5.1 List of Census Events

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/sensus/id/37/`

| Field | Type | Description |
|---|---|---|
| `id` | Number | Service ID = `37` |
| `key` | String | API key |

Response fields: `id`, `kegiatan`, `tahun_kegiatan`.

### 5.2 Data Topics in the Census

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/sensus/id/38/`

| Field | Type | Description |
|---|---|---|
| `id` | Number | Service ID = `38` |
| `kegiatan` | String | Census event ID (e.g. `sp2020`) |
| `key` | String | API key |

Response fields: `id`, `topik`, `topic`, `id_kegiatan`, `kegiatan`, `event`, `alias_kegiatan`, `alias_event`.

### 5.3 List of Census Event Areas

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/sensus/id/39/`

| Field | Type | Description |
|---|---|---|
| `id` | Number | Service ID = `39` |
| `kegiatan` | String | Census event ID |
| `key` | String | API key |

Response fields: `id`, `kode_mfd`, `nama`, `slug`.

### 5.4 List of Available Datasets

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/sensus/id/40/`

| Field | Type | Description |
|---|---|---|
| `id` | Number | Service ID = `40` |
| `kegiatan` | String | Census event ID |
| `topik` | Number | Topic ID |
| `key` | String | API key |

Response fields: `id`, `id_topik`, `topik`, `id_kegiatan`, `nama`, `deskripsi`.

### 5.5 Census Data

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/sensus/id/41/`

| Field | Type | Description |
|---|---|---|
| `id` | Number | Service ID = `41` |
| `kegiatan` | String | Census event ID |
| `wilayah_sensus` | Number | Census area ID |
| `dataset` | Number | Dataset ID |
| `key` | String | API key |

Response includes: `timestamp`, `status`, `data_count`, then per record: `id_wilayah`, `kode_wilayah`, `nama_wilayah`, `level_wilayah`, `id_indikator`, `nama_indikator`, `id_kategori_x`, `nama_kategori_x`, `id_item_kategori_x`, `kode_item_kategori_x`, `nama_item_kategori_x`, `period`, `nilai`.

---

## 6. SIMDASI

(Sistem Informasi Manajemen Data Statistik Terintegrasi)

### 6.1 List of 7-Digit MFD Code of Province

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/26/`

| Field | Type | Description |
|---|---|---|
| `key` | String | API key |

### 6.2 List of 7-Digit MFD Code of Regency

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/27/`

| Field | Type | Description |
|---|---|---|
| `parent` | String | 7-digit Province MFD code |
| `key` | String | API key |

### 6.3 List of 7-Digit MFD Code of District

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/28/`

| Field | Type | Description |
|---|---|---|
| `parent` | String | 7-digit Regency MFD code |
| `key` | String | API key |

### 6.4 List of SIMDASI Subject

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/22/`

| Field | Type | Description |
|---|---|---|
| `wilayah` | String | 7-digit MFD area code (e.g. `3100000`) |
| `key` | String | API key |

Response fields include: `id_tabel`, `judul`, `judul_en`, `kode_tabel`, `ketersediaan_tahun`, `id_subject`, `bab`, `bab_en`, `subject`, `subject_en`, `mms_id`, `mms_subject`.

### 6.5 SIMDASI Master Table

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/34/`

| Field | Type | Description |
|---|---|---|
| `key` | String | API key |

### 6.6 Detail of SIMDASI Master Table

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/36/`

| Field | Type | Description |
|---|---|---|
| `id_tabel` | String | Table ID |
| `key` | String | API key |

### 6.7 List of SIMDASI Table Based on Area

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/23/`

| Field | Type | Description |
|---|---|---|
| `wilayah` | String | 7-digit MFD area code |
| `key` | String | API key |

### 6.8 List of SIMDASI Table Based on Area and Subject

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/24/`

| Field | Type | Description |
|---|---|---|
| `wilayah` | String | 7-digit MFD area code |
| `id_subjek` | String | MMS_id of subject |
| `key` | String | API key |

### 6.9 Detail of SIMDASI Table

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/interoperabilitas/datasource/simdasi/id/25/`

| Field | Type | Description |
|---|---|---|
| `wilayah` | String | 7-digit MFD area code |
| `tahun` | Number | Year |
| `id_tabel` | String | Table ID |
| `key` | String | API key |

---

## 7. Static Table

### 7.1 Detail Static Table

**Endpoint:** `GET https://webapi.bps.go.id/v1/view`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `statictable` |
| `lang` | String | `ind` or `eng` |
| `id` | Number | Static table ID |
| `key` | String | API key |

Response fields: `table_id`, `subj_id`, `title`, `table` (HTML), `cr_date`, `updt_date`, `size`, `excel`.

### 7.2 List All Static Table

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `statictable` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `page` *(optional)* | Number | Page number |
| `month` *(optional)* | Number | Month |
| `year` *(optional)* | Number | Year |
| `keyword` *(optional)* | String | Search keyword |
| `key` | String | API key |

Response fields: `table_id`, `title`, `subj_id`, `subj`, `updt_date`, `size`, `excel`.

---

## 8. CSA Subject

(Classification of Statistical Activities — established 2005, used as basis for CES international statistical activities database.)

### 8.1 CSA Subject Categories

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `subcatcsa` |
| `key` | String | API key |

Response fields: `subcat_id`, `title`.

### 8.2 CSA Subject

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `subjectcsa` |
| `subcat` *(optional)* | String | CSA category ID |
| `key` | String | API key |

Response fields: `sub_id`, `title`, `subcat_id`, `subcat`.

### 8.3 List of Table (Using CSA Subject)

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `tablestatistic` |
| `subject` *(optional)* | Number | CSA Subject `sub_id` |
| `page` *(optional)* | Number | Page |
| `perpage` *(optional)* | Number | Page size |
| `key` | String | API key |

Response fields: `id`, `title`, `id_subject`, `subject`, `id_subcat`, `subcat`, `tablesource` (1=Static, 2=Dynamic, 3=SIMDASI).

### 8.4 Detail of Table (Using CSA Subject)

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/view`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `tablestatistic` |
| `id` | String | Table ID |
| `year` *(optional)* | Integer | 4-digit year |
| `lang` | String | `ind` or `eng` |
| `key` | String | API key |

---

## 9. Press Release

### 9.1 Detail Press Release

**Endpoint:** `GET https://webapi.bps.go.id/v1/view`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `pressrelease` |
| `lang` | String | `ind` or `eng` |
| `id` | Number | Press release ID |
| `key` | String | API key |

Response fields: `brs_id`, `title`, `abstract`, `rl_date`, `updt_date`, `pdf`, `size`.

### 9.2 List All Press Release

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `pressrelease` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `page` *(optional)* | Number | Page |
| `month` *(optional)* | Number | Month |
| `year` *(optional)* | Number | Year |
| `keyword` *(optional)* | String | Search keyword |
| `key` | String | API key |

Response fields: `brs_id`, `title`, `rl_date`, `updt_date`, `pdf`, `size`.

---

## 10. Publication

### 10.1 Detail Publication

**Endpoint:** `GET https://webapi.bps.go.id/v1/view`

| Field | Type | Description |
|---|---|---|
| `domain` | Number | Domain ID |
| `model` | String | Must be `publication` |
| `lang` | String | `ind` or `eng` |
| `id` | String | Publication ID |
| `key` | String | API key |

Response fields: `pub_id`, `title`, `kat_no`, `pub_no`, `issn`, `abstract`, `sch_date`, `rl_date`, `updt_date`, `cover`, `pdf`, `size`.

### 10.2 List All Publication

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `publication` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `page` *(optional)* | Number | Page |
| `month` *(optional)* | Number | Month |
| `year` *(optional)* | Number | Year |
| `keyword` *(optional)* | String | Search keyword |
| `key` | String | API key |

Response fields: `pub_id`, `title`, `issn`, `sch_date`, `rl_date`, `updt_date`, `cover`, `pdf`, `size`.

---

## 11. Strategic Indicators

Displays strategic indicators (only for central and province websites).

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `indicators` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain (central/province only) |
| `var` *(optional)* | Number | Variable ID |
| `page` *(optional)* | Number | Page number |
| `key` | String | API key |

Response fields: `title`, `desc`, `data_source`, `value`, `unit`.

---

## 12. Infographic

Displays all infographics on the website.

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `infographic` |
| `lang` *(optional)* | String | `ind` (default), `eng` |
| `domain` | Number | Domain ID |
| `page` *(optional)* | Number | Page |
| `keyword` *(optional)* | String | Search keyword |
| `key` | String | API key |

Response fields: `inf_id`, `title`, `img`, `desc`, `category` (1=Social/Population, 2=Economic/Trade, 3=Agriculture/Mining), `dl`.

---

## 13. Glosarium

### 13.1 List of Glosarium

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `glosarium` |
| `prefix` *(optional)* | String | First letter to filter |
| `page` *(optional)* | Number | Page |
| `perpage` *(optional)* | Number | Page size (max 500) |
| `key` | String | API key |

Response `_source` fields: `konten`, `jenis`, `id`, `idSds`, `noIndikator`, `judulIndikator(_en)`, `konsep(_en)`, `definisi(_en)`, `namaKlasifikasi(_en)`, `ukuran(_en)`, `satuan(_en)`, `flagSds`, `sumberKonten(_en)`, `sumberData(_en)`, `endpoint`, `flag`.

### 13.2 Detail of Glosarium

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/view`

| Field | Type | Description |
|---|---|---|
| `model` | String | Must be `glosarium` |
| `id` | Number | Glosarium ID |
| `lang` | String | `ind` (default), `eng` |
| `key` | String | API key |

---

## 14. Foreign Trade Data

(Export & Import)

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/dataexim/`

| Field | Type | Description |
|---|---|---|
| `sumber` | Number | `1`=Export, `2`=Import |
| `periode` | Number | `1`=Monthly, `2`=Annually |
| `kodehs` | Number | HS Code, multiple separated by `;` |
| `jenishs` | Number | `1`=Two digit, `2`=Full HS Code |
| `tahun` | String | Year |
| `key` | String | API key |

Response metadata describes: `source`, `value` (USD), `netweight` (Kg), `kodehs`, `pod` (port), `ctr` (country), `tahun`.

---

## 15. Sustainable Development Goals (SDGs)

Domain must be `0000`.

**Endpoint:** `GET https://webapi.bps.go.id/v1/api/list/`

| Field | Type | Description |
|---|---