/**
 * Unit tests for chartAgent.service.js
 *
 * Tests: input building, column validation, cache, LLM integration (mocked),
 * timeout/failure fallback, skip conditions.
 */

jest.mock('../services/ai/openaiChat.service', () => ({
  openAiStructuredOutput: jest.fn(),
}));

const { openAiStructuredOutput } = require('../services/ai/openaiChat.service');
const { buildChatJsonResponse } = require('./helpers/mockOpenAI');
const {
  generateChartConfig,
  _buildChartInput,
  _validateConfig,
  _cacheKey,
  _cache,
} = require('../services/chat/streaming/chartAgent.service');

// ── Sample data ──────────────────────────────────────────────────────────

const SAMPLE_INFLASI_CTX = {
  effectiveQuery: 'inflasi kota ternate 2024',
  userMessage: 'inflasi kota ternate 2024',
  geoContext: 'Kota Ternate',
  periodContext: '2024',
  dataPreview: {
    title: 'Inflasi Kota Ternate',
    source_type: 'dynamic',
    source_id: 42,
    columns: ['Bulan', 'Inflasi (m-t-m)', 'Inflasi (y-o-y)', 'IHK'],
    rows: [
      { Bulan: 'Januari', 'Inflasi (m-t-m)': 0.25, 'Inflasi (y-o-y)': 2.1, IHK: 105.3 },
      { Bulan: 'Februari', 'Inflasi (m-t-m)': 0.18, 'Inflasi (y-o-y)': 2.3, IHK: 105.5 },
      { Bulan: 'Maret', 'Inflasi (m-t-m)': -0.12, 'Inflasi (y-o-y)': 2.0, IHK: 105.4 },
      { Bulan: 'April', 'Inflasi (m-t-m)': 0.30, 'Inflasi (y-o-y)': 2.5, IHK: 105.7 },
      { Bulan: 'Mei', 'Inflasi (m-t-m)': 0.10, 'Inflasi (y-o-y)': 2.2, IHK: 105.6 },
      { Bulan: 'Juni', 'Inflasi (m-t-m)': -0.05, 'Inflasi (y-o-y)': 1.9, IHK: 105.3 },
    ],
  },
};

const SAMPLE_GEO_CTX = {
  effectiveQuery: 'kemiskinan kabupaten kota 2023',
  dataPreview: {
    columns: ['Wilayah', 'Jumlah Penduduk Miskin', 'Persentase'],
    rows: [
      { Wilayah: 'Kota Ternate', 'Jumlah Penduduk Miskin': 12000, Persentase: 4.5 },
      { Wilayah: 'Kab. Halmahera Utara', 'Jumlah Penduduk Miskin': 18000, Persentase: 6.2 },
      { Wilayah: 'Kab. Halmahera Selatan', 'Jumlah Penduduk Miskin': 15000, Persentase: 5.8 },
    ],
  },
};

const SAMPLE_LLM_LINE_RESPONSE = {
  should_render: true,
  render_reason: 'Time-series data with monthly pattern and 3 metrics, suitable for multi-series line chart',
  chart_type: 'line',
  x_axis: { column: 'Bulan', label: 'Bulan', type: 'category' },
  series: [
    { column: 'Inflasi (m-t-m)', label: 'Inflasi m-t-m', type: 'primary' },
    { column: 'Inflasi (y-o-y)', label: 'Inflasi y-o-y', type: 'secondary' },
    { column: 'IHK', label: 'IHK', type: 'secondary' },
  ],
  y_axis: { label: 'Nilai', format: 'number' },
  options: { stacked: false, show_legend: true, show_data_labels: false, orientation: 'vertical', color_scheme: 'default' },
  chart_title: 'Inflasi Kota Ternate 2024',
  chart_subtitle: '2024',
  alternative: { chart_type: 'area', reason: 'Area chart shows trend filling' },
};

const SAMPLE_LLM_NO_RENDER = {
  should_render: false,
  render_reason: 'Only 1 row of data, insufficient for chart',
  chart_type: 'bar',
  x_axis: { column: 'Wilayah', label: 'Wilayah', type: 'category' },
  series: [{ column: 'Nilai', label: 'Nilai', type: 'primary' }],
  y_axis: { label: 'Nilai', format: 'number' },
  options: { stacked: false, show_legend: false, show_data_labels: false, orientation: 'vertical', color_scheme: 'default' },
  chart_title: 'Data',
  chart_subtitle: null,
  alternative: null,
};

// ── Tests ────────────────────────────────────────────────────────────────

describe('chartAgent.service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    _cache.clear();
  });

  // ── _buildChartInput ────────────────────────────────────────────────

  describe('_buildChartInput', () => {
    it('builds correct input from pipeline context', () => {
      const input = _buildChartInput(SAMPLE_INFLASI_CTX);

      expect(input).not.toBeNull();
      expect(input.user_query).toBe('inflasi kota ternate 2024');
      expect(input.table_title).toBe('Inflasi Kota Ternate');
      expect(input.columns).toEqual(['Bulan', 'Inflasi (m-t-m)', 'Inflasi (y-o-y)', 'IHK']);
      expect(input.row_count).toBe(6);
      expect(input.source_id).toBe(42);
      expect(input.geo_context).toBe('Kota Ternate');
      expect(input.period_context).toBe('2024');
    });

    it('detects column types correctly', () => {
      const input = _buildChartInput(SAMPLE_INFLASI_CTX);

      // Bulan → time
      expect(input.column_types['Bulan']).toBe('time');
      // Numeric metric columns → detected format
      expect(['number', 'percentage']).toContain(input.column_types['Inflasi (m-t-m)']);
    });

    it('detects geo column types', () => {
      const input = _buildChartInput(SAMPLE_GEO_CTX);

      expect(input.column_types['Wilayah']).toBe('geo');
    });

    it('limits sample rows to max 5', () => {
      const input = _buildChartInput(SAMPLE_INFLASI_CTX);
      expect(input.sample_rows.length).toBe(5);
    });

    it('returns null for empty preview', () => {
      expect(_buildChartInput({ dataPreview: null })).toBeNull();
      expect(_buildChartInput({ dataPreview: { columns: [], rows: [] } })).toBeNull();
    });

    it('truncates long user query to 200 chars', () => {
      const ctx = {
        ...SAMPLE_INFLASI_CTX,
        effectiveQuery: 'a'.repeat(300),
      };
      const input = _buildChartInput(ctx);
      expect(input.user_query.length).toBe(200);
    });
  });

  // ── _validateConfig ─────────────────────────────────────────────────

  describe('_validateConfig', () => {
    const columns = ['Bulan', 'Inflasi (m-t-m)', 'Inflasi (y-o-y)', 'IHK'];

    it('accepts valid config with matching columns', () => {
      const result = _validateConfig(SAMPLE_LLM_LINE_RESPONSE, columns);
      expect(result).not.toBeNull();
      expect(result.should_render).toBe(true);
    });

    it('accepts should_render=false without column check', () => {
      const result = _validateConfig(SAMPLE_LLM_NO_RENDER, ['Wilayah', 'Nilai']);
      expect(result).not.toBeNull();
      expect(result.should_render).toBe(false);
    });

    it('rejects config with wrong x_axis column', () => {
      const badConfig = {
        ...SAMPLE_LLM_LINE_RESPONSE,
        x_axis: { column: 'NonExistent', label: 'X', type: 'category' },
      };
      const result = _validateConfig(badConfig, columns);
      expect(result).toBeNull();
    });

    it('rejects config with wrong series column', () => {
      const badConfig = {
        ...SAMPLE_LLM_LINE_RESPONSE,
        series: [{ column: 'FakeColumn', label: 'Fake', type: 'primary' }],
      };
      const result = _validateConfig(badConfig, columns);
      expect(result).toBeNull();
    });

    it('accepts case-insensitive column matches', () => {
      const config = {
        ...SAMPLE_LLM_LINE_RESPONSE,
        x_axis: { column: 'bulan', label: 'Bulan', type: 'category' },
        series: [{ column: 'inflasi (m-t-m)', label: 'Inflasi m-t-m', type: 'primary' }],
      };
      const result = _validateConfig(config, columns);
      // Should not reject — lowercased column names match actual columns (lowercased)
      expect(result).not.toBeNull();
      expect(result.should_render).toBe(true);
    });

    it('rejects null/undefined input', () => {
      expect(_validateConfig(null, columns)).toBeNull();
      expect(_validateConfig(undefined, columns)).toBeNull();
    });

    it('rejects config with empty series', () => {
      const noSeries = { ...SAMPLE_LLM_LINE_RESPONSE, series: [] };
      const result = _validateConfig(noSeries, columns);
      expect(result).toBeNull();
    });
  });

  // ── Cache ───────────────────────────────────────────────────────────

  describe('cache', () => {
    it('generates deterministic cache keys', () => {
      const key1 = _cacheKey(42, ['Bulan', 'Inflasi', 'IHK']);
      const key2 = _cacheKey(42, ['IHK', 'Bulan', 'Inflasi']);
      expect(key1).toBe(key2); // sorted
    });

    it('differentiates keys by source_id', () => {
      const key1 = _cacheKey(42, ['Bulan', 'IHK']);
      const key2 = _cacheKey(99, ['Bulan', 'IHK']);
      expect(key1).not.toBe(key2);
    });

    it('handles null source_id', () => {
      const key = _cacheKey(null, ['Bulan']);
      expect(key).toContain('x:');
    });
  });

  // ── generateChartConfig (integration with mocked LLM) ──────────────

  describe('generateChartConfig', () => {
    it('returns LLM chart config for valid data', async () => {
      openAiStructuredOutput.mockResolvedValue(
        buildChatJsonResponse(SAMPLE_LLM_LINE_RESPONSE)
      );

      const result = await generateChartConfig(SAMPLE_INFLASI_CTX);

      expect(result).not.toBeNull();
      expect(result.should_render).toBe(true);
      expect(result.chart_type).toBe('line');
      expect(result.series.length).toBe(3);
      expect(openAiStructuredOutput).toHaveBeenCalledTimes(1);

      // Verify it was called with correct params
      const callArgs = openAiStructuredOutput.mock.calls[0][0];
      expect(callArgs.model).toBe('gemini-3-flash-preview');
      expect(callArgs.purpose).toBe('chart_agent');
      expect(callArgs.timeoutMs).toBe(6000);
      expect(callArgs.retries).toBe(0);
    });

    it('returns cached result on second call', async () => {
      openAiStructuredOutput.mockResolvedValue(
        buildChatJsonResponse(SAMPLE_LLM_LINE_RESPONSE)
      );

      const first = await generateChartConfig(SAMPLE_INFLASI_CTX);
      const second = await generateChartConfig(SAMPLE_INFLASI_CTX);

      expect(first).toEqual(second);
      // LLM should only be called once (second call uses cache)
      expect(openAiStructuredOutput).toHaveBeenCalledTimes(1);
    });

    it('returns null when LLM call fails', async () => {
      openAiStructuredOutput.mockRejectedValue(new Error('timeout'));

      const result = await generateChartConfig(SAMPLE_INFLASI_CTX);
      expect(result).toBeNull();
    });

    it('returns null when LLM returns empty content', async () => {
      openAiStructuredOutput.mockResolvedValue({
        choices: [{ message: { content: null } }],
      });

      const result = await generateChartConfig(SAMPLE_INFLASI_CTX);
      expect(result).toBeNull();
    });

    it('returns null when LLM returns invalid column references', async () => {
      const badResponse = {
        ...SAMPLE_LLM_LINE_RESPONSE,
        x_axis: { column: 'NonExistent', label: 'X', type: 'category' },
      };
      openAiStructuredOutput.mockResolvedValue(
        buildChatJsonResponse(badResponse)
      );

      const result = await generateChartConfig(SAMPLE_INFLASI_CTX);
      expect(result).toBeNull();
    });

    it('skips when no data preview', async () => {
      const result = await generateChartConfig({ dataPreview: null });
      expect(result).toBeNull();
      expect(openAiStructuredOutput).not.toHaveBeenCalled();
    });

    it('skips when empty columns', async () => {
      const result = await generateChartConfig({
        dataPreview: { columns: [], rows: [{ a: 1 }] },
      });
      expect(result).toBeNull();
      expect(openAiStructuredOutput).not.toHaveBeenCalled();
    });

    it('skips when only 1 row', async () => {
      const result = await generateChartConfig({
        dataPreview: {
          columns: ['Wilayah', 'Nilai'],
          rows: [{ Wilayah: 'Ternate', Nilai: 100 }],
        },
      });
      expect(result).toBeNull();
      expect(openAiStructuredOutput).not.toHaveBeenCalled();
    });

    it('returns should_render=false config from LLM', async () => {
      openAiStructuredOutput.mockResolvedValue(
        buildChatJsonResponse(SAMPLE_LLM_NO_RENDER)
      );

      const result = await generateChartConfig(SAMPLE_GEO_CTX);
      expect(result).not.toBeNull();
      expect(result.should_render).toBe(false);
    });

    it('passes geo and period context to LLM', async () => {
      openAiStructuredOutput.mockResolvedValue(
        buildChatJsonResponse(SAMPLE_LLM_LINE_RESPONSE)
      );

      await generateChartConfig(SAMPLE_INFLASI_CTX);

      const callArgs = openAiStructuredOutput.mock.calls[0][0];
      const userMsg = JSON.parse(callArgs.messages[1].content);
      expect(userMsg.geo_context).toBe('Kota Ternate');
      expect(userMsg.period_context).toBe('2024');
    });
  });
});
