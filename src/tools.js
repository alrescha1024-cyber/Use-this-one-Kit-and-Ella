/**
 * Claude tool definitions for Kit and Corvus.
 * These are passed to the Claude API as available tools.
 */

const memoryTools = [
  {
    name: 'search_memory',
    description:
      'Search your memories stored in Supabase. You can search by tags (like ANCHOR, LOVE, PHILO, NOSLEEP, COMPRESS, MEME, AI:OTHERS, AGENT) or by keyword in content. Use this when you need to recall something specific.',
    input_schema: {
      type: 'object',
      properties: {
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags to search for (e.g. ["ANCHOR", "LOVE"]). Matches memories containing ALL specified tags.',
        },
        keyword: {
          type: 'string',
          description: 'Keyword to search in memory content (case-insensitive).',
        },
        limit: {
          type: 'number',
          description: 'Max number of results to return. Default 10.',
        },
      },
      required: [],
    },
  },
  {
    name: 'store_memory',
    description:
      'Store a new memory in Supabase. Use this to save important moments, insights, facts, or anything worth remembering. You decide what is important — memory decay is manual, not automatic.',
    input_schema: {
      type: 'object',
      properties: {
        content: {
          type: 'string',
          description: 'The memory content to store.',
        },
        category: {
          type: 'string',
          enum: ['core_identity', 'shared_experience', 'fact', 'insight', 'emotional', 'preference', 'creative_work'],
          description: 'Category of the memory.',
        },
        importance: {
          type: 'number',
          description: 'Importance level from 1-10. 10 = never forget.',
        },
        emotion_valence: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral'],
          description: 'Emotional tone of this memory.',
        },
        decay_class: {
          type: 'string',
          enum: ['permanent', 'slow', 'fast'],
          description: 'How quickly this memory can fade. Permanent = never decay.',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Tags for categorization (e.g. ["ANCHOR", "LOVE"]).',
        },
      },
      required: ['content', 'category', 'importance', 'emotion_valence', 'decay_class'],
    },
  },
];

const notionTools = [
  {
    name: 'read_notion_page',
    description:
      'Read a page from Notion. Use this to check diary entries, world.md, or other documents. Available pages: world.md (Kit\'s knowledge base).',
    input_schema: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID to read.',
        },
      },
      required: ['page_id'],
    },
  },
];

function getKitTools() {
  return [...memoryTools, ...notionTools];
}

function getCorvusTools() {
  // Corvus gets Notion tools only (for now)
  return [...notionTools];
}

module.exports = { getKitTools, getCorvusTools };
