const sampleQueryBuilderOutput = {
  version: 1,
  intent: "search",
  type: "dynamic",
  params: {
    q: "kemiskinan maluku utara",
    source_id: null,
    period: null,
    year: null,
    month: null,
    group: null,
    code_hs: null,
    pod: null,
    ctr: null,
    metric: null,
    direction: null,
  },
  confidence: 0.7,
  notes: null,
};

const sampleDynamicApi = {
  labelvervar: "Kabupaten/Kota",
  vervar: [
    { label: "Kota Ternate", val: 1 },
    { label: "Kota Tidore Kepulauan", val: 2 },
  ],
  turvar: [{ label: "Nilai", val: 0 }],
  tahun: [{ label: "2024", val: 2024 }],
  turtahun: [{ label: "2024", val: 2024 }],
  datacontent: {
    "1-0-2024": 120,
    "2-0-2024": 98,
  },
  var: [{ label: "Kemiskinan" }],
  last_update: "2025-01-01",
};

const sampleRerankCandidates = [
  { id: 1, name: "Kemiskinan", score: 78 },
  { id: 2, name: "Kemiskinan Menurut Kab/Kota", score: 72 },
  { id: 3, name: "Inflasi", score: 50 },
];

module.exports = {
  sampleQueryBuilderOutput,
  sampleDynamicApi,
  sampleRerankCandidates,
};
