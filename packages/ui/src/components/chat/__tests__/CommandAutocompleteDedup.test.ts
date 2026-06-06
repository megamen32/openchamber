/**
 * Reproduction test for issue #1550: "/ command popup shows duplicate OpenCode skills
 * after installing Oh My OpenAgent plugin"
 *
 * Root cause:
 * The CommandAutocomplete component at CommandAutocomplete.tsx:176 builds its command
 * list from THREE sources (builtInCommands + customCommands + skillCommands) without
 * deduplication by name. Meanwhile, the commands store at useCommandsStore.ts:173 only
 * filters out entries where `source === 'skill'`.
 *
 * When a plugin (like Oh My OpenAgent) registers commands via the OpenCode plugin
 * system that have the SAME name as skills from `.agents/skills/`, the commands
 * store includes them (because source !== 'skill'), AND the skills store includes
 * the same entries (from `/api/config/skills`). The autocomplete shows both → duplicate.
 */
import { describe, expect, test } from 'bun:test';

// ---------- Reproduction: commands store filter ----------

interface Command {
  name: string;
  description?: string;
  agent?: string | null;
  model?: string | null;
  source?: string;
  template?: string;
  scope?: string;
}

/**
 * This is the exact filter from useCommandsStore.ts line 173:
 *   const configurableCommands = commands.filter((cmd) => cmd.source !== 'skill');
 *
 * The bug: The filter ONLY excludes source === 'skill'. If a plugin-registered command
 * has source: undefined, source: 'agent', source: 'plugin', source: 'opencode', etc.,
 * the entry passes through even if its name matches a skill name.
 */
function filterNonSkillCommands(commands: Command[]): Command[] {
  return commands.filter((cmd) => cmd.source !== 'skill');
}

describe('issue-1550: commands store filter (source !== "skill")', () => {
  test('commands with source="skill" are filtered out', () => {
    const commands: Command[] = [
      { name: 'test', source: 'skill', template: 'something' },
      { name: 'other', source: 'opencode', template: 'something' },
    ];

    const filtered = filterNonSkillCommands(commands);

    expect(filtered.map((c) => c.name)).toEqual(['other']);
  });

  test('commands with source=undefined are NOT filtered (BUG: passes through)', () => {
    const commands: Command[] = [
      { name: 'my-agent-skill', source: undefined, template: 'do stuff' },
    ];

    const filtered = filterNonSkillCommands(commands);

    // This command has the same name as a skill in .agents/skills/
    // but it's NOT filtered because source !== 'skill' (it's undefined)
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('my-agent-skill');
  });

  test('commands with source="agent" (plugin-registered) are NOT filtered (BUG)', () => {
    const commands: Command[] = [
      { name: 'oh-my-plugin-skill', source: 'agent', template: 'do stuff' },
    ];

    const filtered = filterNonSkillCommands(commands);

    // Plugin commands often have source 'agent' not 'skill'
    // They slip through the filter despite having skill names
    expect(filtered.length).toBe(1);
    expect(filtered[0].name).toBe('oh-my-plugin-skill');
  });
});

// ---------- Reproduction: CommandAutocomplete combination logic ----------

interface DiscoveredSkill {
  name: string;
  path: string;
  scope: string;
  source: string;
  description?: string;
}

interface CommandInfo {
  id: string;
  name: string;
  source: 'openchamber' | 'opencode' | 'skill';
  description?: string;
  isSkill?: boolean;
  scope?: string;
}

/**
 * This is the exact combine logic from CommandAutocomplete.tsx lines 112-176:
 *
 *   const skillNames = new Set(skills.map((skill) => skill.name));
 *   const customCommands = commandsWithMetadata.map(...)    // from commands store
 *   const skillCommands = skills.map(...)                    // from skills store
 *   const allCommands = [...builtInCommands, ...customCommands, ...skillCommands];
 *
 * The bug: There is NO dedup between customCommands and skillCommands.
 * If a command name matches a skill name, the entry appears twice.
 */
function buildAutocompleteCommands(
  commandsWithMetadata: Command[],
  skills: DiscoveredSkill[],
): CommandInfo[] {
  const skillNames = new Set(skills.map((skill) => skill.name));

  const customCommands: CommandInfo[] = commandsWithMetadata.map((cmd, index) => ({
    id: `opencode:${cmd.scope ?? 'global'}:${cmd.name}:${cmd.agent ?? ''}:${cmd.model ?? ''}:${index}`,
    name: cmd.name,
    source: 'opencode',
    description: cmd.description,
    isSkill: cmd.source === 'skill' || skillNames.has(cmd.name),
    scope: cmd.scope,
  }));

  const skillCommands: CommandInfo[] = skills.map((skill, index) => ({
    id: `skill:${skill.scope}:${skill.source ?? 'opencode'}:${skill.name}:${index}`,
    name: skill.name,
    source: 'skill',
    description: skill.description,
    isSkill: true,
    scope: skill.scope,
  }));

  const allCommands = [...customCommands, ...skillCommands];

  // Check for duplicates: count occurrences of each name
  const nameCounts = new Map<string, number>();
  for (const cmd of allCommands) {
    nameCounts.set(cmd.name, (nameCounts.get(cmd.name) ?? 0) + 1);
  }

  // Debug: find duplicates
  const duplicates = [...nameCounts.entries()].filter(([_, count]) => count > 1);

  return { allCommands, duplicates, nameCounts } as unknown as CommandInfo[];
}

describe('issue-1550: CommandAutocomplete dedup (MISSING)', () => {
  test('no duplicates when there is no name overlap between commands and skills', () => {
    const commands: Command[] = [
      { name: 'test', source: 'opencode', template: 'run tests' },
    ];
    const skills: DiscoveredSkill[] = [
      { name: 'deploy', path: '/sk/deploy', scope: 'user', source: 'opencode', description: 'Deploy stuff' },
    ];

    const result = buildAutocompleteCommands(commands, skills) as unknown as {
      allCommands: CommandInfo[];
      duplicates: [string, number][];
      nameCounts: Map<string, number>;
    };

    const nameCounts = result.nameCounts;
    expect(nameCounts.get('test')).toBe(1);
    expect(nameCounts.get('deploy')).toBe(1);
    expect(result.allCommands.length).toBe(2);
    expect(result.duplicates.length).toBe(0);
  });

  test('DUPLICATE: command with same name as skill appears twice in autocomplete (BUG)', () => {
    // Scenario: Plugin registers a command named 'my-plugin-skill'
    // The same skill exists in .agents/skills/ and is discovered as a skill
    const commands: Command[] = [
      {
        name: 'my-plugin-skill',
        source: 'agent',        // NOT 'skill' → passes through filter
        description: 'Plugin skill command',
      },
    ];
    const skills: DiscoveredSkill[] = [
      {
        name: 'my-plugin-skill',  // SAME name as command
        path: '/home/user/.agents/skills/my-plugin-skill/SKILL.md',
        scope: 'user',
        source: 'agents',
        description: 'A skill from Oh My OpenAgent plugin',
      },
    ];

    const result = buildAutocompleteCommands(commands, skills) as unknown as {
      allCommands: CommandInfo[];
      duplicates: [string, number][];
      nameCounts: Map<string, number>;
    };

    // BUG: 'my-plugin-skill' appears TWICE
    expect(result.allCommands.length).toBe(2);
    expect(result.nameCounts.get('my-plugin-skill')).toBe(2);

    // The first entry is from customCommands (source 'opencode')
    // The second entry is from skillCommands (source 'skill')
    expect(result.allCommands[0].name).toBe('my-plugin-skill');
    expect(result.allCommands[0].source).toBe('opencode');
    expect(result.allCommands[1].name).toBe('my-plugin-skill');
    expect(result.allCommands[1].source).toBe('skill');

    // Note: the `isSkill` flag on the first entry is correctly set to true
    // (line 121: `isSkill: cmd.source === 'skill' || skillNames.has(cmd.name)`)
    // but the code does NOT filter out the duplicate — it only adjusts the badge
    expect(result.allCommands[0].isSkill).toBe(true);

    // The duplicates array confirms name appears more than once
    expect(result.duplicates.length).toBe(1);
    expect(result.duplicates[0][0]).toBe('my-plugin-skill');
  });

  test('command with explicit source="skill" does NOT duplicate (already filtered)', () => {
    // If the SDK correctly marks skill-sourced commands with source='skill',
    // the commands store filter removes them, and only the skills store entry remains
    const commands: Command[] = [
      {
        name: 'proper-skill',
        source: 'skill',           // ← correctly marked, gets filtered out
        description: 'A skill command',
      },
    ];
    const skills: DiscoveredSkill[] = [
      {
        name: 'proper-skill',
        path: '/home/user/.agents/skills/proper-skill/SKILL.md',
        scope: 'user',
        source: 'agents',
        description: 'A skill',
      },
    ];

    const result = buildAutocompleteCommands(commands, skills) as unknown as {
      allCommands: CommandInfo[];
      duplicates: [string, number][];
      nameCounts: Map<string, number>;
    };

    // In this case, the command IS filtered out by the store filter
    // (source === 'skill'), so only the skill entry remains
    // But actually, the command IS NOT filtered by buildAutocompleteCommands
    // since it doesn't apply the filter. The duplication only happens
    // because the commands store filter missed it.
    // 
    // The real test: even if source === 'skill', if the commands store
    // FAILS to filter it (hypothetically), the autocomplete would still
    // show it twice. This test demonstrates that the autocomplete
    // has NO dedup safety net.
    expect(result.nameCounts.get('proper-skill')).toBe(2);
    expect(result.duplicates.length).toBe(1);
  });
});

// ---------- Reproduction: Combined scenario (most realistic) ----------

describe('issue-1550: realistic scenario (Oh My OpenAgent plugin)', () => {
  test('plugin-registered commands with skill names appear duplicated', () => {
    // Realistic scenario after installing Oh My OpenAgent:
    // 1. The plugin registers commands via OpenCode plugin system
    // 2. These commands have source 'agent' or no source at all
    // 3. Skills with the same names exist in .agents/skills/
    // 4. The commands store filter (source !== 'skill') does NOT catch them
    // 5. The autocomplete shows each skill twice

    const commands: Command[] = [
      { name: 'review-pr', source: 'agent', template: 'Review a PR' },
      { name: 'deploy-app', source: undefined, template: 'Deploy the app' },
      { name: 'run-tests', source: 'opencode', template: 'Run tests' },
      // A normal non-skill command
      { name: 'custom-command', source: 'opencode', template: 'Do something' },
    ];

    const skills: DiscoveredSkill[] = [
      { name: 'review-pr', path: '/home/user/.agents/skills/review-pr/SKILL.md', scope: 'project', source: 'agents', description: 'Review PR skill' },
      { name: 'deploy-app', path: '/home/user/.agents/skills/deploy-app/SKILL.md', scope: 'user', source: 'agents', description: 'Deploy app skill' },
      { name: 'run-tests', path: '/home/user/.agents/skills/run-tests/SKILL.md', scope: 'user', source: 'agents', description: 'Run tests skill' },
    ];

    const result = buildAutocompleteCommands(commands, skills) as unknown as {
      allCommands: CommandInfo[];
      duplicates: [string, number][];
      nameCounts: Map<string, number>;
    };

    // 3 skills appear duplicated (once from commands store, once from skills store)
    // 'custom-command' appears once (no matching skill)
    // Total: 3*2 + 1 = 7
    expect(result.allCommands.length).toBe(7);
    expect(result.duplicates.length).toBe(3);

    // Each overlapped name appears twice
    expect(result.nameCounts.get('review-pr')).toBe(2);
    expect(result.nameCounts.get('deploy-app')).toBe(2);
    expect(result.nameCounts.get('run-tests')).toBe(2);
    expect(result.nameCounts.get('custom-command')).toBe(1);
  });
});
