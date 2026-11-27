# Roles and access plan (planning only, nothing built yet)

Date: 2026-11-27

## Idea
Each team member signs in with their own GitHub account. The project owner (the Editor) decides who is Designer, UX writer or another role. GitHub enforces the access. The role box in the editor is not a permission.

## How GitHub does it
- **Collaborators:** the owner adds people in Settings → Collaborators (or through a team), each with a level: Read, Write, Maintain or Admin.
- **Only write access can save or merge.** Without write access a person cannot save a version, open a pull request, or merge. This is the real control.
- **Roles are a file, not a GitHub permission.** GitHub has no built-in Designer or UX writer level. Roles live in one file, for example `people.yml`:

  ```yaml
  designer:  [name-of-designer-1, name-of-designer-2]
  writer:    [name-of-writer]
  editor:    [name-of-editor]
  ```

- **The editor page and the checks read that file.** A person sees only the buttons for their role. The check and the merge step refuse anyone not listed.

## What a person needs
- A GitHub account.
- Write access, given by the owner.
- Their own token, as now.

## Ending a role
Remove the name from the file. Also remove write access in Settings → Collaborators if the person leaves the team.

## Limits
- Only the editor can merge. This rule moves into the file.
- Role-based control on a private repository needs a paid plan on a personal account. The company GitHub already has it.
- The page is public: anyone can read the content and the file. Only write-access accounts can change them.

## Open questions for the owner
1. Which GitHub organisation or repository holds the real project (for example the company GitHub)?
2. Can one person hold two roles, for example designer and writer?
