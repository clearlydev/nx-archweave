import { invalidWorkspaceNameMessage, workspaceNameProblem } from './workspace-name.ts';

describe('workspaceNameProblem', () => {
  it.each(['my-app', 'app', 'my_app', 'my.app', 'app2', 'a'.repeat(214)])('accepts %s', (name) => {
    expect(workspaceNameProblem(name)).toBeUndefined();
  });

  it('refuses an empty name', () => {
    expect(workspaceNameProblem('')).toBe('it is empty');
  });

  it('refuses uppercase letters', () => {
    expect(workspaceNameProblem('My-App')).toBe('it contains uppercase letters, and npm package names are lowercase');
  });

  it('refuses whitespace', () => {
    expect(workspaceNameProblem('my app')).toBe('it contains whitespace');
    expect(workspaceNameProblem('my\tapp')).toBe('it contains whitespace');
  });

  it('refuses a leading "." or "_"', () => {
    expect(workspaceNameProblem('.app')).toBe('it starts with "."');
    expect(workspaceNameProblem('_app')).toBe('it starts with "_"');
  });

  it('refuses a name longer than 214 characters', () => {
    expect(workspaceNameProblem('a'.repeat(215))).toBe('it is 215 characters long, and npm allows at most 214');
  });

  it('refuses shell metacharacters and names each one once', () => {
    // The space is caught first; without it, the metacharacters themselves are named.
    expect(workspaceNameProblem('my-app; rm -rf ~')).toBe('it contains whitespace');
    expect(workspaceNameProblem('my-app;rm&&echo~')).toBe(
      'it contains ";", "&", "~" — only lowercase letters, digits, "-", "_" and "." are allowed',
    );
    expect(workspaceNameProblem('%path%')).toBe('it contains "%" — only lowercase letters, digits, "-", "_" and "." are allowed');
  });
});

describe('invalidWorkspaceNameMessage', () => {
  it('names the rule that failed and shows a valid example', () => {
    expect(invalidWorkspaceNameMessage('My-App', 'it contains uppercase letters, and npm package names are lowercase')).toBe(
      'Invalid workspace name "My-App": it contains uppercase letters, and npm package names are lowercase. For example: my-app',
    );
  });
});
