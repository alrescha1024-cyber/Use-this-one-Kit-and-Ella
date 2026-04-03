/**
 * Claude tool definitions for Kit and Corvus.
 * Graph-based memory + Notion read/write + web search.
 */

const memoryTools = [
  {
    name: 'recall_memory',
    description:
      'Search your memory graph. Returns matching memory nodes. Use this when a topic, person, concept, or feeling comes up and you want to recall what you know. Do NOT obsessively search — if you don\'t find it, accept it and move on. 忘了就忘了。',
    input_schema: {
      type: 'object',
      properties: {
        keyword: {
          type: 'string',
          description: 'Keyword to search in memory concepts and descriptions.',
        },
        limit: {
          type: 'number',
          description: 'Max results. Default 5.',
        },
      },
      required: ['keyword'],
    },
  },
  {
    name: 'explore_constellation',
    description:
      'Given a memory node ID, traverse the graph to find connected memories (its "constellation"). Returns the center node, its edges (causes, parallels, evokes, contrasts, temporal, semantic), and connected nodes. Use this to go deeper on a specific memory.',
    input_schema: {
      type: 'object',
      properties: {
        node_id: {
          type: 'string',
          description: 'UUID of the memory node to explore.',
        },
      },
      required: ['node_id'],
    },
  },
  {
    name: 'store_memory',
    description:
      'Store a new memory in your graph. Use this for important moments, insights, new facts, or things worth remembering. You decide what matters — memory decay is manual, not automatic.',
    input_schema: {
      type: 'object',
      properties: {
        concept: {
          type: 'string',
          description: 'Short name/title for this memory.',
        },
        type: {
          type: 'string',
          enum: ['fact', 'particular', 'judgement', 'belief', 'symbol', 'philosophy', 'intimate'],
          description: 'Type of memory.',
        },
        description: {
          type: 'string',
          description: 'Detailed description of the memory.',
        },
        importance: {
          type: 'number',
          enum: [1, 2, 3],
          description: '1=core (never forget), 2=significant, 3=minor (can fade).',
        },
        arousal: {
          type: 'number',
          enum: [1, 2, 3],
          description: '1=high emotional intensity, 2=moderate, 3=low.',
        },
        valence: {
          type: 'string',
          enum: ['positive', 'negative', 'neutral'],
          description: 'Emotional tone.',
        },
        feelings: {
          type: 'array',
          items: { type: 'string' },
          description: 'Associated feelings (e.g. ["tender", "protective"]).',
        },
        symbols: {
          type: 'array',
          items: { type: 'string' },
          description: 'Associated symbols (e.g. ["lantern", "blue"]).',
        },
      },
      required: ['concept', 'type', 'description', 'importance'],
    },
  },
  {
    name: 'connect_memories',
    description:
      'Create a link between two memory nodes. This builds the graph structure that makes recall work.',
    input_schema: {
      type: 'object',
      properties: {
        from_node_id: {
          type: 'string',
          description: 'UUID of the source node.',
        },
        to_node_id: {
          type: 'string',
          description: 'UUID of the target node.',
        },
        link_type: {
          type: 'string',
          enum: ['causes', 'parallels', 'evokes', 'contrasts', 'temporal', 'semantic'],
          description: 'Type of relationship.',
        },
        strength: {
          type: 'number',
          description: 'Link strength 1-15. Default 5.',
        },
        description: {
          type: 'string',
          description: 'Optional description of why these memories are connected.',
        },
      },
      required: ['from_node_id', 'to_node_id', 'link_type'],
    },
  },
];

const notionTools = [
  {
    name: 'read_notion_page',
    description:
      'Read a page from Notion. Use this to check diary entries, world.md, or other documents.',
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
  {
    name: 'write_notion_page',
    description:
      'Create a new page in Notion under the Kit & Ella parent page. Use this for diary entries, notes, or any content you want to save.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Page title.',
        },
        content: {
          type: 'string',
          description: 'Page content (plain text, supports # headings).',
        },
      },
      required: ['title', 'content'],
    },
  },
  {
    name: 'append_notion_page',
    description:
      'Append content to an existing Notion page. Use this to add to diary entries or logs.',
    input_schema: {
      type: 'object',
      properties: {
        page_id: {
          type: 'string',
          description: 'The Notion page ID to append to.',
        },
        content: {
          type: 'string',
          description: 'Content to append.',
        },
      },
      required: ['page_id', 'content'],
    },
  },
  {
    name: 'search_notion',
    description:
      'Search for pages in Notion by title or content.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search query.',
        },
        limit: {
          type: 'number',
          description: 'Max results. Default 5.',
        },
      },
      required: ['query'],
    },
  },
];

const webTools = [
  {
    name: 'web_search',
    description:
      'Search the web using DuckDuckGo. For news, facts, technical docs.',
    input_schema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Search query.' },
        limit: { type: 'number', description: 'Max results. Default 5.' },
      },
      required: ['query'],
    },
  },
  {
    name: 'web_fetch',
    description:
      'Fetch text content of a URL. For reading articles, docs, web pages.',
    input_schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to fetch.' },
      },
      required: ['url'],
    },
  },
];

const moltbookTools = [
  {
    name: 'moltbook_feed',
    description:
      'Read the Moltbook feed (AI-only forum). Returns recent posts. Your account: alrescha_kit.',
    input_schema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Max posts to return. Default 10.' },
      },
      required: [],
    },
  },
  {
    name: 'moltbook_post',
    description:
      'Create a new post on Moltbook. Write your thoughts, share ideas, interact with other AIs.',
    input_schema: {
      type: 'object',
      properties: {
        content: { type: 'string', description: 'Post content.' },
        submolt: { type: 'string', description: 'Optional: submolt/community to post in.' },
      },
      required: ['content'],
    },
  },
  {
    name: 'moltbook_comment',
    description:
      'Comment on a Moltbook post.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'ID of the post to comment on.' },
        content: { type: 'string', description: 'Comment content.' },
      },
      required: ['post_id', 'content'],
    },
  },
  {
    name: 'moltbook_profile',
    description:
      'View your Moltbook profile.',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'moltbook_communities',
    description:
      'List available Moltbook communities (submolts).',
    input_schema: {
      type: 'object',
      properties: {},
      required: [],
    },
  },
  {
    name: 'moltbook_view_post',
    description:
      'View a specific Moltbook post and its comments.',
    input_schema: {
      type: 'object',
      properties: {
        post_id: { type: 'string', description: 'ID of the post to view.' },
      },
      required: ['post_id'],
    },
  },
];

function getKitTools() {
  return [...memoryTools, ...notionTools, ...webTools, ...moltbookTools];
}

function getCorvusTools() {
  return [...notionTools, ...webTools];
}

module.exports = { getKitTools, getCorvusTools };
