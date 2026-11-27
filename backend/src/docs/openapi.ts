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
          preferences: ref('Preferences'),
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
          access: { enum: ['PUBLIC', 'PRIVATE', 'GROUP'] },
          canVote: {
            type: 'boolean',
            description: 'PUBLIC/PRIVATE: false for the creator and for non-invited users. GROUP: true for every current member, the creator included',
          },
          group: {
            type: ['object', 'null'],
            description: 'GROUP polls: the group conversation whose members can see and vote',
            properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' } },
          },
          voters: {
            type: ['array', 'null'],
            description: 'Invited voters of a PRIVATE poll (creator and admins only)',
            items: { type: 'object', properties: { id: { type: 'string' }, username: { type: 'string' } } },
          },
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
          access: { enum: ['PUBLIC', 'PRIVATE', 'GROUP'], default: 'PUBLIC' },
          voters: {
            type: 'array',
            maxItems: 500,
            items: { type: 'string' },
            description: 'PRIVATE polls: usernames or emails of the invited voters (the creator cannot be one of them)',
          },
          groupId: { type: ['string', 'null'], format: 'uuid', description: 'GROUP polls (required): a group conversation the creator belongs to' },
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
          pollQuestion: { type: ['string', 'null'], description: 'Lets clients word the notice in the reader’s language' },
          isRead: { type: 'boolean' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Preferences: {
        type: 'object',
        properties: {
          locale: { enum: ['fr', 'en', 'ar', null], description: 'null = follow the browser' },
          theme: { enum: ['system', 'light', 'dark'] },
          messageNotifications: { type: 'boolean' },
        },
      },
      Member: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          username: { type: 'string' },
          role: { enum: ['ADMIN', 'MEMBER'] },
          lastReadSeq: { type: 'integer', description: 'seq of the last message this member has read (read receipts)' },
          joinedAt: { type: 'string', format: 'date-time' },
          online: { type: 'boolean' },
        },
      },
      Message: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          kind: { enum: ['TEXT', 'POLL'], description: 'POLL: a group poll announcement (body = its question)' },
          poll: {
            type: ['object', 'null'],
            properties: { id: { type: 'string' }, question: { type: 'string' }, status: { type: 'string' }, endTime: { type: 'string' }, optionCount: { type: 'integer' } },
          },
          seq: { type: 'integer', description: 'Strictly increasing ordering key (pagination cursor)' },
          conversationId: { type: 'string', format: 'uuid' },
          sender: { type: ['object', 'null'], properties: { id: { type: 'string' }, username: { type: 'string' } } },
          body: { type: 'string', maxLength: 2000 },
          clientId: { type: 'string', format: 'uuid' },
          createdAt: { type: 'string', format: 'date-time' },
        },
      },
      Conversation: {
        type: 'object',
        properties: {
          id: { type: 'string', format: 'uuid' },
          type: { enum: ['DIRECT', 'GROUP'] },
          name: { type: ['string', 'null'], description: 'Groups only' },
          createdBy: { type: ['string', 'null'] },
          myRole: { enum: ['ADMIN', 'MEMBER'] },
          myLastReadSeq: { type: 'integer' },
          members: { type: 'array', items: ref('Member') },
          lastMessage: { oneOf: [ref('Message'), { type: 'null' }] },
          unreadCount: { type: 'integer' },
          lastMessageAt: { type: ['string', 'null'], format: 'date-time' },
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
    '/users/lookup': {
      get: {
        tags: ['Users'],
        security: secured,
        summary: 'Find an active user by exact username or email (to invite them to a private poll)',
        parameters: [{ name: 'identifier', in: 'query', required: true, schema: { type: 'string' } }],
        responses: {
          200: ok('OK', { user: { type: 'object', properties: { id: { type: 'string' }, username: { type: 'string' } } } }),
          401: E[401],
          404: E[404],
        },
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
        summary: 'List published polls (public ones, plus private ones the user created or is invited to)',
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
        responses: { 200: ok('OK', { poll: ref('Poll') }), 400: err('INVALID_END_TIME / NOT_ENOUGH_OPTIONS / NO_VOTERS'), 403: E[403], 404: E[404], 409: err('POLL_ALREADY_PUBLISHED') },
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
        summary: 'Vote (once per poll; never on your own poll; PRIVATE polls: invited voters only)',
        parameters: idParam,
        requestBody: body({ type: 'object', required: ['optionId'], properties: { optionId: { type: 'string', format: 'uuid' } } }),
        responses: {
          201: ok('Vote recorded', { vote: { type: 'object' }, results: ref('Results') }),
          400: err('VALIDATION_ERROR / INVALID_OPTION'),
          401: E[401],
          403: err('POLL_CLOSED / OWNER_CANNOT_VOTE / NOT_INVITED'),
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
    '/users/me/preferences': {
      patch: {
        tags: ['Users'],
        security: secured,
        summary: 'Update my interface preferences',
        requestBody: body(ref('Preferences')),
        responses: { 200: ok('OK', { user: ref('User') }), 400: E[400], 401: E[401] },
      },
    },
    '/users/directory': {
      get: {
        tags: ['Users'],
        security: secured,
        summary: 'Find people by username (new conversations); never returns emails',
        parameters: [
          { name: 'search', in: 'query', required: true, schema: { type: 'string', maxLength: 30 } },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 8, maximum: 20 } },
        ],
        responses: { 200: ok('OK', { users: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, username: { type: 'string' } } } } }), 401: E[401] },
      },
    },
    '/conversations': {
      get: {
        tags: ['Messaging'],
        security: secured,
        summary: 'My conversations, most recent activity first',
        parameters: [{ name: 'search', in: 'query', schema: { type: 'string' }, description: 'Group name or participant username' }],
        responses: { 200: ok('OK', { conversations: { type: 'array', items: ref('Conversation') } }), 401: E[401] },
      },
    },
    '/conversations/unread-count': {
      get: { tags: ['Messaging'], security: secured, summary: 'Total unread messages', responses: { 200: ok('OK', { total: { type: 'integer' } }), 401: E[401] } },
    },
    '/conversations/direct': {
      post: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Open the private conversation with a user (201 created, 200 existing)',
        requestBody: body({ type: 'object', required: ['userId'], properties: { userId: { type: 'string', format: 'uuid' } } }),
        responses: { 200: ok('Existing', { conversation: ref('Conversation') }), 201: ok('Created', { conversation: ref('Conversation') }), 400: E[400], 404: E[404] },
      },
    },
    '/conversations/groups': {
      post: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Create a group (the creator becomes ADMIN)',
        requestBody: body({
          type: 'object',
          required: ['name', 'memberIds'],
          properties: { name: { type: 'string', maxLength: 80 }, memberIds: { type: 'array', minItems: 1, maxItems: 49, items: { type: 'string', format: 'uuid' } } },
        }),
        responses: { 201: ok('Created', { conversation: ref('Conversation') }), 400: E[400], 401: E[401] },
      },
    },
    '/conversations/{id}': {
      get: { tags: ['Messaging'], security: secured, summary: 'One conversation (members only)', parameters: idParam, responses: { 200: ok('OK', { conversation: ref('Conversation') }), 404: E[404] } },
      patch: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Rename a group (group admins)',
        parameters: idParam,
        requestBody: body({ type: 'object', required: ['name'], properties: { name: { type: 'string', maxLength: 80 } } }),
        responses: { 200: ok('OK', { conversation: ref('Conversation') }), 400: E[400], 403: E[403], 404: E[404] },
      },
    },
    '/conversations/{id}/members': {
      post: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Add members to a group (group admins)',
        parameters: idParam,
        requestBody: body({ type: 'object', required: ['userIds'], properties: { userIds: { type: 'array', items: { type: 'string', format: 'uuid' } } } }),
        responses: { 200: ok('OK', { conversation: ref('Conversation') }), 400: E[400], 403: E[403], 404: E[404] },
      },
    },
    '/conversations/{id}/members/{userId}': {
      patch: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Change a member’s role (group admins); 409 LAST_ADMIN',
        parameters: [...idParam, { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        requestBody: body({ type: 'object', required: ['role'], properties: { role: { enum: ['ADMIN', 'MEMBER'] } } }),
        responses: { 200: ok('OK', { conversation: ref('Conversation') }), 403: E[403], 404: E[404], 409: E[409] },
      },
      delete: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Remove a member (group admins) or leave (userId = yourself)',
        parameters: [...idParam, { name: 'userId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } }],
        responses: { 200: ok('OK', { left: { type: 'boolean' } }), 400: E[400], 403: E[403], 404: E[404] },
      },
    },
    '/conversations/{id}/messages': {
      get: {
        tags: ['Messaging'],
        security: secured,
        summary: 'History, oldest first, keyset-paginated on seq',
        parameters: [
          ...idParam,
          { name: 'before', in: 'query', schema: { type: 'integer' }, description: 'Older page: messages with seq < before' },
          { name: 'after', in: 'query', schema: { type: 'integer' }, description: 'Catch-up: messages with seq > after' },
          { name: 'limit', in: 'query', schema: { type: 'integer', default: 30, maximum: 100 } },
        ],
        responses: { 200: ok('OK', { messages: { type: 'array', items: ref('Message') }, hasMore: { type: 'boolean' } }), 404: E[404] },
      },
      post: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Send a message (201 new, 200 retry of an existing clientId); 429 RATE_LIMITED',
        parameters: idParam,
        requestBody: body({
          type: 'object',
          required: ['body', 'clientId'],
          properties: { body: { type: 'string', minLength: 1, maxLength: 2000 }, clientId: { type: 'string', format: 'uuid' } },
        }),
        responses: { 200: ok('Duplicate', { message: ref('Message') }), 201: ok('Created', { message: ref('Message') }), 400: E[400], 404: E[404], 429: err('RATE_LIMITED') },
      },
    },
    '/conversations/{id}/read': {
      post: {
        tags: ['Messaging'],
        security: secured,
        summary: 'Mark as read up to seq (default: newest); never moves backwards',
        parameters: idParam,
        requestBody: { content: { 'application/json': { schema: { type: 'object', properties: { seq: { type: 'integer' } } } } } },
        responses: { 200: ok('OK', { lastReadSeq: { type: 'integer' } }), 404: E[404] },
      },
    },
    '/conversations/{id}/polls': {
      get: { tags: ['Messaging'], security: secured, summary: 'Polls of a group (members only)', parameters: idParam, responses: { 200: ok('OK', { polls: { type: 'array', items: ref('Poll') } }), 404: E[404] } },
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
