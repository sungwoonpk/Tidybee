# Parser project

A small Markdown parser. Read @docs/rules.md before you change anything.

## Layout

- The parser is in `src/parser.ts`, and the old one in `src/old-parser.ts` is kept for reference.
- Design notes: [the guide](docs/guide.md) and [the history](docs/history.md#why-we-rewrote-it).

## Commands

```bash
npm install
npm run build
npm run lint
npm test
```

Run `make check` before you open a pull request.
