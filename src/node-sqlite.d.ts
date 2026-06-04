// Minimal ambient types for Node's built-in `node:sqlite` module.
//
// The runtime is Node 24 (Electron 42), where this module is built in, but the
// project's pinned @types/node (v20) predates its typings. Rather than bump
// @types/node (broad blast radius), declare just the surface Sesh uses. If
// @types/node is later upgraded to a version that ships these types, delete
// this file.
declare module "node:sqlite" {
  export interface StatementResultingChanges {
    changes: number | bigint;
    lastInsertRowid: number | bigint;
  }

  export class StatementSync {
    run(...params: unknown[]): StatementResultingChanges;
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    setAllowUnknownNamedParameters(enabled: boolean): void;
    setAllowBareNamedParameters(enabled: boolean): void;
    setReadBigInts(enabled: boolean): void;
    readonly sourceSQL: string;
  }

  export interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
    enableDoubleQuotedStringLiterals?: boolean;
  }

  export class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
