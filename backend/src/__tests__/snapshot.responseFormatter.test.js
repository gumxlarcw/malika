const {
  formatDataResponse,
  formatComparisonResponse,
  formatNotFoundResponse,
} = require('../services/chat/responseFormatter.service');

describe('responseFormatter snapshots', () => {
  it('formats data response', () => {
    const text = formatDataResponse({
      title: 'Kemiskinan Maluku Utara',
      period: '2024',
      data: [
        { label: 'Kota Ternate', value: 12.34, unit: '%' },
        { label: 'Kota Tidore Kepulauan', value: 10.21, unit: '%' },
      ],
      source: 'BPS',
      insight: 'Kemiskinan menurun tipis dibanding tahun sebelumnya.',
    });

    expect(text).toMatchSnapshot();
  });

  it('formats comparison response', () => {
    const text = formatComparisonResponse({
      title: 'Inflasi YoY',
      period: 'Desember 2024',
      items: [
        { name: 'Maluku Utara', value: 3.1, unit: '%', change: -0.2 },
        { name: 'Nasional', value: 2.8, unit: '%', change: 0.1 },
      ],
      insight: 'Inflasi daerah masih sejalan dengan nasional.',
    });

    expect(text).toMatchSnapshot();
  });

  it('formats not found response', () => {
    const text = formatNotFoundResponse({
      message: 'Data belum tersedia.',
      alternatives: ['Kemiskinan 2024', 'Inflasi 2024'],
      showWhatsApp: true,
    });

    expect(text).toMatchSnapshot();
  });
});
