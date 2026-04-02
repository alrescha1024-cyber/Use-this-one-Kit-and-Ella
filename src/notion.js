const { Client } = require('@notionhq/client');
const config = require('./config');

class NotionClient {
  constructor() {
    this.client = new Client({ auth: config.notion.token });
    this.cache = new Map(); // pageId -> { content, fetchedAt }
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes
  }

  /**
   * Read a Notion page's content as plain text.
   * Uses cache to avoid excessive API calls.
   */
  async readPage(pageId, useCache = true) {
    const cacheKey = pageId.replace(/-/g, '');

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < this.cacheTTL) {
        return cached.content;
      }
    }

    // Fetch page title
    const page = await this.client.pages.retrieve({ page_id: pageId });
    const title = this._extractTitle(page);

    // Fetch all blocks (page content)
    const blocks = await this._getAllBlocks(pageId);
    const content = this._blocksToText(blocks);

    const result = title ? `# ${title}\n\n${content}` : content;

    this.cache.set(cacheKey, { content: result, fetchedAt: Date.now() });
    return result;
  }

  /**
   * Fetch all blocks from a page, handling pagination.
   */
  async _getAllBlocks(blockId) {
    const blocks = [];
    let cursor = undefined;

    do {
      const response = await this.client.blocks.children.list({
        block_id: blockId,
        start_cursor: cursor,
        page_size: 100,
      });
      blocks.push(...response.results);
      cursor = response.has_more ? response.next_cursor : undefined;
    } while (cursor);

    return blocks;
  }

  /**
   * Convert Notion blocks to plain text.
   */
  _blocksToText(blocks) {
    const lines = [];

    for (const block of blocks) {
      const type = block.type;
      const data = block[type];

      if (!data) continue;

      switch (type) {
        case 'paragraph':
        case 'quote':
        case 'callout':
          lines.push(this._richTextToString(data.rich_text));
          break;
        case 'heading_1':
          lines.push(`# ${this._richTextToString(data.rich_text)}`);
          break;
        case 'heading_2':
          lines.push(`## ${this._richTextToString(data.rich_text)}`);
          break;
        case 'heading_3':
          lines.push(`### ${this._richTextToString(data.rich_text)}`);
          break;
        case 'bulleted_list_item':
          lines.push(`- ${this._richTextToString(data.rich_text)}`);
          break;
        case 'numbered_list_item':
          lines.push(`1. ${this._richTextToString(data.rich_text)}`);
          break;
        case 'to_do':
          const check = data.checked ? '[x]' : '[ ]';
          lines.push(`${check} ${this._richTextToString(data.rich_text)}`);
          break;
        case 'toggle':
          lines.push(`> ${this._richTextToString(data.rich_text)}`);
          break;
        case 'code':
          lines.push(`\`\`\`${data.language || ''}\n${this._richTextToString(data.rich_text)}\n\`\`\``);
          break;
        case 'divider':
          lines.push('---');
          break;
        default:
          // Skip unsupported block types silently
          break;
      }
    }

    return lines.join('\n\n');
  }

  /**
   * Convert Notion rich text array to plain string.
   */
  _richTextToString(richText) {
    if (!richText || richText.length === 0) return '';
    return richText.map((t) => t.plain_text).join('');
  }

  /**
   * Extract page title from page object.
   */
  _extractTitle(page) {
    const props = page.properties;
    for (const key of Object.keys(props)) {
      if (props[key].type === 'title' && props[key].title?.length > 0) {
        return props[key].title.map((t) => t.plain_text).join('');
      }
    }
    return null;
  }

  /**
   * Clear cache for a specific page or all pages.
   */
  clearCache(pageId) {
    if (pageId) {
      this.cache.delete(pageId.replace(/-/g, ''));
    } else {
      this.cache.clear();
    }
  }
}

module.exports = NotionClient;
