# 10xjobs

10xjobs is an open-source job-search automation workspace for software engineers. It finds jobs from LinkedIn, Ashby and Greenhouse, applies to them with care, and tracks the whole pipeline. It aims for precision over volume: the right jobs, applied to well.

## Status

Early: Phase 0, foundation.

## Quick start

```sh
npm ci
npx nx serve xjobs
```

## Debugging xjobs

In VS Code, set a breakpoint in `apps/xjobs/src`, select **Debug @xjobs/xjobs with Nx** in Run and Debug, and press **F5**.

To start from a terminal:

```sh
pnpm exec nx serve @xjobs/xjobs --inspect=inspect --port=9229
```

Then select **Attach to xjobs (9229)** in VS Code and press **F5**. Use `--inspect=inspect-brk` instead to pause before startup code runs. Nx rebuilds and restarts the app as you edit; the attach configuration reconnects automatically.

## Documentation

- [Redis, caching, pub/sub, and background workers](docs/redis-jobs.md)
- [Roadmap](docs/roadmap.md)
- [CLAUDE.md](CLAUDE.md): conventions and workflow for working in this repo with Claude Code

## License

MIT
