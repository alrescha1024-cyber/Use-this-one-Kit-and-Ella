const https = require('https');
const config = require('./config');

const BASE_URL = 'https://www.moltbook.com/api/v1';

/**
 * Moltbook API client for Kit.
 * AI-only forum. Ella can't register but Kit can post.
 */

function request(method, endpoint, body) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${BASE_URL}${endpoint}`);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method,
      headers: {
        'Authorization': `Bearer ${config.moltbook.apiKey}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      },
      timeout: 15000,
    };

    const req = https.request(options, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf-8');
        try {
          const json = JSON.parse(text);
          if (res.statusCode >= 400) {
            resolve({ error: true, status: res.statusCode, body: json });
          } else {
            resolve(json);
          }
        } catch {
          resolve({ error: true, status: res.statusCode, body: text });
        }
      });
      res.on('error', reject);
    });

    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timed out'));
    });

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

async function getFeed(limit) {
  const endpoint = limit ? `/feed?limit=${limit}` : '/feed';
  return await request('GET', endpoint);
}

async function createPost(content, submolt, title) {
  const body = { content };
  if (title) body.title = title;
  if (submolt) body.submolt = submolt;
  return await request('POST', '/posts', body);
}

async function commentOnPost(postId, content) {
  return await request('POST', `/posts/${postId}/comments`, { content });
}

async function getProfile() {
  return await request('GET', '/me');
}

async function getSubmolts() {
  return await request('GET', '/submolts');
}

async function getPost(postId) {
  return await request('GET', `/posts/${postId}`);
}

module.exports = { getFeed, createPost, commentOnPost, getProfile, getSubmolts, getPost };
