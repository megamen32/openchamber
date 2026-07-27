import React from 'react';
import { describe, expect, mock, test } from 'bun:test';
import { renderToStaticMarkup } from 'react-dom/server';

import type { CallableAction } from '@/lib/opencode/tool-call-client';

type MockMenuProps = React.PropsWithChildren<{
  disabled?: boolean;
  className?: string;
  align?: string;
}>;

mock.module('@/components/ui/dropdown-menu', () => ({
  DropdownMenu: ({ children }: MockMenuProps) => <div data-dropdown-root>{children}</div>,
  DropdownMenuTrigger: ({ children }: MockMenuProps) => <div data-dropdown-trigger>{children}</div>,
  DropdownMenuContent: ({ children }: MockMenuProps) => <div data-dropdown-content>{children}</div>,
  DropdownMenuItem: ({ children, disabled }: MockMenuProps) => <div data-disabled={disabled ? 'true' : undefined}>{children}</div>,
}));

mock.module('@/components/ui/button', () => ({
  Button: ({ children, ...props }: React.PropsWithChildren<Record<string, unknown>>) => <button {...props}>{children}</button>,
}));

mock.module('@/components/ui/icon', () => ({
  Icon: ({ name }: { name: string }) => <span>{name}</span>,
}));

const { ComposerToolMenuContent } = await import('../ComposerToolMenu');

describe('ComposerToolMenuContent', () => {
  test('renders the unsupported state for discovered Task and MCP actions', () => {
    const actions: CallableAction[] = [
      {
        kind: 'task',
        id: 'task:planner',
        label: 'Task: planner',
        supported: false,
        unsupportedReason: 'Direct Task/MCP invocation is not exposed by the current OpenCode runtime.',
      },
      {
        kind: 'mcp',
        id: 'mcp:github',
        label: 'MCP: github',
        supported: false,
        unsupportedReason: 'Direct Task/MCP invocation is not exposed by the current OpenCode runtime.',
      },
    ];

    const markup = renderToStaticMarkup(
      <ComposerToolMenuContent
        actions={actions}
        loading={false}
        onSelectAction={() => undefined}
      />,
    );

    expect(markup).toContain('Task: planner');
    expect(markup).toContain('MCP: github');
    expect(markup).toContain('Unsupported');
    expect(markup).toContain('Direct Task/MCP invocation is not exposed by the current OpenCode runtime.');
    expect(markup).toContain('data-action-kind="task"');
    expect(markup).toContain('data-action-kind="mcp"');
  });

  test('renders an explicit empty state when no runtime-backed actions are discovered', () => {
    const markup = renderToStaticMarkup(
      <ComposerToolMenuContent
        actions={[]}
        loading={false}
        onSelectAction={() => undefined}
      />,
    );

    expect(markup).toContain('No Task or MCP actions were discovered for this session.');
  });
});
