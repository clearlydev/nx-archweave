import type { ToolkitFrontend } from '@nx-archweave/shared';
import type { FsdLayer } from '../fsd/fsd-eslint-config.ts';

/**
 * What nx-archweave needs to know about a frontend framework, in one place: the generators,
 * the layer guide and the rule read these values and never branch on a framework name.
 * A framework nx-archweave does not recognise gets `generic`: the common FSD rules, no
 * renamed layers, and a report that says so.
 */
export interface FrameworkProfile {
  id: ToolkitFrontend;
  /** False only for `generic`, so a report can say the framework was not recognised. */
  recognised: boolean;
  /** The layers the guide lists and the generators serve. */
  layers: FsdLayer[];
  /** Layers whose directory is not the layer's own name (a router owns that name). */
  layerDirs: Partial<Record<FsdLayer, string>>;
  /** Output the framework writes inside the app, kept out of the rule's files. */
  buildOutputDirs: string[];
  /** Platform suffixes whose `index.<suffix>.<ext>` is a public API (React Native resolves
   * `index.ios.tsx` for `index`). */
  platformSuffixes: string[];
  /** Folders the framework's router owns inside the source root that are not an FSD layer of
   * the same name (Next.js's Pages Router `pages/`, next to FSD's `_pages/`). */
  routerDirs: string[];
}

const ALL_LAYERS: FsdLayer[] = ['app', 'pages', 'features', 'entities', 'shared'];

const NEXT: FrameworkProfile = {
  id: 'next',
  recognised: true,
  // Next.js's own app/ (App Router) directory is the composition root; FSD's Next.js guide
  // names the FSD app and pages layers _app and _pages, since Next.js reads src/app and
  // src/pages as its routers.
  layers: ['pages', 'features', 'entities', 'shared'],
  layerDirs: { app: '_app', pages: '_pages' },
  buildOutputDirs: ['.next', 'out'],
  platformSuffixes: [],
  routerDirs: ['pages'],
};

const REACT_VITE: FrameworkProfile = {
  id: 'react-vite',
  recognised: true,
  layers: ALL_LAYERS,
  layerDirs: {},
  buildOutputDirs: ['dist'],
  platformSuffixes: [],
  routerDirs: [],
};

/** Expo with expo-router (the default since SDK 50): the router reads `app/` as its routes, so
 * FSD's app layer moves to `_app`, as on Next.js. */
const EXPO_ROUTER: FrameworkProfile = {
  id: 'expo',
  recognised: true,
  layers: ALL_LAYERS,
  layerDirs: { app: '_app' },
  buildOutputDirs: ['.expo', 'dist'],
  platformSuffixes: ['ios', 'android', 'native', 'web'],
  routerDirs: [],
};

/** Expo without a file-system router: `app/` is FSD's app layer itself. */
const EXPO: FrameworkProfile = { ...EXPO_ROUTER, layerDirs: {} };

const GENERIC: FrameworkProfile = {
  id: 'generic',
  recognised: false,
  layers: ALL_LAYERS,
  layerDirs: {},
  buildOutputDirs: ['dist', 'build'],
  platformSuffixes: [],
  routerDirs: [],
};

const PROFILES: Record<ToolkitFrontend, FrameworkProfile> = { next: NEXT, 'react-vite': REACT_VITE, expo: EXPO_ROUTER, generic: GENERIC };

export function profileById(id: ToolkitFrontend): FrameworkProfile {
  return PROFILES[id];
}

/** Every profile, in a fixed order. */
export function allFrameworkProfiles(): FrameworkProfile[] {
  return Object.values(PROFILES);
}

export interface FrameworkDetectionInput {
  exists(path: string): boolean;
  read(path: string): string | null | undefined;
  /** The project's root, `.` (or empty) for a project at the workspace root. */
  projectRoot: string;
  /** The executors of the project's declared targets (project.json / package.json `nx`). */
  executors?: string[];
}

const NEXT_CONFIGS = ['next.config.js', 'next.config.mjs', 'next.config.ts', 'next.config.cjs'];
const VITE_CONFIGS = ['vite.config.ts', 'vite.config.mts', 'vite.config.js', 'vite.config.mjs'];
const EXPO_CONFIGS = ['app.config.ts', 'app.config.js', 'app.config.mjs'];

function hasExpoKey(input: FrameworkDetectionInput, file: string): boolean {
  const text = input.read(file);
  if (typeof text !== 'string') return false;
  try {
    return typeof (JSON.parse(text) as Record<string, unknown>)['expo'] === 'object';
  } catch {
    return false;
  }
}

function dependsOn(input: FrameworkDetectionInput, manifest: string, name: string): boolean {
  const text = input.read(manifest);
  if (typeof text !== 'string') return false;
  try {
    const parsed = JSON.parse(text) as Record<string, Record<string, unknown> | undefined>;
    return ['dependencies', 'devDependencies', 'peerDependencies'].some((field) => parsed[field]?.[name] !== undefined);
  } catch {
    return false;
  }
}

/** The project's framework from what is on disk: its config files, its executors and the
 * dependencies of its own or the workspace's package.json. */
export function detectFramework(input: FrameworkDetectionInput): FrameworkProfile {
  const prefix = input.projectRoot === '' || input.projectRoot === '.' ? '' : `${input.projectRoot}/`;
  const executors = input.executors ?? [];
  if (NEXT_CONFIGS.some((file) => input.exists(`${prefix}${file}`)) || executors.some((executor) => executor.startsWith('@nx/next:'))) {
    return NEXT;
  }
  const dependsAnywhere = (name: string): boolean => dependsOn(input, `${prefix}package.json`, name) || dependsOn(input, 'package.json', name);
  const usesExpo =
    executors.some((executor) => executor.startsWith('@nx/expo:')) ||
    hasExpoKey(input, `${prefix}app.json`) ||
    EXPO_CONFIGS.some((file) => input.exists(`${prefix}${file}`)) ||
    dependsOn(input, `${prefix}package.json`, 'expo');
  if (usesExpo) return dependsAnywhere('expo-router') ? EXPO_ROUTER : EXPO;
  const usesReact = dependsAnywhere('react');
  const usesVite = VITE_CONFIGS.some((file) => input.exists(`${prefix}${file}`)) || executors.some((executor) => executor.startsWith('@nx/vite:'));
  if (usesVite && usesReact) return REACT_VITE;
  return GENERIC;
}
