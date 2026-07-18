# Recovery guide

Project changes are previewed and committed as filesystem transactions. If the application or system
stops during a write, reopen the project: recovery completes or rolls back the transaction journal
before the model is loaded.

- Discard an unapplied Diff to leave the project untouched.
- Use the project's command history to undo structured edits that were already applied.
- Schema migrations create a timestamped `project.yaml` backup before writing.
- If Java changed outside the application, choose **Reload**, **Compare**, **Keep code & unmanage**, or
  **Regenerate**. Regeneration always requires a reviewed Diff and never silently wins a conflict.
- An unmanaged file is ordinary user code. Remove it from `unmanagedFiles` only when you deliberately
  want FRC Framework to generate it again, then review the resulting Diff.
- Diagnostic reports contain validation and build summaries but do not include entire Java files or
  network credentials. Exporting or uploading a report is always an explicit user action.

Keep the repository in version control. For serious corruption, close FRC Framework, copy the project
folder, restore `project.yaml` from its migration backup or version control, and reopen the copy first.
