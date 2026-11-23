/**
 * OpenAPI 3.1 description of the REST API, served by Swagger UI at /api/docs.
 * Kept deliberately compact: schemas are shared and every route lists its
 * possible error codes. The README contains the full narrative reference.
 */
const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const ok = (description: string, data: object) => ({
  description,
  content: {
    'application/json': {
      schema: { type: 'object', properties: { success: { const: true }, data: { type: 'object', properties: data } } },
    },
  },
});
const err = (description: string) => ({ description, content: { 'application/json': { schema: ref('Error') } } });
const body = (schema: object) => ({ required: true, content: { 'application/json': { schema } } });
const idParam = [{ name: 'id', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }];
const secured = [{ cookieAuth: [] }, { bearerAuth: [] }];

const E = {
  400: err('Validation error'),
  401: err('Not authenticated'),
  403: err('Forbidden'),
  404: err('Not found'),
  409: err('Conflict with the current state'),
};

export const openApiDocument = {
  openapi: '3.1.0',
  info: {
    title: 'VoteLive API',
    version: '1.0.0',
    description:
      'REST API of the real-time voting platform. Responses use the envelope `{ success, data }` or `{ success: false, error: { code, message, details? } }`. Real-time events (Socket.IO) are documented in the README.',
  },
  servers: [{ url: '/api' }],
  components: {
    securitySchemes: {
      cookieAuth: { type: 'apiKey', in: 'cookie', name: 'votelive_token' },
      bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
    },
    schemas: {
      Error: {
        type: 'object',
        properties: {
          success: { const: false },
          error: {
            type: 'object',
            properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
            required: ['code', 'message'],
          },
        },
      },
      User: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          email: { type: 'string', format: 'email' },
          role: { enum: ['user', 'admin'] },
          isActive: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
      PollOption: {
        type: 'object',
        properties: { id: { type: 'string', format: 'uuid' }, text: { type: 'string' }, position: { type: 'integer' } },
      },
      Poll: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          question: { type: 'string' },
          description: { type: ['string', 'null'] },
          status: { enum: ['DRAFT', 'ACTIVE', 'CLOSED'] },
          isOpen: { type: 'boolean' },
          creationMode: { enum: ['MANUAL', 'AI'] },
          resultsVisibility: { enum: ['LIVE', 'AFTER_CLOSE'] },
          endTime: { type: 'string', format: 'date-time' },
          publishedAt: { type: ['string', 'null'], format: 'date-time' },
          closedAt: { type: ['string', 'null'], format: 'date-time' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
          creator: { type: 'object', properties: { id: { type: 'string' }, username: { type: 'string' } } },
          options: { type: 'array', items: ref('PollOption') },
          totalVotes: { type: 'integer' },
          myVoteOptionId: { type: ['string', 'null'], format: 'uuid' },
        },
      },
      PollInput: {
        type: 'object',
        required: ['question', 'options', 'endTime'],
        properties: {
          question: { type: 'string', minLength: 5, maxLength: 300 },
          description: { type: ['string', 'null'], maxLength: 1000 },
          options: { type: 'array', minItems: 2, maxItems: 10, items: { type: 'string', maxLength: 200 } },
          endTime: { type: 'string', format: 'date-time' },
          resultsVisibility: { enum: ['LIVE', 'AFTER_CLOSE'], default: 'LIVE' },
          creationMode: { enum: ['MANUAL', 'AI'], default: 'MANUAL' },
        },
      },
      Results: {
        type: 'object',
        properties: {
          pollId: { type: 'string', format: 'uuid' },
          status: { enum: ['DRAFT', 'ACTIVE', 'CLOSED'] },
          totalVotes: { type: 'integer' },
          visible: { type: 'boolean' },
          options: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                optionId: { type: 'string' },
                text: { type: 'string' },
                position: { type: 'integer' },
                votes: { type: 'integer' },
                percentage: { type: 'number' },
              },
            },
          },
          computedAt: { type: 'string', format: 'date-time' },
        },
      },
      Notification: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { const: 'POLL_CLOSED' },
          message: { type: 'string' },
          pollId: { type: ['string', 'null'] },
          isRead: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  },
  paths: {
    '/health': { get: { tags: ['System'], summary: 'Health check (API + database)', responses: { 200: ok('OK', {}) } } },
    '/auth/register': {
      post: {
        tags: ['Auth'],
        summary: 'Create an account and open a session (sets the httpOnly cookie)',
        requestBody: body({
          type: 'object',
          required: ['username', 'email', 'password', 'confirmPassword'],
          properties: {
            username: { type: 'string' },
            email: { type: 'string' },
            password: { type: 'string' },
            confirmPassword: { type: 'string' },
          },
        }),
        responses: { 201: ok('Created', { user: ref('User'), token: { type: 'string' } }), 400: E[400], 409: err('Email or username taken') },
      },
    },
    '/auth/login': {
      post: {
        tags: ['Auth'],
        summary: 'Log in (sets the httpOnly cookie)',
        requestBody: body({ type: 'object', required: ['email', 'password'], properties: { email: { type: 'string' }, password: { type: 'string' } } }),
        responses: { 200: ok('OK', { user: ref('User'), token: { type: 'string' } }), 400: E[400], 401: err('Invalid credentials'), 403: err('Account disabled') },
      },
    },
    '/auth/logout': { post: { tags: ['Auth'], summary: 'Clear the session cookie', responses: { 200: ok('OK', {}) } } },
    '/auth/me': { get: { tags: ['Auth'], security: secured, summary: 'Current user', responses: { 200: ok('OK', { user: ref('User') }), 401: E[401] } } },
    '/users/me': {
      get: { tags: ['Users'], security: secured, summary: 'My profile', responses: { 200: ok('OK', { user: ref('User') }), 401: E[401] } },
      patch: {
        tags: ['Users'],
        security: secured,
        summary: 'Update my profile (currentPassword required to change email or password)',
        requestBody: body({
          type: 'object',
          properties: { username: { type: 'string' }, email: { type: 'string' }, newPassword: { type: 'string' }, currentPassword: { type: 'string' } },
        }),
        responses: { 200: ok('OK', { user: ref('User') }), 400: E[400], 401: E[401], 409: E[409] },
      },
    },
    '/users': {
      get: {
        tags: ['Users (admin)'],
        security: secured,
        summary: 'List users',
        parameters: [
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 20 } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
        ],
        responses: { 200: ok('OK', { users: { type: 'array', items: ref('User') }, pagination: { type: 'object' } }), 401: E[401], 403: E[403] },
      },
    },
    '/users/{id}': {
      get: { tags: ['Users (admin)'], security: secured, summary: 'Get a user', parameters: idParam, responses: { 200: ok('OK', { user: ref('User') }), 403: E[403], 404: E[404] } },
      patch: {
        tags: ['Users (admin)'],
        security: secured,
        summary: 'Change role or activate/deactivate an account',
        parameters: idParam,
        requestBody: body({ type: 'object', properties: { role: { enum: ['user', 'admin'] }, isActive: { type: 'boolean' } } }),
        responses: { 200: ok('OK', { user: ref('User') }), 400: E[400], 403: E[403], 404: E[404] },
      },
    },
    '/polls': {
      get: {
        tags: ['Polls'],
        security: secured,
        summary: 'List published polls',
        parameters: [
          { name: 'status', in: 'query', schema: { enum: ['ACTIVE', 'CLOSED'], default: 'ACTIVE' } },
          { name: 'search', in: 'query', schema: { type: 'string' } },
          { name: 'page', in: 'query', schema: { type: 'integer', default: 1 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 12 } },
        ],
        responses: { 200: ok('OK', { polls: { type: 'array', items: ref('Poll') }, pagination: { type: 'object' } }), 401: E[401] },
      },
      post: {
        tags: ['Polls'],
        security: secured,
        summary: 'Create a poll (always created as DRAFT)',
        requestBody: body(ref('PollInput')),
        responses: { 201: ok('Created', { poll: ref('Poll') }), 400: E[400], 401: E[401] },
      },
    },
    '/polls/mine': {
      get: {
        tags: ['Polls'],
        security: secured,
        summary: 'Polls created by the current user (all statuses)',
        parameters: [{ name: 'status', in: 'query', schema: { enum: ['DRAFT', 'ACTIVE', 'CLOSED'] } }],
        responses: { 200: ok('OK', { polls: { type: 'array', items: ref('Poll') } }), 401: E[401] },
      },
    },
    '/polls/{id}': {
      get: { tags: ['Polls'], security: secured, summary: 'Poll details', parameters: idParam, responses: { 200: ok('OK', { poll: ref('Poll') }), 401: E[401], 404: E[404] } },
      patch: {
        tags: ['Polls'],
        security: secured,
        summary: 'Edit a DRAFT poll (owner only)',
        parameters: idParam,
        requestBody: body(ref('PollInput')),
        responses: { 200: ok('OK', { poll: ref('Poll') }), 400: E[400], 403: E[403], 404: E[404], 409: err('POLL_NOT_EDITABLE') },
      },
      delete: {
        tags: ['Polls'],
        security: secured,
        summary: 'Delete a poll (owner: drafts only; admin: any)',
        parameters: idParam,
        responses: { 204: { description: 'Deleted' }, 403: E[403], 404: E[404], 409: err('POLL_NOT_DELETABLE') },
      },
    },
    '/polls/{id}/publish': {
      post: {
        tags: ['Polls'],
        security: secured,
        summary: 'DRAFT → ACTIVE (owner only)',
        parameters: idParam,
        responses: { 200: ok('OK', { poll: ref('Poll') }), 400: err('INVALID_END_TIME / NOT_ENOUGH_OPTIONS'), 403: E[403], 404: E[404], 409: err('POLL_ALREADY_PUBLISHED') },
      },
    },
    '/polls/{id}/close': {
      post: {
        tags: ['Polls'],
        security: secured,
        summary: 'ACTIVE → CLOSED before the end time (owner or admin)',
        parameters: idParam,
        responses: { 200: ok('OK', { poll: ref('Poll') }), 403: E[403], 404: E[404], 409: err('POLL_NOT_ACTIVE') },
      },
    },
    '/polls/{id}/results': {
      get: {
        tags: ['Votes'],
        security: secured,
        summary: 'Results computed from the database (per-option details hidden for AFTER_CLOSE polls until closure)',
        parameters: idParam,
        responses: { 200: ok('OK', { results: ref('Results') }), 401: E[401], 404: E[404] },
      },
    },
    '/polls/{id}/votes': {
      post: {
        tags: ['Votes'],
        security: secured,
        summary: 'Vote (once per poll)',
        parameters: idParam,
        requestBody: body({ type: 'object', required: ['optionId'], properties: { optionId: { type: 'string', format: 'uuid' } } }),
        responses: {
          201: ok('Vote recorded', { vote: { type: 'object' }, results: ref('Results') }),
          400: err('VALIDATION_ERROR / INVALID_OPTION'),
          401: E[401],
          403: err('POLL_CLOSED'),
          404: E[404],
          409: err('ALREADY_VOTED'),
        },
      },
    },
    '/votes/me': {
      get: { tags: ['Votes'], security: secured, summary: 'My voting history', responses: { 200: ok('OK', { votes: { type: 'array', items: { type: 'object' } } }), 401: E[401] } },
    },
    '/ai/generate': {
      post: {
        tags: ['AI'],
        security: secured,
        summary: 'Generate a poll proposal with OpenRouter (nothing is saved)',
        requestBody: body({
          type: 'object',
          required: ['topic'],
          properties: {
            topic: { type: 'string', minLength: 3, maxLength: 200 },
            optionCount: { type: 'integer', minimum: 2, maximum: 8, default: 4 },
            instructions: { type: 'string', maxLength: 500 },
            language: { enum: ['fr', 'en'], default: 'fr' },
            previousQuestion: { type: 'string' },
          },
        }),
        responses: {
          200: ok('Proposal', { poll: { type: 'object', properties: { question: { type: 'string' }, options: { type: 'array', items: { type: 'string' } }, model: { type: 'string' } } } }),
          400: E[400],
          401: E[401],
          429: err('RATE_LIMITED / AI_RATE_LIMITED'),
          502: err('AI_INVALID_RESPONSE'),
          503: err('AI_NOT_CONFIGURED / AI_UNAVAILABLE / AI_INSUFFICIENT_CREDITS / AI_MODEL_UNAVAILABLE'),
          504: err('AI_TIMEOUT'),
        },
      },
    },
    '/notifications': {
      get: {
        tags: ['Notifications'],
        security: secured,
        summary: 'My notifications',
        parameters: [
          { name: 'unreadOnly', in: 'query', schema: { type: 'boolean', default: false } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30 } },
        ],
        responses: { 200: ok('OK', { notifications: { type: 'array', items: ref('Notification') }, unreadCount: { type: 'integer' } }), 401: E[401] },
      },
    },
    '/notifications/read-all': {
      patch: { tags: ['Notifications'], security: secured, summary: 'Mark all as read', responses: { 200: ok('OK', { updated: { type: 'integer' } }), 401: E[401] } },
    },
    '/notifications/{id}/read': {
      patch: {
        tags: ['Notifications'],
        security: secured,
        summary: 'Mark one notification as read',
        parameters: idParam,
        responses: { 200: ok('OK', { notification: ref('Notification') }), 401: E[401], 404: E[404] },
      },
    },
  },
};
