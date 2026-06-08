---
name: web-search
description: Search the web for documentation, facts, and current info using the websearch tool. Use when repository files are insufficient.
allowed-tools: websearch
---

# Web Search

Use this skill when the answer depends on external information not present in the local repository.

## Workflow

1. Call `websearch` with a precise query.
2. Review returned links/snippets.
3. If needed, run follow-up `websearch` calls with narrower terms.
4. Cite the URLs you used in your final response.

## Query tips

- Add product/library names and versions.
- Add words like `docs`, `api`, `reference`, `release notes`.
- Prefer targeted queries over broad ones.

## Examples

- `/skill:web-search react usememo docs`
- `/skill:web-search kotlin coroutines flow operator reference`
