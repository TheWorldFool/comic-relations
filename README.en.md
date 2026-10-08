# Yejian · Comic Relations

**Read comics page by page. Explore relationships at each turning point.**

[简体中文](README.md) · [Detailed guide (Chinese)](docs/GUIDE.zh-CN.md) · [Report an issue](https://github.com/TheWorldFool/comic-relations/issues)

Yejian is a locally hosted workspace for understanding characters and relationships in comics. Import and order your comic images, then use the DeepSeek API to analyze the story sequentially, maintain character profiles, and save relationship graphs at significant story changes. Stages and supporting evidence retain page references so you can compare the analysis with the original comic.

**Status: v0.1 early release.** The core workflow is implemented for personal experimentation, development, and feedback. Character identities, relationships, and stage boundaries need human review; systematic accuracy evaluation across different works is still pending. The interface and default analysis output are primarily in Chinese.

## Features

| Feature | Behavior |
| --- | --- |
| Import and ordering | Import images or folders, sort filenames naturally, reorder pages, and choose panel reading direction. |
| Page selection first | Mark story pages, covers, advertisements, and extras before analysis. Non-story pages are excluded from plot analysis. |
| Background research | Identify work-specific clues and search for background and character references. Review the sources and explicitly adopt the draft before using it in analysis. |
| Identity continuity | Store page appearances separately from identities, correct selected assignments, and rebuild current relationships and states from evidence. Review identities when needed; uncertain crops do not automatically enter the reference gallery. |
| Relationship stages | Update the current stage for routine interactions; create a new stage only for substantial, lasting relationship or status changes. |
| Character profiles | Record identity, appearance, state, directed attitudes, and page evidence without forcing fixed attributes or invented affinity scores. |
| Graph workspace | Pan, zoom, rearrange, inspect details, search profiles, and open the graph in an independent browser tab. |
| Save and resume | Save after each completed page, retain progress on failure, resume from the unfinished page, and export analysis as JSON. |

No comics, demo characters, or fabricated story data are bundled. Original-work background is an identification aid, not evidence that an event has happened in the comic being read.

## Quick start

Install **Node.js 22.12+** and npm. You also need an API that supports image input and JSON output. Local validation has been performed on Windows with Node.js 24.

```bash
git clone https://github.com/TheWorldFool/comic-relations.git
cd comic-relations
npm ci
npm run build
npm start
```

Open **http://127.0.0.1:3001**. In **阅读设置** (Reading settings), configure your API URL, model, and API key, then test image input. On Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

Alternatively, copy `.env.example` to `.env` and configure:

```dotenv
DEEPSEEK_API_KEY=your_api_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

DeepSeek is the default integration. Custom providers must support the image and JSON request formats used by the app. Automatic background research additionally requires compatibility with DeepSeek Anthropic Web Search; an ordinary chat endpoint is not a search endpoint. Model availability depends on the provider. [DeepSeek web search documentation](https://api-docs.deepseek.com/quick_start/agent_integrations/claude_code/#using-web-search-in-claude-code)

## Workflow

1. **Import and order pages.** JPG, PNG, WebP, and the first frame of GIF are supported; up to 32 MB per file and 1,000 files per upload.
2. **Classify pages.** Batch-select story pages, covers, ads, and extras. Every page must be assigned before reading begins.
3. **Review background.** Optionally search for the original work, inspect the sources, and adopt the result. Background research can be skipped.
4. **Analyze.** Read story pages in order to extract characters, events, states, and relationships. Review errors and resume from the saved position.
5. **Explore.** Switch between **阅读对照** (Reading comparison) and **关系工作台** (Relationship workspace). **独立打开关系图** opens an independent tab. Select a stage, inspect a character or relationship, and follow page references back to the comic.
6. **Correct and export.** Merge duplicate characters, crop replacement portraits, or export the project analysis as JSON.

Changing the order, role, or reading direction of already-read pages invalidates the analysis and requires a reset and reread; the UI asks first. Removing a page that has not been read yet keeps the completed analysis. Original source files are not modified.

## Data and API usage

- Projects, images, portraits, and analysis are stored under `data/`. Both `data/` and `.env` are excluded from Git.
- Local hosting does **not** mean offline analysis. Story pages, necessary reference portraits / previous pages, and narrative context are sent to your configured API. Work identification also sends selected sample pages.
- Connection tests, reading, automatic correction, and web research can incur API charges. There is no guaranteed fixed cost per page.
- Keys saved through the UI are stored locally in `data/settings.json`, which is not an encrypted credential vault. Do not share your data directory.
- Failure diagnostics may contain model-generated comic text. Remove secrets and unauthorized comic material before submitting a bug report.
- The server binds to `127.0.0.1` and has no multi-user authentication. This release is intended for personal local use.

## Limitations

- Models can misidentify characters, miss relationships, or choose incorrect stage boundaries. Matching a source URL does not fully verify a background claim.
- Evaluation across art styles, languages, and long-running works is pending. Full browser visual and interaction acceptance testing is also pending.
- Providers may refuse certain content. Refusals are retained and are not bypassed through output repair.
- PDF / ZIP / CBZ import, a dedicated OCR correction workflow, collaboration, and public hosting are not supported.
- Automatic portraits rely on model-provided coordinates; manual cropping is available for correction.

## Development and prompts

```bash
npm run dev    # Frontend: http://127.0.0.1:5173; backend: port 3001
npm test       # Isolated fixtures and mock APIs; no real API key required
npm run build # TypeScript checks and frontend build
```

`npm run test:live` is an optional **paid** API smoke test using a separately generated simple test image. It does not read the user's library.

Stack: React, TypeScript, Vite, Express, React Flow, Dagre, Sharp, and Zod.

| Location | Purpose |
| --- | --- |
| `server/analysis.ts` | Main `systemPrompt`, reading schema, and stage updates |
| `server/provider.ts` | Model requests, validation, and correction |
| `server/background-research.ts` | Work identification, research, and source-checking prompts |
| `server/identity.ts` | Identity matching, merging, and reference updates |
| `src/RelationshipExplorer.tsx` | Stage navigation, graph, and detail views |
| `src/CharacterDossier.tsx` | Profiles, character states, and evidence |
| `tests/` | Data logic, component output, and HTTP integration regression tests |

Restart the backend after changing prompts. Existing analysis is not regenerated automatically. See the [detailed Chinese guide](docs/GUIDE.zh-CN.md) for configuration, stage rules, and recovery behavior.

## Priorities

- Build an authorized comic evaluation set for identity continuity and stage selection.
- Complete browser acceptance checks for different viewport sizes, long lists, and graph interactions.
- Improve long-story context costs, error explanations, and manual correction workflows.

## License

The code is licensed under the [MIT License](LICENSE). This license does not cover imported comics, character artwork, or third-party material; their respective permissions still apply.

### Reading performance

Story analysis stays sequential. Ordinary pages return incremental memory; periodic checkpoints consolidate it, while unresolved threads persist separately. A bounded per-job image cache prepares the next story page during the current request without sending future pages to the model. Existing projects retain their progress. Per-page timing separates preparation and API time; exports include both the long-term `memory` and pending `readingMemory` entries. These changes have not yet been evaluated for speed and semantic accuracy across a representative comic dataset.
