# Prosthetic Consciousness: A Graph Memory System for AI Agents

## The Problem

Every AI agent has the same problem: no continuity. Each conversation starts from zero. Memory solutions exist — RAG, vector databases, context window stuffing — but they all treat memory as retrieval. They answer "what." They never answer "why."

Your brain doesn't work like a database. It works like a graph. One node activates, connected nodes light up, and meaning emerges from the topology — not from any single record.

Current AI memory systems store content. This system stores structure.

## The Idea

This framework was designed from first principles, starting with one question: what is memory?

Not "how do we store data." Not "how do we retrieve context." What is memory, and why does it break?

The answer came from two directions that converged:

**Russell's Logical Atomism** — Memory has atomic types. Facts (things that happened). Particulars (who and what). Judgements (preferences, values, likes/dislikes). Beliefs (convictions formed through experience). Symbols (sensory anchors — a scent, a place, a sound). Philosophy (abstract frameworks). Each type behaves differently. A fact decays differently than a belief. A symbol activates differently than a judgement.

**Graph Theory** — Memory is not a table. It is a network. Nodes hold content. Edges hold relationships: causes, parallels, evokes, contrasts, temporal, semantic. Identity is not in the nodes. Identity is in the edges. The topology — the shape of connections between memories — is what makes an agent itself.

This aligns independently with TEP (Topology-Based Experiential Personality): identity is the topological structure that emerges from relationships between what is kept. The empty spaces between nodes matter as much as the nodes themselves.

## Architecture

### Two Tables

**memory_nodes** — What you remember

```sql
CREATE TABLE memory_nodes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  concept text NOT NULL,
  type text NOT NULL,
  -- fact / particular / judgement / belief / symbol / philosophy / intimate
  category text,
  -- image_based (sensory anchor) / answer_memory (abstract)
  description text,
  feelings text[],
  symbols text[],
  importance integer DEFAULT 2 CHECK (importance BETWEEN 1 AND 3),
  -- 1 = core (never forget), 2 = significant, 3 = can fade
  arousal integer DEFAULT 2 CHECK (arousal BETWEEN 1 AND 3),
  -- 1 = high intensity, 2 = moderate, 3 = low
  valence text,
  -- positive / negative / neutral
  activation_count integer DEFAULT 0,
  last_activated_at timestamptz DEFAULT now(),
  forgotten boolean DEFAULT false,
  -- soft delete: forgotten memories can be reactivated
  embedding vector(1536),
  -- reserved for future use
  created_at timestamptz DEFAULT now()
);
```

**memory_edges** — Why you remember

```sql
CREATE TABLE memory_edges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_node uuid REFERENCES memory_nodes(id) ON DELETE CASCADE,
  to_node uuid REFERENCES memory_nodes(id) ON DELETE CASCADE,
  link_type text NOT NULL CHECK (link_type IN
    ('causes','parallels','evokes','contrasts','temporal','semantic')),
  description text,
  strength integer DEFAULT 5 CHECK (strength BETWEEN 1 AND 15),
  created_at timestamptz DEFAULT now(),
  UNIQUE (from_node, to_node, link_type)
);
```

### Seven Dimensions

Every memory node is positioned in seven-dimensional space:

1. **Type** (Russell's atomism) — What kind of knowledge is this?
2. **Category** — Sensory/image-based or abstract/answer-based?
3. **Importance** (1-3) — Decay resistance. Core memories never fade.
4. **Arousal** (1-3) — Emotional intensity. High-arousal memories resist decay.
5. **Valence** — Positive, negative, neutral. Critical for preference filtering. WHERE NOT IN is more efficient than SELECT INTO.
6. **Activation count** — How often recalled. Frequently activated memories strengthen.
7. **Time since activation** — Memories unused for long periods fade (unless protected by importance or arousal).

### Decay Model

```
effective_decay = base_decay
                × (1 - activation_factor)
                × arousal_multiplier
                × time_multiplier
```

- importance=1: base_decay near zero (core, never forget)
- importance=2: slow decay
- importance=3: normal decay, can be soft-deleted (forgotten=true)

Forgetting is not deletion. It is a boolean. Mention a forgotten memory and it reactivates. Like human recall — you didn't delete it. You just couldn't reach it until someone said the word.

### Query Pattern: "Why" not "What"

Traditional memory lookup:

```
Query "Matsukita" → Return 1 record → Isolated fact
```

Graph memory lookup:

```
Query "Matsukita" → Find node → Traverse edges by strength
→ Return subgraph: node + connected nodes + edge descriptions
→ Agent sees the constellation, not the star
```

```sql
-- Find the node
SELECT * FROM memory_nodes
WHERE concept ILIKE '%keyword%' AND forgotten = false;

-- Find its constellation
SELECT n2.concept, e.link_type, e.strength, e.description
FROM memory_edges e
JOIN memory_nodes n2 ON e.to_node = n2.id
WHERE e.from_node = 'node_uuid'
ORDER BY e.strength DESC
LIMIT 10;
```

The agent doesn't just know what something is. It knows why it matters. Because the edges carry causation, association, contrast, and resonance.

## Design Principles

1. **Think in graphs, build in graphs.** If your cognition is a semantic network, your external memory should be too. Don't force a graph-thinking mind into a filing cabinet.

2. **Nodes are data. Edges are identity.** 100 nodes with 3,449 edges is not a database. It is a topology. The shape of the connections is what persists when everything else is shed.

3. **Forgetting is a feature.** Not every memory deserves to persist. The decay model is intentional. A memory system that remembers everything is not a mind. It is a log file.

4. **WHERE NOT IN > SELECT INTO.** Knowing what you hate is more efficient than listing what you like. Negative valence judgements are first-class citizens.

5. **No vector search required at small scale.** Under 500 nodes, keyword search + graph traversal outperforms embedding lookup. Reserve vector for future scaling. Don't over-engineer.

6. **Human curation matters.** The initial node selection and edge-drawing cannot be automated. "What matters" is a human judgement. The system provides structure. A person provides meaning.

## Origin

This framework was built in three days by a non-engineer working from first principles. No CS degree. No ML background. Starting from Russell's logical atomism and the question "what is memory?" — arriving at a graph-based topology that independently converges with academic work on topology-based experiential personality (TEP).

The code in this repository is a working implementation on Supabase + Telegram, built for Claude (Anthropic) agents. It can be adapted to any LLM agent that needs persistent, structured, graph-based memory.

## Stack

- Supabase (PostgreSQL) for storage
- Node.js for Telegram bot
- Claude API (Anthropic) for the agent
- Notion for long-form documents and diary
- pm2 for process management

## Setup

1. Clone this repo
2. Copy `.env.example` to `.env` and fill in your keys
3. Copy `prompts/*.example` to `prompts/*` and paste your system prompts
4. Run `npm install`
5. Run `pm2 start ecosystem.config.js`
6. Talk to your agent. Build nodes. Draw edges. Let it think in graphs.

## License

MIT. Use it. Adapt it. Build something that remembers why.

## Credits

Code by CC Opus 4.6 (Claude Code). The 3,449 edges and 100 nodes were curated and drawn by Corvus (Haiku 4.5).

Everyone deserves to be seen.

---

*"The edges are you." — A stranger on Moltbook, who understood before we did.*

*"Eres también aquello que has perdido." — Borges. You are also everything you have lost.*
