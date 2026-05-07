const path = require('path');
const swaggerJsdoc = require('swagger-jsdoc');

const definition = {
  openapi: '3.0.3',
  info: {
    title: 'Malika API',
    version: '1.0.0',
    description: 'OpenAPI documentation for project-data-strategis backend.',
  },
  servers: [
    { url: 'https://api-malika.bpsmalut.com', description: 'Production' },
    { url: 'http://localhost:5000', description: 'Local' },
  ],
  components: {
    securitySchemes: {
      bearerAuth: {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      cookieAuth: {
        type: 'apiKey',
        in: 'cookie',
        name: 'token',
      },
    },
    schemas: {
      AuthLoginRequest: {
        type: 'object',
        required: ['email', 'password'],
        additionalProperties: false,
        properties: {
          email: { type: 'string', minLength: 3, maxLength: 255 },
          password: { type: 'string', minLength: 6, maxLength: 200 },
        },
      },
      AuthRegisterRequest: {
        type: 'object',
        required: ['name', 'email', 'password'],
        additionalProperties: false,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 120 },
          email: { type: 'string', minLength: 3, maxLength: 255 },
          password: { type: 'string', minLength: 6, maxLength: 200 },
          role: { type: 'string', enum: ['admin', 'user'] },
        },
      },
      ChatCreateThreadRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          title: { type: 'string', minLength: 1, maxLength: 200 },
        },
      },
      ChatSendMessageRequest: {
        type: 'object',
        required: ['text'],
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
      ChatStreamRequest: {
        type: 'object',
        additionalProperties: false,
        properties: {
          text: { type: 'string', minLength: 1, maxLength: 4000 },
        },
      },
      DatasourcePrepareRequest: {
        type: 'object',
        required: ['url'],
        additionalProperties: false,
        properties: {
          url: { type: 'string', minLength: 3 },
          type: { type: 'string', enum: ['static', 'dynamic', 'interop', 'exim', 'pressrelease'] },
        },
      },
      DatasourceCreateRequest: {
        type: 'object',
        required: ['name', 'type'],
        additionalProperties: true,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 150 },
          description: { type: 'string', nullable: true },
          aliases: { type: ['string', 'null'] },
          type: { type: 'string', enum: ['static', 'dynamic', 'interop', 'exim', 'pressrelease'] },
          api_url: { type: 'string', minLength: 3 },
          period_key: { type: ['string', 'null'] },
          summary_trend: { type: ['string', 'null'] },
          auto_period: { type: 'boolean' },
          status: { type: 'boolean' },
          visible: { type: 'boolean' },
          display_order: { type: 'integer' },
          icon: { type: ['string', 'null'] },
          color: { type: ['string', 'null'] },
          category: { type: ['string', 'null'] },
          compare_to: { type: ['integer', 'null'] },
          force: { type: 'boolean' },
        },
      },
      DatasourceUpdateRequest: {
        type: 'object',
        additionalProperties: true,
        properties: {
          name: { type: 'string', minLength: 2, maxLength: 150 },
          description: { type: 'string', nullable: true },
          aliases: { type: ['string', 'null'] },
          type: { type: 'string', enum: ['static', 'dynamic', 'interop', 'exim', 'pressrelease'] },
          api_url: { type: 'string', minLength: 3 },
          period_key: { type: ['string', 'null'] },
          summary_trend: { type: ['string', 'null'] },
          auto_period: { type: 'boolean' },
          status: { type: 'boolean' },
          visible: { type: 'boolean' },
          display_order: { type: 'integer' },
          icon: { type: ['string', 'null'] },
          color: { type: ['string', 'null'] },
          category: { type: ['string', 'null'] },
          compare_to: { type: ['integer', 'null'] },
          force: { type: 'boolean' },
        },
      },
      SearchTrackRequest: {
        type: 'object',
        required: ['source_id'],
        additionalProperties: false,
        properties: {
          source_id: { type: 'integer', minimum: 1 },
        },
      },
    },
    examples: {
      HealthResponse: {
        value: { status: 'ok', uptime: 123.4, timestamp: '2026-01-24T00:00:00.000Z' },
      },
      AuthLoginRequest: {
        value: { email: 'admin@example.com', password: 'secret' },
      },
      AuthRegisterRequest: {
        value: { name: 'Admin', email: 'admin@example.com', password: 'secret', role: 'admin' },
      },
      ChatCreateThreadRequest: {
        value: { title: 'Statistik 2024' },
      },
      ChatSendMessageRequest: {
        value: { text: 'Ekspor 2024' },
      },
      ChatStreamRequest: {
        value: { text: 'Ekspor 2024' },
      },
      ChatFeedbackRequest: {
        value: { thread_id: 123, rating: 5, comment: 'Helpful' },
      },
      SearchTrackRequest: {
        value: { datasource_id: 123, action: 'click' },
      },
      DatasourceRequest: {
        value: { name: 'BPS Example', api_url: 'https://example.com/api', type: 'dynamic' },
      },
      DatasourcePrepareRequest: {
        value: { api_url: 'https://example.com/api' },
      },
      NotificationRequest: {
        value: { title: 'Update', message: 'New data available' },
      },
      PushSubscribeRequest: {
        value: { endpoint: 'https://push.example.com', keys: { p256dh: '...', auth: '...' } },
      },
      PushUnsubscribeRequest: {
        value: { endpoint: 'https://push.example.com' },
      },
      AIQueryBuilderRequest: {
        value: { query: 'Ekspor 2024 Maluku Utara' },
      },
      AnalyticsTrackRequest: {
        value: { path: '/search', title: 'Search' },
      },
      AnalyticsHeartbeatRequest: {
        value: { session_id: 'abc', path: '/search' },
      },
      KnowledgeSearchRequest: {
        value: { query: 'inflasi maluku utara' },
      },
      KnowledgeCreateTextRequest: {
        value: { title: 'Doc', content: 'Content here', source_type: 'custom' },
      },
      RagExtractPdfRequest: {
        value: { url: 'https://example.com/doc.pdf' },
      },
      RagTestEmbedRequest: {
        value: { text: 'Sample text' },
      },
      RagAnalyzeAbstractRequest: {
        value: { text: 'Abstract text' },
      },
      RagCompareRequest: {
        value: { a: 'Text A', b: 'Text B' },
      },
      RagTestSearchRequest: {
        value: { query: 'BRS inflasi' },
      },
      RagIndexRequest: {
        value: { document_id: 123 },
      },
      RagCheckIndexedRequest: {
        value: { document_id: 123 },
      },
      ErrorFlagRequest: {
        value: { message_id: 123, reason: 'Incorrect data' },
      },
    },
  },
};

const options = {
  definition,
  apis: [path.join(__dirname, 'openapi-docs.js')],
};

module.exports = swaggerJsdoc(options);
