import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CLI_VERSION, renderUsage, renderVersion } from './render-usage.ts';

describe('renderUsage', () => {
  it('documents the name positional, every flag, and the currently installed generators', () => {
    const usage = renderUsage();

    expect(usage).toContain('Usage: create-nx-archweave <name> [options]');
    expect(usage).toContain('--preset <quick-start|solo|team>');
    expect(usage).toContain('--frontend <react-vite|next|none>');
    expect(usage).toContain('--backend <express|nest|none>');
    expect(usage).toContain('--locale <ko|en>');
    expect(usage).toContain('--review, --no-review');
    expect(usage).toContain('--plugin-source <spec>');
    expect(usage).toContain('--package-manager <name>           npm, pnpm, yarn or bun');
    expect(usage).toContain('--ai-hosts <list>                  AI coding tools, comma-separated: claude-code, codex, cursor, gemini-cli');
    expect(usage).toContain('--plugins <list|none>              Optional plugins for the picked AI hosts, comma-separated: ponytail (Claude Code)');
    expect(usage).toContain('--help');
    expect(usage).toContain('--version');
    expect(usage).toContain(
      'doctor, init, add-integration, add-review, add-backend, add-agent-rules, add-github-templates, add-fsd-lite, page, widget, feature, entity, shared, install-integration, record-integration, allow-builds',
    );
  });
});

describe('renderVersion', () => {
  it('returns the CLI_VERSION constant', () => {
    expect(renderVersion()).toBe(CLI_VERSION);
  });

  it('CLI_VERSION matches package.json, so the caret-pinned plugin install follows a release bump', () => {
    const pkg = JSON.parse(readFileSync(join(__dirname, '../package.json'), 'utf-8')) as { version: string };
    expect(CLI_VERSION).toBe(pkg.version);
  });
});

it('nowhere user-facing calls pnpm the default package manager (npm and pnpm are equals)', () => {
  const repo = join(__dirname, '../../..');
  const docs = ['README.md', 'README.ko-KR.md', 'packages/create-nx-archweave/README.md', 'packages/nx-plugin/README.md']
    .concat(readdirSync(join(repo, 'docs')).filter((f) => f.endsWith('.md')).map((f) => `docs/${f}`))
    .concat(readdirSync(join(repo, 'docs/ko-KR')).map((f) => `docs/ko-KR/${f}`));
  const texts = [renderUsage(), ...docs.map((file) => readFileSync(join(repo, file), 'utf-8'))];
  for (const text of texts) {
    expect(text).not.toMatch(/default: pnpm|pnpm \(default\)|pnpm\(기본\)|기본: pnpm|`--package-manager` \| `pnpm` \|/);
  }
});
