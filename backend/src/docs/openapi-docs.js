/**
 * @openapi
 * tags:
 *   - name: Health
 *   - name: Auth
 *   - name: Chat
 *   - name: Chat Feedback
 *   - name: Search
 *   - name: Datasource
 *   - name: Cache
 *   - name: Period
 *   - name: Dynamic
 *   - name: Static
 *   - name: Interop
 *   - name: Exim
 *   - name: Pressrelease
 *   - name: Categories
 *   - name: Notifications
 *   - name: Push
 *   - name: AI
 *   - name: Analytics
 *   - name: Knowledge
 *   - name: RAG Trial
 *   - name: Error Learning
 *   - name: GeoJSON
 *   - name: Automation
 *   - name: Logs
 *   - name: Monitoring
 *
 * /health:
 *   get:
 *     tags: [Health]
 *     summary: Health check
 *     responses:
 *       200:
 *         description: Service is healthy
 *         content:
 *           application/json:
 *             examples:
 *               ok:
 *                 $ref: '#/components/examples/HealthResponse'
 *
 * /metrics:
 *   get:
 *     tags: [Monitoring]
 *     summary: Prometheus metrics
 *     responses:
 *       200:
 *         description: Metrics payload
 *
 * /csrf-token:
 *   get:
 *     tags: [Auth]
 *     summary: Get CSRF token
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: CSRF token payload
 *
 * /auth/login:
 *   post:
 *     tags: [Auth]
 *     summary: Login
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthLoginRequest'
 *           examples:
 *             login:
 *               $ref: '#/components/examples/AuthLoginRequest'
 *     responses:
 *       200:
 *         description: Login success
 *
 * /auth/register:
 *   post:
 *     tags: [Auth]
 *     summary: Register user (admin only)
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AuthRegisterRequest'
 *           examples:
 *             register:
 *               $ref: '#/components/examples/AuthRegisterRequest'
 *     responses:
 *       200:
 *         description: User created
 *
 * /auth/me:
 *   get:
 *     tags: [Auth]
 *     summary: Current user
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Current user profile
 *
 * /auth/users:
 *   get:
 *     tags: [Auth]
 *     summary: List users (admin only)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Users list
 *
 * /auth/users/{id}:
 *   delete:
 *     tags: [Auth]
 *     summary: Delete user (admin only)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 4
 *           maxLength: 20
 *     responses:
 *       200:
 *         description: User deleted
 *
 * /auth/logout:
 *   post:
 *     tags: [Auth]
 *     summary: Logout
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logout success
 *
 * /chat/threads:
 *   get:
 *     tags: [Chat]
 *     summary: List chat threads
 *     parameters:
 *       - in: header
 *         name: x-malika-uid
 *         required: false
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Threads list
 *   post:
 *     tags: [Chat]
 *     summary: Create chat thread
 *     parameters:
 *       - in: header
 *         name: x-malika-uid
 *         required: false
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatCreateThreadRequest'
 *           examples:
 *             createThread:
 *               $ref: '#/components/examples/ChatCreateThreadRequest'
 *     responses:
 *       201:
 *         description: Thread created
 *
 * /chat/threads/{id}/messages:
 *   get:
 *     tags: [Chat]
 *     summary: List messages in thread
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: period
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 4
 *           maxLength: 20
 *     responses:
 *       200:
 *         description: Messages list
 *   post:
 *     tags: [Chat]
 *     summary: Send message
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: th_ids
 *         required: false
 *         schema: { type: string }
 *       - in: query
 *         name: all
 *         required: false
 *         schema: { type: boolean }
 *       - in: header
 *         name: x-malika-uid
 *         required: false
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatSendMessageRequest'
 *           examples:
 *             sendMessage:
 *               $ref: '#/components/examples/ChatSendMessageRequest'
 *     responses:
 *       201:
 *         description: Message sent
 *
 * /chat/threads/{id}/stream:
 *   get:
 *     tags: [Chat]
 *     summary: Stream chat response (SSE)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *       - in: query
 *         name: signature
 *         required: true
 *         schema:
 *           type: string
 *           minLength: 1
 *           maxLength: 255
 *     responses:
 *       200:
 *         description: SSE stream
 *   post:
 *     tags: [Chat]
 *     summary: Stream chat response (SSE, POST)
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ChatStreamRequest'
 *           examples:
 *             streamMessage:
 *               $ref: '#/components/examples/ChatStreamRequest'
 *     responses:
 *       200:
 *         description: SSE stream
 *
 * /chat-feedback:
 *   post:
 *     tags: [Chat Feedback]
 *     summary: Submit chat feedback
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             feedback:
 *               $ref: '#/components/examples/ChatFeedbackRequest'
 *     responses:
 *       200:
 *         description: Feedback saved
 *
 * /chat-feedback/general:
 *   post:
 *     tags: [Chat Feedback]
 *     summary: Submit general feedback
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             feedback:
 *               $ref: '#/components/examples/ChatFeedbackRequest'
 *     responses:
 *       200:
 *         description: Feedback saved
 *
 * /chat-feedback/mine:
 *   get:
 *     tags: [Chat Feedback]
 *     summary: Get my feedback
 *     responses:
 *       200:
 *         description: Feedback list
 *
 * /chat-feedback/thread/{thread_id}:
 *   get:
 *     tags: [Chat Feedback]
 *     summary: Feedback by thread
 *     parameters:
 *       - in: path
 *         name: thread_id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Feedback list
 *
 * /chat-feedback/all:
 *   get:
 *     tags: [Chat Feedback]
 *     summary: All feedback (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Feedback list
 *
 * /chat/admin/threads:
 *   get:
 *     tags: [Chat]
 *     summary: List all chat threads (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Threads list
 *
 * /chat/admin/threads/{id}:
 *   get:
 *     tags: [Chat]
 *     summary: Get thread with messages (admin)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Thread detail
 *
 * /chat/admin/export/owner/{ownerId}:
 *   get:
 *     tags: [Chat]
 *     summary: Export chats by owner (admin)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: ownerId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Export data
 *
 * /chat/admin/export/all:
 *   get:
 *     tags: [Chat]
 *     summary: Export all chats (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Export data
 *
 * /chat/admin/stats:
 *   get:
 *     tags: [Chat]
 *     summary: Chat stats (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Stats
 *
 * /search/datasource:
 *   get:
 *     tags: [Search]
 *     summary: Search datasources
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *           minLength: 0
 *           maxLength: 80
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Search results
 *
 * /search/favorites:
 *   get:
 *     tags: [Search]
 *     summary: Favorite datasources
 *     responses:
 *       200:
 *         description: Favorites list
 *
 * /search/track/datasource:
 *   post:
 *     tags: [Search]
 *     summary: Track datasource
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/SearchTrackRequest'
 *           examples:
 *             track:
 *               $ref: '#/components/examples/SearchTrackRequest'
 *     responses:
 *       200:
 *         description: Tracking recorded
 *
 * /search/intent:
 *   get:
 *     tags: [Search]
 *     summary: Get search intent
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *           minLength: 0
 *           maxLength: 80
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 50
 *     responses:
 *       200:
 *         description: Intent response
 *
 * /search/knowledge:
 *   get:
 *     tags: [Search]
 *     summary: Search knowledge
 *     parameters:
 *       - in: query
 *         name: q
 *         required: false
 *         schema:
 *           type: string
 *           minLength: 0
 *           maxLength: 200
 *       - in: query
 *         name: limit
 *         required: false
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 20
 *     responses:
 *       200:
 *         description: Knowledge search results
 *
 * /search/knowledge/{id}:
 *   get:
 *     tags: [Search]
 *     summary: Get knowledge by id
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Knowledge detail
 *
 * /search/admin/intent-stats:
 *   get:
 *     tags: [Search]
 *     summary: Intent stats (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Intent stats
 *
 * /datasource:
 *   get:
 *     tags: [Datasource]
 *     summary: List datasources
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Datasource list
 *   post:
 *     tags: [Datasource]
 *     summary: Create datasource
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DatasourceCreateRequest'
 *           examples:
 *             datasource:
 *               $ref: '#/components/examples/DatasourceRequest'
 *     responses:
 *       201:
 *         description: Datasource created
 *
 * /datasource/admin:
 *   get:
 *     tags: [Datasource]
 *     summary: Admin datasource list
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Datasource list
 *
 * /datasource/prepare:
 *   post:
 *     tags: [Datasource]
 *     summary: Prepare datasource from URL
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DatasourcePrepareRequest'
 *           examples:
 *             datasource:
 *               $ref: '#/components/examples/DatasourcePrepareRequest'
 *     responses:
 *       200:
 *         description: Prepared datasource
 *
 * /datasource/search-terms/reindex:
 *   post:
 *     tags: [Datasource]
 *     summary: Reindex search terms (all)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Reindex started
 *
 * /datasource/{id}/search-terms/reindex:
 *   post:
 *     tags: [Datasource]
 *     summary: Reindex search terms (one)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reindex started
 *
 * /datasource/search-metadata/reindex:
 *   post:
 *     tags: [Datasource]
 *     summary: Reindex search metadata (all)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Reindex started
 *
 * /datasource/{id}/search-metadata/reindex:
 *   post:
 *     tags: [Datasource]
 *     summary: Reindex search metadata (one)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Reindex started
 *
 * /datasource/exim/seed:
 *   post:
 *     tags: [Datasource]
 *     summary: Seed exim
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Seed started
 *
 * /datasource/exim/seed/job:
 *   post:
 *     tags: [Datasource]
 *     summary: Seed exim job start
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Job started
 *
 * /datasource/exim/seed/job-active:
 *   get:
 *     tags: [Datasource]
 *     summary: Seed exim job active
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Job status
 *
 * /datasource/exim/seed/job/{jobId}:
 *   get:
 *     tags: [Datasource]
 *     summary: Seed exim job status
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job status
 *
 * /datasource/{id}:
 *   put:
 *     tags: [Datasource]
 *     summary: Update datasource
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/DatasourceUpdateRequest'
 *           examples:
 *             datasource:
 *               $ref: '#/components/examples/DatasourceRequest'
 *     responses:
 *       200:
 *         description: Datasource updated
 *   delete:
 *     tags: [Datasource]
 *     summary: Delete datasource
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Datasource deleted
 *
 * /datasource/{id}/hard:
 *   delete:
 *     tags: [Datasource]
 *     summary: Hard delete datasource
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Datasource deleted
 *
 * /cache/{id}:
 *   get:
 *     tags: [Cache]
 *     summary: Get processed cache
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cache data
 *
 * /cache/refresh/{id}:
 *   post:
 *     tags: [Cache]
 *     summary: Refresh cache
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Cache refreshed
 *
 * /cache/merge/{id}:
 *   get:
 *     tags: [Cache]
 *     summary: Merge cache
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Merge result
 *
 * /cache/merged/{id}:
 *   get:
 *     tags: [Cache]
 *     summary: Get merged cache
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Merged cache data
 *
 * /period/public/{id}:
 *   get:
 *     tags: [Period]
 *     summary: Public available periods
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Periods list
 *
 * /period/generate/{id}:
 *   get:
 *     tags: [Period]
 *     summary: Generate periods for datasource
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Periods generated
 *
 * /period/generate-all:
 *   get:
 *     tags: [Period]
 *     summary: Generate periods for all datasources
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Periods generated
 *
 * /period/list/{id}:
 *   get:
 *     tags: [Period]
 *     summary: List periods for datasource
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Periods list
 *
 * /period/available/{id}:
 *   get:
 *     tags: [Period]
 *     summary: Available periods
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Periods list
 *
 * /period/available/{id}/months:
 *   get:
 *     tags: [Period]
 *     summary: Available months
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Months list
 *
 * /dynamic/{id}:
 *   get:
 *     tags: [Dynamic]
 *     summary: Get dynamic table
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Dynamic data
 *
 * /static/{id}:
 *   get:
 *     tags: [Static]
 *     summary: Get static data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Static data
 *
 * /interop/{id}:
 *   get:
 *     tags: [Interop]
 *     summary: Get interop data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Interop data
 *
 * /exim/hs2:
 *   get:
 *     tags: [Exim]
 *     summary: Search HS2
 *     responses:
 *       200:
 *         description: HS2 results
 *
 * /exim/{id}:
 *   get:
 *     tags: [Exim]
 *     summary: Get EXIM data
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: EXIM data
 *
 * /pressrelease/{id}:
 *   get:
 *     tags: [Pressrelease]
 *     summary: Get pressrelease
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pressrelease data
 *
 * /categories:
 *   get:
 *     tags: [Categories]
 *     summary: List categories
 *     responses:
 *       200:
 *         description: Categories
 *
 * /notifications:
 *   get:
 *     tags: [Notifications]
 *     summary: Get notifications
 *     responses:
 *       200:
 *         description: Notifications list
 *
 * /notifications/admin/list:
 *   get:
 *     tags: [Notifications]
 *     summary: Admin notifications list
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notifications list
 *
 * /notifications/admin/clear:
 *   delete:
 *     tags: [Notifications]
 *     summary: Clear notifications
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notifications cleared
 *
 * /notifications/admin/delete:
 *   delete:
 *     tags: [Notifications]
 *     summary: Delete notifications by ids
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notifications deleted
 *
 * /notifications/admin/test:
 *   post:
 *     tags: [Notifications]
 *     summary: Send test notification
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Test sent
 *
 * /notifications/admin/create:
 *   post:
 *     tags: [Notifications]
 *     summary: Create custom notification
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             notification:
 *               $ref: '#/components/examples/NotificationRequest'
 *     responses:
 *       200:
 *         description: Notification created
 *
 * /notifications/admin/emit-latest-merged:
 *   post:
 *     tags: [Notifications]
 *     summary: Emit latest merged cache notification
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notification emitted
 *
 * /notifications/admin/rebroadcast:
 *   post:
 *     tags: [Notifications]
 *     summary: Rebroadcast notifications
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Notifications rebroadcast
 *
 * /push/subscribe:
 *   post:
 *     tags: [Push]
 *     summary: Subscribe push notifications
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             subscribe:
 *               $ref: '#/components/examples/PushSubscribeRequest'
 *     responses:
 *       200:
 *         description: Subscription saved
 *
 * /push/unsubscribe:
 *   post:
 *     tags: [Push]
 *     summary: Unsubscribe push notifications
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             unsubscribe:
 *               $ref: '#/components/examples/PushUnsubscribeRequest'
 *     responses:
 *       200:
 *         description: Unsubscribed
 *
 * /push/subscriptions:
 *   get:
 *     tags: [Push]
 *     summary: List subscriptions (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Subscription list
 *
 * /push/subscriptions/{id}:
 *   delete:
 *     tags: [Push]
 *     summary: Delete subscription (admin)
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Subscription deleted
 *
 * /push/subscriptions/stats:
 *   get:
 *     tags: [Push]
 *     summary: Subscription stats (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Subscription stats
 *
 * /ai/query-builder:
 *   post:
 *     tags: [AI]
 *     summary: Query builder
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             query:
 *               $ref: '#/components/examples/AIQueryBuilderRequest'
 *     responses:
 *       200:
 *         description: Query builder response
 *
 * /analytics/track:
 *   post:
 *     tags: [Analytics]
 *     summary: Track page view
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             track:
 *               $ref: '#/components/examples/AnalyticsTrackRequest'
 *     responses:
 *       200:
 *         description: Tracked
 *
 * /analytics/heartbeat:
 *   post:
 *     tags: [Analytics]
 *     summary: Track heartbeat
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             heartbeat:
 *               $ref: '#/components/examples/AnalyticsHeartbeatRequest'
 *     responses:
 *       200:
 *         description: Tracked
 *
 * /analytics/dashboard:
 *   get:
 *     tags: [Analytics]
 *     summary: Analytics dashboard (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Dashboard stats
 *
 * /analytics/calendar:
 *   get:
 *     tags: [Analytics]
 *     summary: Analytics calendar (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Calendar stats
 *
 * /analytics/cleanup:
 *   post:
 *     tags: [Analytics]
 *     summary: Cleanup analytics (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Cleanup started
 *
 * /summary/{id}:
 *   get:
 *     tags: [Cache]
 *     summary: Summary for datasource
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Summary data
 *
 * /knowledge/stats:
 *   get:
 *     tags: [Knowledge]
 *     summary: Knowledge stats
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Knowledge stats
 *
 * /knowledge/datasources:
 *   get:
 *     tags: [Knowledge]
 *     summary: Knowledge datasources
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Datasource list
 *
 * /knowledge/embed/{id}:
 *   post:
 *     tags: [Knowledge]
 *     summary: Embed single knowledge document
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Embed triggered
 *   delete:
 *     tags: [Knowledge]
 *     summary: Clear knowledge embedding
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Embedding cleared
 *
 * /knowledge/embed-all:
 *   post:
 *     tags: [Knowledge]
 *     summary: Embed all knowledge documents
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Embed triggered
 *
 * /knowledge/search:
 *   post:
 *     tags: [Knowledge]
 *     summary: Search knowledge
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             query:
 *               $ref: '#/components/examples/KnowledgeSearchRequest'
 *     responses:
 *       200:
 *         description: Search results
 *
 * /knowledge/invalidate-cache:
 *   post:
 *     tags: [Knowledge]
 *     summary: Invalidate knowledge cache
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Cache invalidated
 *
 * /knowledge/documents/stats:
 *   get:
 *     tags: [Knowledge]
 *     summary: Knowledge document stats
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Stats
 *
 * /knowledge/documents:
 *   get:
 *     tags: [Knowledge]
 *     summary: List knowledge documents
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Documents
 *
 * /knowledge/documents/text:
 *   post:
 *     tags: [Knowledge]
 *     summary: Create knowledge doc from text
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             text:
 *               $ref: '#/components/examples/KnowledgeCreateTextRequest'
 *     responses:
 *       201:
 *         description: Document created
 *
 * /knowledge/documents/pdf:
 *   post:
 *     tags: [Knowledge]
 *     summary: Create knowledge doc from PDF
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Document created
 *
 * /knowledge/documents/{id}/re-embed:
 *   post:
 *     tags: [Knowledge]
 *     summary: Re-embed document
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Re-embed triggered
 *
 * /knowledge/documents/{id}:
 *   delete:
 *     tags: [Knowledge]
 *     summary: Delete knowledge document
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Document deleted
 *
 * /rag-trial/stats:
 *   get:
 *     tags: [RAG Trial]
 *     summary: RAG trial stats
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Stats
 *
 * /rag-trial/available-years:
 *   get:
 *     tags: [RAG Trial]
 *     summary: Available years
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Years list
 *
 * /rag-trial/brs:
 *   get:
 *     tags: [RAG Trial]
 *     summary: BRS list
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: BRS list
 *
 * /rag-trial/publications:
 *   get:
 *     tags: [RAG Trial]
 *     summary: Publications list
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Publications list
 *
 * /rag-trial/extract-pdf:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Extract PDF
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             extract:
 *               $ref: '#/components/examples/RagExtractPdfRequest'
 *     responses:
 *       200:
 *         description: Extraction result
 *
 * /rag-trial/test-embed:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Test embedding
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             embed:
 *               $ref: '#/components/examples/RagTestEmbedRequest'
 *     responses:
 *       200:
 *         description: Test result
 *
 * /rag-trial/analyze-abstract:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Analyze abstract
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             analyze:
 *               $ref: '#/components/examples/RagAnalyzeAbstractRequest'
 *     responses:
 *       200:
 *         description: Analysis result
 *
 * /rag-trial/compare:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Compare extraction
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             compare:
 *               $ref: '#/components/examples/RagCompareRequest'
 *     responses:
 *       200:
 *         description: Comparison result
 *
 * /rag-trial/test-search:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Test search
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             search:
 *               $ref: '#/components/examples/RagTestSearchRequest'
 *     responses:
 *       200:
 *         description: Search result
 *
 * /rag-trial/indexed:
 *   get:
 *     tags: [RAG Trial]
 *     summary: Indexed list
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Indexed list
 *
 * /rag-trial/indexed/stats:
 *   get:
 *     tags: [RAG Trial]
 *     summary: Indexed stats
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Indexed stats
 *
 * /rag-trial/index:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Index document
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             index:
 *               $ref: '#/components/examples/RagIndexRequest'
 *     responses:
 *       200:
 *         description: Index result
 *
 * /rag-trial/check-indexed:
 *   post:
 *     tags: [RAG Trial]
 *     summary: Check indexed
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             check:
 *               $ref: '#/components/examples/RagCheckIndexedRequest'
 *     responses:
 *       200:
 *         description: Check result
 *
 * /rag-trial/indexed/{id}:
 *   delete:
 *     tags: [RAG Trial]
 *     summary: Remove indexed document
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /error-learning/flag:
 *   post:
 *     tags: [Error Learning]
 *     summary: Flag a message
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           examples:
 *             flag:
 *               $ref: '#/components/examples/ErrorFlagRequest'
 *     responses:
 *       200:
 *         description: Flag recorded
 *
 * /error-learning/stats:
 *   get:
 *     tags: [Error Learning]
 *     summary: Error learning stats
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Stats
 *
 * /error-learning/stats/cutoff:
 *   get:
 *     tags: [Error Learning]
 *     summary: Error learning stats with cutoff
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Stats
 *
 * /error-learning/analyze:
 *   get:
 *     tags: [Error Learning]
 *     summary: Analyze flags
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Analysis
 *
 * /error-learning/flags:
 *   get:
 *     tags: [Error Learning]
 *     summary: List flags
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Flags list
 *
 * /error-learning/flags/{id}/resolve:
 *   put:
 *     tags: [Error Learning]
 *     summary: Resolve flag
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flag resolved
 *
 * /error-learning/flags/{id}:
 *   patch:
 *     tags: [Error Learning]
 *     summary: Update flag
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Flag updated
 *
 * /error-learning/flags/{id}/add-to-knowledge:
 *   post:
 *     tags: [Error Learning]
 *     summary: Add flag to knowledge
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Added to knowledge
 *
 * /error-learning/export:
 *   get:
 *     tags: [Error Learning]
 *     summary: Export flags
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Export data
 *
 * /error-learning/checkpoints:
 *   get:
 *     tags: [Error Learning]
 *     summary: List checkpoints
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Checkpoints
 *   post:
 *     tags: [Error Learning]
 *     summary: Save checkpoint
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Checkpoint saved
 *
 * /error-learning/patterns:
 *   get:
 *     tags: [Error Learning]
 *     summary: List patterns
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Patterns list
 *   post:
 *     tags: [Error Learning]
 *     summary: Create pattern
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Pattern created
 *
 * /error-learning/patterns/{id}:
 *   put:
 *     tags: [Error Learning]
 *     summary: Update pattern
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pattern updated
 *   patch:
 *     tags: [Error Learning]
 *     summary: Update pattern
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pattern updated
 *   delete:
 *     tags: [Error Learning]
 *     summary: Delete pattern
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Pattern deleted
 *
 * /geojson/list:
 *   get:
 *     tags: [GeoJSON]
 *     summary: List geojson files
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Geojson list
 *
 * /geojson/admin/raw/{filename}:
 *   get:
 *     tags: [GeoJSON]
 *     summary: Get geojson raw file
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Geojson file
 *
 * /geojson/admin/update-properties/{filename}:
 *   post:
 *     tags: [GeoJSON]
 *     summary: Update geojson properties
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Updated
 *
 * /geojson/file/{filename}:
 *   delete:
 *     tags: [GeoJSON]
 *     summary: Delete geojson file
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Deleted
 *
 * /geojson/upload:
 *   post:
 *     tags: [GeoJSON]
 *     summary: Upload geojson
 *     security:
 *       - cookieAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         multipart/form-data:
 *           schema:
 *             type: object
 *             properties:
 *               file:
 *                 type: string
 *                 format: binary
 *     responses:
 *       201:
 *         description: Uploaded
 *
 * /geojson/{filename}:
 *   get:
 *     tags: [GeoJSON]
 *     summary: Get geojson (public)
 *     parameters:
 *       - in: path
 *         name: filename
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Geojson file
 *
 * /automation:
 *   get:
 *     tags: [Automation]
 *     summary: List automation status
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Status list
 *
 * /automation/status-job:
 *   post:
 *     tags: [Automation]
 *     summary: Start automation status job
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Job started
 *
 * /automation/status-job/{jobId}:
 *   get:
 *     tags: [Automation]
 *     summary: Automation status job result
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job result
 *
 * /automation/run/job/{jobId}:
 *   get:
 *     tags: [Automation]
 *     summary: Automation job status
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: jobId
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job status
 *
 * /automation/{id}/pod-filter:
 *   get:
 *     tags: [Automation]
 *     summary: Get EXIM POD filter
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: POD filter
 *   post:
 *     tags: [Automation]
 *     summary: Update EXIM POD filter
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: POD filter updated
 *
 * /automation/{id}/pod-options:
 *   get:
 *     tags: [Automation]
 *     summary: Get EXIM POD options
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: POD options
 *
 * /automation/{id}:
 *   post:
 *     tags: [Automation]
 *     summary: Upsert automation config
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Config saved
 *
 * /automation/{id}/run:
 *   post:
 *     tags: [Automation]
 *     summary: Run automation now
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Run started
 *
 * /automation/{id}/run-job:
 *   post:
 *     tags: [Automation]
 *     summary: Run automation job
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Job started
 *
 * /automation/{id}/log:
 *   get:
 *     tags: [Automation]
 *     summary: Get last automation log
 *     security:
 *       - cookieAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema: { type: string }
 *     responses:
 *       200:
 *         description: Log entry
 *
 * /logs/fetch:
 *   get:
 *     tags: [Logs]
 *     summary: Fetch logs (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logs
 *   delete:
 *     tags: [Logs]
 *     summary: Clear fetch logs (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Logs cleared
 *
 * /logs/fetch/stats:
 *   get:
 *     tags: [Logs]
 *     summary: Fetch log stats (admin)
 *     security:
 *       - cookieAuth: []
 *     responses:
 *       200:
 *         description: Log stats
 *
 */
