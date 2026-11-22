// Ready-made crews for `crewroom init`. Rules use patterns any setup can hit, except "kil",
// which is B1Kjuu's own setup (kept identical to examples/kil.office.config.json by a test).
import type { OfficeConfig } from '../shared/config-schema.js';

type Worker = OfficeConfig['workers'][number];

const SOURCES: OfficeConfig['sources'] = { inbox: { enabled: true, path: null }, log: [], webhook: { enabled: true } };

const w = (id: string, name: string, n: number, color: string): Worker => ({
  id,
  name,
  sprite: `crew-${n}` as Worker['sprite'],
  color,
  home: `console-${n}` as Worker['home'],
});

const DEVELOPER = (n: number) => w('developer', 'Developer', n, '#e8452c');
const DESIGNER = (n: number) => w('designer', 'Designer', n, '#c86bd6');
const WRITER = (n: number) => w('writer', 'Writer', n, '#5fd08a');
const EDITOR = (n: number) => w('editor', 'Editor', n, '#3aa7ff');
const RESEARCHER = (n: number) => w('researcher', 'Researcher', n, '#ffcf5c');
const OPERATOR = (n: number) => w('operator', 'Operator', n, '#ff8a3d');

const R = {
  designer: { worker: 'designer', when: { skill: ['*design*', '*ui*', '*figma*', '*animat*'] } },
  figma: { worker: 'designer', when: { tool: 'mcp__*figma*__*' } },
  writer: { worker: 'writer', when: { skill: ['*writ*', '*caption*', '*copy*'] } },
  editorSkill: { worker: 'editor', when: { skill: ['*video*', '*edit*', '*capcut*'] } },
  capcut: { worker: 'editor', when: { tool: 'mcp__capcut__*' }, action: 'editing' },
  ffmpeg: { worker: 'editor', when: { command: 'ffmpeg*' }, action: 'rendering' },
  researcher: { worker: 'researcher', when: { skill: ['*research*', '*search*'] } },
  operator: { worker: 'operator', when: { tool: ['mcp__*slack*__*', 'mcp__*gmail*__*', 'mcp__*whatsapp*__*'] } },
} satisfies Record<string, OfficeConfig['rules'][number]>;

const VIDEO_ACTIONS: OfficeConfig['actions'] = {
  editing: { label: 'editing', anim: 'type' },
  rendering: { label: 'rendering', anim: 'run' },
};

const make = (name: string, workers: Worker[], rules: OfficeConfig['rules'], actions: OfficeConfig['actions'] = {}): OfficeConfig => ({
  office: { name, setting: 'crew-deck' },
  workers,
  rules,
  fallback: 'developer',
  actions,
  layout: null,
  sources: SOURCES,
});

const KIL: OfficeConfig = {
  office: {
    name: 'Kil crew deck',
    setting: 'crew-deck'
  },
  workers: [
    {
      id: 'developer',
      name: 'Developer',
      sprite: 'crew-1',
      color: '#e8452c',
      home: 'console-1'
    },
    {
      id: 'designer',
      name: 'Designer',
      sprite: 'crew-2',
      color: '#c86bd6',
      home: 'console-2'
    },
    {
      id: 'editor',
      name: 'Editor',
      sprite: 'crew-3',
      color: '#3aa7ff',
      home: 'console-3'
    },
    {
      id: 'writer',
      name: 'Writer',
      sprite: 'crew-4',
      color: '#5fd08a',
      home: 'console-4'
    },
    {
      id: 'researcher',
      name: 'Researcher',
      sprite: 'crew-5',
      color: '#ffcf5c',
      home: 'console-5'
    },
    {
      id: 'operator',
      name: 'Operator',
      sprite: 'crew-6',
      color: '#ff8a3d',
      home: 'console-6'
    },
    {
      id: 'advisor',
      name: 'Advisor',
      sprite: 'crew-7',
      color: '#9aa4ff',
      home: 'console-7'
    },
    {
      id: 'scout',
      name: 'Scout',
      sprite: 'crew-8',
      color: '#4fd1c5',
      home: 'console-8'
    }
  ],
  rules: [
    {
      worker: 'advisor',
      when: {
        source: 'log',
        text: [
          '*brief*',
          '*health check*'
        ]
      }
    },
    {
      worker: 'scout',
      when: {
        source: 'log',
        text: [
          '*gmail*',
          '*scan*'
        ]
      }
    },
    {
      worker: 'editor',
      when: {
        skill: 'b1kjuu-editor'
      }
    },
    {
      worker: 'editor',
      when: {
        tool: 'mcp__capcut__*'
      },
      action: 'editing'
    },
    {
      worker: 'editor',
      when: {
        command: 'ffmpeg*'
      },
      action: 'rendering'
    },
    {
      worker: 'editor',
      when: {
        path: 'EDITS/**'
      }
    },
    {
      worker: 'writer',
      when: {
        skill: [
          'b1kjuu-writer',
          'avoid-ai-writing:*',
          'ig-human'
        ]
      }
    },
    {
      worker: 'designer',
      when: {
        skill: [
          'b1kjuu-design',
          'impeccable',
          'emil-design-eng',
          'animate'
        ]
      }
    },
    {
      worker: 'designer',
      when: {
        tool: 'mcp__TalkToFigma__*'
      }
    },
    {
      worker: 'researcher',
      when: {
        skill: [
          'kil-research',
          'anthropic-skills:deep-research'
        ]
      }
    },
    {
      worker: 'operator',
      when: {
        tool: 'mcp__whatsapp__*'
      }
    },
    {
      worker: 'developer',
      when: {
        skill: [
          'b1kjuu-dev',
          'superpowers:*'
        ]
      }
    },
    {
      worker: 'editor',
      when: {
        cwd: [
          'EDITS',
          'EDITS/**'
        ]
      }
    }
  ],
  fallback: 'developer',
  actions: {
    editing: {
      label: 'editing',
      anim: 'type'
    },
    rendering: {
      label: 'rendering',
      anim: 'run'
    }
  },
  layout: null,
  sources: {
    inbox: {
      enabled: true,
      path: null
    },
    log: [
      {
        path: '~/Documents/b1kjuuu-brain/log.md'
      }
    ],
    webhook: {
      enabled: true
    }
  }
};

export const PRESETS: Record<string, { label: string; config: OfficeConfig }> = {
  'solo-dev': {
    label: 'Solo dev (Developer, Designer, Researcher)',
    config: make('Dev deck', [DEVELOPER(1), DESIGNER(2), RESEARCHER(3)], [R.designer, R.figma, R.researcher]),
  },
  creator: {
    label: 'Content creator (Editor, Writer, Designer, Researcher, Developer)',
    config: make(
      'Studio deck',
      [EDITOR(1), WRITER(2), DESIGNER(3), RESEARCHER(4), DEVELOPER(5)],
      [R.capcut, R.ffmpeg, R.editorSkill, R.writer, R.designer, R.figma, R.researcher],
      VIDEO_ACTIONS,
    ),
  },
  agency: {
    label: 'Agency (Developer, Designer, Writer, Editor, Researcher, Operator)',
    config: make(
      'Agency deck',
      [DEVELOPER(1), DESIGNER(2), WRITER(3), EDITOR(4), RESEARCHER(5), OPERATOR(6)],
      [R.capcut, R.ffmpeg, R.editorSkill, R.writer, R.designer, R.figma, R.researcher, R.operator],
      VIDEO_ACTIONS,
    ),
  },
  kil: { label: "Kil (B1Kjuu's own setup)", config: KIL },
};
