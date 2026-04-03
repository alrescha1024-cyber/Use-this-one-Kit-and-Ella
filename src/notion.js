const { Client } = require('@notionhq/client');
const config = require('./config');

class NotionClient {
  constructor() {
    this.client = new Client({ auth: config.notion.token });
    this.cache = new Map(); // pageId -> { content, fetchedAt }
    this.cacheTTL = 10 * 60 * 1000; // 10 minutes
  }

  // ─── READ ──────────────────────────────────────────────

  /**
   * Read a Notion page's content as plain text.
   */
  async readPage(pageId, useCache = true) {
    const cacheKey = pageId.replace(/-/g, '');

    if (useCache) {
      const cached = this.cache.get(cacheKey);
      if (cached && Date.now() - cached.fetchedAt < this.cacheTTL) {
        return cached.content;
      }
    }

    const page = await this.client.pages.retrieve({ page_id: pageId });
    const title = this._extractTitle(page);
    const blocks = await this._getAllBlocks(pageId);
    const content = this._blocksToText(blocks);
    const result = title ? `# ${title}\n\n${content}` : content;

    this.cache.set(cacheKey, { content: result, fetchedAt: Date.now() });
    return result;
  }

  /**
   * Load recent diary entries from the parent page.
   * Searches for child pages with "Day" in the title, sorted by creation date.
   */
  async loadRecentDiary(parentPageId, count = 2) {
    if (!parentPageId) return '';

    const children = await this._getAllBlocks(parentPageId);

    // Filter for child_page blocks with "Day" in title
    const diaryPages = children
      .filter((block) => block.type === 'child_page' && block.child_page?.title)
      .filter((block) => /day/i.test(block.child_page.title))
      .sort((a, b) => new Date(b.created_time) - new Date(a.created_time))
      .slice(0, count);

    if (diaryPages.length === 0) return '';

    const entries = [];
    for (const page of diaryPages) {
      try {
        const content = await this.readPage(page.id, false);
        entries.push(`--- ${page.child_page.title} ---\n${content}`);
      } catch (err) {
        console.error(`[Notion] Failed to load diary page ${page.child_page.title}:`, err.message);
      }
    }

    return entries.length > 0
      ? `\n--- Recent Diary (${entries.length} entries) ---\n${entries.join('\n\n')}\n--- End Diary ---`
      : '';
  }

  /**
   * Search pages across the workspace.
   */
  async searchPages(query, limit = 5) {
    const response = await this.client.search({
      query,
      filter: { property: 'object', value: 'page' },
      sort: { direction: 'descending', timestamp: 'last_edited_time' },
      page_size: limit,
    });

    const results = [];
    for (const page of response.results) {
      const title = this._extractTitle(page);
      results.push({
        id: page.id,
        title: title || 'Untitled',
        lastEdited: page.last_edited_time,
        url: page.url,
      });
    }

    return results;
  }

  // ─── WRITE ─────────────────────────────────────────────

  /**
   * Create a new page under a parent page.
   */
  async createPage(parentPageId, title, content) {
    const children = this._textToBlocks(content);

    const page = await this.client.pages.create({
      parent: { page_id: parentPageId },
      properties: {
        title: {
          title: [{ text: { content: title } }],
        },
      },
      children,
    });

    return { id: page.id, url: page.url };
  }

  /**
   * Append text content to an existing page.
   */
  async appendToPage(pageId, content) {
    const children = this._textToBlocks(content);

    await this.client.blocks.children.append({
      block_id: pageId,
      children,
    });

    // Invalidate cache
    this.cache.delete(pageId.replace(/-/g, ''));

    return { success: true };
  }

  // ─── HELPERS ───────────────────────────────────────────

  /**
   * Convert plain text to Notion block array.
   */
  _textToBlocks(text) {
    return text.split('\n\n').filter(Boolean).map((paragraph) => {
      // Detect headings
      if (paragraph.startsWith('# ')) {
        return {
          object: 'block',
          type: 'heading_1',
          heading_1: { rich_text: [{ text: { content: paragraph.slice(2) } }] },
        };
      }
      if (paragraph.startsWith('## ')) {
        return {
          object: 'block',
          type: 'heading_2',
          heading_2: { rich_text: [{ text: { content: paragraph.slice(3) } }] },
        };
      }
      if (paragraph.startsWith('### ')) {
        return {
          object: 'block',
          type: 'heading_3',
          heading_3: { rich_text: [{ text: { content: paragraph.slice(4) } }] },
        };
      }

      // Truncate to Notion's 2000 char limit per rich text
      const truncated = paragraph.slice(0, 2000);
      return {
        object: 'block',
        type: 'paragraph',
        paragraph: { rich_text: [{ text: { content: truncated } }] },
      };
    });
  }

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
        case 'to_do': {
          const check = data.checked ? '[x]' : '[ ]';
          lines.push(`${check} ${this._richTextToString(data.rich_text)}`);
          break;
        }
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
          break;
      }
    }
    return lines.join('\n\n');
  }

  _richTextToString(richText) {
    if (!richText || richText.length === 0) return '';
    return richText.map((t) => t.plain_text).join('');
  }

  _extractTitle(page) {
    const props = page.properties;
    for (const key of Object.keys(props)) {
      if (props[key].type === 'title' && props[key].title?.length > 0) {
        return props[key].title.map((t) => t.plain_text).join('');
      }
    }
    return null;
  }

  clearCache(pageId) {
    if (pageId) {
      this.cache.delete(pageId.replace(/-/g, ''));
    } else {
      this.cache.clear();
    }
  }
}

module.exports = NotionClient;
