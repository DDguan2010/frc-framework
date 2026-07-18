import { executeCommand, type CommandResult, type DomainCommand } from './commands.js';
import type { FrcProjectModel } from './model.js';

interface HistoryEntry {
  readonly command: DomainCommand;
  readonly inverse: DomainCommand;
}

export class DomainSession {
  #model: FrcProjectModel;
  #undo: HistoryEntry[] = [];
  #redo: HistoryEntry[] = [];
  #checkpoint = 0;

  constructor(initial: FrcProjectModel) {
    this.#model = structuredClone(initial);
  }

  get model(): FrcProjectModel {
    return this.#model;
  }

  get canUndo(): boolean {
    return this.#undo.length > 0;
  }

  get canRedo(): boolean {
    return this.#redo.length > 0;
  }

  get isClean(): boolean {
    return this.#undo.length === this.#checkpoint;
  }

  execute(command: DomainCommand): CommandResult {
    const result = executeCommand(this.#model, command);
    this.#model = result.model;
    this.#undo.push({ command, inverse: result.inverse });
    this.#redo = [];
    return result;
  }

  executeMerged(label: string, commands: readonly DomainCommand[]): CommandResult {
    return this.execute({ commands, label, type: 'batch' });
  }

  undo(): CommandResult | undefined {
    const entry = this.#undo.pop();
    if (entry === undefined) {
      return undefined;
    }
    const result = executeCommand(this.#model, entry.inverse);
    this.#model = result.model;
    this.#redo.push(entry);
    return result;
  }

  redo(): CommandResult | undefined {
    const entry = this.#redo.pop();
    if (entry === undefined) {
      return undefined;
    }
    const result = executeCommand(this.#model, entry.command);
    this.#model = result.model;
    this.#undo.push(entry);
    return result;
  }

  markClean(): void {
    this.#checkpoint = this.#undo.length;
  }

  replaceFromDisk(model: FrcProjectModel): void {
    this.#model = structuredClone(model);
    this.#undo = [];
    this.#redo = [];
    this.#checkpoint = 0;
  }
}
